import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { contained, frontmatter, parseYaml } from "../scripts/catalog.mjs";
import { checkCoverage, discoverAssets, readEvals, root } from "../scripts/validate-evals.mjs";
import { validateMcpConfig, validateRepository } from "../scripts/validate.mjs";

test("discovery covers every local skill, agent, hook, extension, and advertised MCP tool", async () => {
  const assets = await discoverAssets();
  assert.deepEqual(assets.map((asset) => asset.kind).sort(), [
    "agent", "extension", "hook", "mcp", "mcp", "skill", "skill", "skill", "skill", "skill",
  ]);
  assert.deepEqual(assets.filter((asset) => asset.kind === "mcp").map((asset) => asset.id).sort(), [
    "mcp:json-configuration/json-configuration/get_json_value",
    "mcp:json-configuration/json-configuration/validate_json",
  ]);
  checkCoverage(assets, await readEvals());
});

test("coverage rejects unknown, unloaded, invocation-free, negative-free, and smoke-free cases", async () => {
  const assets = await discoverAssets();
  const specs = await readEvals();
  const author = specs.find((item) => item.spec.name === "customization-authoring");
  const only = assets.filter((asset) => asset.id === "skill:customization-authoring/skill-authoring");
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
  assert.throws(() => checkCoverage(only, modify((spec) => { spec.stimuli[0].tags.suite = "pr"; })), /only tagged suite is smoke/);
  assert.throws(() => checkCoverage(only, modify((spec) => { delete spec.stimuli[1].tags.control; })), /tags\.control/);
});

test("MCP coverage requires the configured server and an asserted tool result", async () => {
  const assets = (await discoverAssets()).filter((asset) => asset.id.includes(":json-configuration/"));
  const specs = (await readEvals()).filter((item) => item.spec.name === "json-configuration");
  assert.doesNotThrow(() => checkCoverage(assets, specs));
  const unconfigured = structuredClone(specs);
  delete unconfigured[0].spec.agent_environment.mcpServers;
  assert.throws(() => checkCoverage(assets, unconfigured), /configure the actual MCP server/);
  const resultless = structuredClone(specs);
  for (const stimulus of resultless[0].spec.stimuli) {
    for (const grader of stimulus.graders) for (const rule of grader.config?.required ?? []) if (typeof rule === "object") delete rule.result;
  }
  assert.throws(() => checkCoverage(assets, resultless), /actual tool call and its result/);
});

test("a relocated copy discovers the bundled MCP tools without this checkout's node_modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter copied template "));
  try {
    await cp(join(root, "marketplace.json"), join(directory, "marketplace.json"));
    await cp(join(root, "plugins"), join(directory, "plugins"), { recursive: true });
    const assets = await discoverAssets(directory);
    assert.equal(assets.filter((asset) => asset.kind === "mcp").length, 2);
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
