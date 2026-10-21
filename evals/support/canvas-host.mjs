import { register } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { CanvasError, getRegisteredCanvases } from "./brainstorm-sdk.mjs";

export const CANVAS_ID = "marketplace-starter-brainstorm";
export const LIMITS = Object.freeze({
  panels: 4,
  queuedCalls: 32,
  messageBytes: 64 * 1024,
  runtimeMs: 10 * 60_000,
  shutdownMs: 5_000,
});

const sessionId = "brainstorm-eval-session";
const expectedErrors = new Set([
  "invalid_input", "invalid_note", "unknown_tool", "unknown_action",
  "unknown_instance", "panel_limit", "fixture_closed", "fixture_busy",
]);
let created = false;

function toolDefinitions(canvas) {
  const canvasId = { type: "string", const: CANVAS_ID };
  const instanceId = { type: "string", minLength: 1, maxLength: 128, pattern: "\\S" };
  const object = (properties, required) => ({ type: "object", additionalProperties: false, properties, required });
  return [
    {
      name: "list_canvas_capabilities",
      description: "Inspect the real team-brainstorm action contracts in this evaluation-only headless SDK transport. This does not test native Copilot or VS Code rendering.",
      inputSchema: object({ canvasId }, ["canvasId"]),
    },
    {
      name: "open_canvas",
      description: `Open a headless SDK-contract panel using the real extension's HTTP server and lifecycle, not a native UI window. Reusing a handle is idempotent. At most ${LIMITS.panels} panels; no localhost URL is exposed.`,
      inputSchema: object({ canvasId, instanceId }, ["canvasId", "instanceId"]),
    },
    {
      name: "invoke_canvas_action",
      description: "Invoke a real registered brainstorm action on an opened headless panel. Read get_board to discover generated note IDs. Use the source action schema for save_note/remove_note; omit input or use null for get_board. Notes persist for this fixture session.",
      inputSchema: object({
        instanceId,
        actionName: { type: "string", enum: canvas.actions.map((action) => action.name) },
        input: { type: ["object", "null"] },
      }, ["instanceId", "actionName"]),
    },
  ];
}

export async function createBrainstormFixture() {
  if (created) throw new Error("Start a fresh process for a new brainstorm eval session.");
  created = true;
  register(new URL("./brainstorm-loader.mjs", import.meta.url));
  await import("../../plugins/team-brainstorm/com.github.copilot/extensions/brainstorm/extension.mjs");
  const canvases = getRegisteredCanvases();
  const canvas = canvases[0];
  if (canvases.length !== 1 || canvas.id !== CANVAS_ID
    || typeof canvas.open !== "function" || typeof canvas.onClose !== "function") {
    throw new Error("The real brainstorm canvas registration is incompatible with this fixture.");
  }

  const ajv = new Ajv({ allErrors: true });
  const tools = toolDefinitions(canvas);
  const toolValidators = new Map(tools.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]));
  const actions = new Map(canvas.actions.map((action) => {
    if (typeof action.handler !== "function") throw new Error(`Missing real handler: ${action.name}`);
    return [action.name, { ...action, validate: action.inputSchema ? ajv.compile(action.inputSchema) : undefined }];
  }));
  if (actions.size !== canvas.actions.length || !actions.has("save_note")) {
    throw new Error("The real brainstorm action registration is incompatible with this fixture.");
  }
  await actions.get("save_note").handler({
    sessionId,
    input: { text: "Keep onboarding simple", column: "ideas" },
  });

  const panels = new Map();
  let queue = Promise.resolve();
  let pending = 0;
  let closing = false;
  let cleanup;
  function validate(check, input, label) {
    if (!check(input)) {
      throw new CanvasError("invalid_input", `${label}: ${ajv.errorsText(check.errors, { separator: "; " })}`);
    }
  }
  function panelFor(instanceId) {
    const panel = panels.get(instanceId);
    if (!panel?.opened) throw new CanvasError("unknown_instance", "Open this instanceId before using its actions.");
    return panel;
  }
  function enqueue(operation) {
    if (closing) return Promise.reject(new CanvasError("fixture_closed", "The fixture session is closing."));
    if (pending >= LIMITS.queuedCalls) return Promise.reject(new CanvasError("fixture_busy", "Too many pending fixture calls."));
    pending += 1;
    const result = queue.then(operation);
    queue = result.then(() => { pending -= 1; }, () => { pending -= 1; });
    return result;
  }

  return {
    tools,
    callTool(name, input) {
      return enqueue(async () => {
        const check = toolValidators.get(name);
        if (!check) throw new CanvasError("unknown_tool", `Unsupported tool: ${name}`);
        validate(check, input, name);
        if (name === "list_canvas_capabilities") {
          return {
            canvasId: canvas.id,
            displayName: canvas.displayName,
            actions: canvas.actions.map(({ name, description, inputSchema }) => ({
              name, description, ...(inputSchema === undefined ? {} : { inputSchema }),
            })),
            transport: "headless-sdk-contract",
          };
        }
        const { instanceId } = input;
        if (name === "open_canvas") {
          if (!panels.has(instanceId)) {
            if (panels.size >= LIMITS.panels) throw new CanvasError("panel_limit", `At most ${LIMITS.panels} panels may be open.`);
            const context = { sessionId, instanceId };
            // Keep the private descriptor only for lifecycle/HTTP tests, never in MCP results.
            const panel = { context };
            panels.set(instanceId, panel);
            panel.opened = await canvas.open(context);
          }
          return { canvasId: canvas.id, instanceId, title: panelFor(instanceId).opened.title, headless: true };
        }
        const panel = panelFor(instanceId);
        const action = actions.get(input.actionName);
        if (!action) throw new CanvasError("unknown_action", `Unsupported action: ${input.actionName}`);
        if (action.validate) validate(action.validate, input.input, input.actionName);
        else if (input.input != null && Object.keys(input.input).length !== 0) {
          throw new CanvasError("invalid_input", `${input.actionName} does not take input.`);
        }
        const board = await action.handler({ ...panel.context, input: input.input });
        return { canvasId: canvas.id, instanceId, actionName: action.name, board };
      });
    },
    // Internal lifecycle hooks are deliberately absent from the three MCP tools.
    panelUrl(instanceId) {
      return panelFor(instanceId).opened.url;
    },
    closePanel(instanceId) {
      return enqueue(async () => {
        const panel = panelFor(instanceId);
        try {
          await canvas.onClose(panel.context);
        } finally {
          panels.delete(instanceId);
        }
      });
    },
    close() {
      if (!cleanup) {
        closing = true;
        cleanup = queue.then(async () => {
          const results = await Promise.allSettled([...panels.values()].map((panel) => canvas.onClose(panel.context)));
          panels.clear();
          const failures = results.filter((result) => result.status === "rejected");
          if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Panel cleanup failed.");
        });
      }
      return cleanup;
    },
  };
}

export async function runStdio(factory = createBrainstormFixture) {
  let server;
  let bootstrap;
  let stopping = false;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const report = (error) => {
    process.exitCode = 1;
    process.stderr.write(`[brainstorm headless-sdk-contract] ${String(error?.stack ?? error)}\n`);
  };
  const stop = (error) => {
    if (error) report(error);
    if (stopping) return done;
    stopping = true;
    clearTimeout(lifetime);
    const deadline = setTimeout(() => {
      report(new Error("Headless fixture cleanup exceeded its deadline."));
      process.exit(1);
    }, LIMITS.shutdownMs);
    void (async () => {
      try {
        const fixture = await bootstrap;
        await fixture?.close();
      } catch (error) {
        report(error);
      }
      try {
        await server?.close();
      } catch (error) {
        report(error);
      } finally {
        clearTimeout(deadline);
        process.stdin.off("end", onEnd);
        process.stdin.off("close", onEnd);
        process.stdout.off("error", onError);
        process.off("SIGINT", onEnd);
        process.off("SIGTERM", onEnd);
        process.off("uncaughtException", onError);
        process.off("unhandledRejection", onError);
        process.stdin.pause();
        finish();
      }
    })();
    return done;
  };
  const onEnd = () => { void stop(); };
  const onError = (error) => { void stop(error); };
  const lifetime = setTimeout(() => onError(new Error("Headless fixture exceeded its ten-minute lifetime.")), LIMITS.runtimeMs);
  process.stdin.once("end", onEnd);
  process.stdin.once("close", onEnd);
  process.stdout.on("error", onError);
  process.once("SIGINT", onEnd);
  process.once("SIGTERM", onEnd);
  process.on("uncaughtException", onError);
  process.on("unhandledRejection", onError);
  bootstrap = Promise.resolve().then(factory);
  try {
    const fixture = await bootstrap;
    if (!stopping) {
      server = new Server({ name: "team-brainstorm-headless-sdk-contract", version: "1.0.0" }, {
        capabilities: { tools: {} },
        instructions: "Evaluation-only headless SDK contract for the real team-brainstorm asset. It does not render native Copilot or VS Code UI. Discover capabilities, open a stable instanceId, then read the board to obtain note IDs.",
      });
      server.onclose = onEnd;
      server.onerror = onError;
      server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: fixture.tools }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        try {
          const result = await fixture.callTool(params.name, params.arguments);
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          if (error instanceof CanvasError && expectedErrors.has(error.code)) {
            return { isError: true, content: [{ type: "text", text: `${error.code}: ${error.message}` }] };
          }
          setImmediate(() => onError(error));
          throw new McpError(ErrorCode.InternalError, "Headless brainstorm runtime failed; see stderr.");
        }
      });
      await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: LIMITS.messageBytes }));
    }
  } catch (error) {
    void stop(error);
  }
  return done;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runStdio();
}
