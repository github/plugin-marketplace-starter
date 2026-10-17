import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { readCatalog } from "./catalog.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const list = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
async function directories(path) {
  try { return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

export async function discoverAssets(directory = root) {
  const { localPlugins } = await readCatalog(directory);
  const assets = [];
  for (const plugin of localPlugins) {
    const source = resolve(directory, plugin.source);
    assert.ok(!relative(resolve(directory, "plugins"), source).split(sep).includes(".."));
    for (const skill of await directories(resolve(source, "skills"))) {
      const path = resolve(source, "skills", skill.name);
      await stat(resolve(path, "SKILL.md"));
      assets.push({ id: `skill:${plugin.name}/${skill.name}`, kind: "skill", name: skill.name, path });
    }
    const agentsPath = resolve(source, "com.github.copilot/agents");
    let agents = [];
    try { agents = await readdir(agentsPath, { withFileTypes: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const agent of agents.filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))) {
      const path = resolve(agentsPath, agent.name);
      const text = await readFile(path, "utf8");
      const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const name = (header ? parse(header[1], { uniqueKeys: true })?.name : undefined) ?? agent.name.slice(0, -9);
      assert.ok(typeof name === "string" && name.trim(), `${path}: invalid agent name.`);
      assets.push({ id: `agent:${plugin.name}/${name}`, kind: "agent", name, path });
    }
    const hooksFile = resolve(source, "com.github.copilot/hooks/hooks.json");
    let hooks;
    try { hooks = await json(hooksFile); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const event of Object.keys(hooks?.hooks ?? {})) {
      assets.push({ id: `hook:${plugin.name}/${event}`, kind: "hook", path: source });
    }
    for (const extension of await directories(resolve(source, "com.github.copilot/extensions"))) {
      const path = resolve(source, "com.github.copilot/extensions", extension.name);
      await stat(resolve(path, "extension.mjs"));
      assets.push({ id: `extension:${plugin.name}/${extension.name}`, kind: "extension", path });
    }
  }
  return assets;
}

export async function readEvals(directory = root) {
  const specs = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Do not use symlinked eval inputs: ${child}`);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name === "eval.yaml") specs.push({ path: child, spec: parse(await readFile(child, "utf8"), { uniqueKeys: true }) });
    }
  }
  await walk(resolve(directory, "evals"));
  if (!specs.length) throw new Error("No eval.yaml files were found.");
  return specs;
}

export function checkCoverage(assets, specs) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const covered = new Set();
  const smoke = new Set();
  const names = new Set();
  for (const { path, spec } of specs) {
    assert.ok(Array.isArray(spec.stimuli) && spec.stimuli.length, `${path}: stimuli are required.`);
    assert.ok(spec.stimuli.some((stimulus) => stimulus.tags?.control === "negative"), `${path}: add a negative control.`);
    for (const stimulus of spec.stimuli) {
      assert.ok(stimulus.name && !names.has(stimulus.name), `Missing/duplicate stimulus name: ${stimulus.name}`);
      names.add(stimulus.name);
      const ids = list(stimulus.tags?.assets);
      assert.ok(ids.length, `${stimulus.name}: declare covered assets.`);
      for (const id of ids) {
        const asset = byId.get(id);
        assert.ok(asset, `${stimulus.name}: unknown asset ${id}`);
        if (stimulus.tags.control !== "positive") continue;
        const graders = stimulus.graders ?? [];
        assert.ok(graders.some((grader) => ["program", "output-matches", "output-contains", "file-matches", "prompt", "panel"].includes(grader.type)),
          `${stimulus.name}: invocation alone is not outcome coverage.`);
        const env = { ...spec.agent_environment, ...stimulus.agent_environment };
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
              && rule.name === "^task$" && rule.args?.agent_type === `^${asset.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)),
          `${id}: assert delegation to the actual agent.`);
          assert.ok(graders.some((grader) => grader.scope === "subagent"
            && ["program", "output-matches", "output-contains", "prompt"].includes(grader.type)),
          `${id}: grade the subagent's behavior, not only the parent answer.`);
        } else if (asset.kind === "hook") {
          assert.equal(env.env?.STARTER_ENABLE_FORMAT_HOOK, "1", `${id}: mount the real formatter plugin.`);
          assert.ok(graders.some((grader) => grader.type === "program" && list(grader.config?.args).includes(".grading/format-json.mjs")));
        } else {
          assert.equal(stimulus.tags.boundary, "headless-sdk-contract", `${id}: label the host boundary honestly.`);
          assert.ok(env.mcpServers?.["brainstorm-host"], `${id}: configure the actual extension contract transport.`);
          assert.ok(graders.some((grader) => grader.type === "program" && list(grader.config?.args).includes(".grading/brainstorm.mjs")));
        }
        covered.add(id);
        if (list(stimulus.tags.suite).includes("smoke")) smoke.add(id);
      }
    }
  }
  for (const id of byId.keys()) {
    assert.ok(covered.has(id), `${id}: missing positive behavioral coverage.`);
    assert.ok(smoke.has(id), `${id}: missing smoke coverage.`);
  }
  return names.size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const assets = await discoverAssets();
  const specs = await readEvals();
  const count = checkCoverage(assets, specs);
  console.log(`Validated ${specs.length} eval specs and ${count} cases covering ${assets.length} local plugin assets.`);
  console.log("Canvas interaction is evaluated through a headless MCP/SDK contract, not native UI rendering.");
}
