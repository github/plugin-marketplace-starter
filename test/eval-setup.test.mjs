import test from "node:test";
import assert from "node:assert/strict";
import { resolve, delimiter, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { checkCoverage, discoverAssets, readEvals, root, suiteTags } from "../scripts/validate-evals.mjs";
import { evalFilenameMatcher, paramsFileName, readCatalog, readVallyConfig } from "../scripts/catalog.mjs";
import { defaultRuntime, pluginDirectories, runtimeArguments, runtimeEntry } from "../scripts/eval-runtime.js";
import { evalParams, generatedHeader, isPathParam, pathParams, runtimeBridge, runtimeEnvironment, vallyArguments, vallyCliPath, writeActionParams } from "../scripts/evals.mjs";
import { expectedCases, render, summarize } from "../scripts/eval-report.mjs";

test("all local assets have positive, smoke, and negative coverage", async () => {
  const config = await readVallyConfig(root);
  const assets = await discoverAssets();
  const specs = await readEvals(root, config);
  const { localPlugins } = await readCatalog(root);
  assert.ok(assets.length > 0);
  for (const asset of assets) assert.ok(localPlugins.some((plugin) => asset.id.split(":")[1].startsWith(`${plugin.name}/`)));
  const stimuli = specs.flatMap(({ spec }) => spec.stimuli);
  assert.equal(checkCoverage(assets, specs, { suites: suiteTags(config) }), stimuli.length);
  for (const asset of assets) {
    const withoutPositive = specs.map((item) => ({ ...item, spec: { ...item.spec,
      stimuli: item.spec.stimuli.filter((stimulus) => !(stimulus.tags.control === "positive" && [stimulus.tags.assets].flat().includes(asset.id))) } }))
      .filter((item) => item.spec.stimuli.length);
    assert.throws(() => checkCoverage(assets, withoutPositive, { suites: suiteTags(config) }), /missing/);
  }
});

test("the brainstorm example keeps explicit headless canvas boundaries", { skip: !existsSync(resolve(root, "plugins/team-brainstorm")) }, async () => {
  const assets = await discoverAssets();
  const specs = await readEvals();
  const canvasCases = specs.flatMap(({ spec }) => spec.stimuli).filter((stimulus) => stimulus.agent_environment?.mcpServers?.["brainstorm-host"]);
  assert.ok(canvasCases.length >= 2);
  for (const stimulus of canvasCases) assert.equal(stimulus.tags.boundary, "headless-sdk-contract");
  const ungradedNegative = structuredClone(specs);
  const arithmetic = ungradedNegative.flatMap(({ spec }) => spec.stimuli).find((stimulus) => stimulus.name === "brainstorm-does-not-trigger-for-arithmetic");
  arithmetic.tags.assets = ["skill:team-brainstorm/team-brainstorm"];
  assert.throws(() => checkCoverage(assets, ungradedNegative), /extension:team-brainstorm\/brainstorm: missing negative control/);
  const relabeled = structuredClone(specs);
  relabeled.flatMap(({ spec }) => spec.stimuli).find((stimulus) => stimulus.name === "brainstorm-preserves-and-moves-session-notes").tags.boundary = "native-ui";
  assert.throws(() => checkCoverage(assets, relabeled), /host boundary honestly/);
});

test("the bug-report example must load its actual skill", { skip: !existsSync(resolve(root, "plugins/bug-report")) }, async () => {
  const assets = await discoverAssets();
  const specs = await readEvals();
  const unloaded = structuredClone(specs);
  unloaded.find((item) => item.spec.name === "bug-report-behavior").spec.agent_environment.skills = [];
  assert.throws(() => checkCoverage(assets, unloaded), /load the actual skill/);
});

test("eval-only dependencies stay out of plugins and remote installation stays opt-in", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  for (const [name, version] of Object.entries({
    "@github/copilot": "1.0.98", "@microsoft/vally-cli": "0.19.0", "@modelcontextprotocol/sdk": "1.32.1",
  })) assert.equal(manifest.devDependencies[name], version);
  for (const version of Object.values(manifest.devDependencies)) assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.engines.node, ">=22.14.0");
  const settings = JSON.parse(await readFile(resolve(root, ".github/copilot/settings.json"), "utf8"));
  const { catalog, localPlugins, remotePlugins } = await readCatalog(root);
  assert.deepEqual(Object.keys(settings.enabledPlugins).sort(), localPlugins.map((entry) => `${entry.name}@${catalog.name}`).sort());
  for (const remote of remotePlugins) assert.equal(settings.enabledPlugins[`${remote.name}@${catalog.name}`], undefined);
});

test("runtime setup uses the pinned full runtime bridge and mounts only requested plugin directories", () => {
  const env = runtimeEnvironment({ Path: "/existing", STARTER_PLUGIN_DIRS: "plugins/format-json" });
  assert.equal(Object.keys(env).filter((name) => name.toLowerCase() === "path").length, 1);
  assert.equal(env.PATH.split(delimiter)[0], resolve(root, "node_modules/.bin"));
  assert.equal(env.COPILOT_CLI_PATH, runtimeBridge);
  assert.equal(env.MARKETPLACE_VALLY_CLI, undefined);
  assert.equal(runtimeEntry({}), resolve(root, "node_modules/@github/copilot/npm-loader.js"));
  assert.equal(runtimeEntry({}), defaultRuntime);
  const args = runtimeArguments(["--headless", "--stdio"], env);
  assert.ok(args.includes("--no-ask-user"));
  assert.ok(args.includes("--disable-builtin-mcps"));
  assert.equal(args[args.indexOf("--plugin-dir") + 1], resolve(root, "plugins/format-json"));
  assert.ok(!runtimeArguments([], {}).includes("--plugin-dir"));
  const absolute = resolve(root, "plugins/other");
  assert.deepEqual(pluginDirectories({ STARTER_PLUGIN_DIRS: ` plugins/a , ${absolute},,` }), [resolve(root, "plugins/a"), absolute]);
  assert.equal(runtimeArguments([], { STARTER_PLUGIN_DIRS: "plugins/a,plugins/b" }).filter((arg) => arg === "--plugin-dir").length, 2);
  assert.throws(() => runtimeEntry({ STARTER_COPILOT_CLI: "npm-loader.js" }), /absolute/);
});

test("the launcher passes absolute values for every .vally.yaml path param and keeps bounded retries", async () => {
  const config = parse(await readFile(resolve(root, ".vally.yaml"), "utf8"));
  assert.ok(config.suites.smoke?.filter?.suite === "smoke", "CI runs the smoke suite by default.");
  const configuredPaths = Object.entries(config.params ?? {}).filter(([, value]) => isPathParam(value));
  assert.deepEqual(Object.keys(evalParams).sort(), configuredPaths.map(([name]) => name).sort());
  for (const [name, value] of configuredPaths) {
    assert.ok(isAbsolute(evalParams[name]));
    assert.equal(evalParams[name], resolve(root, value));
  }
  assert.ok(!isPathParam("gpt-5.4-mini") && !isPathParam(["a/b"]) && !isPathParam("https://example.com/a") && isPathParam("evals/x.mjs"));
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

test("path params come only from .vally.yaml, so removing an example removes its param", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-params-"));
  try {
    assert.deepEqual(await pathParams(directory), {});
    await writeFile(join(directory, ".vally.yaml"), "params:\n  SERVER: tools/server.mjs\n  MODEL: gpt-5.4-mini\n");
    assert.deepEqual(await pathParams(directory), { SERVER: resolve(directory, "tools/server.mjs") });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Action params files hold only referenced absolute params and never overwrite authored files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-action-params-"));
  const params = { JSON_MCP_SERVER: resolve(directory, "server.mjs") };
  const config = { paths: { evalFilenames: ["eval.yaml", "*.eval.yaml"] } };
  try {
    await mkdir(join(directory, "uses"), { recursive: true });
    await mkdir(join(directory, "plain"), { recursive: true });
    await mkdir(join(directory, "upstream"), { recursive: true });
    await writeFile(join(directory, "uses/eval.yaml"), "stimuli:\n  - args: ['${JSON_MCP_SERVER}']\n");
    await writeFile(join(directory, "plain/eval.yaml"), "stimuli: []\n");
    await writeFile(join(directory, "upstream/release.eval.yaml"), "stimuli:\n  - args: ['${JSON_MCP_SERVER}']\n");
    const written = (await writeActionParams(directory, params, config)).sort();
    assert.deepEqual(written, [join(directory, "upstream/release.eval.params.yaml"), join(directory, "uses/eval.params.yaml")].sort());
    for (const file of written) {
      const text = await readFile(file, "utf8");
      assert.ok(text.startsWith(generatedHeader));
      assert.deepEqual(parse(text), { params });
    }
    assert.equal((await writeActionParams(directory, params, config)).length, 2);
    await writeFile(join(directory, "uses/eval.params.yaml"), "params:\n  MODEL: [a, b]\n");
    await assert.rejects(writeActionParams(directory, params, config), /wasn't generated by action-params/);
    assert.equal(await readFile(join(directory, "uses/eval.params.yaml"), "utf8"), "params:\n  MODEL: [a, b]\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const ignore = await readFile(resolve(root, ".gitignore"), "utf8");
  assert.match(ignore, /^evals\/\*\*\/eval\.params\.yaml$/m);
  assert.match(ignore, /^evals\/\*\*\/\*\.eval\.params\.yaml$/m);
});

test("eval discovery follows .vally.yaml evalFilenames, including the upstream *.eval.yaml convention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-eval-names-"));
  try {
    await mkdir(join(directory, "evals/a"), { recursive: true });
    await mkdir(join(directory, "evals/graders/dist"), { recursive: true });
    await writeFile(join(directory, "evals/a/eval.yaml"), "name: a\nstimuli: []\n");
    await writeFile(join(directory, "evals/a/release.eval.yaml"), "name: b\nstimuli: []\n");
    await writeFile(join(directory, "evals/a/eval.params.yaml"), "params: {}\n");
    await writeFile(join(directory, "evals/graders/dist/ignored.eval.yaml"), "name: dist\n");
    const names = async (config) => (await readEvals(directory, config)).map(({ spec }) => spec.name).sort();
    assert.deepEqual(await names({ paths: { evalFilenames: ["eval.yaml", "*.eval.yaml"] } }), ["a", "b"]);
    assert.deepEqual(await names({ paths: { evalFilenames: ["*.eval.yaml"] } }), ["b"]);
    assert.deepEqual(await names({}), ["a"]);
    await assert.rejects(readEvals(directory, { paths: { evalFilenames: ["missing.yaml"] } }), /evalFilenames/);
    assert.throws(() => evalFilenameMatcher(["evals/**/eval.yaml"]), /plain file names/);
    assert.equal(paramsFileName("release.eval.yaml"), "release.eval.params.yaml");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("deterministic CI stays model-free, and opt-in behavioral CI uses the Evals Action or the npm runner on trusted code", async () => {
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
        if (step.uses) assert.match(step.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${step.uses}: pin every action to a full commit SHA.`);
        if (step.uses?.startsWith("actions/checkout")) assert.equal(step.with["persist-credentials"], false);
      }
    }
  }
  assert.ok(!("pull_request_target" in evals.on));
  assert.deepEqual(Object.keys(evals.on).sort(), ["pull_request", "workflow_dispatch"]);
  assert.deepEqual(evals.on.pull_request.types, ["opened", "synchronize", "reopened", "ready_for_review"]);
  assert.deepEqual(evals.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(evals.jobs).sort(), ["evals", "evals-npm"]);
  for (const [name, job] of Object.entries(evals.jobs)) {
    // Opt-in, never on forks or drafts, and only one runner job at a time.
    assert.match(job.if, /github\.event_name == 'workflow_dispatch' \|\|/, name);
    assert.match(job.if, /vars\.ENABLE_EVALS == 'true' &&/, name);
    assert.match(job.if, /head\.repo\.full_name == github\.repository/, name);
    assert.match(job.if, /!github\.event\.pull_request\.draft/, name);
    assert.deepEqual(job.concurrency, { group: "evals-${{ github.workflow_ref }}", "cancel-in-progress": false });
    const setupNode = job.steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
    assert.ok(automatic.jobs.validate.strategy.matrix.node.includes(setupNode.with["node-version"]), "Use a Node major that validate.yml also tests.");
    const preflight = job.steps.find((step) => step.name === "Check the runtime bridge");
    assert.ok(job.steps.indexOf(job.steps.find((step) => step.run?.startsWith("npm ci"))) < job.steps.indexOf(preflight));
  }
  assert.match(evals.jobs.evals.if, /^vars\.EVALS_RUNNER != 'npm' &&/);
  assert.match(evals.jobs["evals-npm"].if, /^vars\.EVALS_RUNNER == 'npm' &&/);
  const job = evals.jobs.evals;
  assert.deepEqual(job.permissions, { contents: "read", "copilot-requests": "write", "pull-requests": "write" });
  const steps = job.steps;
  const action = steps.find((step) => step.uses?.startsWith("github/evals-action@"));
  assert.equal(action.uses, "github/evals-action@83fa12332c3e44ad899f347eaf153a0d9b6432dc");
  const preflight = steps.find((step) => step.name === "Check the runtime bridge");
  assert.ok(steps.indexOf(preflight) < steps.indexOf(action));
  assert.equal(preflight.env.COPILOT_CLI_PATH, action.env.COPILOT_CLI_PATH);
  assert.ok(steps.indexOf(steps.find((step) => step.run?.startsWith("npm ci"))) < steps.indexOf(action));
  assert.ok(steps.indexOf(steps.find((step) => step.run === "node scripts/evals.mjs action-params")) < steps.indexOf(action));
  assert.equal(action.with["working-directory"], ".");
  assert.match(action.with.suite, /'smoke'/);
  assert.equal(action.with["vally-version"], manifest.devDependencies["@microsoft/vally-cli"]);
  assert.equal(action.with["copilot-token"], "${{ github.token }}");
  assert.equal(String(action.with["upload-transcripts"]), "false");
  assert.deepEqual(action.with["credential-env"].trim().split("\n"), ["COPILOT_CLI_PATH"]);
  assert.deepEqual(Object.keys(action.env), ["COPILOT_CLI_PATH"]);
  assert.equal(action.env.COPILOT_CLI_PATH, "${{ github.workspace }}/scripts/eval-runtime.js");
  const npmJob = evals.jobs["evals-npm"];
  assert.deepEqual(npmJob.permissions, { contents: "read", "copilot-requests": "write" });
  assert.ok(!npmJob.steps.some((step) => step.uses?.startsWith("github/evals-action@")), "The npm runner must not need the private Action.");
  const runStep = npmJob.steps.find((step) => step.name === "Run evals");
  assert.equal(runStep.run, 'node scripts/evals.mjs eval --suite "$SUITE" --require-pass');
  assert.deepEqual(runStep.env, { GITHUB_TOKEN: "${{ github.token }}" });
  assert.match(npmJob.env.SUITE, /'smoke'/);
  const report = npmJob.steps.find((step) => step.name === "Report eval results");
  assert.ok(npmJob.steps.indexOf(runStep) < npmJob.steps.indexOf(report));
  assert.match(report.if, /!cancelled\(\)/);
  const upload = npmJob.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.match(upload.if, /vars\.EVALS_UPLOAD_RESULTS == 'true'/, "Transcripts upload only when someone opts in.");
  assert.ok(manifest.scripts.verify.includes("eval:lint"));
  assert.ok(manifest.scripts.verify.includes("build:check"));
  assert.ok(!manifest.scripts.verify.includes("eval:smoke"));
  assert.ok(!manifest.scripts.verify.includes("npm run eval "));
});

test("reports select the cases of a configured suite or of specific eval specs", () => {
  const specs = [
    { path: resolve(root, "evals/a/eval.yaml"), spec: { stimuli: [{ name: "a-smoke", tags: { suite: "smoke" } }, { name: "a-other", tags: {} }] } },
    { path: resolve(root, "evals/b/release.eval.yaml"), spec: { stimuli: [{ name: "b-ci", tags: { lane: ["ci", "nightly"] } }] } },
  ];
  const config = { suites: {
    smoke: { filter: { suite: "smoke" } },
    ci: { filter: { lane: "ci" } },
    full: { evals: ["evals/**/eval.yaml", "evals/**/*.eval.yaml"] },
    "a-only": { evals: ["evals/a/*.yaml"] },
  } };
  const names = (options) => [...expectedCases(specs, config, options)].sort();
  assert.deepEqual(names({}), ["a-other", "a-smoke", "b-ci"]);
  assert.deepEqual(names({ suite: "smoke" }), ["a-smoke"]);
  assert.deepEqual(names({ suite: "ci" }), ["b-ci"]);
  assert.deepEqual(names({ suite: "a-only" }), ["a-other", "a-smoke"]);
  assert.deepEqual(names({ evalSpecs: ["evals/b/release.eval.yaml"] }), ["b-ci"]);
  assert.deepEqual(names({ evalSpecs: ["evals/a/eval.yaml"], suite: "smoke" }), ["a-smoke"]);
  assert.throws(() => expectedCases(specs, config, { suite: "nightly" }), /Unknown suite nightly/);
  assert.throws(() => expectedCases(specs, config, { evalSpecs: ["evals/missing/eval.yaml"] }), /No eval spec/);
  assert.throws(() => expectedCases(specs, config, { evalSpecs: ["evals/b/release.eval.yaml"], suite: "smoke" }), /no cases/);
});
