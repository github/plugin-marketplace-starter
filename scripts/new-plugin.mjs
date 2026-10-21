import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseDocument } from "yaml";
import { namePattern, readCatalog } from "./catalog.mjs";
import { runCli } from "./problems.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const components = ["agent", "mcp"];
const usage = `Usage: npm run new-plugin -- <name> [--with agent] [--with mcp] [--description "What it does."]

Scaffolds plugins/<name>/ with a skill, README, CHANGELOG, and LICENSE, plus
evals/<name>/eval.yaml, and registers the plugin in marketplace.json,
.github/copilot/settings.json, and .vally.yaml. npm run verify passes right away.

  --with agent   Also add a custom agent and its delegation eval.
  --with mcp     Also add a local stdio MCP server (src/server.ts) with one tool.`;

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const title = (name) => name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
const paramName = (name) => `${name.toUpperCase().replaceAll("-", "_")}_MCP_SERVER`;

async function write(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function skillFile(name, description, { agent, mcp }) {
  return `---
name: ${name}
description: ${JSON.stringify(`${description} Use when the user asks for ${name} help. Replace this description with the real trigger: say when to use the skill and when not to.`)}
---

# ${title(name)}

Replace these instructions with your team's procedure. Keep this file short and
move detail into a \`references/\` folder that the skill reads when it needs it.

1. Start your reply with the line \`${name}: ready\` so evals can confirm the skill ran.
2. Do the task the user asked for. Ask for missing details instead of inventing them.
${agent ? `3. For a deeper review, delegate to the \`${agent}\` custom agent.\n` : ""}${mcp ? `${agent ? 4 : 3}. Use the \`echo\` tool from the \`${name}\` MCP server when the user asks you to echo text, and report its result.\n` : ""}`;
}

function agentFile(agent, name) {
  return `---
name: ${agent}
description: ${JSON.stringify(`Read-only specialist for ${name} tasks. Replace this description with when the main agent should delegate to it.`)}
tools: ["read", "search"]
---

Replace these instructions with the specialist's role. Start your reply with the
line \`${agent}: ready\` so evals can confirm this agent ran.

You are read-only. Don't edit files or run commands.
`;
}

function serverFile(name) {
  return `import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Replaced at build time with the version in plugin.json.
declare const __PLUGIN_VERSION__: string;

// Replace this example tool with your own. Servers must start offline, without
// credentials or network access; put anything that needs a secret in a tool call.
export function createServer(): McpServer {
  const server = new McpServer({ name: '${name}', version: __PLUGIN_VERSION__ });
  server.registerTool('echo', {
    title: 'Echo text',
    description: 'Return the supplied text unchanged as {text}. No files, network, or persistence.',
    inputSchema: { text: z.string().max(10_000).describe('Text to return.') },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }, ({ text }) => ({ content: [{ type: 'text', text: JSON.stringify({ text }) }], structuredContent: { text } }));
  return server;
}

const realPath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};
const entrypoint = process.argv[1];
if (entrypoint && relative(realPath(entrypoint), realPath(fileURLToPath(import.meta.url))) === '') {
  createServer().connect(new StdioServerTransport()).catch(error => {
    console.error('Failed to start the ${name} MCP server:', error);
    process.exitCode = 1;
  });
}
`;
}

function readmeFile(name, description, marketplace, { agent, mcp }) {
  const parts = ["a skill", agent && "a read-only custom agent", mcp && "a local MCP server"].filter(Boolean);
  return `# ${title(name)}

${description}

This plugin ships ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}. Replace the scaffolded
instructions${mcp ? " and the example `echo` tool" : ""} with your team's own, and update
[its evals](../../evals/${name}/eval.yaml) to check the real behavior.

## Install

\`\`\`sh
copilot plugin marketplace add OWNER/REPO
copilot plugin install ${name}@${marketplace}
\`\`\`

Replace \`OWNER/REPO\` with the GitHub repository that hosts this marketplace.
${mcp ? "\nThe MCP server needs Node.js 22.14 or newer on the machine running Copilot.\n" : ""}
## Try it

> Use the ${name} skill to help with my task.
`;
}

function evalFile(name, { agent, mcp }) {
  const param = paramName(name);
  const lines = [
    `# Behavioral evals for the ${name} plugin. Replace the prompts and graders with`,
    "# your plugin's real behavior. npm run eval:check needs, for every asset, a",
    "# positive case that asserts invocation and outcome, one positive case tagged",
    "# suite: smoke, and a negative case with an observable assertion.",
    `name: ${name}`,
    `description: Scaffolded checks for the ${name} plugin.`,
    "type: capability",
    "defaults:",
    "  executor: copilot-sdk",
    "  model: gpt-5.4-mini",
    "  timeout: 2m",
    "  runs: 1",
    "agent_environment:",
    "  skills:",
    `    - ../../plugins/${name}/skills/${name}`,
  ];
  if (mcp) {
    lines.push(
      "  mcpServers:",
      `    ${name}:`,
      "      type: stdio",
      "      command: node",
      `      args: ['\${${param}}']`,
    );
  }
  lines.push(
    "stimuli:",
    `  - name: ${name}-does-the-task`,
    `    prompt: Use the ${name} skill to help me with a small example task.`,
    "    tags:",
    `      assets: skill:${name}/${name}`,
    "      suite: smoke",
    "      control: positive",
    "    graders:",
    "      - type: completed",
    "      - type: skill-invocation",
    "        config:",
    `          required: [${name}]`,
    "      - type: output-contains",
    "        config:",
    `          substring: "${name}: ready"`,
    `  - name: ${name}-ignores-unrelated-question`,
    "    prompt: What is two plus two? Reply with only the digit.",
    "    tags:",
    `      assets: [skill:${name}/${name}${agent ? `, agent:${name}/${agent}` : ""}${mcp ? `, mcp:${name}/${name}/echo` : ""}]`,
    "      control: negative",
    "    graders:",
    "      - type: completed",
    "      - type: skill-invocation",
    "        config:",
    `          disallowed: [${name}]`,
  );
  if (agent || mcp) {
    lines.push(
      "      - type: tool-calls",
      "        config:",
      `          disallowed: [${[agent && "'^task$'", mcp && "'(^|[./_-])echo$'"].filter(Boolean).join(", ")}]`,
    );
  }
  lines.push(
    "      - type: output-contains",
    "        config:",
    '          substring: "4"',
  );
  if (agent) {
    lines.push(
      `  - name: ${name}-delegates-to-${agent}`,
      `    prompt: Delegate to the ${agent} specialist and report what it says. Don't edit files.`,
      "    agent_environment:",
      "      files:",
      `        - src: ../../plugins/${name}/com.github.copilot/agents/${agent}.agent.md`,
      `          dest: .github/agents/${agent}.agent.md`,
      "    tags:",
      `      assets: agent:${name}/${agent}`,
      "      suite: smoke",
      "      control: positive",
      "    graders:",
      "      - type: completed",
      "      - type: tool-calls",
      "        config:",
      "          required:",
      "            - name: ^task$",
      "              args:",
      `                agent_type: ^${agent}$`,
      "      - type: output-contains",
      "        scope: subagent",
      "        config:",
      `          substring: "${agent}: ready"`,
      "      - type: diff-empty",
    );
  }
  if (mcp) {
    lines.push(
      `  - name: ${name}-echoes-text`,
      `    prompt: Use the ${name} skill and its echo tool to echo the text hello-${name}. Report the tool's result.`,
      "    tags:",
      `      assets: mcp:${name}/${name}/echo`,
      "      suite: smoke",
      "      control: positive",
      "    graders:",
      "      - type: completed",
      "      - type: tool-calls",
      "        config:",
      "          required:",
      "            - name: '(^|[./_-])echo$'",
      `              result: '"text"\\s*:\\s*"hello-${name}"'`,
      "      - type: output-contains",
      "        config:",
      `          substring: hello-${name}`,
    );
  }
  lines.push("scoring:", "  threshold: 1", "");
  return lines.join("\n");
}

function licenseFile(owner) {
  return `MIT License

Copyright (c) ${new Date().getFullYear()} ${owner}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

export async function newPlugin(name, { components: requested = [], description, directory = root } = {}) {
  if (!namePattern.test(name ?? "") || name.length > 64) {
    throw new Error(`Plugin name "${name ?? ""}" must be lowercase letters, digits, and single hyphens, such as release-notes.`);
  }
  const unknown = requested.filter((item) => !components.includes(item));
  if (unknown.length) throw new Error(`Unknown --with value: ${unknown.join(", ")}. Use ${components.join(" or ")}.`);
  const { catalog } = await readCatalog(directory);
  if (catalog.plugins.some((entry) => entry.name === name)) throw new Error(`marketplace.json already has a plugin named ${name}.`);
  for (const path of [`plugins/${name}`, `evals/${name}`]) {
    if (existsSync(resolve(directory, path))) throw new Error(`${path} already exists. Pick another name or remove it first.`);
  }
  const options = { agent: requested.includes("agent") ? `${name}-specialist` : undefined, mcp: requested.includes("mcp") };
  description ??= `Help with ${name.replaceAll("-", " ")} tasks.`;
  const plugin = resolve(directory, "plugins", name);
  const created = [];
  const add = async (path, text) => { await write(resolve(directory, path), text); created.push(path); };

  await add(`plugins/${name}/plugin.json`, `${JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name, version: "0.1.0", description, license: "MIT",
  }, null, 2)}\n`);
  await add(`plugins/${name}/README.md`, readmeFile(name, description, catalog.name, options));
  await add(`plugins/${name}/CHANGELOG.md`, "# Changelog\n\n## 0.1.0\n\n- Initial release.\n");
  await add(`plugins/${name}/LICENSE`, licenseFile(catalog.owner.name));
  await add(`plugins/${name}/skills/${name}/SKILL.md`, skillFile(name, description, options));
  if (options.agent) await add(`plugins/${name}/com.github.copilot/agents/${options.agent}.agent.md`, agentFile(options.agent, name));
  if (options.mcp) {
    await add(`plugins/${name}/src/server.ts`, serverFile(name));
    await add(`plugins/${name}/mcp.json`, `${JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { [name]: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/dist/server.mjs"], cwd: "${PLUGIN_ROOT}" } },
    }, null, 2)}\n`);
  }
  await add(`evals/${name}/eval.yaml`, evalFile(name, options));

  const catalogPath = resolve(directory, "marketplace.json");
  const rawCatalog = await json(catalogPath);
  const lastLocal = rawCatalog.plugins.findLastIndex((entry) => typeof entry.source === "string");
  rawCatalog.plugins.splice(lastLocal + 1, 0, { name, source: `./plugins/${name}`, version: "0.1.0", description });
  await writeJson(catalogPath, rawCatalog);

  const settingsPath = resolve(directory, ".github/copilot/settings.json");
  const settings = await json(settingsPath);
  settings.enabledPlugins = { ...settings.enabledPlugins, [`${name}@${catalog.name}`]: true };
  await writeJson(settingsPath, settings);

  const vallyPath = resolve(directory, ".vally.yaml");
  const vally = parseDocument(await readFile(vallyPath, "utf8"));
  if (!vally.hasIn(["paths", "skills"])) vally.setIn(["paths", "skills"], vally.createNode([]));
  vally.addIn(["paths", "skills"], `plugins/${name}/skills`);
  if (options.mcp) vally.setIn(["params", paramName(name)], `plugins/${name}/dist/server.mjs`);
  await writeFile(vallyPath, vally.toString());

  if (options.mcp) {
    const build = spawnSync(process.execPath, [resolve(directory, "scripts/build.mjs")], { cwd: directory, encoding: "utf8" });
    if (build.status !== 0) throw new Error(`npm run build failed for the new MCP server:\n${build.stderr || build.stdout}`);
    created.push(`plugins/${name}/dist/server.mjs`);
  }
  return { created, updated: ["marketplace.json", ".github/copilot/settings.json", ".vally.yaml"], plugin, options };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli(async () => {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      with: { type: "string", multiple: true, default: [] },
      description: { type: "string" },
      help: { type: "boolean", short: "h" },
    } });
    if (values.help || positionals.length !== 1) {
      console.log(usage);
      if (!values.help) process.exitCode = 1;
      return;
    }
    const result = await newPlugin(positionals[0], {
      components: values.with.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean),
      description: values.description,
    });
    console.log(`Created plugin ${positionals[0]}:`);
    for (const path of result.created) console.log(`  ${path}`);
    console.log(`Updated ${result.updated.join(", ")}.`);
    console.log("\nNext: edit the skill, README, and evals, then run npm run verify.");
  });
}
