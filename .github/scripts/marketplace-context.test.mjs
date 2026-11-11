import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDefaultGraderRegistry, loadEvalSpec, ProjectContext, resolveStimulus, runEval } from "@microsoft/vally";
import { parse, stringify } from "yaml";
import { checkMarketplaceEnvironment, prepareEvalContext } from "./prepare-eval-context.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = "a".repeat(40);
const schema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const hash = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

function fixture(t) {
  const directory = resolve(root, ".github/scripts", `.context-test-${randomUUID()} space`);
  mkdirSync(directory);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (path, content) => {
    const file = resolve(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  write("plugins/fixture-local/skills/local-notes/SKILL.md", "---\nname: local-notes\ndescription: Summarize local notes.\n---\nLocal notes instructions.\n");
  write("marketplace.json", JSON.stringify({ plugins: [
    { name: "fixture-local", source: "./plugins/fixture-local" },
    { name: "fixture-remote", version: "1.0.0", source: {
      source: "github", repo: "example/fixture", path: "packages/plugin", ref: "v1.0.0", sha,
    } },
  ] }));
  const environment = { skills: [
    "../../../../plugins/fixture-local/skills/local-notes",
    `../../../../.vally/marketplace/fixture-remote/${sha}/skills/remote-notes`,
  ] };
  const saveConfig = () => write(".vally.yaml", stringify({ environments: { marketplace: environment } }));
  saveConfig();
  const contents = new Map([
    ["remote-notes/SKILL.md", Buffer.from("---\nname: remote-notes\ndescription: Summarize remote notes.\n---\nRemote notes instructions.\n")],
    ["remote-notes/references/example.bin", Buffer.from([0, 128, 255])],
  ]);
  const tree = { truncated: false, tree: [...contents].map(([path, bytes]) => ({
    path: `packages/plugin/skills/${path}`, type: "blob", mode: "100644", sha: hash(bytes),
  })).concat([{ path: "packages/plugin/mcp.json", type: "blob", mode: "100644", sha: "b".repeat(40) }]) };
  const calls = [];
  const api = (endpoint, _run, accept) => {
    calls.push(endpoint);
    const response = (data) => ({ status: 200, body: JSON.stringify(data) });
    if (endpoint.startsWith("repos/example/fixture/commits/")) return response({ sha });
    if (endpoint.includes("/contents/")) return response({
      $schema: schema, name: "fixture-remote", version: "1.0.0",
    });
    if (endpoint.includes("/git/trees/")) return response(tree);
    for (const bytes of contents.values()) {
      if (endpoint.endsWith(`/git/blobs/${hash(bytes)}`)) {
        assert.equal(accept, "application/vnd.github+json", "binary sources need JSON/base64, not raw UTF-8");
        return response({ encoding: "base64", content: bytes.toString("base64") });
      }
    }
    assert.fail(`Unexpected API request: ${endpoint}`);
  };
  return { directory, write, environment, saveConfig, tree, api, calls, contents };
}

test("preparation stages pinned remote skill files, verifies cached bytes and excludes plugin runtimes", (t) => {
  const { directory, api, calls, contents } = fixture(t);
  const skills = prepareEvalContext(directory, api);
  assert.deepEqual(skills.map((path) => basename(path)), ["local-notes", "remote-notes"]);
  const remote = skills[1];
  for (const [path, bytes] of contents) {
    assert.deepEqual(readFileSync(resolve(dirname(remote), path)), bytes);
  }
  assert.equal(existsSync(resolve(dirname(remote), "mcp.json")), false);
  const firstBlobCalls = calls.filter((path) => path.includes("/git/blobs/")).length;
  assert.equal(firstBlobCalls, contents.size);
  prepareEvalContext(directory, api);
  assert.equal(calls.filter((path) => path.includes("/git/blobs/")).length, firstBlobCalls);
  writeFileSync(resolve(remote, "SKILL.md"), "changed");
  assert.throws(() => prepareEvalContext(directory, api), /Modified cached skill source/);
});

test("preparation rejects incomplete cohorts, stale pins, truncated trees and unavailable sources", (t) => {
  const { directory, environment, saveConfig, tree, api } = fixture(t);
  environment.skills.pop();
  saveConfig();
  assert.throws(() => prepareEvalContext(directory, api), /must match the catalog/);
  environment.skills.push(`../../../../.vally/marketplace/fixture-remote/${"b".repeat(40)}/skills/remote-notes`);
  saveConfig();
  assert.throws(() => checkMarketplaceEnvironment(directory), /must match the catalog/);
  environment.skills[1] = environment.skills[1].replace("b".repeat(40), sha);
  saveConfig();
  tree.truncated = true;
  assert.throws(() => prepareEvalContext(directory, api), /truncated/);
  tree.truncated = false;
  assert.throws(() => prepareEvalContext(directory, () => ({ status: 403, body: "Forbidden" })), /HTTP 403/);
  tree.tree[0].mode = "120000";
  assert.throws(() => prepareEvalContext(directory, api), /unsupported skill file mode/);
});

test("completeness checks detect new local skills and unexpected cached remote files", (t) => {
  const { directory, write, api } = fixture(t);
  const remote = prepareEvalContext(directory, api)[1];
  writeFileSync(resolve(remote, "extra.md"), "unexpected");
  assert.throws(() => prepareEvalContext(directory, api), /Unexpected cached skill file/);
  rmSync(resolve(remote, "extra.md"));
  write("plugins/fixture-local/skills/another/SKILL.md", "---\nname: another\ndescription: Another skill.\n---\nInstructions.\n");
  assert.throws(() => checkMarketplaceEnvironment(directory), /must match the catalog/);
});

test("native Vally resolves the named environment, merges a case fixture and supplies both skills to an executor without a model", async (t) => {
  const { directory, write, api } = fixture(t);
  prepareEvalContext(directory, api);
  const evalDirectory = resolve(directory, "evals/fixture-local/skills/local-notes");
  write("evals/fixture-local/skills/local-notes/fixture.txt", "case fixture");
  write("evals/fixture-local/skills/local-notes/eval.yaml", stringify({
    name: "fixture-context", agent_environment: "marketplace",
    stimuli: [{ name: "fixture-case", prompt: "Summarize notes.",
      agent_environment: { files: [{ src: "fixture.txt", dest: "input.txt" }] } }],
  }));
  const project = await ProjectContext.load(directory);
  const spec = await loadEvalSpec(resolve(evalDirectory, "eval.yaml"));
  const stimulus = resolveStimulus(spec.stimuli[0], project.config.environments[spec.environment],
    project.config.environments, spec.tags, evalDirectory, spec.grading_environment);
  let observed;
  const result = await runEval({
    prompt: stimulus.prompt, stimulus, environment: stimulus.environment, baseDir: evalDirectory,
    workDir: directory, skills: [],
    executor: { name: "test-only-no-model", execute: async (_stimulus, options) => {
      observed = options.skills.map((skill) => skill.name);
      assert.equal(readFileSync(resolve(options.workDir, "input.txt"), "utf8"), "case fixture");
      for (const name of observed) {
        assert.ok(readFileSync(resolve(options.workDir, name, "SKILL.md"), "utf8").includes(`name: ${name}`));
      }
      assert.deepEqual(readFileSync(resolve(options.workDir, "remote-notes/references/example.bin")), Buffer.from([0, 128, 255]));
      return { output: "No model was called.", workDir: options.workDir, events: [],
        metadata: { executor: "test-only-no-model" }, metrics: {}, endReason: "completed" };
    } },
  });
  t.after(() => result.cleanup());
  assert.deepEqual(observed, ["local-notes", "remote-notes"]);
  assert.equal(result.trajectory.metadata.skillsLoaded, undefined,
    "native staging is not a live Copilot skills-loaded observation");
});

test("loaded-context grader requires observed SDK inventory, not answers, paths, activation alone or mock metadata", {
  skip: !existsSync(resolve(root, "evals/_shared/graders/marketplace-context.mjs")),
}, async () => {
  const { evaluate } = await import(pathToFileURL(resolve(root, "evals/_shared/graders/marketplace-context.mjs")));
  const { score } = await import(pathToFileURL(resolve(root, "evals/_shared/graders/common.mjs")));
  const expected = ["local-notes", "remote-notes"];
  const trajectory = { output: "Both skills are available.", events: [] };
  for (const candidate of [
    trajectory,
    { ...trajectory, metadata: { executor: "copilot-sdk", skillsLoaded: ["local-notes"] } },
    { ...trajectory, metadata: { executor: "mock", skillsLoaded: expected } },
    { ...trajectory, events: [{ type: "skill_activation", data: { name: "remote-notes" } }] },
    { ...trajectory, events: [{ type: "tool_call", data: { toolName: "view", arguments: { path: "remote-notes/SKILL.md" } } }] },
  ]) {
    assert.equal(score("context", evaluate(candidate, expected)).passed, false);
  }
  assert.equal(score("context", evaluate({
    ...trajectory, metadata: { executor: "copilot-sdk", skillsLoaded: expected },
  }, expected)).passed, true);
});

test("all local skill evals use the shared environment and the runtime inventory check covers that environment", async () => {
  const skills = checkMarketplaceEnvironment();
  const project = parse(readFileSync(resolve(root, ".vally.yaml"), "utf8"));
  for (const path of skills.filter((path) => !path.includes(`${resolve(root, ".vally")}`))) {
    const plugin = basename(resolve(path, "../../"));
    const spec = await loadEvalSpec(resolve(root, "evals", plugin, "skills", basename(path), "eval.yaml"));
    assert.equal(spec.environment, "marketplace", spec.name);
    for (const raw of spec.stimuli) {
      const stimulus = resolveStimulus(raw, project.environments.marketplace, project.environments);
      assert.deepEqual(stimulus.environment.skills, project.environments.marketplace.skills);
    }
  }
  const prDescription = resolve(root, "evals/pr-description/skills/pr-description/eval.yaml");
  if (existsSync(resolve(root, "plugins/pr-description"))) {
    const spec = await loadEvalSpec(prDescription);
    const grader = spec.stimuli.flatMap((item) => item.graders).find((item) => item.name === "marketplace-skills-loaded");
    assert.deepEqual(grader.config.args.slice(1).sort(), skills.map((path) => basename(path)).sort());
  }
});

test("native program grading preserves the SDK inventory for the context check without calling a model", {
  skip: !existsSync(resolve(root, "evals/_shared/graders/marketplace-context.mjs")),
}, async (t) => {
  const { directory } = fixture(t);
  const grader = createDefaultGraderRegistry().get("program");
  const config = {
    program: process.execPath,
    args: [resolve(root, "evals/_shared/graders/marketplace-context.mjs"), "local-notes", "remote-notes"],
  };
  for (const [skillsLoaded, passed] of [
    [["local-notes", "remote-notes"], true],
    [["local-notes"], false],
  ]) {
    const result = await grader.grade({
      config, workDir: directory, stimulus: { name: "synthetic-inventory", prompt: "Synthetic evidence only." },
      trajectory: { output: "Synthetic evidence only.", events: [], workDir: directory,
        metadata: { executor: "copilot-sdk", skillsLoaded } },
    });
    assert.equal(result.passed, passed, result.evidence);
  }
});
