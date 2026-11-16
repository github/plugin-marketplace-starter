import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDefaultGraderRegistry } from "@microsoft/vally";
import { parse } from "yaml";
import {
  classifyTransition,
  compareSummaries,
  extractTrialMetrics,
  formatDuration,
  formatTokens,
  loadResults,
  renderReport,
  summarizeRun,
  summarizeSkillVerdicts,
} from "./eval-report.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const hasPrDescription = existsSync(resolve(root, "plugins/pr-description"));
const prDescriptionTest = hasPrDescription ? test : test.skip;

const makeTrial = ({
  runId = "run-1",
  evalName = "pr-description",
  stimulus = "case-1",
  model = "claude-haiku-5.5",
  status = "success",
  passed = true,
  gradeScore = passed ? 1 : 0,
  durationMs = 2400,
  wallTimeMs = durationMs,
  turnCount = 1,
  skillActivationBreakdown = {},
  inputTokens = 1100,
  outputTokens = 320,
  totalTokens = inputTokens + outputTokens,
  details = [],
  events = [],
} = {}) => ({
  type: "trial-result",
  runId,
  evalName,
  stimulus,
  model,
  status,
  durationMs,
  gradeResult: { passed, score: gradeScore, details },
  trajectory: {
    output: "Done.",
    events,
    metadata: {
      model,
    },
    metrics: {
      wallTimeMs,
      turnCount,
      skillActivationBreakdown,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens,
      },
    },
  },
});

const makeFooter = (runId = "run-1", hadExecutionErrors = false) => ({
  type: "run-summary",
  runId,
  passed: true,
  hadExecutionErrors,
  evals: [],
});

test("eval-report follows native project results configuration and retains explicit paths and defaults", async (t) => {
  const directory = resolve(root, ".github/scripts", `.report-path-test-${randomUUID()}`);
  mkdirSync(directory);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const configured = resolve(directory, "evals/results/2026-01-01/results.jsonl");
  const legacy = resolve(directory, "vally-results/2026-02-01/results.jsonl");
  for (const [file, stimulus] of [[configured, "configured-results"], [legacy, "native-default"]]) {
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, `${JSON.stringify(makeTrial({ stimulus }))}\n${JSON.stringify(makeFooter())}\n`);
  }
  const configuration = resolve(directory, ".vally.yaml");
  writeFileSync(configuration, "paths:\n  results: evals/results\n");
  assert.equal((await loadResults(undefined, directory)).file, configured);
  assert.equal((await loadResults("vally-results/2026-02-01", directory)).file, legacy);
  const cli = spawnSync(process.execPath, [resolve(root, ".github/scripts/eval-report.mjs")], {
    cwd: directory, encoding: "utf8", timeout: 10000,
  });
  assert.ifError(cli.error);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /configured-results/);
  assert.doesNotMatch(cli.stdout, /native-default/);
  writeFileSync(configuration, "{}\n");
  assert.equal((await loadResults(undefined, directory)).file, legacy);
  writeFileSync(configuration, "paths: [\n");
  await assert.rejects(loadResults(undefined, directory), /parse|YAML|flow sequence/i);
});

test("extractTrialMetrics and summarizeRun extract per-trial and aggregate tokens and duration", () => {
  const trial1 = makeTrial({
    stimulus: "case-a",
    durationMs: 1500,
    wallTimeMs: 1100,
    turnCount: 2,
    skillActivationBreakdown: { "pr-description": 1 },
    inputTokens: 800,
    outputTokens: 200,
    totalTokens: 1000,
  });
  const trial2 = makeTrial({
    stimulus: "case-b",
    durationMs: 2500,
    wallTimeMs: 1900,
    turnCount: 1,
    inputTokens: 1200,
    outputTokens: 300,
    totalTokens: 1500,
    passed: false,
    gradeScore: 0.5,
  });

  assert.deepEqual(extractTrialMetrics(trial1), {
    durationMs: 1500,
    wallTimeMs: 1100,
    turns: 2,
    model: "claude-haiku-5.5",
    skillsInvoked: ["pr-description"],
    tokenUsage: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 },
  });

  const summary = summarizeRun([trial1, trial2, makeFooter()]);
  assert.deepEqual(summary.models, ["claude-haiku-5.5"]);
  assert.equal(summary.passedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.errorCount, 0);
  assert.equal(summary.averageScore, 0.75);
  assert.equal(summary.totalDurationMs, 4000);
  assert.equal(summary.totalWallTimeMs, 3000);
  assert.equal(summary.totalTurns, 3);
  assert.deepEqual(summary.tokenUsage, {
    inputTokens: 2000,
    outputTokens: 500,
    totalTokens: 2500,
  });
  assert.equal(formatTokens(summary.tokenUsage), "2,500 (in: 2,000, out: 500)");
  assert.equal(formatDuration(summary.totalDurationMs), "4.0s");
  assert.equal(formatDuration(450), "450ms");

  const markdown = renderReport(summary, "vally-results/run-1/results.jsonl");
  assert.match(markdown, /Saved run: `vally-results\/run-1\/results\.jsonl` \| Model: `claude-haiku-5\.5`/);
  assert.match(markdown, /\| Passed \| Failed \| Avg Score \| Total Turns \| Total Tokens \| Agent Wall Time \| Total Duration \|/);
  assert.match(markdown, /\| 1 \| 1 \| 75\.0% \| 3 \| 2,500 \(in: 2,000, out: 500\) \| 3\.0s \| 4\.0s \|/);
  assert.match(markdown, /\| case-a \| PASS \| 100\.0% \| pr-description \| 2 \| 1,000 \(in: 800, out: 200\) \| 1\.1s \| 1\.5s \|/);
  assert.match(markdown, /\| case-b \| BEHAVIORAL FAILURE \| 50\.0% \| none \| 1 \| 1,500 \(in: 1,200, out: 300\) \| 1\.9s \| 2\.5s \|/);
});

test("compareSummaries and renderReport surface fixed failures, regressions, and token diet reductions at parity", () => {
  const baseline = summarizeRun([
    makeTrial({
      runId: "base",
      stimulus: "pr-description-drafts-structured-pr-body",
      passed: false,
      gradeScore: 0.5,
      durationMs: 6840,
      wallTimeMs: 5200,
      turnCount: 2,
      skillActivationBreakdown: { "pr-description": 1 },
      inputTokens: 3420,
      outputTokens: 980,
      totalTokens: 4400,
    }),
    makeTrial({
      runId: "base",
      stimulus: "pr-description-ignores-bug-and-review-question",
      passed: true,
      gradeScore: 1,
      durationMs: 4120,
      wallTimeMs: 3100,
      turnCount: 1,
      inputTokens: 2150,
      outputTokens: 410,
      totalTokens: 2560,
    }),
    makeFooter("base"),
  ]);

  const candidate = summarizeRun([
    makeTrial({
      runId: "cand",
      stimulus: "pr-description-drafts-structured-pr-body",
      passed: true,
      gradeScore: 1,
      durationMs: 3910,
      wallTimeMs: 2800,
      turnCount: 2,
      skillActivationBreakdown: { "pr-description": 1 },
      inputTokens: 1680,
      outputTokens: 310,
      totalTokens: 1990,
    }),
    makeTrial({
      runId: "cand",
      stimulus: "pr-description-ignores-bug-and-review-question",
      passed: true,
      gradeScore: 1,
      durationMs: 2450,
      wallTimeMs: 1800,
      turnCount: 1,
      inputTokens: 1120,
      outputTokens: 190,
      totalTokens: 1310,
    }),
    makeFooter("cand"),
  ]);

  const comparison = compareSummaries(baseline, candidate);
  assert.equal(comparison.deltas.passed, 1);
  assert.equal(comparison.deltas.failed, -1);
  assert.equal(comparison.deltas.averageScore, 0.25);
  assert.equal(comparison.deltas.totalTurns, 0);
  assert.equal(comparison.deltas.totalTokens, -3660);
  assert.equal(comparison.deltas.totalWallTimeMs, -3700);
  assert.equal(comparison.cases[0].transition, "Fixed");
  assert.equal(comparison.cases[1].transition, "Reduced tokens at parity");

  assert.equal(
    classifyTransition(
      { status: "PASS", score: 1, tokenUsage: { totalTokens: 1000 } },
      { status: "BEHAVIORAL FAILURE", score: 0, tokenUsage: { totalTokens: 900 } },
    ),
    "Regressed",
  );
  assert.equal(
    classifyTransition(
      { status: "PASS", score: 1, tokenUsage: { inputTokens: 1000, outputTokens: 400, totalTokens: 1400 } },
      { status: "PASS", score: 1, tokenUsage: { inputTokens: 1200, outputTokens: 250, totalTokens: 1450 } },
    ),
    "Increased tokens at parity",
  );
  assert.equal(
    classifyTransition(
      { status: "PASS", score: 1, tokenUsage: { inputTokens: 1000, outputTokens: 400, totalTokens: 1400 } },
      { status: "PASS", score: 1, tokenUsage: { inputTokens: 1150, outputTokens: 250, totalTokens: 1400 } },
    ),
    "Reduced tokens at parity",
  );

  const markdown = renderReport(candidate, "candidate/results.jsonl", {
    baselineSummary: baseline,
    baselinePath: "baseline/results.jsonl",
  });
  assert.match(markdown, /## Evals: ✅ Ship/);
  assert.match(markdown, /\| \*\*pr-description\*\* \| ✅ \*\*Ship\*\* \| 1 scenario fixed \(1\/2 → 2\/2 passing\) · -64\.0% output tokens \|/);
  assert.match(markdown, /<summary>✅ <strong>pr-description<\/strong> — 1 fixed \(1\/2 → 2\/2 passing\)<\/summary>/);
  assert.match(markdown, /<summary>📊 <strong>Telemetry, token deltas &amp; run evidence<\/strong>/);
  assert.match(markdown, /## Baseline vs\. Candidate Comparison/);
  assert.match(markdown, /\| Total Turns \| 3 \| 3 \| 0 \|/);
  assert.match(markdown, /\| Total Tokens \| 6,960 \(in: 5,570, out: 1,390\) \| 3,300 \(in: 2,800, out: 500\) \| -3,660 \(-52\.6%\) \|/);
  assert.match(markdown, /\| Output Tokens \| 1,390 \| 500 \| -890 \(-64\.0%\) \|/);
  assert.match(markdown, /\| Agent Wall Time \| 8\.3s \| 4\.6s \| -3\.7s \|/);
  assert.match(markdown, /\| pr-description \/ pr-description-drafts-structured-pr-body \| BEHAVIORAL FAILURE \(50\.0%\) \| PASS \(100\.0%\) \| \+50\.0% \| 0 \| -2,410 \(-54\.8%\) \| -2\.4s \(-46\.2%\) \| Fixed \|/);
  assert.match(markdown, /\| pr-description \/ pr-description-ignores-bug-and-review-question \| PASS \(100\.0%\) \| PASS \(100\.0%\) \| 0\.0% \| 0 \| -1,250 \(-48\.8%\) \| -1\.3s \(-41\.9%\) \| Reduced tokens at parity \|/);
  assert.match(markdown, /Single-run score, token, and duration deltas are observed signals for review/);

  // Multi-skill mixed verdict ordering: No ship and Re-run above ---, Ship and Unchanged/Telemetry below ---
  const multiSkillBase = summarizeRun([
    makeTrial({ runId: "ms-base", evalName: "pr-description", stimulus: "drafts-body", passed: false, gradeScore: 0.5, outputTokens: 900, inputTokens: 2000, totalTokens: 2900, details: [{ name: "program", passed: false, score: 0 }, { name: "completed", passed: true, score: 1 }] }),
    makeTrial({ runId: "ms-base", evalName: "release-plugins", stimulus: "preserves-version", passed: true, gradeScore: 1, outputTokens: 400, inputTokens: 2000, totalTokens: 2400, details: [{ name: "skill-invocation", passed: true, score: 1 }] }),
    makeTrial({ runId: "ms-base", evalName: "try-plugin-locally", stimulus: "prepares-session", passed: true, gradeScore: 1, outputTokens: 500, inputTokens: 2000, totalTokens: 2500 }),
    makeTrial({ runId: "ms-base", evalName: "update-remote-pins", stimulus: "updates-pins", passed: true, gradeScore: 1, outputTokens: 300, inputTokens: 1500, totalTokens: 1800 }),
    makeFooter("ms-base"),
  ]);
  const multiSkillCand = summarizeRun([
    makeTrial({ runId: "ms-cand", evalName: "pr-description", stimulus: "drafts-body", passed: true, gradeScore: 1, outputTokens: 400, inputTokens: 2000, totalTokens: 2400, details: [{ name: "program", passed: true, score: 1 }, { name: "completed", passed: true, score: 1 }] }),
    makeTrial({ runId: "ms-cand", evalName: "release-plugins", stimulus: "preserves-version", passed: false, gradeScore: 0, outputTokens: 390, inputTokens: 2000, totalTokens: 2390, details: [{ name: "skill-invocation", passed: false, score: 0 }] }),
    makeTrial({ runId: "ms-cand", evalName: "try-plugin-locally", stimulus: "prepares-session", status: "error", passed: false, gradeScore: 0, outputTokens: 0, inputTokens: 0, totalTokens: 0 }),
    makeTrial({ runId: "ms-cand", evalName: "update-remote-pins", stimulus: "updates-pins", passed: true, gradeScore: 1, outputTokens: 300, inputTokens: 1500, totalTokens: 1800 }),
    makeFooter("ms-cand", true),
  ]);
  const multiSkillComparison = compareSummaries(multiSkillBase, multiSkillCand);
  const verdicts = summarizeSkillVerdicts(multiSkillComparison);
  assert.deepEqual(verdicts.map((v) => [v.skillName, v.verdict]), [
    ["release-plugins", "🛑 No ship"],
    ["try-plugin-locally", "⚠️ Re-run"],
    ["pr-description", "✅ Ship"],
    ["update-remote-pins", "✅ Ship"],
  ]);
  const multiSkillMarkdown = renderReport(multiSkillCand, "cand/results.jsonl", {
    baselineSummary: multiSkillBase,
    baselinePath: "base/results.jsonl",
  });
  assert.match(multiSkillMarkdown, /## Evals: 🛑 No ship/);
  const hrIndex = multiSkillMarkdown.indexOf("\n---\n");
  assert.ok(hrIndex > 0, "expected --- separator between actionable and passing sections");
  assert.ok(multiSkillMarkdown.indexOf("<summary>🛑 <strong>release-plugins</strong>") < hrIndex);
  assert.ok(multiSkillMarkdown.indexOf("<summary>⚠️ <strong>try-plugin-locally</strong>") < hrIndex);
  assert.ok(multiSkillMarkdown.indexOf("<summary>✅ <strong>pr-description</strong>") > hrIndex);
  assert.ok(multiSkillMarkdown.indexOf("<summary>📋 <strong>Unchanged evals &amp; run configuration</strong>") > hrIndex);
  assert.ok(multiSkillMarkdown.indexOf("<summary>📊 <strong>Telemetry, token deltas &amp; run evidence</strong>") > hrIndex);
  assert.match(multiSkillMarkdown, /\| Outcome \| failed \| failed \(🛑 No ship\) \|/);
});

prDescriptionTest("eval-report CLI compares the shared pr-description baseline and candidate fixtures without writing GITHUB_STEP_SUMMARY", async (t) => {
  const tempDir = resolve(root, ".github/scripts", `.report-test-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  const summaryFile = resolve(tempDir, "step-summary.md");
  writeFileSync(summaryFile, "");

  const baselinePath = "evals/_shared/fixtures/pr-description/baseline-results.jsonl";
  const candidatePath = "evals/_shared/fixtures/pr-description/candidate-results.jsonl";
  const loadedBase = await loadResults(baselinePath, root);
  const loadedCand = await loadResults(candidatePath, root);
  assert.equal(loadedBase.summary.passedCount, 1);
  assert.equal(loadedCand.summary.passedCount, 2);

  const result = spawnSync(
    process.execPath,
    [
      resolve(root, ".github/scripts/eval-report.mjs"),
      "--baseline",
      baselinePath,
      "--candidate",
      candidatePath,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile },
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Model: `claude-haiku-5\.5`/);
  assert.match(result.stdout, /\| pr-description-drafts-structured-pr-body \| PASS \| 100\.0% \| pr-description \| 2 \|/);
  assert.match(result.stdout, /\| pr-description-ignores-bug-and-review-question \| PASS \| 100\.0% \| none \| 1 \|/);
  assert.match(result.stdout, /## Baseline vs\. Candidate Comparison/);
  assert.match(result.stdout, /\| Output Tokens \| 1,447 \| 991 \| -456 \(-31\.5%\) \|/);
  assert.match(result.stdout, /\| Agent Wall Time \| 17\.5s \| 16\.4s \| -1\.1s \|/);
  assert.match(result.stdout, /-4\.0s \(-36\.2%\)/);
  assert.match(result.stdout, /Fixed/);
  assert.match(result.stdout, /Increased tokens at parity/);
  assert.equal(readFileSync(summaryFile, "utf8"), "");
});

test("eval-report redacts raw grader evidence and error strings, requires complete metric coverage, aggregates multi-trial cases, and guards unscored transitions", () => {
  const secretEvidence = "SECRET_TOKEN_EVIDENCE_12345";
  const secretError = "RAW_EXECUTION_ERROR_67890";
  const secretSkip = "RAW_SKIP_REASON_ABCDE";
  const secretRuntime = "RAW_RUNTIME_EVENT_FGHIJ";

  const leakedRecords = [
    makeTrial({
      runId: "leak-run",
      stimulus: "failed-case",
      passed: false,
      gradeScore: 0.5,
      details: [{ name: "pr-description-contract", passed: false, score: 0, evidence: secretEvidence }],
    }),
    {
      ...makeTrial({ runId: "leak-run", stimulus: "error-case", status: "error" }),
      error: secretError,
    },
    {
      ...makeTrial({ runId: "leak-run", stimulus: "skip-case", status: "skipped" }),
      skipReason: secretSkip,
    },
    makeTrial({
      runId: "leak-run",
      stimulus: "runtime-error-case",
      events: [{ type: "error", data: { message: secretRuntime } }],
    }),
    makeFooter("leak-run", true),
  ];

  const leakedSummary = summarizeRun(leakedRecords);
  const leakedReport = renderReport(leakedSummary, "vally-results/leak-run/results.jsonl");
  for (const secret of [secretEvidence, secretError, secretSkip, secretRuntime]) {
    assert.ok(!JSON.stringify(leakedSummary).includes(secret), `summary leaked ${secret}`);
    assert.ok(!leakedReport.includes(secret), `report leaked ${secret}`);
  }
  assert.deepEqual(leakedSummary.rows[0].failures, ["pr-description-contract"]);
  assert.deepEqual(leakedSummary.errors, [
    "error-case: execution-error",
    "skip-case: skipped",
    "runtime-error-case: runtime-error",
    "execution-error",
  ]);

  // Partial duration or token coverage must yield undefined run totals
  const missingSecondMetrics = makeTrial({ runId: "partial-run", stimulus: "case-2" });
  delete missingSecondMetrics.durationMs;
  delete missingSecondMetrics.trajectory.metrics;
  const partialSummary = summarizeRun([
    makeTrial({ runId: "partial-run", stimulus: "case-1", durationMs: 1200, inputTokens: 500, outputTokens: 100, totalTokens: 600 }),
    missingSecondMetrics,
    makeFooter("partial-run"),
  ]);
  assert.equal(partialSummary.totalDurationMs, undefined);
  assert.equal(partialSummary.totalWallTimeMs, undefined);
  assert.equal(partialSummary.totalTurns, undefined);
  assert.equal(partialSummary.tokenUsage, undefined);

  // Multi-trial aggregation per case and mismatched trial count comparison
  const multiBase = summarizeRun([
    makeTrial({ runId: "m-base", stimulus: "repeat-case", passed: true, gradeScore: 1, durationMs: 1000, inputTokens: 400, outputTokens: 100, totalTokens: 500 }),
    makeTrial({ runId: "m-base", stimulus: "repeat-case", passed: true, gradeScore: 1, durationMs: 1200, inputTokens: 500, outputTokens: 100, totalTokens: 600 }),
    makeFooter("m-base"),
  ]);
  const multiCand = summarizeRun([
    makeTrial({
      runId: "m-cand",
      stimulus: "repeat-case",
      passed: false,
      gradeScore: 0,
      durationMs: 900,
      inputTokens: 300,
      outputTokens: 100,
      totalTokens: 400,
      details: [{ name: "contract-check", passed: false, evidence: "ignored" }],
    }),
    makeTrial({
      runId: "m-cand",
      stimulus: "repeat-case",
      passed: true,
      gradeScore: 1,
      durationMs: 900,
      inputTokens: 300,
      outputTokens: 100,
      totalTokens: 400,
      details: [{ name: "contract-check", passed: false, evidence: "ignored" }],
    }),
    makeFooter("m-cand"),
  ]);
  assert.equal(multiBase.rows.length, 1);
  assert.equal(multiBase.rows[0].trials, 2);
  assert.equal(multiBase.rows[0].passedCount, 2);
  assert.equal(multiBase.rows[0].status, "PASS");
  assert.equal(multiBase.rows[0].score, 1);
  assert.equal(multiBase.rows[0].durationMs, 2200);
  assert.equal(multiBase.rows[0].tokenUsage.totalTokens, 1100);

  assert.equal(multiCand.rows.length, 1);
  assert.equal(multiCand.rows[0].trials, 2);
  assert.equal(multiCand.rows[0].passedCount, 1);
  assert.equal(multiCand.rows[0].status, "BEHAVIORAL FAILURE");
  assert.equal(multiCand.rows[0].passed, false);
  assert.equal(multiCand.rows[0].score, 0.5);
  assert.deepEqual(multiCand.rows[0].failures, ["contract-check"]);

  const multiComp = compareSummaries(multiBase, multiCand);
  assert.equal(multiComp.cases[0].transition, "Regressed");
  assert.equal(multiComp.cases[0].scoreDelta, -0.5);
  assert.equal(multiComp.cases[0].tokenDelta, -300);

  const singleTrialCand = summarizeRun([
    makeTrial({ runId: "s-cand", stimulus: "repeat-case", passed: true, gradeScore: 1, durationMs: 900, inputTokens: 300, outputTokens: 100, totalTokens: 400 }),
    makeFooter("s-cand"),
  ]);
  const mismatchedTrialsComp = compareSummaries(multiBase, singleTrialCand);
  assert.equal(mismatchedTrialsComp.cases[0].turnsDelta, undefined);
  assert.equal(mismatchedTrialsComp.cases[0].tokenDelta, undefined);
  assert.equal(mismatchedTrialsComp.cases[0].durationDeltaMs, undefined);
  assert.equal(mismatchedTrialsComp.cases[0].wallTimeDeltaMs, undefined);
  assert.equal(mismatchedTrialsComp.cases[0].transition, "Unchanged");
  assert.equal(mismatchedTrialsComp.deltas.totalTurns, undefined);
  assert.equal(mismatchedTrialsComp.deltas.totalTokens, undefined);
  assert.equal(mismatchedTrialsComp.deltas.totalTokensPct, undefined);
  assert.equal(mismatchedTrialsComp.deltas.totalWallTimeMs, undefined);
  assert.equal(mismatchedTrialsComp.deltas.totalDurationMs, undefined);
  const mismatchedTrialsReport = renderReport(singleTrialCand, "cand/results.jsonl", {
    baselineSummary: multiBase,
    baselinePath: "base/results.jsonl",
  });
  assert.match(mismatchedTrialsReport, /\| Total Turns \| 2 \| 1 \| — \|/);
  assert.match(mismatchedTrialsReport, /\| Total Tokens \| 1,100 \(in: 900, out: 200\) \| 400 \(in: 300, out: 100\) \| — \|/);
  assert.match(mismatchedTrialsReport, /\| Agent Wall Time \| 2\.2s \| 900ms \| — \|/);
  assert.match(mismatchedTrialsReport, /\| Total Duration \| 2\.2s \| 900ms \| — \|/);
  assert.doesNotMatch(mismatchedTrialsReport, /output tokens/);

  // Footer execution error without trial failure still triggers Re-run and Outcome alignment
  const footerErrCand = summarizeRun([
    makeTrial({ runId: "f-cand", stimulus: "repeat-case", passed: true, gradeScore: 1, durationMs: 900, inputTokens: 300, outputTokens: 100, totalTokens: 400 }),
    makeFooter("f-cand", true),
  ]);
  const footerErrReport = renderReport(footerErrCand, "cand/results.jsonl", {
    baselineSummary: singleTrialCand,
    baselinePath: "base/results.jsonl",
  });
  assert.match(footerErrReport, /## Evals: ⚠️ Re-run/);
  assert.match(footerErrReport, /\| Outcome \| passed \| failed \(⚠️ Re-run\) \| ⚠️ Re-run \|/);

  const extraCaseBase = summarizeRun([
    makeTrial({ runId: "e-base", stimulus: "repeat-case", passed: true, gradeScore: 1, durationMs: 900, inputTokens: 300, outputTokens: 100, totalTokens: 400 }),
    makeTrial({ runId: "e-base", stimulus: "extra-case", passed: true, gradeScore: 1, durationMs: 900, inputTokens: 300, outputTokens: 100, totalTokens: 400 }),
    makeFooter("e-base"),
  ]);
  const mismatchedCasesComp = compareSummaries(extraCaseBase, singleTrialCand);
  assert.equal(mismatchedCasesComp.deltas.totalTurns, undefined);
  assert.equal(mismatchedCasesComp.deltas.totalTokens, undefined);
  assert.equal(mismatchedCasesComp.deltas.totalTokensPct, undefined);
  assert.equal(mismatchedCasesComp.deltas.totalWallTimeMs, undefined);
  assert.equal(mismatchedCasesComp.deltas.totalDurationMs, undefined);

  // Unscored / errored transitions
  assert.equal(
    classifyTransition(
      { status: "BEHAVIORAL FAILURE", score: 0.5, tokenUsage: { totalTokens: 2000 } },
      { status: "ERROR / NOT EVALUATED", score: undefined, tokenUsage: { totalTokens: 500 } },
    ),
    "Regressed",
  );
  assert.equal(
    classifyTransition(
      { status: "ERROR / NOT EVALUATED", score: undefined, tokenUsage: { totalTokens: 2000 } },
      { status: "ERROR / NOT EVALUATED", score: undefined, tokenUsage: { totalTokens: 500 } },
    ),
    "Unchanged",
  );
  assert.equal(
    classifyTransition(
      { status: "ERROR / NOT EVALUATED", score: undefined, tokenUsage: { totalTokens: 2000 } },
      { status: "BEHAVIORAL FAILURE", score: 0.5, tokenUsage: { totalTokens: 500 } },
    ),
    "Unchanged",
  );

  // Strip terminal escape sequences (including OSC 52) from report fields and invalid-grade errors
  const osc52Stimulus = "case-\u001b]52;c;ZWNobyBpw6g=\u0007\u001b[31mred\u001b[0m";
  const escapedSummary = summarizeRun([
    makeTrial({ runId: "osc-run", stimulus: osc52Stimulus, passed: true, gradeScore: 1 }),
    makeFooter("osc-run"),
  ]);
  const escapedReport = renderReport(escapedSummary, "vally-results/\u001b]52;c;bad\u0007/results.jsonl");
  assert.doesNotMatch(escapedReport, /\u001b|\u0007/);
  assert.throws(
    () => summarizeRun([
      {
        ...makeTrial({ runId: "bad-grade-osc", stimulus: osc52Stimulus }),
        gradeResult: { status: "success", passed: true, score: 2 },
      },
      makeFooter("bad-grade-osc"),
    ]),
    (err) => err instanceof Error && /^Invalid grade: /.test(err.message) && !/[\u001b\u0007]/.test(err.message),
  );
});
