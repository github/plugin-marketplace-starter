import test from "node:test";
import assert from "node:assert/strict";
import { resolve, delimiter } from "node:path";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { checkCoverage, discoverAssets, readEvals, root } from "../scripts/validate-evals.mjs";
import { runtimeArguments } from "../scripts/eval-runtime.js";
import { runtimeEnvironment } from "../scripts/evals.mjs";
import { render, summarize } from "../scripts/eval-report.mjs";

test("local skills and hooks have positive smoke coverage; native canvas checks stay separate", async () => {
  const assets = await discoverAssets();
  const specs = await readEvals();
  assert.deepEqual(assets.map((asset) => asset.id).sort(), [
    "extension:team-brainstorm/brainstorm", "hook:format-json/postToolUse",
    "skill:bug-report/bug-report", "skill:team-brainstorm/team-brainstorm",
  ]);
  assert.equal(checkCoverage(assets, specs), 9);
  assert.ok(specs.every(({ spec }) => !spec.agent_environment?.mcpServers
    && spec.stimuli.every((stimulus) => !stimulus.agent_environment?.mcpServers)));
  const missing = specs.filter((item) => item.spec.name !== "format-json-integration");
  assert.throws(() => checkCoverage(assets, missing), /missing positive/);
  const unloaded = structuredClone(specs);
  unloaded.find((item) => item.spec.name === "bug-report-behavior").spec.agent_environment.skills = [];
  assert.throws(() => checkCoverage(assets, unloaded), /load the actual skill/);
});

test("the base eval branch has no MCP fixture dependency and preserves opt-in remote installation", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(manifest.devDependencies["@modelcontextprotocol/sdk"], undefined);
  const settings = JSON.parse(await readFile(resolve(root, ".github/copilot/settings.json"), "utf8"));
  assert.equal(Object.keys(settings.enabledPlugins).length, 3);
  assert.equal(settings.enabledPlugins["evals@plugin-marketplace-starter"], undefined);
});

test("runtime setup mounts only the requested hook and has no reliance on npm PATH", () => {
  const env = runtimeEnvironment({ Path: "/existing", STARTER_ENABLE_FORMAT_HOOK: "1" });
  assert.equal(Object.keys(env).filter((name) => name.toLowerCase() === "path").length, 1);
  assert.equal(env.PATH.split(delimiter)[0], resolve(root, "node_modules/.bin"));
  const args = runtimeArguments(["--headless", "--stdio"], env);
  assert.ok(args.includes("--no-ask-user"));
  assert.ok(args.includes("--disable-builtin-mcps"));
  assert.equal(args[args.indexOf("--plugin-dir") + 1], resolve(root, "plugins/format-json"));
  assert.ok(!runtimeArguments([], {}).includes("--plugin-dir"));
  assert.throws(() => runtimeArguments([], { STARTER_ENABLE_FORMAT_HOOK: "1" }), /absolute/);
});

const trial = (passed = true) => ({
  type: "trial-result", runId: "one", stimulus: "case", status: "success",
  gradeResult: { passed, score: passed ? 1 : 0, details: [] },
  trajectory: { events: [] },
});
const footer = { type: "run-summary", runId: "one", hadExecutionErrors: false };
const expected = new Set(["case"]);

test("reporting keeps valid failures visible and rejects incomplete or malformed results", () => {
  const failed = summarize([trial(false), footer], expected);
  assert.equal(failed.errors.length, 0);
  assert.match(render(failed, "saved-run"), /BEHAVIORAL FAILURE/);
  assert.throws(() => summarize([], expected), /completion/);
  assert.throws(() => summarize([trial()], expected), /completion/);
  assert.throws(() => summarize([{ ...trial(), runId: "other" }, footer], expected), /mixed/);
  assert.throws(() => summarize([footer], expected), /No cases/);
  assert.equal(summarize([trial(), footer], new Set(["case", "missing"])).errors.length, 1);
});

test("runtime and grader infrastructure errors never become report-only scores", () => {
  for (const record of [
    { ...trial(), status: "error", error: "Timed out" },
    { ...trial(), status: "skipped", skipReason: "Unsupported" },
    { ...trial(), gradeResult: { passed: false, score: 0, status: "error" } },
    { ...trial(), trajectory: { events: [{ type: "error", data: { message: "MCP failed to initialize" } }] } },
  ]) {
    const result = summarize([record, footer], expected);
    assert.equal(result.errors.length, 1);
    assert.equal(result.rows[0].score, undefined);
    assert.match(result.rows[0].status, /ERROR/);
  }
});

test("the source validator accepts CRLF changelog headings and excludes generated eval reports", async () => {
  const script = await readFile(resolve(root, "scripts/validate.mjs"), "utf8");
  assert.ok(script.includes('replaceAll("\\r\\n", "\\n")'));
  assert.ok(script.includes('"vally-results"'));
});

test("automatic CI stays model-free and behavioral CI is an explicit manual choice", async () => {
  const automatic = parse(await readFile(resolve(root, ".github/workflows/validate.yml"), "utf8"));
  const manual = parse(await readFile(resolve(root, ".github/workflows/evals.yml"), "utf8"));
  assert.deepEqual(automatic.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(manual.on), ["workflow_dispatch"]);
  assert.equal(manual.jobs.evaluate.permissions["copilot-requests"], "write");
  const run = manual.jobs.evaluate.steps.find((step) => step.id === "evaluate");
  assert.match(run.run, /scripts\/evals\.mjs eval --suite/);
  assert.equal(run.env.GITHUB_TOKEN, "${{ github.token }}");
  for (const step of manual.jobs.evaluate.steps) assert.equal(step["continue-on-error"], undefined);
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.ok(manifest.scripts.verify.includes("eval:lint"));
  assert.ok(!manifest.scripts.verify.includes("eval:smoke"));
  assert.ok(!manifest.scripts.verify.includes("npm run eval "));
});
