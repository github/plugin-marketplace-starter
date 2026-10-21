import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { contained, frontmatter, parseYaml, readCatalog } from "./catalog.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const list = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matches = (pattern, value) => typeof pattern === "string" && new RegExp(pattern).test(value);
const outcomeGraders = ["program", "output-matches", "output-contains", "file-matches", "file-exists", "prompt", "panel"];
async function entries(path) {
  try { return await readdir(path, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

// Starts a plugin's real stdio MCP server to discover the tools it advertises.
export async function listMcpTools(pluginRoot, server) {
  assert.equal(server.type, "stdio", "Only local stdio MCP servers can be discovered.");
  const data = await mkdtemp(join(tmpdir(), "starter-mcp-data-"));
  const expand = (value) => value.replaceAll("${PLUGIN_ROOT}", pluginRoot).replaceAll("${PLUGIN_DATA}", data);
  const configuredCwd = server.cwd ?? "${PLUGIN_ROOT}";
  const cwd = configuredCwd.startsWith("${PLUGIN_DATA}") ? await contained(data, expand(configuredCwd)) : await contained(pluginRoot, expand(configuredCwd));
  const command = server.command.startsWith("./") ? await contained(pluginRoot, server.command) : server.command;
  const transport = new StdioClientTransport({
    command,
    args: (server.args ?? []).map(expand),
    cwd,
    env: {
      ...getDefaultEnvironment(),
      ...Object.fromEntries(Object.entries(server.env ?? {}).map(([key, value]) => [key, expand(value)])),
      PLUGIN_ROOT: pluginRoot,
      PLUGIN_DATA: data,
    },
    stderr: "inherit",
  });
  const client = new Client({ name: "starter-inventory", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: 10_000 });
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 10_000 });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    assert.ok(tools.length, `MCP server in ${pluginRoot} advertises no tools.`);
    return tools;
  } finally {
    try { await client.close(); }
    finally {
      try { await transport.close(); }
      finally { await rm(data, { recursive: true, force: true }); }
    }
  }
}

export async function discoverAssets(directory = root) {
  const { localPlugins } = await readCatalog(directory);
  const assets = [];
  for (const plugin of localPlugins) {
    const source = resolve(directory, plugin.source);
    assert.ok(!relative(resolve(directory, "plugins"), source).split(sep).includes(".."));
    for (const skill of (await entries(resolve(source, "skills"))).filter((entry) => entry.isDirectory())) {
      const path = resolve(source, "skills", skill.name);
      await stat(resolve(path, "SKILL.md"));
      assets.push({ id: `skill:${plugin.name}/${skill.name}`, kind: "skill", name: skill.name, path });
    }
    const agentsPath = resolve(source, "com.github.copilot/agents");
    for (const agent of (await entries(agentsPath)).filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))) {
      const path = resolve(agentsPath, agent.name);
      const { name } = frontmatter(await readFile(path, "utf8"), path);
      assets.push({ id: `agent:${plugin.name}/${name}`, kind: "agent", name, path });
    }
    let hooks;
    try { hooks = await json(resolve(source, "com.github.copilot/hooks/hooks.json")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const event of Object.keys(hooks?.hooks ?? {})) {
      assets.push({ id: `hook:${plugin.name}/${event}`, kind: "hook", name: event, path: source });
    }
    for (const extension of (await entries(resolve(source, "com.github.copilot/extensions"))).filter((entry) => entry.isDirectory())) {
      const path = resolve(source, "com.github.copilot/extensions", extension.name);
      await stat(resolve(path, "extension.mjs"));
      assets.push({ id: `extension:${plugin.name}/${extension.name}`, kind: "extension", name: extension.name, path });
    }
    let mcp;
    try { mcp = await json(resolve(source, "mcp.json")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const [serverName, server] of Object.entries(mcp?.mcpServers ?? {})) {
      for (const tool of await listMcpTools(source, server)) {
        assets.push({ id: `mcp:${plugin.name}/${serverName}/${tool.name}`, kind: "mcp", name: tool.name, serverName, path: source });
      }
    }
  }
  assert.equal(new Set(assets.map((asset) => asset.id)).size, assets.length, "Duplicate asset identity.");
  return assets;
}

export async function readEvals(directory = root) {
  const specs = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Do not use symlinked eval inputs: ${child}`);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name === "eval.yaml") specs.push({ path: child, spec: parseYaml(await readFile(child, "utf8"), child) });
    }
  }
  await walk(resolve(directory, "evals"));
  if (!specs.length) throw new Error("No eval.yaml files were found.");
  return specs;
}

function checkPositive(asset, stimulus, spec, path) {
  const id = asset.id;
  const graders = stimulus.graders ?? [];
  const env = { ...spec.agent_environment, ...stimulus.agent_environment };
  const mcpServers = { ...spec.agent_environment?.mcpServers, ...stimulus.agent_environment?.mcpServers };
  assert.ok(graders.some((grader) => outcomeGraders.includes(grader.type) || grader.type === "tool-calls" && asset.kind === "mcp"),
    `${stimulus.name}: invocation alone is not outcome coverage.`);
  if (asset.kind === "skill") {
    const skills = [...list(spec.agent_environment?.skills), ...list(stimulus.agent_environment?.skills)];
    assert.ok(skills.some((skill) => resolve(dirname(path), skill) === asset.path), `${id}: load the actual skill.`);
    assert.ok(graders.some((grader) => grader.type === "skill-invocation" && list(grader.config?.required).includes(asset.name)),
      `${id}: assert actual skill invocation.`);
  } else if (asset.kind === "agent") {
    const files = [...list(spec.agent_environment?.files), ...list(stimulus.agent_environment?.files)];
    assert.ok(files.some((file) => typeof file.src === "string"
      && resolve(dirname(path), file.src) === asset.path
      && /^\.github\/agents\/[^/]+\.agent\.md$/.test(file.dest)), `${id}: stage the actual agent profile.`);
    assert.ok(graders.some((grader) => grader.type === "tool-calls"
      && list(grader.config?.required).some((rule) => typeof rule === "object"
        && rule.name === "^task$" && rule.args?.agent_type === `^${escapeRegExp(asset.name)}$`)),
    `${id}: assert delegation to the actual agent.`);
    assert.ok(graders.some((grader) => grader.scope === "subagent"
      && ["program", "output-matches", "output-contains", "prompt"].includes(grader.type)),
    `${id}: grade the subagent's behavior, not only the parent answer.`);
  } else if (asset.kind === "mcp") {
    assert.ok(mcpServers[asset.serverName], `${id}: configure the actual MCP server.`);
    assert.ok(graders.some((grader) => grader.type === "tool-calls"
      && list(grader.config?.required).some((rule) => typeof rule === "object"
        && matches(rule.name, asset.name) && typeof rule.result === "string" && rule.result.length > 0)),
    `${id}: assert the actual tool call and its result.`);
  } else if (asset.kind === "hook") {
    assert.equal(env.env?.STARTER_ENABLE_FORMAT_HOOK, "1", `${id}: mount the real formatter plugin.`);
    assert.ok(graders.some((grader) => grader.type === "program" && list(grader.config?.args).includes(".grading/format-json.mjs")),
      `${id}: grade the hook's actual file effects.`);
  } else {
    assert.equal(stimulus.tags.boundary, "headless-sdk-contract", `${id}: label the host boundary honestly.`);
    assert.ok(mcpServers["brainstorm-host"], `${id}: configure the actual extension contract transport.`);
    assert.ok(graders.some((grader) => grader.type === "program" && list(grader.config?.args).includes(".grading/brainstorm.mjs")),
      `${id}: grade the extension's actual session state.`);
  }
}

export function checkCoverage(assets, specs) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const covered = new Set();
  const smoke = new Set();
  const negative = new Set();
  const names = new Set();
  for (const { path, spec } of specs) {
    assert.ok(Array.isArray(spec?.stimuli) && spec.stimuli.length, `${path}: stimuli are required.`);
    for (const stimulus of spec.stimuli) {
      assert.ok(stimulus.name && !names.has(stimulus.name), `Missing/duplicate stimulus name: ${stimulus.name}`);
      names.add(stimulus.name);
      const ids = list(stimulus.tags?.assets);
      assert.ok(ids.length, `${stimulus.name}: declare covered assets.`);
      assert.ok(["positive", "negative"].includes(stimulus.tags?.control), `${stimulus.name}: set tags.control to positive or negative.`);
      for (const suite of list(stimulus.tags?.suite)) assert.equal(suite, "smoke", `${stimulus.name}: the only tagged suite is smoke; full includes every spec.`);
      for (const id of ids) {
        const asset = byId.get(id);
        assert.ok(asset, `${stimulus.name}: unknown asset ${id}`);
        const graders = stimulus.graders ?? [];
        if (stimulus.tags.control === "negative") {
          if (asset.kind === "mcp" || graders.some((grader) => outcomeGraders.includes(grader.type) || grader.type === "tool-calls")) negative.add(id);
          continue;
        }
        checkPositive(asset, stimulus, spec, path);
        covered.add(id);
        if (list(stimulus.tags.suite).includes("smoke")) smoke.add(id);
      }
    }
  }
  for (const id of byId.keys()) {
    assert.ok(covered.has(id), `${id}: missing positive behavioral coverage.`);
    assert.ok(smoke.has(id), `${id}: missing smoke coverage.`);
    assert.ok(negative.has(id), `${id}: missing negative control.`);
  }
  return names.size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const assets = await discoverAssets();
  const specs = await readEvals();
  const count = checkCoverage(assets, specs);
  const kinds = Object.entries(Object.groupBy(assets, (asset) => asset.kind)).map(([kind, items]) => `${items.length} ${kind}`).join(", ");
  console.log(`Validated ${specs.length} eval specs and ${count} cases covering ${assets.length} local assets (${kinds}).`);
  for (const asset of assets) console.log(`  ${asset.id}`);
  console.log("Canvas interaction is evaluated through a headless MCP/SDK contract, not native UI rendering.");
}
