import test from "node:test";
import assert from "node:assert/strict";
import { resolve, delimiter, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { checkCoverage, discoverAssets, readEvals, root } from "../scripts/validate-evals.mjs";
import { defaultFormatPlugin, defaultRuntime, runtimeArguments, runtimeEntry } from "../scripts/eval-runtime.js";
import { evalParams, runtimeBridge, runtimeEnvironment, vallyArguments, vallyCliPath, writeActionParams } from "../scripts/evals.mjs";
import { render, summarize } from "../scripts/eval-report.mjs";

test("all local assets have positive, smoke, and negative coverage with explicit headless canvas boundaries", async () => {
  const assets = await discoverAssets();
  const specs = await readEvals();
  assert.deepEqual(assets.map((asset) => asset.id).sort(), [
    "agent:code-review/code-reviewer",
    "extension:team-brainstorm/brainstorm", "hook:format-json/postToolUse",
    "mcp:json-configuration/json-configuration/get_json_value",
    "mcp:json-configuration/json-configuration/validate_json",
    "skill:bug-report/bug-report", "skill:code-review/adversarial-review",
    "skill:customization-authoring/skill-authoring", "skill:json-configuration/json-configuration",
    "skill:team-brainstorm/team-brainstorm",
  ]);
  assert.equal(checkCoverage(assets, specs), 21);
  const canvasCases = specs.flatMap(({ spec }) => spec.stimuli).filter((stimulus) => stimulus.agent_environment?.mcpServers?.["brainstorm-host"]);
  assert.equal(canvasCases.length, 2);
  for (const stimulus of canvasCases) assert.equal(stimulus.tags.boundary, "headless-sdk-contract");
  const missing = specs.filter((item) => item.spec.name !== "format-json-integration");
  assert.throws(() => checkCoverage(assets, missing), /missing positive/);
  const unloaded = structuredClone(specs);
  unloaded.find((item) => item.spec.name === "bug-report-behavior").spec.agent_environment.skills = [];
  assert.throws(() => checkCoverage(assets, unloaded), /load the actual skill/);
  const ungradedNegative = structuredClone(specs);
  const arithmetic = ungradedNegative.flatMap(({ spec }) => spec.stimuli).find((stimulus) => stimulus.name === "brainstorm-does-not-trigger-for-arithmetic");
  arithmetic.tags.assets = ["skill:team-brainstorm/team-brainstorm"];
  assert.throws(() => checkCoverage(assets, ungradedNegative), /extension:team-brainstorm\/brainstorm: missing negative control/);
});

test("eval-only dependencies stay out of plugins and remote installation stays opt-in", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  for (const [name, version] of Object.entries({
    "@github/copilot": "1.0.98", "@microsoft/vally-cli": "0.19.0", "@modelcontextprotocol/sdk": "1.32.1",
  })) assert.equal(manifest.devDependencies[name], version);
  for (const version of Object.values(manifest.devDependencies)) assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.engines.node, ">=22.14.0");
  const settings = JSON.parse(await readFile(resolve(root, ".github/copilot/settings.json"), "utf8"));
  assert.equal(Object.keys(settings.enabledPlugins).length, 6);
  assert.equal(settings.enabledPlugins["evals@plugin-marketplace-starter"], undefined);
});

test("runtime setup uses the pinned full runtime bridge and mounts only the requested hook", () => {
  const env = runtimeEnvironment({ Path: "/existing", STARTER_ENABLE_FORMAT_HOOK: "1" });
  assert.equal(Object.keys(env).filter((name) => name.toLowerCase() === "path").length, 1);
  assert.equal(env.PATH.split(delimiter)[0], resolve(root, "node_modules/.bin"));
  assert.equal(env.COPILOT_CLI_PATH, runtimeBridge);
  assert.equal(env.MARKETPLACE_VALLY_CLI, vallyCliPath);
  assert.equal(runtimeEntry({}), resolve(root, "node_modules/@github/copilot/npm-loader.js"));
  assert.equal(runtimeEntry({}), defaultRuntime);
  const args = runtimeArguments(["--headless", "--stdio"], env);
  assert.ok(args.includes("--no-ask-user"));
  assert.ok(args.includes("--disable-builtin-mcps"));
  assert.equal(args[args.indexOf("--plugin-dir") + 1], resolve(root, "plugins/format-json"));
  assert.equal(defaultFormatPlugin, resolve(root, "plugins/format-json"));
  assert.ok(!runtimeArguments([], {}).includes("--plugin-dir"));
  assert.throws(() => runtimeArguments([], { STARTER_ENABLE_FORMAT_HOOK: "1", STARTER_FORMAT_PLUGIN: "plugins/format-json" }), /absolute/);
  assert.throws(() => runtimeEntry({ STARTER_COPILOT_CLI: "npm-loader.js" }), /absolute/);
});

test("the launcher passes absolute params for every .vally.yaml param and keeps bounded retries", async () => {
  const config = parse(await readFile(resolve(root, ".vally.yaml"), "utf8"));
  assert.deepEqual(Object.keys(config.suites).sort(), ["full", "smoke"]);
  assert.deepEqual(Object.keys(evalParams).sort(), Object.keys(config.params).sort());
  for (const [name, value] of Object.entries(config.params)) {
    assert.ok(isAbsolute(evalParams[name]));
    assert.equal(evalParams[name], resolve(root, value));
  }
  const run = vallyArguments("eval", ["--suite", "smoke"]);
  for (const flag of [["--workers", "1"], ["--max-retries", "1"], ["--output-dir", "vally-results"]]) {
    assert.equal(run[run.indexOf(flag[0]) + 1], flag[1]);
  }
  assert.ok(run.includes("--junit"));
  assert.ok(!run.includes("--require-pass"));
  for (const [name, value] of Object.entries(evalParams)) assert.ok(run.includes(`${name}=${value}`));
  assert.deepEqual(vallyArguments("lint").slice(1, 6), ["lint", "plugins", "--eval-spec", "evals", "--strict"]);
  assert.throws(() => vallyArguments("plan"), /Use eval/);
});

test("Action params files hold only the absolute params each eval references", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-action-params-"));
  try {
    await mkdir(join(directory, "uses"), { recursive: true });
    await mkdir(join(directory, "plain"), { recursive: true });
    await writeFile(join(directory, "uses/eval.yaml"), "stimuli:\n  - args: ['${JSON_MCP_SERVER}']\n");
    await writeFile(join(directory, "plain/eval.yaml"), "stimuli: []\n");
    const written = await writeActionParams(directory);
    assert.deepEqual(written, [join(directory, "uses/eval.params.yaml")]);
    assert.deepEqual(parse(await readFile(written[0], "utf8")), { params: { JSON_MCP_SERVER: evalParams.JSON_MCP_SERVER } });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const ignore = await readFile(resolve(root, ".gitignore"), "utf8");
  assert.match(ignore, /^evals\/\*\*\/eval\.params\.yaml$/m);
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
  assert.match(render(summarize([trial(), footer], expected), "run-123"), /run-123[\s\S]*PASS/);
  assert.throws(() => summarize([], expected), /completion/);
  assert.throws(() => summarize([trial()], expected), /completion/);
  assert.throws(() => summarize([{ ...trial(), runId: "other" }, footer], expected), /mixed/);
  assert.throws(() => summarize([footer], expected), /No cases/);
  assert.throws(() => summarize([{ ...trial(), stimulus: "not-in-suite" }, footer], expected), /Unexpected/);
  assert.throws(() => summarize([{ ...trial(), type: "unrecognized" }, footer], expected), /Unexpected/);
  assert.throws(() => summarize([{ ...trial(), status: "unknown" }, footer], expected), /Unknown trial status/);
  assert.throws(() => summarize([{ ...trial(), gradeResult: { passed: "false", score: 1 } }, footer], expected), /Invalid grade/);
  assert.equal(summarize([trial(), { ...footer, hadExecutionErrors: true }], expected).errors.length, 1);
  assert.equal(summarize([trial(), footer], new Set(["case", "missing"])).errors.length, 1);
});

test("runtime and grader infrastructure errors never become report-only scores", () => {
  for (const record of [
    { ...trial(), status: "error", error: "Timed out" },
    { ...trial(), status: "skipped", skipReason: "Unsupported" },
    { ...trial(), gradeResult: { passed: false, score: 0, status: "error" } },
    { ...trial(), gradeResult: { passed: false, score: 0, details: [{ status: "error", evidence: "invalid grader" }] } },
    { ...trial(), gradeResult: null },
    { ...trial(), trajectory: { events: [{ type: "error", data: { message: "MCP failed to initialize" } }] } },
  ]) {
    const result = summarize([record, footer], expected);
    assert.equal(result.errors.length, 1);
    assert.equal(result.rows[0].score, undefined);
    assert.match(result.rows[0].status, /ERROR/);
  }
  const mcp = summarize([{ ...trial(false), trajectory: { events: [{ type: "error", data: { message: "Server file not found" } }] } }, footer], expected);
  assert.match(mcp.errors[0], /Server file not found/);
});

test("the source validator accepts CRLF changelog headings and excludes generated eval reports", async () => {
  const script = await readFile(resolve(root, "scripts/validate.mjs"), "utf8");
  assert.ok(script.includes('replaceAll("\\r\\n", "\\n")'));
  assert.ok(script.includes('"vally-results"'));
});

test("deterministic CI stays model-free and behavioral CI uses the Evals Action on trusted code", async () => {
  const automatic = parse(await readFile(resolve(root, ".github/workflows/validate.yml"), "utf8"));
  const evals = parse(await readFile(resolve(root, ".github/workflows/evals.yml"), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.deepEqual(automatic.permissions, { contents: "read" });
  assert.deepEqual(automatic.jobs.validate.strategy.matrix, { os: ["ubuntu-latest", "windows-latest", "macos-latest"], node: [22, 24] });
  assert.ok(automatic.jobs.validate.steps.some((step) => step.run === "npm run verify"));
  for (const workflow of [automatic, evals]) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        assert.equal(step["continue-on-error"], undefined);
        if (step.uses?.startsWith("actions/")) assert.match(step.uses, /@[0-9a-f]{40}$/);
        if (step.uses?.startsWith("actions/checkout")) assert.equal(step.with["persist-credentials"], false);
      }
    }
  }
  assert.ok(!("pull_request_target" in evals.on));
  assert.deepEqual(Object.keys(evals.on).sort(), ["pull_request", "workflow_dispatch"]);
  assert.deepEqual(evals.permissions, { contents: "read" });
  const job = evals.jobs.evals;
  assert.match(job.if, /head\.repo\.full_name == github\.repository/);
  assert.deepEqual(job.permissions, { contents: "read", "copilot-requests": "write", "pull-requests": "write" });
  assert.deepEqual(job.concurrency, { group: "evals-${{ github.workflow_ref }}", "cancel-in-progress": false });
  const steps = job.steps;
  const action = steps.find((step) => step.uses?.startsWith("github/evals-action@"));
  assert.equal(action.uses, "github/evals-action@v0.1.0");
  assert.ok(steps.indexOf(steps.find((step) => step.run?.startsWith("npm ci"))) < steps.indexOf(action));
  assert.ok(steps.indexOf(steps.find((step) => step.run === "node scripts/evals.mjs action-params")) < steps.indexOf(action));
  assert.equal(action.with["working-directory"], ".");
  assert.match(action.with.suite, /'smoke'/);
  assert.equal(action.with["vally-version"], manifest.devDependencies["@microsoft/vally-cli"]);
  assert.equal(action.with["copilot-token"], "${{ github.token }}");
  assert.equal(String(action.with["upload-transcripts"]), "false");
  assert.deepEqual(action.with["credential-env"].trim().split("\n"), ["COPILOT_CLI_PATH", "MARKETPLACE_VALLY_CLI"]);
  assert.equal(action.env.COPILOT_CLI_PATH, "${{ github.workspace }}/scripts/eval-runtime.js");
  assert.equal(resolve(root, action.env.MARKETPLACE_VALLY_CLI.replace("${{ github.workspace }}/", "")), vallyCliPath);
  assert.ok(manifest.scripts.verify.includes("eval:lint"));
  assert.ok(manifest.scripts.verify.includes("build:check"));
  assert.ok(!manifest.scripts.verify.includes("eval:smoke"));
  assert.ok(!manifest.scripts.verify.includes("npm run eval "));
});
