import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, cp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { contained, frontmatter, parseYaml, readCatalog, readVallyConfig } from "../scripts/catalog.mjs";
import { checkCoverage, discoverAssets, readEvals, root, suiteTags } from "../scripts/validate-evals.mjs";
import { hookEvents, markdownLinks, validateMcpConfig, validateRepository } from "../scripts/validate.mjs";

async function names(path) {
  try { return (await readdir(path)).sort(); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

test("discovery covers every local skill, agent, hook, extension, and advertised MCP tool", async () => {
  const assets = await discoverAssets();
  const { localPlugins } = await readCatalog(root);
  const expected = [];
  for (const plugin of localPlugins) {
    const source = resolve(root, plugin.source);
    for (const name of await names(join(source, "skills"))) expected.push(`skill:${plugin.name}/${name}`);
    for (const name of await names(join(source, "com.github.copilot/agents"))) if (name.endsWith(".agent.md")) expected.push(`agent:${plugin.name}/${name.slice(0, -".agent.md".length)}`);
    for (const name of await names(join(source, "com.github.copilot/extensions"))) expected.push(`extension:${plugin.name}/${name}`);
    try {
      const hooks = JSON.parse(await readFile(join(source, "com.github.copilot/hooks/hooks.json"), "utf8"));
      for (const event of Object.keys(hooks.hooks)) expected.push(`hook:${plugin.name}/${event}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  assert.deepEqual(assets.filter((asset) => asset.kind !== "mcp").map((asset) => asset.id).sort(), expected.sort());
  for (const asset of assets.filter((item) => item.kind === "mcp")) assert.match(asset.id, /^mcp:[^/]+\/[^/]+\/[^/]+$/);
  checkCoverage(assets, await readEvals(), { suites: suiteTags(await readVallyConfig(root)) });
});

test("the JSON configuration example advertises its two real MCP tools", { skip: !existsSync(resolve(root, "plugins/json-configuration")) }, async () => {
  const assets = await discoverAssets();
  assert.deepEqual(assets.filter((asset) => asset.kind === "mcp").map((asset) => asset.id).sort(), [
    "mcp:json-configuration/json-configuration/get_json_value",
    "mcp:json-configuration/json-configuration/validate_json",
  ]);
});

test("coverage rejects unknown, unloaded, invocation-free, negative-free, and smoke-free cases", async () => {
  const assets = [{ id: "skill:fixture/fixture-skill", kind: "skill", name: "fixture-skill", path: resolve(root, "plugins/fixture/skills/fixture-skill") }];
  const author = { path: resolve(root, "evals/fixture/eval.yaml"), spec: {
    agent_environment: { skills: ["../../plugins/fixture/skills/fixture-skill"] },
    stimuli: [
      { name: "does-it", tags: { assets: assets[0].id, control: "positive", suite: "smoke" }, graders: [
        { type: "skill-invocation", config: { required: ["fixture-skill"] } },
        { type: "file-exists", config: { path: "out.json" } },
      ] },
      { name: "skips-it", tags: { assets: assets[0].id, control: "negative" }, graders: [
        { type: "skill-invocation", config: { disallowed: ["fixture-skill"] } },
        { type: "output-contains", config: { substring: "Paris" } },
      ] },
    ],
  } };
  const only = assets;
  const modify = (mutate) => {
    const copy = structuredClone(author);
    mutate(copy.spec);
    return [copy];
  };
  assert.doesNotThrow(() => checkCoverage(only, [author]));
  assert.throws(() => checkCoverage(only, []), /missing positive/);
  assert.throws(() => checkCoverage(only, modify((spec) => { spec.stimuli[0].tags.assets = "skill:unknown/unknown"; })), /unknown asset/);
  assert.throws(() => checkCoverage(only, modify((spec) => { spec.agent_environment.skills = []; })), /load the actual skill/);
  assert.throws(() => checkCoverage(only, modify((spec) => { spec.stimuli[0].graders = [{ type: "output-contains", config: { substring: "ok" } }]; })), /skill invocation/);
  assert.throws(() => checkCoverage(only, modify((spec) => { spec.stimuli = [spec.stimuli[0]]; })), /negative control/);
  assert.throws(() => checkCoverage(only, modify((spec) => { delete spec.stimuli[0].tags.suite; })), /smoke coverage/);
  assert.throws(() => checkCoverage(only, modify((spec) => { spec.stimuli[0].tags.suite = "pr"; })), /isn't a configured suite/);
  assert.doesNotThrow(() => checkCoverage(only, modify((spec) => { spec.stimuli[1].tags.suite = "pr"; }), { suites: new Set(["smoke", "pr"]) }));
  assert.throws(() => checkCoverage(only, [author], { suites: new Set(["ci"]) }), /needs a "smoke" suite/);
  assert.throws(() => checkCoverage(only, modify((spec) => { delete spec.stimuli[1].tags.control; })), /tags\.control/);
});

test("MCP coverage requires the configured server, an asserted tool result, and observable negative controls", async () => {
  const tool = { id: "mcp:fixture/server/lookup", kind: "mcp", name: "lookup", serverName: "server", path: resolve(root, "plugins/fixture") };
  const call = (result) => ({ type: "tool-calls", config: { required: [{ name: "(^|[./_-])lookup$", result }] } });
  const specs = [{ path: resolve(root, "evals/fixture/eval.yaml"), spec: {
    agent_environment: { mcpServers: { server: { type: "stdio", command: "node", args: ["${SERVER}"] } } },
    stimuli: [
      { name: "finds", tags: { assets: tool.id, control: "positive", suite: "smoke" }, graders: [call('"value"\\s*:\\s*1')] },
      { name: "reports-missing", tags: { assets: tool.id, control: "negative" }, graders: [{ type: "completed" }, call("NOT_FOUND")] },
    ],
  } }];
  assert.equal(checkCoverage([tool], specs), 2);
  const unconfigured = structuredClone(specs);
  delete unconfigured[0].spec.agent_environment.mcpServers;
  assert.throws(() => checkCoverage([tool], unconfigured), /configure the actual MCP server/);
  const resultless = structuredClone(specs);
  for (const stimulus of resultless[0].spec.stimuli) {
    for (const grader of stimulus.graders) for (const rule of grader.config?.required ?? []) if (typeof rule === "object") delete rule.result;
  }
  assert.throws(() => checkCoverage([tool], resultless), /actual tool call and its result/);
  const completedOnly = structuredClone(specs);
  completedOnly[0].spec.stimuli[1].graders = [{ type: "completed" }];
  assert.throws(() => checkCoverage([tool], completedOnly), /mcp:fixture\/server\/lookup: missing negative control/);
  const negativeWithoutResult = structuredClone(specs);
  delete negativeWithoutResult[0].spec.stimuli[1].graders[1].config.required[0].result;
  assert.throws(() => checkCoverage([tool], negativeWithoutResult), /missing negative control/);
  const otherTool = structuredClone(specs);
  otherTool[0].spec.stimuli[1].graders = [{ type: "tool-calls", config: { required: [{ name: "^unrelated$", result: "x" }] } }];
  assert.throws(() => checkCoverage([tool], otherTool), /missing negative control/);
  const disallowed = structuredClone(specs);
  disallowed[0].spec.stimuli[1].graders = [{ type: "tool-calls", config: { disallowed: ["(^|[./_-])lookup$"] } }];
  assert.equal(checkCoverage([tool], disallowed), 2);
});

test("the JSON configuration example's MCP negative controls stay observable", { skip: !existsSync(resolve(root, "plugins/json-configuration")) }, async () => {
  const assets = (await discoverAssets()).filter((asset) => asset.id.includes(":json-configuration/"));
  const specs = (await readEvals()).filter((item) => item.spec.name === "json-configuration");
  assert.doesNotThrow(() => checkCoverage(assets, specs));
  const weakened = structuredClone(specs);
  for (const stimulus of weakened[0].spec.stimuli) if (stimulus.tags.control === "negative") stimulus.graders = [{ type: "completed" }, { type: "output-contains", config: { substring: "NOT_FOUND" } }];
  assert.throws(() => checkCoverage(assets, weakened), /mcp:json-configuration\/json-configuration\/\w+: missing negative control/);
});

test("a relocated copy discovers the bundled MCP tools without this checkout's node_modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter copied template "));
  try {
    await cp(join(root, "marketplace.json"), join(directory, "marketplace.json"));
    await cp(join(root, "plugins"), join(directory, "plugins"), { recursive: true });
    const original = await discoverAssets();
    const assets = await discoverAssets(directory);
    assert.deepEqual(assets.map((asset) => asset.id), original.map((asset) => asset.id));
    await assert.rejects(contained(directory, ".."), /escapes/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mcp.json must be schema-valid, local stdio, and contained in its plugin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-mcp-config-"));
  const write = (config) => writeFile(join(directory, "mcp.json"), JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", ...config,
  }));
  try {
    await mkdir(join(directory, "dist"));
    await writeFile(join(directory, "dist/server.mjs"), "");
    await write({ mcpServers: { local: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/dist/server.mjs"], cwd: "${PLUGIN_ROOT}" } } });
    assert.equal(await validateMcpConfig(directory, "fixture"), 1);
    await write({ mcpServers: { remote: { type: "streamable-http", url: "https://example.com/mcp" } } });
    await assert.rejects(validateMcpConfig(directory, "fixture"), /local stdio/);
    await write({ mcpServers: { local: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/../outside.mjs"] } } });
    await assert.rejects(validateMcpConfig(directory, "fixture"));
    await write({ mcpServers: { local: { type: "stdio", command: "node", unknown: true } } });
    await assert.rejects(validateMcpConfig(directory, "fixture"), /fixture/);
    await write({ mcpServers: { local: { type: "stdio", command: "node /tmp/server.mjs" } } });
    await assert.rejects(validateMcpConfig(directory, "fixture"), /bare executable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("agents and skills must live in their Agent Plugins locations with valid frontmatter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-layout-"));
  const catalog = { name: "layout-fixture", owner: { name: "Test" }, plugins: [
    { name: "review", source: "./plugins/review", version: "1.0.0", description: "Review fixture." },
  ] };
  const plugin = join(directory, "plugins/review");
  const agent = "---\nname: reviewer\ndescription: Reviews supplied code.\ntools: [\"read\"]\n---\nReview it.\n";
  try {
    await mkdir(join(plugin, "com.github.copilot/agents"), { recursive: true });
    await mkdir(join(directory, ".github/copilot"), { recursive: true });
    await writeFile(join(directory, "marketplace.json"), JSON.stringify(catalog));
    await writeFile(join(directory, ".vally.yaml"), "paths:\n  skills: []\n");
    await writeFile(join(directory, ".github/copilot/settings.json"), JSON.stringify({
      extraKnownMarketplaces: { "layout-fixture": { source: { source: "directory", path: "." } } },
      enabledPlugins: { "review@layout-fixture": true },
    }));
    await writeFile(join(plugin, "plugin.json"), JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "review", version: "1.0.0", description: "Review fixture.",
    }));
    await writeFile(join(plugin, "README.md"), "# Review\n");
    await writeFile(join(plugin, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n");
    await writeFile(join(plugin, "com.github.copilot/agents/reviewer.agent.md"), agent);
    assert.equal((await validateRepository(directory)).agents, 1);
    await writeFile(join(plugin, "com.github.copilot/agents/reviewer.agent.md"), agent.replace("name: reviewer", "name: other"));
    await assert.rejects(validateRepository(directory), /match its file name/);
    await writeFile(join(plugin, "com.github.copilot/agents/reviewer.agent.md"), agent.replace("Review it.\n", ""));
    await assert.rejects(validateRepository(directory), /instructions are empty/);
    await rm(join(plugin, "com.github.copilot"), { recursive: true });
    await writeFile(join(plugin, "reviewer.agent.md"), agent);
    await assert.rejects(validateRepository(directory), /com\.github\.copilot\/agents/);
    await rm(join(plugin, "reviewer.agent.md"));
    await assert.rejects(validateRepository(directory), /no supported assets/);
    await mkdir(join(plugin, "skills/review"), { recursive: true });
    await writeFile(join(plugin, "skills/review/SKILL.md"), "---\nname: other\ndescription: Review.\n---\nReview it.\n");
    await assert.rejects(validateRepository(directory), /match its directory/);
    await mkdir(join(directory, "plugins/uncatalogued"));
    await writeFile(join(plugin, "skills/review/SKILL.md"), "---\nname: review\ndescription: Review.\n---\nReview it.\n");
    await assert.rejects(validateRepository(directory), /Every plugin must be registered/);
    await rm(join(directory, "plugins/uncatalogued"), { recursive: true });
    await assert.rejects(validateRepository(directory), /\.vally\.yaml paths\.skills must list plugins\/review\/skills/);
    await writeFile(join(directory, ".vally.yaml"), "paths:\n  skills:\n    - plugins/review/skills\n    - plugins/renamed/skills\n");
    await assert.rejects(validateRepository(directory), /lists plugins\/renamed\/skills, which doesn't exist/);
    await writeFile(join(directory, ".vally.yaml"), "paths:\n  skills:\n    - plugins/review/skills\n");
    assert.equal((await validateRepository(directory)).skills, 1);
    await rm(join(directory, ".vally.yaml"));
    await assert.rejects(validateRepository(directory), /\.vally\.yaml is required/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed frontmatter and duplicate YAML keys are rejected", () => {
  assert.throws(() => frontmatter("no header", "skill"), /frontmatter/);
  assert.throws(() => frontmatter("---\nname: Valid\n---\ntext", "skill"), /valid name/);
  assert.throws(() => parseYaml("name: first\nname: second", "fixture"), /unique|Map keys/);
});

test("vendored schemas keep their Apache-2.0 license and attribution", async () => {
  const notice = await readFile(resolve(root, "schemas/NOTICE"), "utf8");
  assert.match(notice, /plugin\.schema\.json/);
  assert.match(notice, /mcp\.schema\.json/);
  assert.match(await readFile(resolve(root, "schemas/LICENSE-APACHE-2.0.txt"), "utf8"), /Apache License/);
});

test("Markdown link checks ignore code, web, mailto, and anchor links", () => {
  const text = [
    "See [the guide](docs/guide.md#setup) and [home](https://example.com) or [mail](mailto:security@example.com).",
    "Jump to [a section](#section). Inline `[x](not/a/link.md)` stays code.",
    "```js", "const pattern = /\\]\\((broken)\\)/; // [y](also/not/a/link.md)", "```",
    "~~~", "[z](fenced/tilde.md)", "~~~",
    "Then [real](plugins/a/README.md).",
  ].join("\n");
  assert.deepEqual(markdownLinks(text), ["docs/guide.md#setup", "plugins/a/README.md"]);
  assert.deepEqual(markdownLinks("```\n[open](unclosed.md)\n"), []);
  assert.deepEqual(markdownLinks("```\r\n[x](crlf.md)\r\n```\r\n[y](after.md)\r\n"), ["after.md"]);
});

test("hooks may use any documented event and pass arguments to their plugin script", async () => {
  assert.ok(["sessionStart", "userPromptSubmitted", "postToolUseFailure", "errorOccurred"].every((event) => hookEvents.includes(event)));
  const directory = await mkdtemp(join(tmpdir(), "starter-hooks-"));
  const plugin = join(directory, "plugins/guard");
  const hooks = (value) => writeFile(join(plugin, "com.github.copilot/hooks/hooks.json"), JSON.stringify(value));
  try {
    await mkdir(join(plugin, "com.github.copilot/hooks"), { recursive: true });
    await writeFile(join(plugin, "com.github.copilot/hooks/check.mjs"), "");
    await writeFile(join(plugin, "plugin.json"), JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "guard", version: "1.0.0", description: "Guard fixture.",
    }));
    await writeFile(join(plugin, "README.md"), "# Guard\n");
    await writeFile(join(plugin, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n");
    await writeFile(join(directory, "marketplace.json"), JSON.stringify({ name: "hooks-fixture", owner: { name: "Test" },
      plugins: [{ name: "guard", source: "./plugins/guard", version: "1.0.0", description: "Guard fixture." }] }));
    await mkdir(join(directory, ".github/copilot"), { recursive: true });
    await writeFile(join(directory, ".github/copilot/settings.json"), JSON.stringify({
      extraKnownMarketplaces: { "hooks-fixture": { source: { source: "directory", path: "." } } },
      enabledPlugins: { "guard@hooks-fixture": true },
    }));
    await writeFile(join(directory, ".vally.yaml"), "paths:\n  skills: []\n");
    const command = (text) => ({ type: "command", command: text, timeoutSec: 5 });
    await hooks({ version: 1, hooks: {
      sessionStart: [command('node "${PLUGIN_ROOT}/com.github.copilot/hooks/check.mjs"')],
      postToolUse: [command('node "${PLUGIN_ROOT}/com.github.copilot/hooks/check.mjs" --mode strict')],
    } });
    assert.equal((await validateRepository(directory)).hooks, 2);
    await hooks({ version: 1, hooks: { onSave: [command('node "${PLUGIN_ROOT}/com.github.copilot/hooks/check.mjs"')] } });
    await assert.rejects(validateRepository(directory), /Unsupported hook event: onSave/);
    await hooks({ version: 1, hooks: { postToolUse: [command('node "${PLUGIN_ROOT}/../outside.mjs" --x')] } });
    await assert.rejects(validateRepository(directory), /escapes|ENOENT/);
    await hooks({ version: 1, hooks: { postToolUse: [command("node check.mjs")] } });
    await assert.rejects(validateRepository(directory), /PLUGIN_ROOT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
