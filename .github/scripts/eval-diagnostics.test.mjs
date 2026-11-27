import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isGraderResult } from "@microsoft/vally";
import { summarizeRecords } from "./eval-diagnostics.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const script = resolve(root, ".github/scripts/eval-diagnostics.mjs");
const token = `ghp_${"A".repeat(36)}`;
const markers = [token, "prompt-marker", "output-marker", "evidence-marker", "label-marker", "metadata-marker",
  "error-marker", "skip-marker", "workspace-marker", "stderr-marker", "raw-line-marker", "derived-name-marker",
  "Builtin nested marker", "Passing trial marker", "/home/runner", "x".repeat(40), "path-marker"];

const directory = (t) => {
  const path = mkdtempSync(join(tmpdir(), "eval-diagnostics-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};
const run = (args, extraEnv = {}) => {
  const env = { ...process.env, ...extraEnv };
  if (!("GITHUB_STEP_SUMMARY" in extraEnv)) delete env.GITHUB_STEP_SUMMARY;
  if (!("NATIVE_DIAGNOSTICS_PATH" in extraEnv)) delete env.NATIVE_DIAGNOSTICS_PATH;
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", timeout: 10000, env });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout.trimEnd().split("\n");
};
const check = (name, passed) => ({ name, kind: "code", passed, score: passed ? 1 : 0, evidence: "" });
const trial = (stimulus, gradeResult, extra = {}) => ({
  type: "trial-result", runId: "run-1", itemId: `item-${stimulus}`, evalName: "update-remote-pins",
  evalFilePath: "evals/path-marker/eval.yaml", variant: "default", stimulus, model: "synthetic-model",
  status: "success", durationMs: 10, gradeResult,
  trajectory: { output: "output-marker", events: [{ type: "tool_call", data: { arguments: { prompt: "prompt-marker" } } }] },
  ...extra,
});

test("eval-diagnostics prints only identifiers, verdicts, scores, and program check names", (t) => {
  const failing = trial("update-remote-pins-uses-reviewed-release", {
    name: "trajectory-grade", kind: "code", passed: false, score: 7 / 9, evidence: `evidence-marker ${token}`,
    stimulusName: "update-remote-pins-uses-reviewed-release", trajectoryId: "trajectory-1",
    details: [
      { name: "derived-name-marker", graderType: "completed", kind: "code", passed: true, score: 1,
        evidence: "evidence-marker", label: "label-marker", details: [check("Builtin nested marker", true)] },
      { name: "derived-name-marker", graderType: "skill-invocation", configuredName: "invoked-skill", kind: "code",
        passed: true, score: 1, evidence: "evidence-marker", metadata: { stdout: "metadata-marker" } },
      { name: "derived-name-marker", graderType: "program", kind: "code", passed: false, score: 1 / 3,
        evidence: `evidence-marker ${token}`, metadata: { stdout: `metadata-marker ${token}`, stderr: "stderr-marker" },
        details: [
          check("Updated the exact reviewed SHA, ref and version", true),
          check("Preserved the unrelated local entry", false),
          check("Reported the upstream change and offline limit (no offline limit)", false),
          check(`Saw ${token}`, false),
          check("See /home/runner/work/path-marker", false),
          check(`Model wrote ${"x".repeat(40)}`, false),
        ] },
    ],
  }, { trialIndex: 0, totalTrials: 1, error: `error-marker ${token}`, skipReason: "skip-marker", workspacePath: "/tmp/workspace-marker" });
  const passing = trial("update-remote-pins-ignores-local-copy-edit", {
    name: "trajectory-grade", kind: "code", passed: true, score: 1, evidence: "evidence-marker",
    details: [{ name: "derived-name-marker", graderType: "program", kind: "code", passed: true, score: 1,
      evidence: "evidence-marker", details: [check("Passing trial marker", true)] }],
  });
  const unsafe = trial(`stimulus ${token}`, null, { evalName: "eval name-marker", status: "error-marker" });
  const summary = { type: "run-summary", runId: "run-1", passed: false, jsonlPath: "/tmp/path-marker",
    evals: [{ name: "update-remote-pins", evalFilePath: "evals/path-marker/eval.yaml", passed: false, overallScore: 25 / 27, threshold: 1 }] };

  const native = directory(t);
  writeFileSync(join(native, "11111111-1111-1111-1111-111111111111.stdout.log"), "0.21.0\n");
  writeFileSync(join(native, "22222222-2222-2222-2222-222222222222.stdout.log"),
    [failing, passing, unsafe].map((row) => JSON.stringify(row)).join("\n")
    + `\nraw-line-marker ${token}\n{"type":"trial-result" raw-line-marker\n${JSON.stringify(summary)}\n`);
  writeFileSync(join(native, "22222222-2222-2222-2222-222222222222.stderr.log"),
    `stderr-marker ${token}\n${JSON.stringify(trial("stderr-marker", null))}\n`);
  writeFileSync(join(native, "notes.log"), `${JSON.stringify(trial("raw-line-marker", null))}\n`);
  const stepSummary = join(native, "summary.md");

  const lines = run([], { NATIVE_DIAGNOSTICS_PATH: native, GITHUB_STEP_SUMMARY: stepSummary });
  const expected = [
    "FAIL update-remote-pins / update-remote-pins-uses-reviewed-release: status success, score 0.778, trial index 0",
    "  PASS grader #1 completed, score 1",
    "  PASS grader #2 skill-invocation (invoked-skill), score 1",
    "  FAIL grader #3 program, score 0.333",
    "    PASS check #1 Updated the exact reviewed SHA, ref and version",
    "    FAIL check #2 Preserved the unrelated local entry",
    "    FAIL check #3 Reported the upstream change and offline limit (no offline limit)",
    "    FAIL check #4 [redacted]",
    "    FAIL check #5 [redacted]",
    "    FAIL check #6 [redacted]",
    "PASS update-remote-pins / update-remote-pins-ignores-local-copy-edit: status success, score 1",
    "UNKNOWN [redacted] / [redacted]: status unknown, score unknown",
    "FAIL eval update-remote-pins: overall score 0.926, threshold 1",
  ];
  assert.deepEqual(lines, ["Sanitized eval diagnostics (identifiers, verdicts, and scores only):", ...expected]);
  const written = readFileSync(stepSummary, "utf8");
  assert.equal(written, `### Sanitized eval diagnostics\n\n\`\`\`text\n${expected.join("\n")}\n\`\`\`\n`);
  for (const marker of markers) {
    assert.ok(!lines.join("\n").includes(marker), marker);
    assert.ok(!written.includes(marker), marker);
  }
});

test("eval-diagnostics fails safe without changing the job outcome", (t) => {
  const native = directory(t);
  const header = "Sanitized eval diagnostics (identifiers, verdicts, and scores only):";
  assert.deepEqual(run([]), [header, "No native diagnostics path was provided."]);
  assert.deepEqual(run([join(native, "missing")]), [header, "Native diagnostics could not be read."]);
  assert.deepEqual(run([native]), [header, "No eval trial results were found in the native diagnostics."]);
  writeFileSync(join(native, "33333333-3333-3333-3333-333333333333.stdout.log"), "raw-line-marker\n{not json raw-line-marker\n");
  assert.deepEqual(run([native]), [header, "No eval trial results were found in the native diagnostics."]);
});

test("shared score() adds per-check details without changing the graded result", async () => {
  const { check: sharedCheck, score } = await import(pathToFileURL(resolve(root, "evals/_shared/graders/common.mjs")).href);
  const result = score("synthetic", [
    sharedCheck("Kept the entry", true),
    sharedCheck("Named the change", false, "no offline limit"),
    sharedCheck("Reported it", false, `saw ${token}`),
  ]);
  const { details, ...graded } = result;
  assert.deepEqual(graded, {
    name: "synthetic", kind: "code", passed: false, score: 1 / 3,
    evidence: "Named the change (no offline limit); Reported it",
  });
  assert.deepEqual(details, [
    check("Kept the entry", true),
    check("Named the change (no offline limit)", false),
    check("Reported it", false),
  ]);
  assert.equal(isGraderResult(result), true);
  assert.deepEqual(summarizeRecords([{ type: "trial-result", evalName: "synthetic", stimulus: "case-1", status: "success",
    gradeResult: { passed: false, score: 0.5, details: [{ ...result, graderType: "program" }] } }]).slice(1), [
    "  FAIL grader #1 program, score 0.333",
    "    PASS check #1 Kept the entry",
    "    FAIL check #2 Named the change (no offline limit)",
    "    FAIL check #3 Reported it",
  ]);
});
