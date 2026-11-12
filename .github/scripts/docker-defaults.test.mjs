import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectContext, discoverAndFilterEvals } from "@microsoft/vally";
import { resolveBackendSettings } from "../../node_modules/@microsoft/vally-cli/dist/backend-selection.js";
import { DockerBackend } from "../../node_modules/@microsoft/vally/dist/backend/docker/docker-backend.js";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));

function assertReviewerCoverage(projectRoot, evals) {
  if (existsSync(resolve(projectRoot, "plugins/marketplace-maintainer"))) {
    assert.ok(evals.some(({ spec }) => spec.name === "plugin-reviewer-independent"),
      "retained marketplace-maintainer requires its independent reviewer eval");
  }
}

function assertBackendInheritance(command) {
  assert.doesNotMatch(command, /--(?:backend(?:-args)?|in-place)\b/);
}

test("native full-suite and explicit-spec launches inherit Docker for every retained eval", async () => {
  const project = await ProjectContext.load(root);
  const suite = project.resolveSuite("full");
  const discovery = await discoverAndFilterEvals(project, { suiteEvals: suite.evals });
  assert.deepEqual(discovery.errors, []);
  assertReviewerCoverage(root, discovery.matched);
  for (const { filePath, spec } of discovery.matched) {
    const settings = resolveBackendSettings({
      evalBackend: spec.defaults?.backend,
      projectBackend: project.config.defaults?.backend,
      projectDir: project.dir,
      evalDir: dirname(filePath),
      cliCwd: root,
    });
    assert.equal(settings.name, "docker", filePath);
    assert.equal(settings.args["grade-network"], "none", filePath);
  }
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assertBackendInheritance(pkg.scripts.eval);
  const workflow = parse(readFileSync(resolve(root, ".github/workflows/evals.yml"), "utf8"));
  const launches = workflow.jobs.evals.steps.filter((step) => /npm run eval/.test(step.run ?? ""));
  assert.equal(launches.length, 1);
  assertBackendInheritance(launches[0].run);
});

test("reviewer coverage permits plugin removal but rejects a missing retained reviewer eval", (t) => {
  const directory = resolve(root, ".vally", `reviewer-coverage-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assertReviewerCoverage(directory, []);
  mkdirSync(resolve(directory, "plugins/marketplace-maintainer"), { recursive: true });
  assert.throws(() => assertReviewerCoverage(directory, []), /requires its independent reviewer eval/);
  assertReviewerCoverage(directory, [{ spec: { name: "plugin-reviewer-independent" } }]);
});

test("shared launchers reject backend and in-place overrides in either argument form", () => {
  for (const command of ["vally eval --workers 1", "npm run eval -- --suite smoke --require-pass"]) {
    assertBackendInheritance(command);
    for (const option of [
      "--backend local", "--backend=local", "--backend docker", "--backend=docker",
      "--backend-args grade-network=default", "--backend-args=grade-network=default",
      "--in-place", "--in-place=true",
    ]) {
      assert.throws(() => assertBackendInheritance(`${command} ${option}`), assert.AssertionError);
    }
  }
});

test("documented credential recipes expose only the selected token and restore ambient values on failure", () => {
  const guide = readFileSync(resolve(root, "docs/checks-and-evals.md"), "utf8");
  const section = guide.slice(guide.indexOf("complete two-case eval"));
  const bash = section.match(/```sh\n([\s\S]*?)\n```/)[1];
  const powershell = section.match(/```powershell\n([\s\S]*?)\n```/)[1];
  const expectedBash = String.raw`(
  unset COPILOT_GITHUB_TOKEN GH_TOKEN GITHUB_TOKEN
  GH_TOKEN="$(gh auth token)" || exit
  test -n "$GH_TOKEN" || exit 1
  export GH_TOKEN
  npm run eval -- --eval-spec evals/pr-description/skills/pr-description/eval.yaml --max-retries 0
)`;
  const expectedPowerShell = String.raw`$names = 'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'
$original = @{}
foreach ($name in $names) {
  $original[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
  $token = gh auth token
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
    throw 'Could not obtain the selected gh credential.'
  }
  $env:GH_TOKEN = $token
  npm run eval -- --eval-spec evals/pr-description/skills/pr-description/eval.yaml --max-retries 0
  if ($LASTEXITCODE -ne 0) { throw "Eval exited with code $LASTEXITCODE; inspect its saved results." }
} finally {
  foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $original[$name], 'Process')
  }
  $token = $null
}`;
  assert.equal(bash, expectedBash);
  assert.equal(powershell, expectedPowerShell);
  const paid = guide.slice(guide.indexOf("## Paid evals"));
  assert.equal(paid.match(/```sh\n([\s\S]*?)\n```/)[1], expectedBash,
    "the first paid run example must include Docker prerequisites and scoped authentication");
  assert.ok(paid.indexOf("### Native Docker evals") < paid.indexOf("```sh"));
  const env = { ...process.env, COPILOT_GITHUB_TOKEN: "synthetic-copilot", GH_TOKEN: "synthetic-gh", GITHUB_TOKEN: "synthetic-github" };
  for (const exit of [0, 37]) {
    const sh = spawnSync("bash", ["-c", `
gh() { [[ -z "\${COPILOT_GITHUB_TOKEN+x}\${GH_TOKEN+x}\${GITHUB_TOKEN+x}" ]] || return 91; printf 'synthetic-selected'; }
npm() { [[ "$(printenv GH_TOKEN)" == synthetic-selected && -z "\${COPILOT_GITHUB_TOKEN+x}\${GITHUB_TOKEN+x}" ]] || return 92; return ${exit}; }
${expectedBash}
result=$?
[[ $result == ${exit} && "$COPILOT_GITHUB_TOKEN" == synthetic-copilot && "$GH_TOKEN" == synthetic-gh && "$GITHUB_TOKEN" == synthetic-github ]]
`], { env, encoding: "utf8", timeout: 10000 });
    assert.ifError(sh.error);
    assert.equal(sh.status, 0, sh.stderr);
    if (exit === 0) {
      const noExport = spawnSync("bash", ["-c", `
gh() { printf 'synthetic-selected'; }
npm() { [[ "$(printenv GH_TOKEN)" == synthetic-selected ]] || return 92; }
${expectedBash.replace("  export GH_TOKEN\n", "")}
`], { env, encoding: "utf8", timeout: 10000 });
      assert.ifError(noExport.error);
      assert.equal(noExport.status, 92, "missing export must be detected in a child process");
    }
    const ps = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
$ErrorActionPreference = 'Stop'
function gh {
  if ($env:COPILOT_GITHUB_TOKEN -or $env:GH_TOKEN -or $env:GITHUB_TOKEN) { throw 'Credential lookup was not isolated' }
  $global:LASTEXITCODE = 0
  'synthetic-selected'
}
function npm {
  if ($env:GH_TOKEN -ne 'synthetic-selected' -or $env:COPILOT_GITHUB_TOKEN -or $env:GITHUB_TOKEN) { throw 'Unexpected task credential' }
  $global:LASTEXITCODE = ${exit}
}
$caught = $false
try {
${expectedPowerShell}
} catch { $caught = $true }
if ($caught -ne $${exit !== 0} -or $env:COPILOT_GITHUB_TOKEN -ne 'synthetic-copilot' -or $env:GH_TOKEN -ne 'synthetic-gh' -or $env:GITHUB_TOKEN -ne 'synthetic-github') { throw 'Recipe did not restore original credentials' }
exit 0
`], { env, encoding: "utf8", timeout: 15000 });
    assert.ifError(ps.error);
    assert.equal(ps.status, 0, ps.stderr);
  }
});

test("a missing Docker daemon rejects native preparation rather than selecting host execution", async () => {
  const backend = new DockerBackend({
    cwd: root,
    cli: {
      contextInspect: async () => ({ name: "test-local", dockerEndpoint: "unix:///var/run/docker.sock" }),
      info: async () => { throw new Error("test Docker daemon unavailable"); },
    },
  });
  await assert.rejects(backend.prepare({}, { runId: "model-free-docker-unavailable" }),
    /test Docker daemon unavailable/);
  await backend.shutdown();
});

test("the native CLI fails closed without Docker even when a model-free local executor is available", (t) => {
  const directory = resolve(root, ".vally", `docker-unavailable-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const spec = resolve(directory, "eval.yaml");
  writeFileSync(spec, [
    "name: model-free-docker-unavailable",
    "defaults:",
    "  executor: mock",
    "  timeout: 1s",
    "stimuli:",
    "  - name: synthetic",
    "    prompt: model-free",
    "    graders:",
    "      - type: completed",
    "",
  ].join("\n"));
  const child = spawnSync(process.execPath, [
    resolve(root, "node_modules/@microsoft/vally-cli/dist/index.js"),
    "eval", "--eval-spec", spec, "--work-dir", root,
    "--workspace", resolve(directory, "workspace"),
    "--output-dir", resolve(directory, "outputs"),
    "--workers", "1", "--runs", "1", "--max-retries", "0",
    "--shutdown-timeout", "1s", "--require-pass",
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      PATH: directory,
      ...(process.env.SystemRoot && { SystemRoot: process.env.SystemRoot }),
      HOME: directory,
      USERPROFILE: directory,
      TMP: directory,
      TEMP: directory,
      DOCKER_CONFIG: directory,
      DOCKER_CONTEXT: "model-free-nonexistent-context",
      VALLY_TELEMETRY_OPTOUT: "1",
    },
  });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout + child.stderr, /docker.*ENOENT|ENOENT.*docker|Docker backend preparation/i);
});
