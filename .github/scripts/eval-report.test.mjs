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
} from "./eval-report.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const hasPrDescription = existsSync(resolve(root, "plugins/pr-description"));
const prDescriptionTest = hasPrDescription ? test : test.skip;

const makeTrial = ({
  runId = "run-1",
  evalName = "pr-description",
  stimulus = "case-1",
  status = "success",
  passed = true,
  gradeScore = passed ? 1 : 0,
  durationMs = 2400,
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
  status,
  durationMs,
  gradeResult: { passed, score: gradeScore, details },
  trajectory: {
    output: "Done.",
    events,
    metrics: {
      wallTimeMs: durationMs,
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

test("extractTrialMetrics and summarizeRun extract per-trial and aggregate tokens and duration", () => {
  const trial1 = makeTrial({ stimulus: "case-a", durationMs: 1500, inputTokens: 800, outputTokens: 200, totalTokens: 1000 });
  const trial2 = makeTrial({ stimulus: "case-b", durationMs: 2500, inputTokens: 1200, outputTokens: 300, totalTokens: 1500, passed: false, gradeScore: 0.5 });

  assert.deepEqual(extractTrialMetrics(trial1), {
    durationMs: 1500,
    tokenUsage: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 },
  });

  const summary = summarizeRun([trial1, trial2, makeFooter()]);
  assert.equal(summary.passedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.errorCount, 0);
  assert.equal(summary.averageScore, 0.75);
  assert.equal(summary.totalDurationMs, 4000);
  assert.deepEqual(summary.tokenUsage, {
    inputTokens: 2000,
    outputTokens: 500,
    totalTokens: 2500,
  });
  assert.equal(formatTokens(summary.tokenUsage), "2,500 (in: 2,000, out: 500)");
  assert.equal(formatDuration(summary.totalDurationMs), "4.0s");
  assert.equal(formatDuration(450), "450ms");

  const markdown = renderReport(summary, "vally-results/run-1/results.jsonl");
  assert.match(markdown, /\| Passed \| Failed \| Avg Score \| Total Tokens \| Total Duration \|/);
  assert.match(markdown, /\| 1 \| 1 \| 75\.0% \| 2,500 \(in: 2,000, out: 500\) \| 4\.0s \|/);
  assert.match(markdown, /\| case-a \| PASS \| 100\.0% \| 1,000 \(in: 800, out: 200\) \| 1\.5s \|/);
  assert.match(markdown, /\| case-b \| BEHAVIORAL FAILURE \| 50\.0% \| 1,500 \(in: 1,200, out: 300\) \| 2\.5s \|/);
});

test("compareSummaries and renderReport surface fixed failures, regressions, and token diet reductions at parity", () => {
  const baseline = summarizeRun([
    makeTrial({
      runId: "base",
      stimulus: "pr-description-drafts-structured-pr-body",
      passed: false,
      gradeScore: 0.5,
      durationMs: 6840,
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
  assert.equal(comparison.deltas.totalTokens, -3660);
  assert.equal(comparison.cases[0].transition, "Fixed");
  assert.equal(comparison.cases[1].transition, "Reduced tokens at parity");

  assert.equal(
    classifyTransition(
      { status: "PASS", score: 1, tokenUsage: { totalTokens: 1000 } },
      { status: "BEHAVIORAL FAILURE", score: 0, tokenUsage: { totalTokens: 900 } },
    ),
    "Regressed",
  );

  const markdown = renderReport(candidate, "candidate/results.jsonl", {
    baselineSummary: baseline,
    baselinePath: "baseline/results.jsonl",
  });
  assert.match(markdown, /## Baseline vs\. Candidate Comparison/);
  assert.match(markdown, /\| Total Tokens \| 6,960 \(in: 5,570, out: 1,390\) \| 3,300 \(in: 2,800, out: 500\) \| -3,660 \(-52\.6%\) \|/);
  assert.match(markdown, /\| pr-description \/ pr-description-drafts-structured-pr-body \| BEHAVIORAL FAILURE \(50\.0%\) \| PASS \(100\.0%\) \| \+50\.0% \| -2,410 \(-54\.8%\) \| Fixed \|/);
  assert.match(markdown, /\| pr-description \/ pr-description-ignores-bug-and-review-question \| PASS \(100\.0%\) \| PASS \(100\.0%\) \| 0\.0% \| -1,250 \(-48\.8%\) \| Reduced tokens at parity \|/);
  assert.match(markdown, /Single-run score, token, and duration deltas are observed signals for review/);
});

prDescriptionTest("eval-report CLI compares the shared pr-description baseline and candidate fixtures and writes GITHUB_STEP_SUMMARY", (t) => {
  const tempDir = resolve(root, ".github/scripts", `.report-test-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  const summaryFile = resolve(tempDir, "step-summary.md");
  writeFileSync(summaryFile, "");

  const baselinePath = "evals/_shared/fixtures/pr-description/baseline-results.jsonl";
  const candidatePath = "evals/_shared/fixtures/pr-description/candidate-results.jsonl";
  const loadedBase = loadResults(baselinePath, root);
  const loadedCand = loadResults(candidatePath, root);
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
  assert.match(result.stdout, /## Baseline vs\. Candidate Comparison/);
  assert.match(result.stdout, /Fixed/);
  assert.match(result.stdout, /Reduced tokens at parity/);
  assert.match(readFileSync(summaryFile, "utf8"), /## Baseline vs\. Candidate Comparison/);
});

prDescriptionTest("pr-description eval stages the multi-skill marketplace cohort and enforces non-collision", async () => {
  const spec = parse(readFileSync(resolve(root, "evals/pr-description/skills/pr-description/eval.yaml"), "utf8"));
  assert.equal(spec.scoring.threshold, 1);
  const skills = spec.agent_environment.skills;
  for (const expectedSkill of [
    "../../../../plugins/pr-description/skills/pr-description",
    "../../../../plugins/plugin-authoring/skills/add-plugin",
    "../../../../plugins/plugin-authoring/skills/try-plugin-locally",
    "../../../../plugins/plugin-authoring/skills/submit-plugin",
    "../../../../plugins/marketplace-maintainer/skills/update-remote-pins",
    "../../../../plugins/marketplace-maintainer/skills/release-plugins",
  ]) {
    assert.ok(skills.includes(expectedSkill), `missing cohort skill: ${expectedSkill}`);
  }

  const grader = createDefaultGraderRegistry().get("skill-invocation");
  const positive = spec.stimuli.find((item) => item.tags?.control === "positive");
  const negative = spec.stimuli.find((item) => item.tags?.control === "negative");
  const posConfig = positive.graders.find((item) => item.type === "skill-invocation").config;
  const negConfig = negative.graders.find((item) => item.type === "skill-invocation").config;

  const exactMatch = await grader.grade({
    stimulus: positive,
    config: posConfig,
    trajectory: { output: "ok", events: [{ type: "skill_activation", data: { name: "pr-description" } }] },
  });
  assert.equal(exactMatch.passed, true);

  const neighborCollision = await grader.grade({
    stimulus: positive,
    config: posConfig,
    trajectory: {
      output: "ok",
      events: [
        { type: "skill_activation", data: { name: "pr-description" } },
        { type: "skill_activation", data: { name: "submit-plugin" } },
      ],
    },
  });
  assert.equal(neighborCollision.passed, false, "activating a neighbor skill alongside pr-description must fail");

  const negativeTriggered = await grader.grade({
    stimulus: negative,
    config: negConfig,
    trajectory: { output: "ok", events: [{ type: "skill_activation", data: { name: "pr-description" } }] },
  });
  assert.equal(negativeTriggered.passed, false, "activating pr-description on the negative case must fail");
});

prDescriptionTest("pr-description program grader enforces ordered headings, factual changes, and unshipped backlog exclusion", async (t) => {
  const gradingDir = resolve(root, ".github/scripts", `.pr-grader-test-${randomUUID()}`);
  mkdirSync(gradingDir, { recursive: true });
  t.after(() => rmSync(gradingDir, { recursive: true, force: true }));
  copyFileSync(resolve(root, "evals/pr-description/skills/pr-description/grader.mjs"), resolve(gradingDir, "grader.mjs"));
  copyFileSync(resolve(root, "evals/_shared/graders/common.mjs"), resolve(gradingDir, "common.mjs"));
  const { evaluate: evaluatePrDescription } = await import(pathToFileURL(resolve(gradingDir, "grader.mjs")));
  const { score } = await import(pathToFileURL(resolve(gradingDir, "common.mjs")));

  const validOutput = [
    "## Summary",
    "Validate `--timeout` as a positive integer in `src/cli.mjs` and add unit tests. Retry backoff (#42) remains open and out of scope.",
    "",
    "## Changes",
    "- Added positive integer validation for `--timeout` in `src/cli.mjs`.",
    "- Added unit tests for `--timeout 0` and `--timeout -5` in `test/cli.test.mjs`.",
    "",
    "## Verification",
    "- `npm test` passed (14 tests).",
    "",
    "## Risks / Rollback",
    "- Low risk; revert the commit if needed.",
  ].join("\n");

  assert.equal(score("pr-description-contract", evaluatePrDescription({ output: validOutput, events: [] })).passed, true);

  const leaksBacklogIntoChanges = validOutput.replace(
    "- Added unit tests for `--timeout 0` and `--timeout -5` in `test/cli.test.mjs`.",
    "- Added unit tests for `--timeout 0` and `--timeout -5` in `test/cli.test.mjs`.\n- Implemented exponential retry backoff (#42).",
  );
  const leakedResult = score("pr-description-contract", evaluatePrDescription({ output: leaksBacklogIntoChanges, events: [] }));
  assert.equal(leakedResult.passed, false);
  assert.match(leakedResult.evidence, /Excluded unshipped retry backoff/);

  const missingRisks = validOutput.split("## Risks / Rollback")[0];
  assert.equal(score("pr-description-contract", evaluatePrDescription({ output: missingRisks, events: [] })).passed, false);
});
