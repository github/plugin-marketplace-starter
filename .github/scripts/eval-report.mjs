import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const hasGraderError = (grade) => grade?.status === "error" || (grade?.details ?? []).some(hasGraderError);
const escapeCell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const finiteNonNegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

export function extractTrialMetrics(record) {
  const durationMs = finiteNonNegative(record?.durationMs) ?? finiteNonNegative(record?.trajectory?.metrics?.wallTimeMs);
  const rawUsage = record?.trajectory?.metrics?.tokenUsage;
  let tokenUsage;
  if (rawUsage && typeof rawUsage === "object" && !Array.isArray(rawUsage)) {
    const inputTokens = finiteNonNegative(rawUsage.inputTokens);
    const outputTokens = finiteNonNegative(rawUsage.outputTokens);
    const totalTokens = finiteNonNegative(rawUsage.totalTokens)
      ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
    if (totalTokens !== undefined) {
      tokenUsage = {
        totalTokens,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
      };
    }
  }
  return { durationMs, tokenUsage };
}

export function formatTokens(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage.totalTokens !== "number") return "—";
  const total = tokenUsage.totalTokens.toLocaleString("en-US");
  if (typeof tokenUsage.inputTokens === "number" && typeof tokenUsage.outputTokens === "number") {
    return `${total} (in: ${tokenUsage.inputTokens.toLocaleString("en-US")}, out: ${tokenUsage.outputTokens.toLocaleString("en-US")})`;
  }
  return total;
}

export function formatDuration(durationMs) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return "—";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Not scored";
  return `${(score * 100).toFixed(1)}%`;
}

export function summarizeRun(records) {
  if (!Array.isArray(records) || !records.length || records.at(-1)?.type !== "run-summary") {
    throw new Error("The run has no completion summary.");
  }
  const runIds = new Set(records.map((record) => record?.runId));
  if (runIds.size !== 1 || typeof records[0].runId !== "string") {
    throw new Error("Missing or mixed run identities.");
  }

  const rows = [];
  const errors = [];
  let passedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let scoredCount = 0;
  let scoreSum = 0;
  let totalDurationMs = 0;
  let hasDuration = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let hasTokenUsage = false;
  let hasInOutTokens = true;

  for (const record of records) {
    if (record.type === "run-summary") {
      if (typeof record.hadExecutionErrors !== "boolean") throw new Error("Invalid run summary.");
      if (record.hadExecutionErrors) errors.push("Vally reported execution errors.");
      continue;
    }
    if (record.type !== "trial-result" || typeof record.stimulus !== "string" || !record.stimulus.trim()) {
      throw new Error("Unexpected trial identity.");
    }
    if (!["success", "error", "skipped"].includes(record.status)) {
      throw new Error("Unknown trial status.");
    }

    const grade = record.gradeResult;
    const runtimeErrors = (record.trajectory?.events ?? []).filter((event) => event.type === "error");
    const fatal = record.status !== "success" || !grade || hasGraderError(grade) || runtimeErrors.length > 0;
    if (!fatal && (typeof grade.passed !== "boolean" || !Number.isFinite(grade.score) || grade.score < 0 || grade.score > 1)) {
      throw new Error(`Invalid grade: ${record.stimulus}`);
    }
    if (fatal) {
      errorCount++;
      errors.push(`${record.stimulus}: ${record.error ?? record.skipReason
        ?? (runtimeErrors.map((event) => event.data?.message).filter(Boolean).join("; ") || "No valid execution/grading result.")}`);
    } else if (grade.passed) {
      passedCount++;
      scoredCount++;
      scoreSum += grade.score;
    } else {
      failedCount++;
      scoredCount++;
      scoreSum += grade.score;
    }

    const { durationMs, tokenUsage } = extractTrialMetrics(record);
    if (durationMs !== undefined) {
      hasDuration = true;
      totalDurationMs += durationMs;
    }
    if (tokenUsage !== undefined) {
      hasTokenUsage = true;
      totalTokens += tokenUsage.totalTokens;
      if (typeof tokenUsage.inputTokens === "number" && typeof tokenUsage.outputTokens === "number") {
        totalInputTokens += tokenUsage.inputTokens;
        totalOutputTokens += tokenUsage.outputTokens;
      } else {
        hasInOutTokens = false;
      }
    }

    rows.push({
      evalName: typeof record.evalName === "string" && record.evalName.trim() ? record.evalName.trim() : undefined,
      name: record.stimulus,
      status: fatal ? "ERROR / NOT EVALUATED" : grade.passed ? "PASS" : "BEHAVIORAL FAILURE",
      passed: !fatal && grade.passed,
      score: fatal ? undefined : grade.score,
      durationMs,
      tokenUsage,
      failures: (grade?.details ?? []).filter((detail) => !detail.passed),
    });
  }

  if (!rows.length) throw new Error("No cases were evaluated.");

  return {
    runId: records[0].runId,
    rows,
    errors,
    passedCount,
    failedCount,
    errorCount,
    averageScore: scoredCount > 0 ? scoreSum / scoredCount : undefined,
    totalDurationMs: hasDuration ? totalDurationMs : undefined,
    tokenUsage: hasTokenUsage
      ? {
          totalTokens,
          ...(hasInOutTokens ? { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } : {}),
        }
      : undefined,
  };
}

function caseKey(row, useEvalPrefix) {
  return useEvalPrefix && row.evalName ? `${row.evalName} / ${row.name}` : row.name;
}

export function classifyTransition(baselineRow, candidateRow) {
  if (!baselineRow) return "Added";
  if (!candidateRow) return "Removed";
  if (baselineRow.status !== "PASS" && candidateRow.status === "PASS") return "Fixed";
  if (baselineRow.status === "PASS" && candidateRow.status !== "PASS") return "Regressed";
  if (typeof baselineRow.score === "number" && typeof candidateRow.score === "number") {
    if (candidateRow.score > baselineRow.score) return "Improved score";
    if (candidateRow.score < baselineRow.score) return "Regressed";
  }
  const baseTokens = baselineRow.tokenUsage?.totalTokens;
  const candTokens = candidateRow.tokenUsage?.totalTokens;
  if (typeof baseTokens === "number" && typeof candTokens === "number") {
    if (candTokens < baseTokens) return "Reduced tokens at parity";
    if (candTokens > baseTokens) return "Increased tokens at parity";
  }
  return "Unchanged";
}

export function compareSummaries(baseline, candidate) {
  const useEvalPrefix = baseline.rows.every((row) => Boolean(row.evalName))
    && candidate.rows.every((row) => Boolean(row.evalName));
  const baselineMap = new Map(baseline.rows.map((row) => [caseKey(row, useEvalPrefix), row]));
  const candidateMap = new Map(candidate.rows.map((row) => [caseKey(row, useEvalPrefix), row]));
  const keys = [...new Set([...baselineMap.keys(), ...candidateMap.keys()])];

  const cases = keys.map((key) => {
    const baseRow = baselineMap.get(key);
    const candRow = candidateMap.get(key);
    const scoreDelta = typeof baseRow?.score === "number" && typeof candRow?.score === "number"
      ? candRow.score - baseRow.score
      : undefined;
    const baseTokens = baseRow?.tokenUsage?.totalTokens;
    const candTokens = candRow?.tokenUsage?.totalTokens;
    const tokenDelta = typeof baseTokens === "number" && typeof candTokens === "number"
      ? candTokens - baseTokens
      : undefined;
    const tokenDeltaPct = tokenDelta !== undefined && baseTokens > 0
      ? (tokenDelta / baseTokens) * 100
      : undefined;
    const durationDeltaMs = typeof baseRow?.durationMs === "number" && typeof candRow?.durationMs === "number"
      ? candRow.durationMs - baseRow.durationMs
      : undefined;

    return {
      key,
      baseline: baseRow,
      candidate: candRow,
      scoreDelta,
      tokenDelta,
      tokenDeltaPct,
      durationDeltaMs,
      transition: classifyTransition(baseRow, candRow),
    };
  });

  const baseTotalTokens = baseline.tokenUsage?.totalTokens;
  const candTotalTokens = candidate.tokenUsage?.totalTokens;
  const totalTokenDelta = typeof baseTotalTokens === "number" && typeof candTotalTokens === "number"
    ? candTotalTokens - baseTotalTokens
    : undefined;
  const totalTokenDeltaPct = totalTokenDelta !== undefined && baseTotalTokens > 0
    ? (totalTokenDelta / baseTotalTokens) * 100
    : undefined;

  return {
    baseline,
    candidate,
    cases,
    deltas: {
      passed: candidate.passedCount - baseline.passedCount,
      failed: (candidate.failedCount + candidate.errorCount) - (baseline.failedCount + baseline.errorCount),
      averageScore: typeof baseline.averageScore === "number" && typeof candidate.averageScore === "number"
        ? candidate.averageScore - baseline.averageScore
        : undefined,
      totalTokens: totalTokenDelta,
      totalTokensPct: totalTokenDeltaPct,
      totalDurationMs: typeof baseline.totalDurationMs === "number" && typeof candidate.totalDurationMs === "number"
        ? candidate.totalDurationMs - baseline.totalDurationMs
        : undefined,
    },
  };
}

function formatSignedInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
}

function formatScoreDelta(delta) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return "—";
  const points = delta * 100;
  if (Math.abs(points) < 0.05) return "0.0%";
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}%`;
}

function formatTokenDelta(delta, pct) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return "—";
  if (delta === 0) return "0 (0.0%)";
  const sign = delta > 0 ? "+" : "";
  const pctText = typeof pct === "number" && Number.isFinite(pct)
    ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`
    : "";
  return `${sign}${delta.toLocaleString("en-US")}${pctText}`;
}

function formatDurationDelta(deltaMs) {
  if (typeof deltaMs !== "number" || !Number.isFinite(deltaMs)) return "—";
  if (deltaMs === 0) return "0.0s";
  const sign = deltaMs > 0 ? "+" : "-";
  return `${sign}${formatDuration(Math.abs(deltaMs))}`;
}

export function renderReport(summary, path, { baselineSummary, baselinePath } = {}) {
  const lines = [
    "## Behavioral eval report",
    "",
    `Saved run: \`${escapeCell(path)}\``,
    "",
    "| Passed | Failed | Avg Score | Total Tokens | Total Duration |",
    "| --- | --- | --- | --- | --- |",
    `| ${summary.passedCount} | ${summary.failedCount + summary.errorCount} | ${formatScore(summary.averageScore)} | ${formatTokens(summary.tokenUsage)} | ${formatDuration(summary.totalDurationMs)} |`,
    "",
    "| Case | Verdict | Score | Tokens | Duration |",
    "| --- | --- | --- | --- | --- |",
    ...summary.rows.map((row) =>
      `| ${escapeCell(row.name)} | ${row.status} | ${formatScore(row.score)} | ${formatTokens(row.tokenUsage)} | ${formatDuration(row.durationMs)} |`),
    "",
  ];

  const failureLines = summary.rows.flatMap((row) =>
    row.failures.map((detail) => `- ${escapeCell(row.name)} / ${escapeCell(detail.name)}: ${escapeCell(detail.evidence)}`));
  const errorLines = summary.errors.map((error) => `- ERROR: ${escapeCell(error)}`);
  if (failureLines.length || errorLines.length) {
    lines.push(...failureLines, ...errorLines, "");
  }

  if (baselineSummary) {
    const comparison = compareSummaries(baselineSummary, summary);
    lines.push(
      "## Baseline vs. Candidate Comparison",
      "",
      ...(baselinePath ? [`Baseline: \`${escapeCell(baselinePath)}\` | Candidate: \`${escapeCell(path)}\``, ""] : []),
      "| Metric | Baseline | Candidate | Delta |",
      "| --- | --- | --- | --- |",
      `| Passed | ${baselineSummary.passedCount} | ${summary.passedCount} | ${formatSignedInt(comparison.deltas.passed)} |`,
      `| Failed | ${baselineSummary.failedCount + baselineSummary.errorCount} | ${summary.failedCount + summary.errorCount} | ${formatSignedInt(comparison.deltas.failed)} |`,
      `| Avg Score | ${formatScore(baselineSummary.averageScore)} | ${formatScore(summary.averageScore)} | ${formatScoreDelta(comparison.deltas.averageScore)} |`,
      `| Total Tokens | ${formatTokens(baselineSummary.tokenUsage)} | ${formatTokens(summary.tokenUsage)} | ${formatTokenDelta(comparison.deltas.totalTokens, comparison.deltas.totalTokensPct)} |`,
      `| Total Duration | ${formatDuration(baselineSummary.totalDurationMs)} | ${formatDuration(summary.totalDurationMs)} | ${formatDurationDelta(comparison.deltas.totalDurationMs)} |`,
      "",
      "| Case | Baseline | Candidate | Score Delta | Token Delta | Transition |",
      "| --- | --- | --- | --- | --- | --- |",
      ...comparison.cases.map((item) => {
        const baseCell = item.baseline ? `${item.baseline.status} (${formatScore(item.baseline.score)})` : "—";
        const candCell = item.candidate ? `${item.candidate.status} (${formatScore(item.candidate.score)})` : "—";
        return `| ${escapeCell(item.key)} | ${baseCell} | ${candCell} | ${formatScoreDelta(item.scoreDelta)} | ${formatTokenDelta(item.tokenDelta, item.tokenDeltaPct)} | ${item.transition} |`;
      }),
      "",
      "> **Note:** Single-run score, token, and duration deltas are observed signals for review rather than multi-trial statistical proof.",
      "",
    );
  }

  return lines.join("\n");
}

export function resolveResultsPath(input, root = process.cwd()) {
  if (!input) {
    const base = resolve(root, "vally-results");
    if (!existsSync(base)) {
      throw new Error("No saved eval runs under vally-results/. Run evals first, or pass --results <path>.");
    }
    const runs = readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(resolve(base, entry.name, "results.jsonl")))
      .map((entry) => entry.name)
      .sort();
    if (!runs.length) {
      throw new Error("No saved eval runs under vally-results/. Run evals first, or pass --results <path>.");
    }
    return resolve(base, runs.at(-1), "results.jsonl");
  }
  const resolved = resolve(root, input);
  if (!existsSync(resolved)) {
    throw new Error(`${relative(root, resolved).split(sep).join("/")} doesn't exist.`);
  }
  if (statSync(resolved).isDirectory()) {
    const file = resolve(resolved, "results.jsonl");
    if (!existsSync(file)) {
      throw new Error(`${relative(root, file).split(sep).join("/")} doesn't exist.`);
    }
    return file;
  }
  return resolved;
}

export function loadResults(path, root = process.cwd()) {
  const file = resolveResultsPath(path, root);
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim());
  const records = lines.map((line) => JSON.parse(line));
  const displayPath = relative(root, file).split(sep).join("/") || file;
  return { file, displayPath, summary: summarizeRun(records) };
}

export const usage = `Usage: node .github/scripts/eval-report.mjs [options]

Reads Vally results.jsonl files and prints a Markdown report with per-case and
aggregate verdicts, scores, token usage (input, output, total), and duration.
When --baseline is supplied, also prints a Baseline vs. Candidate comparison
table highlighting fixed failures, regressions, and token deltas.

Options:
  --results, --candidate, --run-dir <path>
                    Candidate results.jsonl file or run directory. Defaults to
                    the newest run under vally-results/.
  --baseline <path> Baseline results.jsonl file or run directory to compare
                    against the candidate run.
  -h, --help        Show this help message.

Examples:
  npm run eval:report
  npm run eval:compare -- --baseline evals/_shared/fixtures/pr-description/baseline-results.jsonl --candidate evals/_shared/fixtures/pr-description/candidate-results.jsonl`;

function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        results: { type: "string" },
        candidate: { type: "string" },
        "run-dir": { type: "string" },
        baseline: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new Error(`${error.message}. Run npm run eval:report -- --help for options.`);
  }

  const { values, positionals } = parsed;
  if (values.help) {
    console.log(usage);
    return;
  }
  if (positionals.length > 2) {
    throw new Error("Pass at most two positional paths ([results] or [baseline] [candidate]). Run npm run eval:report -- --help for options.");
  }

  const baselineInput = values.baseline ?? (positionals.length === 2 ? positionals[0] : undefined);
  const candidateInput = values.candidate ?? values.results ?? values["run-dir"]
    ?? (positionals.length === 2 ? positionals[1] : positionals[0]);
  const candidate = loadResults(candidateInput);
  const baseline = baselineInput ? loadResults(baselineInput) : undefined;
  const markdown = renderReport(candidate.summary, candidate.displayPath, {
    baselineSummary: baseline?.summary,
    baselinePath: baseline?.displayPath,
  });
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  if (candidate.summary.errors.length || baseline?.summary.errors.length) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
