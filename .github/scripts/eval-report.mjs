import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { loadProjectConfig } from "@microsoft/vally/config";

const hasGraderError = (grade) => grade?.status === "error" || (grade?.details ?? []).some(hasGraderError);
const stripTerminalControls = (text) => stripVTControlCharacters(String(text ?? ""))
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/gu, " ")
  .trim();
const escapeCell = (text) => stripTerminalControls(text)
  .replaceAll("&", "&amp;")
  .replaceAll("|", "\\|")
  .replaceAll("`", "&#96;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const finiteNonNegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const sanitizeIdentifier = (value, fallback = "check") => {
  const cleaned = String(value ?? fallback).replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
};
const sanitizeGraderId = (detail) => sanitizeIdentifier(
  typeof detail === "string" ? detail : (detail?.configuredName ?? detail?.name ?? detail?.graderType ?? "check"),
  "check",
);

export function extractTrialMetrics(record) {
  const wallTimeMs = finiteNonNegative(record?.trajectory?.metrics?.wallTimeMs);
  const durationMs = finiteNonNegative(record?.durationMs) ?? wallTimeMs;
  const turns = finiteNonNegative(record?.trajectory?.metrics?.turnCount);
  const rawModel = typeof record?.model === "string" && record.model.trim()
    ? record.model.trim()
    : typeof record?.trajectory?.metadata?.model === "string" && record.trajectory.metadata.model.trim()
      ? record.trajectory.metadata.model.trim()
      : undefined;
  const skillsSet = new Set();
  const rawBreakdown = record?.trajectory?.metrics?.skillActivationBreakdown;
  if (rawBreakdown && typeof rawBreakdown === "object" && !Array.isArray(rawBreakdown)) {
    for (const [name, count] of Object.entries(rawBreakdown)) {
      if (typeof count === "number" && count > 0 && name.trim()) {
        skillsSet.add(name.trim());
      }
    }
  }
  for (const event of (record?.trajectory?.events ?? [])) {
    if (event?.type === "skill_activation" && typeof event?.data?.name === "string" && event.data.name.trim()) {
      skillsSet.add(event.data.name.trim());
    }
  }
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
  return {
    durationMs,
    wallTimeMs,
    turns,
    ...(rawModel !== undefined ? { model: rawModel } : {}),
    skillsInvoked: [...skillsSet],
    tokenUsage,
  };
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

  const caseGroups = new Map();
  const runModels = new Set();
  const errors = [];
  let passedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let scoredCount = 0;
  let scoreSum = 0;
  let totalDurationMs = 0;
  let allTrialsHaveDuration = true;
  let totalWallTimeMs = 0;
  let allTrialsHaveWallTime = true;
  let totalTurns = 0;
  let allTrialsHaveTurns = true;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let allTrialsHaveTokens = true;
  let hasInOutTokens = true;
  let trialCount = 0;

  for (const record of records) {
    if (record.type === "run-summary") {
      if (typeof record.hadExecutionErrors !== "boolean") throw new Error("Invalid run summary.");
      if (record.hadExecutionErrors) errors.push("execution-error");
      continue;
    }
    if (record.type !== "trial-result" || typeof record.stimulus !== "string" || !record.stimulus.trim()) {
      throw new Error("Unexpected trial identity.");
    }
    if (!["success", "error", "skipped"].includes(record.status)) {
      throw new Error("Unknown trial status.");
    }
    trialCount++;

    const grade = record.gradeResult;
    const runtimeErrors = (record.trajectory?.events ?? []).filter((event) => event.type === "error");
    const fatalCode = record.status === "skipped"
      ? "skipped"
      : record.status !== "success"
        ? "execution-error"
        : !grade || hasGraderError(grade)
          ? "grader-error"
          : runtimeErrors.length > 0
            ? "runtime-error"
            : undefined;
    const fatal = fatalCode !== undefined;
    if (!fatal && (typeof grade.passed !== "boolean" || !Number.isFinite(grade.score) || grade.score < 0 || grade.score > 1)) {
      throw new Error(`Invalid grade: ${sanitizeIdentifier(record.stimulus, "trial")}`);
    }
    if (fatal) {
      errorCount++;
      errors.push(`${sanitizeIdentifier(record.stimulus, "trial")}: ${fatalCode}`);
    } else if (grade.passed) {
      passedCount++;
      scoredCount++;
      scoreSum += grade.score;
    } else {
      failedCount++;
      scoredCount++;
      scoreSum += grade.score;
    }

    const { durationMs, wallTimeMs, turns, model, skillsInvoked, tokenUsage } = extractTrialMetrics(record);
    if (model !== undefined) {
      runModels.add(model);
    }
    if (durationMs !== undefined) {
      totalDurationMs += durationMs;
    } else {
      allTrialsHaveDuration = false;
    }
    if (wallTimeMs !== undefined) {
      totalWallTimeMs += wallTimeMs;
    } else {
      allTrialsHaveWallTime = false;
    }
    if (turns !== undefined) {
      totalTurns += turns;
    } else {
      allTrialsHaveTurns = false;
    }
    if (tokenUsage !== undefined) {
      totalTokens += tokenUsage.totalTokens;
      if (typeof tokenUsage.inputTokens === "number" && typeof tokenUsage.outputTokens === "number") {
        totalInputTokens += tokenUsage.inputTokens;
        totalOutputTokens += tokenUsage.outputTokens;
      } else {
        hasInOutTokens = false;
      }
    } else {
      allTrialsHaveTokens = false;
    }

    const evalName = typeof record.evalName === "string" && record.evalName.trim() ? record.evalName.trim() : undefined;
    const groupKey = `${evalName ?? ""}\0${record.stimulus}`;
    let group = caseGroups.get(groupKey);
    if (!group) {
      group = {
        evalName,
        name: record.stimulus,
        trials: 0,
        passedCount: 0,
        hasFatal: false,
        allPassed: true,
        allScored: true,
        scoreSum: 0,
        allHaveDuration: true,
        durationSum: 0,
        allHaveWallTime: true,
        wallTimeSum: 0,
        allHaveTurns: true,
        turnsSum: 0,
        models: new Set(),
        skillsInvoked: new Set(),
        allHaveTokens: true,
        allHaveInOutTokens: true,
        totalTokensSum: 0,
        inputTokensSum: 0,
        outputTokensSum: 0,
        failures: new Set(),
      };
      caseGroups.set(groupKey, group);
    }

    group.trials++;
    if (model !== undefined) {
      group.models.add(model);
    }
    for (const skillName of skillsInvoked) {
      group.skillsInvoked.add(skillName);
    }
    if (fatal) {
      group.hasFatal = true;
      group.allPassed = false;
      group.allScored = false;
    } else {
      if (grade.passed) {
        group.passedCount++;
      } else {
        group.allPassed = false;
      }
      group.scoreSum += grade.score;
    }

    if (durationMs !== undefined) {
      group.durationSum += durationMs;
    } else {
      group.allHaveDuration = false;
    }

    if (wallTimeMs !== undefined) {
      group.wallTimeSum += wallTimeMs;
    } else {
      group.allHaveWallTime = false;
    }

    if (turns !== undefined) {
      group.turnsSum += turns;
    } else {
      group.allHaveTurns = false;
    }

    if (tokenUsage !== undefined) {
      group.totalTokensSum += tokenUsage.totalTokens;
      if (typeof tokenUsage.inputTokens === "number" && typeof tokenUsage.outputTokens === "number") {
        group.inputTokensSum += tokenUsage.inputTokens;
        group.outputTokensSum += tokenUsage.outputTokens;
      } else {
        group.allHaveInOutTokens = false;
      }
    } else {
      group.allHaveTokens = false;
      group.allHaveInOutTokens = false;
    }

    for (const detail of (grade?.details ?? [])) {
      if (!detail.passed) {
        group.failures.add(sanitizeGraderId(detail));
      }
    }
    group.gradersTotal = (group.gradersTotal ?? 0) + (grade?.details?.length ?? 0);
    group.gradersPassed = (group.gradersPassed ?? 0) + (grade?.details ?? []).filter((d) => d.passed).length;
  }

  if (!trialCount) throw new Error("No cases were evaluated.");

  const rows = [...caseGroups.values()].map((group) => {
    const passed = !group.hasFatal && group.allPassed;
    const status = group.hasFatal ? "ERROR / NOT EVALUATED" : passed ? "PASS" : "BEHAVIORAL FAILURE";
    return {
      evalName: group.evalName,
      name: group.name,
      trials: group.trials,
      passedCount: group.passedCount,
      status,
      passed,
      score: !group.hasFatal && group.allScored ? group.scoreSum / group.trials : undefined,
      durationMs: group.allHaveDuration ? group.durationSum : undefined,
      wallTimeMs: group.allHaveWallTime ? group.wallTimeSum : undefined,
      turns: group.allHaveTurns ? group.turnsSum : undefined,
      models: [...group.models],
      skillsInvoked: [...group.skillsInvoked],
      tokenUsage: group.allHaveTokens
        ? {
            totalTokens: group.totalTokensSum,
            ...(group.allHaveInOutTokens
              ? { inputTokens: group.inputTokensSum, outputTokens: group.outputTokensSum }
              : {}),
          }
        : undefined,
      gradersPassed: group.gradersPassed ?? 0,
      gradersTotal: group.gradersTotal ?? 0,
      failures: [...group.failures],
    };
  });

  return {
    runId: records[0].runId,
    models: [...runModels],
    rows,
    errors,
    passedCount,
    failedCount,
    errorCount,
    averageScore: scoredCount > 0 ? scoreSum / scoredCount : undefined,
    totalDurationMs: allTrialsHaveDuration ? totalDurationMs : undefined,
    totalWallTimeMs: allTrialsHaveWallTime ? totalWallTimeMs : undefined,
    totalTurns: allTrialsHaveTurns ? totalTurns : undefined,
    tokenUsage: allTrialsHaveTokens
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
  if (baselineRow.status === "BEHAVIORAL FAILURE" && candidateRow.status === "ERROR / NOT EVALUATED") return "Regressed";
  if (baselineRow.status === "ERROR / NOT EVALUATED" || candidateRow.status === "ERROR / NOT EVALUATED") return "Unchanged";
  if (typeof baselineRow.score !== "number" || !Number.isFinite(baselineRow.score)
    || typeof candidateRow.score !== "number" || !Number.isFinite(candidateRow.score)) {
    return "Unchanged";
  }
  if (candidateRow.score > baselineRow.score) return "Improved score";
  if (candidateRow.score < baselineRow.score) return "Regressed";
  if (baselineRow.status === candidateRow.status && (baselineRow.trials ?? 1) === (candidateRow.trials ?? 1)) {
    const baseTokens = baselineRow.tokenUsage?.totalTokens;
    const candTokens = candidateRow.tokenUsage?.totalTokens;
    const baseOutputTokens = baselineRow.tokenUsage?.outputTokens;
    const candOutputTokens = candidateRow.tokenUsage?.outputTokens;
    if (typeof baseTokens === "number" && typeof candTokens === "number") {
      if (candTokens < baseTokens) return "Reduced tokens at parity";
      if (candTokens > baseTokens) return "Increased tokens at parity";
      if (typeof baseOutputTokens === "number" && typeof candOutputTokens === "number") {
        if (candOutputTokens < baseOutputTokens) return "Reduced tokens at parity";
        if (candOutputTokens > baseOutputTokens) return "Increased tokens at parity";
      }
    }
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
    const sameTrialCount = (baseRow?.trials ?? 1) === (candRow?.trials ?? 1);
    const scoreDelta = typeof baseRow?.score === "number" && typeof candRow?.score === "number"
      ? candRow.score - baseRow.score
      : undefined;
    const turnsDelta = sameTrialCount && typeof baseRow?.turns === "number" && typeof candRow?.turns === "number"
      ? candRow.turns - baseRow.turns
      : undefined;
    const baseTokens = baseRow?.tokenUsage?.totalTokens;
    const candTokens = candRow?.tokenUsage?.totalTokens;
    const tokenDelta = sameTrialCount && typeof baseTokens === "number" && typeof candTokens === "number"
      ? candTokens - baseTokens
      : undefined;
    const tokenDeltaPct = tokenDelta !== undefined && baseTokens > 0
      ? (tokenDelta / baseTokens) * 100
      : undefined;
    const baseOutputTokens = baseRow?.tokenUsage?.outputTokens;
    const candOutputTokens = candRow?.tokenUsage?.outputTokens;
    const outputTokenDelta = sameTrialCount && typeof baseOutputTokens === "number" && typeof candOutputTokens === "number"
      ? candOutputTokens - baseOutputTokens
      : undefined;
    const outputTokenDeltaPct = outputTokenDelta !== undefined && baseOutputTokens > 0
      ? (outputTokenDelta / baseOutputTokens) * 100
      : undefined;
    const durationDeltaMs = sameTrialCount && typeof baseRow?.durationMs === "number" && typeof candRow?.durationMs === "number"
      ? candRow.durationMs - baseRow.durationMs
      : undefined;
    const wallTimeDeltaMs = sameTrialCount && typeof baseRow?.wallTimeMs === "number" && typeof candRow?.wallTimeMs === "number"
      ? candRow.wallTimeMs - baseRow.wallTimeMs
      : undefined;
    const wallTimeDeltaPct = wallTimeDeltaMs !== undefined && baseRow.wallTimeMs > 0
      ? (wallTimeDeltaMs / baseRow.wallTimeMs) * 100
      : undefined;

    return {
      key,
      baseline: baseRow,
      candidate: candRow,
      scoreDelta,
      turnsDelta,
      tokenDelta,
      tokenDeltaPct,
      outputTokenDelta,
      outputTokenDeltaPct,
      durationDeltaMs,
      wallTimeDeltaMs,
      wallTimeDeltaPct,
      transition: classifyTransition(baseRow, candRow),
    };
  });

  const workloadsMatch =
    baseline.rows.length === candidate.rows.length &&
    cases.every((item) => item.baseline && item.candidate && item.baseline.trials === item.candidate.trials);
  const baseTotalTokens = baseline.tokenUsage?.totalTokens;
  const candTotalTokens = candidate.tokenUsage?.totalTokens;
  const totalTokenDelta = workloadsMatch && typeof baseTotalTokens === "number" && typeof candTotalTokens === "number"
    ? candTotalTokens - baseTotalTokens
    : undefined;
  const totalTokenDeltaPct = totalTokenDelta !== undefined && baseTotalTokens > 0
    ? (totalTokenDelta / baseTotalTokens) * 100
    : undefined;
  const baseOutputTokens = baseline.tokenUsage?.outputTokens;
  const candOutputTokens = candidate.tokenUsage?.outputTokens;
  const outputTokenDelta = workloadsMatch && typeof baseOutputTokens === "number" && typeof candOutputTokens === "number"
    ? candOutputTokens - baseOutputTokens
    : undefined;
  const outputTokenDeltaPct = outputTokenDelta !== undefined && baseOutputTokens > 0
    ? (outputTokenDelta / baseOutputTokens) * 100
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
      totalTurns: workloadsMatch && typeof baseline.totalTurns === "number" && typeof candidate.totalTurns === "number"
        ? candidate.totalTurns - baseline.totalTurns
        : undefined,
      totalTokens: totalTokenDelta,
      totalTokensPct: totalTokenDeltaPct,
      outputTokens: outputTokenDelta,
      outputTokensPct: outputTokenDeltaPct,
      totalWallTimeMs: workloadsMatch && typeof baseline.totalWallTimeMs === "number" && typeof candidate.totalWallTimeMs === "number"
        ? candidate.totalWallTimeMs - baseline.totalWallTimeMs
        : undefined,
      totalDurationMs: workloadsMatch && typeof baseline.totalDurationMs === "number" && typeof candidate.totalDurationMs === "number"
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

function formatDurationDelta(deltaMs, pct) {
  if (typeof deltaMs !== "number" || !Number.isFinite(deltaMs)) return "—";
  if (deltaMs === 0) return "0.0s";
  const sign = deltaMs > 0 ? "+" : "-";
  const pctText = typeof pct === "number" && Number.isFinite(pct)
    ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`
    : "";
  return `${sign}${formatDuration(Math.abs(deltaMs))}${pctText}`;
}

export function summarizeSkillVerdicts(comparison) {
  const bySkill = new Map();
  for (const item of comparison.cases) {
    const skillName = item.candidate?.evalName ?? item.baseline?.evalName ?? "eval";
    let group = bySkill.get(skillName);
    if (!group) {
      group = {
        skillName,
        cases: [],
        fixed: 0,
        broke: 0,
        errored: 0,
        changed: false,
        basePassed: 0,
        baseTotal: 0,
        candPassed: 0,
        candTotal: 0,
        baseOutputTokens: 0,
        candOutputTokens: 0,
        hasOutputTokens: true,
      };
      bySkill.set(skillName, group);
    }
    group.cases.push(item);
    if (item.baseline) {
      group.baseTotal++;
      if (item.baseline.passed) group.basePassed++;
    }
    if (item.candidate) {
      group.candTotal++;
      if (item.candidate.passed) group.candPassed++;
    }
    const baseOut = item.baseline?.tokenUsage?.outputTokens;
    const candOut = item.candidate?.tokenUsage?.outputTokens;
    const sameCaseTrials = Boolean(
      item.baseline && item.candidate && (item.baseline.trials ?? 1) === (item.candidate.trials ?? 1),
    );
    if (sameCaseTrials && typeof baseOut === "number" && typeof candOut === "number") {
      group.baseOutputTokens += baseOut;
      group.candOutputTokens += candOut;
    } else {
      group.hasOutputTokens = false;
    }
    if (item.candidate?.status === "ERROR / NOT EVALUATED" || !item.candidate) {
      group.errored++;
      group.changed = true;
    } else if (item.transition === "Fixed") {
      group.fixed++;
      group.changed = true;
    } else if (item.transition === "Regressed") {
      group.broke++;
      group.changed = true;
    } else if (
      item.transition === "Improved score"
      || item.transition === "Added"
      || item.transition === "Removed"
      || Math.abs(item.outputTokenDeltaPct ?? 0) >= 10
    ) {
      group.changed = true;
    }
  }

  const severityOrder = { "🛑 No ship": 0, "⚠️ Re-run": 1, "✅ Ship": 2 };
  return [...bySkill.values()]
    .map((group) => {
      const hasBehavioralFailure = group.cases.some((c) => c.candidate?.status === "BEHAVIORAL FAILURE");
      const verdict = group.candTotal === 0 || (group.errored > 0 && !hasBehavioralFailure && group.broke === 0)
        ? "⚠️ Re-run"
        : group.candPassed === group.candTotal && group.broke === 0 && group.errored === 0
          ? "✅ Ship"
          : "🛑 No ship";
      const reasons = [];
      if (group.fixed > 0 && group.broke > 0) {
        reasons.push(`${group.broke} ${group.broke === 1 ? "scenario" : "scenarios"} broke, ${group.fixed} fixed (${group.basePassed}/${group.baseTotal} → ${group.candPassed}/${group.candTotal} passing)`);
      } else if (group.broke > 0) {
        reasons.push(`${group.broke} ${group.broke === 1 ? "scenario" : "scenarios"} broke (${group.basePassed}/${group.baseTotal} → ${group.candPassed}/${group.candTotal} passing)`);
      } else if (group.errored > 0) {
        reasons.push(`${group.errored} ${group.errored === 1 ? "scenario" : "scenarios"} errored (${group.basePassed}/${group.baseTotal} → ${group.candPassed}/${group.candTotal} passing)`);
      } else if (group.fixed > 0) {
        reasons.push(`${group.fixed} ${group.fixed === 1 ? "scenario" : "scenarios"} fixed (${group.basePassed}/${group.baseTotal} → ${group.candPassed}/${group.candTotal} passing)`);
      } else {
        reasons.push(`${group.candPassed}/${group.candTotal} scenarios passing`);
      }
      if (group.hasOutputTokens && group.baseOutputTokens > 0) {
        const outDelta = group.candOutputTokens - group.baseOutputTokens;
        const outPct = (outDelta / group.baseOutputTokens) * 100;
        if (Math.abs(outPct) >= 0.1) {
          const sign = outPct > 0 ? "+" : "";
          reasons.push(`${sign}${outPct.toFixed(1)}% output tokens`);
        }
      }
      const summaryCounts = [];
      if (group.broke > 0) summaryCounts.push(`${group.broke} broke`);
      if (group.errored > 0) summaryCounts.push(`${group.errored} errored`);
      if (group.fixed > 0) summaryCounts.push(`${group.fixed} fixed`);
      if (summaryCounts.length === 0) summaryCounts.push(`${group.candPassed}/${group.candTotal} passing`);
      return {
        ...group,
        verdict,
        summaryLabel: `${summaryCounts.join(", ")} (${group.basePassed}/${group.baseTotal} → ${group.candPassed}/${group.candTotal} passing)`,
        why: reasons.join(" · "),
      };
    })
    .sort((a, b) => (severityOrder[a.verdict] ?? 3) - (severityOrder[b.verdict] ?? 3));
}

function describeCaseChange(item) {
  const baseFailures = item.baseline?.failures ?? [];
  const candFailures = item.candidate?.failures ?? [];
  if (item.candidate?.status === "ERROR / NOT EVALUATED") {
    return "Trial execution error; re-run workflow to verify";
  }
  const hasCounts = Boolean(item.baseline?.gradersTotal && item.candidate?.gradersTotal);
  const countPrefix = hasCounts
    ? `${item.baseline.gradersPassed}/${item.baseline.gradersTotal} → ${item.candidate.gradersPassed}/${item.candidate.gradersTotal} checks passed`
    : undefined;
  if (item.transition === "Fixed") {
    const resolved = baseFailures.filter((f) => !candFailures.includes(f));
    const prefix = countPrefix ?? "Now passes all checks";
    return resolved.length
      ? `${prefix} (fixed: ${resolved.map((f) => `\`${escapeCell(f)}\``).join(", ")})`
      : prefix;
  }
  if (item.transition === "Regressed") {
    const newlyBroken = candFailures.filter((f) => !baseFailures.includes(f));
    const prefix = countPrefix ?? "Check failed";
    return newlyBroken.length
      ? `${prefix} (failed: ${newlyBroken.map((f) => `\`${escapeCell(f)}\``).join(", ")})`
      : prefix;
  }
  if (item.candidate?.passed) {
    return item.candidate.gradersTotal
      ? `Unchanged (${item.candidate.gradersPassed}/${item.candidate.gradersTotal} checks passed)`
      : "Unchanged and passing";
  }
  return candFailures.length
    ? `Still failing (${candFailures.map((f) => `\`${escapeCell(f)}\``).join(", ")})`
    : "Unchanged";
}

function renderSkillDetailsBlock(skill, defaultModel) {
  const verdictEmoji = skill.verdict.split(" ")[0];
  const modelLabel = defaultModel || "default";
  return [
    "<details>",
    `<summary>${verdictEmoji} <strong>${escapeCell(skill.skillName)}</strong> — ${skill.summaryLabel}</summary>`,
    "",
    "| | Scenario | Model | Score | Output Tokens | What happened |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...skill.cases.map((item) => {
      const badge = item.candidate?.status === "ERROR / NOT EVALUATED"
        ? "⚠️ Error"
        : item.transition === "Fixed"
          ? "📈 Fixed"
          : item.transition === "Regressed"
            ? "📉 Broke"
            : item.candidate?.passed
              ? "✅ Passed"
              : "❌ Failed";
      const rawCaseName = item.candidate?.name ?? item.baseline?.name ?? item.key;
      const model = item.candidate?.models?.[0] ?? item.baseline?.models?.[0] ?? modelLabel;
      const scoreText = `${formatScore(item.baseline?.score)} → ${item.candidate?.status === "ERROR / NOT EVALUATED" ? "—" : formatScore(item.candidate?.score)}`;
      const baseOut = item.baseline?.tokenUsage?.outputTokens;
      const candOut = item.candidate?.tokenUsage?.outputTokens;
      const outText = typeof baseOut === "number" && typeof candOut === "number" && item.candidate?.status !== "ERROR / NOT EVALUATED"
        ? `${baseOut.toLocaleString("en-US")} → ${candOut.toLocaleString("en-US")}${typeof item.outputTokenDelta === "number" ? ` (${formatTokenDelta(item.outputTokenDelta, item.outputTokenDeltaPct)})` : ""}`
        : typeof baseOut === "number"
          ? `${baseOut.toLocaleString("en-US")} → —`
          : "—";
      return `| ${badge} | <code>${escapeCell(rawCaseName)}</code> | <code>${escapeCell(model)}</code> | ${scoreText} | ${outText} | ${describeCaseChange(item)} |`;
    }),
    "",
    `<sub><strong>Pass rate (before → after):</strong> <code>${escapeCell(modelLabel)}</code> ${skill.basePassed}/${skill.baseTotal} → ${skill.candPassed}/${skill.candTotal}</sub>`,
    "",
    "</details>",
    "",
  ];
}

export function renderReport(summary, path, { baselineSummary, baselinePath } = {}) {
  const modelHeader = summary.models?.length
    ? ` | Model: \`${escapeCell(summary.models.join(", "))}\``
    : "";
  const singleRunLines = [
    "## Behavioral eval report",
    "",
    `Saved run: \`${escapeCell(path)}\`${modelHeader}`,
    "",
    "| Passed | Failed | Avg Score | Total Turns | Total Tokens | Agent Wall Time | Total Duration |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| ${summary.passedCount} | ${summary.failedCount + summary.errorCount} | ${formatScore(summary.averageScore)} | ${summary.totalTurns ?? "—"} | ${formatTokens(summary.tokenUsage)} | ${formatDuration(summary.totalWallTimeMs)} | ${formatDuration(summary.totalDurationMs)} |`,
    "",
    "| Case | Verdict | Score | Skills Invoked | Turns | Tokens | Agent Wall Time | Duration |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summary.rows.map((row) => {
      const skillsText = row.skillsInvoked?.length
        ? row.skillsInvoked.map((skill) => escapeCell(skill)).join(", ")
        : "none";
      return `| ${escapeCell(row.name)} | ${row.status} | ${formatScore(row.score)} | ${skillsText} | ${row.turns ?? "—"} | ${formatTokens(row.tokenUsage)} | ${formatDuration(row.wallTimeMs)} | ${formatDuration(row.durationMs)} |`;
    }),
    "",
  ];

  const failureLines = summary.rows.flatMap((row) =>
    row.failures.map((grader) => `- ${escapeCell(row.name)} / ${escapeCell(sanitizeGraderId(grader))}: check failed`));
  const errorLines = summary.errors.map((error) => `- ERROR: ${escapeCell(error)}`);
  if (failureLines.length || errorLines.length) {
    singleRunLines.push(...failureLines, ...errorLines, "");
  }

  if (!baselineSummary) {
    return singleRunLines.join("\n");
  }

  const comparison = compareSummaries(baselineSummary, summary);
  const skillVerdicts = summarizeSkillVerdicts(comparison);
  const hasNoShip = skillVerdicts.some((s) => s.verdict === "🛑 No ship") || summary.failedCount > 0;
  const hasRerun = skillVerdicts.some((s) => s.verdict === "⚠️ Re-run")
    || summary.errorCount > 0
    || summary.errors.length > 0
    || baselineSummary.errors.length > 0;
  const overallVerdict = hasNoShip ? "🛑 No ship" : hasRerun ? "⚠️ Re-run" : "✅ Ship";
  const baseClean = (baselineSummary.failedCount + baselineSummary.errorCount) === 0 && baselineSummary.errors.length === 0;
  const candClean = (summary.failedCount + summary.errorCount) === 0 && summary.errors.length === 0;
  const baseOutcome = baseClean ? "passed" : "failed";
  const candOutcome = overallVerdict === "✅ Ship"
    ? "passed (✅ Ship)"
    : overallVerdict === "🛑 No ship"
      ? "failed (🛑 No ship)"
      : `${candClean ? "passed" : "failed"} (⚠️ Re-run)`;
  const outcomeDelta = overallVerdict === "✅ Ship"
    ? (baseOutcome === "failed" ? "fixed" : "unchanged")
    : overallVerdict === "🛑 No ship"
      ? (baseOutcome === "passed" || skillVerdicts.some((s) => s.broke > 0) ? "regressed" : "🛑 No ship")
      : "⚠️ Re-run";
  const defaultModel = summary.models?.[0] ?? baselineSummary.models?.[0] ?? "default";

  const actionableSkills = skillVerdicts.filter((s) => s.verdict !== "✅ Ship");
  const passingChangedSkills = skillVerdicts.filter((s) => s.verdict === "✅ Ship" && (s.changed || skillVerdicts.length === 1));
  const unchangedPassingSkills = skillVerdicts.filter((s) => s.verdict === "✅ Ship" && !s.changed && skillVerdicts.length > 1);

  const lines = [
    `## Evals: ${overallVerdict}`,
    "",
    "| Skill | Verdict | Why |",
    "| --- | --- | --- |",
    ...skillVerdicts.map((s) => {
      const boldVerdict = s.verdict.replace(/^(✅|🛑|⚠️)\s+(.*)$/u, "$1 **$2**");
      return `| **${escapeCell(s.skillName)}** | ${boldVerdict} | ${s.why} |`;
    }),
    "",
  ];

  for (const skill of actionableSkills) {
    lines.push(...renderSkillDetailsBlock(skill, defaultModel));
  }

  if (actionableSkills.length > 0) {
    lines.push("---", "");
  }

  for (const skill of passingChangedSkills) {
    lines.push(...renderSkillDetailsBlock(skill, defaultModel));
  }

  if (unchangedPassingSkills.length > 0) {
    const unchangedScenarios = unchangedPassingSkills.reduce((sum, s) => sum + s.candTotal, 0);
    lines.push(
      "<details>",
      `<summary>📋 <strong>Unchanged evals &amp; run configuration</strong> — ${unchangedPassingSkills.length} passing (${unchangedScenarios}/${unchangedScenarios} scenarios)</summary>`,
      "",
      "| Skill | Status | Scenarios (Before → After) | Details |",
      "| --- | --- | --- | --- |",
      ...unchangedPassingSkills.map((s) =>
        `| \`${escapeCell(s.skillName)}\` | ✅ Unchanged | ${s.basePassed}/${s.baseTotal} → ${s.candPassed}/${s.candTotal} | All scenarios passing on \`${escapeCell(defaultModel)}\` |`,
      ),
      "",
      `<sub><strong>Run config:</strong> ${comparison.cases.length} scenarios across ${skillVerdicts.length} ${skillVerdicts.length === 1 ? "eval" : "evals"} · <code>${escapeCell(defaultModel)}</code></sub>`,
      "",
      "</details>",
      "",
    );
  }

  lines.push(
    "<details>",
    `<summary>📊 <strong>Telemetry, token deltas &amp; run evidence</strong> — ${skillVerdicts.length} ${skillVerdicts.length === 1 ? "skill" : "skills"} evaluated (${comparison.cases.length} ${comparison.cases.length === 1 ? "scenario" : "scenarios"})</summary>`,
    "",
    "## Baseline vs. Candidate Comparison",
    "",
    ...(baselinePath ? [`Baseline: \`${escapeCell(baselinePath)}\` | Candidate: \`${escapeCell(path)}\``, ""] : []),
    "| Metric | Baseline | Candidate | Delta |",
    "| --- | --- | --- | --- |",
    `| Outcome | ${baseOutcome} | ${candOutcome} | ${outcomeDelta} |`,
    `| Passed | ${baselineSummary.passedCount} | ${summary.passedCount} | ${formatSignedInt(comparison.deltas.passed)} |`,
    `| Failed | ${baselineSummary.failedCount + baselineSummary.errorCount} | ${summary.failedCount + summary.errorCount} | ${formatSignedInt(comparison.deltas.failed)} |`,
    `| Avg Score | ${formatScore(baselineSummary.averageScore)} | ${formatScore(summary.averageScore)} | ${formatScoreDelta(comparison.deltas.averageScore)} |`,
    `| Total Turns | ${baselineSummary.totalTurns ?? "—"} | ${summary.totalTurns ?? "—"} | ${formatSignedInt(comparison.deltas.totalTurns)} |`,
    `| Total Tokens | ${formatTokens(baselineSummary.tokenUsage)} | ${formatTokens(summary.tokenUsage)} | ${formatTokenDelta(comparison.deltas.totalTokens, comparison.deltas.totalTokensPct)} |`,
    ...(typeof baselineSummary.tokenUsage?.outputTokens === "number" && typeof summary.tokenUsage?.outputTokens === "number"
      ? [`| Output Tokens | ${baselineSummary.tokenUsage.outputTokens.toLocaleString("en-US")} | ${summary.tokenUsage.outputTokens.toLocaleString("en-US")} | ${formatTokenDelta(comparison.deltas.outputTokens, comparison.deltas.outputTokensPct)} |`]
      : []),
    `| Agent Wall Time | ${formatDuration(baselineSummary.totalWallTimeMs)} | ${formatDuration(summary.totalWallTimeMs)} | ${formatDurationDelta(comparison.deltas.totalWallTimeMs)} |`,
    `| Total Duration | ${formatDuration(baselineSummary.totalDurationMs)} | ${formatDuration(summary.totalDurationMs)} | ${formatDurationDelta(comparison.deltas.totalDurationMs)} |`,
    "",
    "| Case | Baseline | Candidate | Score Delta | Turn Delta | Token Delta | Wall Time Delta | Transition |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...comparison.cases.map((item) => {
      const baseCell = item.baseline ? `${item.baseline.status} (${formatScore(item.baseline.score)})` : "—";
      const candCell = item.candidate ? `${item.candidate.status} (${formatScore(item.candidate.score)})` : "—";
      return `| ${escapeCell(item.key)} | ${baseCell} | ${candCell} | ${formatScoreDelta(item.scoreDelta)} | ${formatSignedInt(item.turnsDelta)} | ${formatTokenDelta(item.tokenDelta, item.tokenDeltaPct)} | ${formatDurationDelta(item.wallTimeDeltaMs, item.wallTimeDeltaPct)} | ${item.transition} |`;
    }),
    "",
    "> **Note:** Single-run score, token, and duration deltas are observed signals for review rather than multi-trial statistical proof.",
    "",
    ...singleRunLines,
    "</details>",
    "",
  );

  return lines.join("\n");
}

export async function resolveResultsPath(input, root = process.cwd()) {
  if (!input) {
    const config = await loadProjectConfig(root);
    const base = resolve(config.dir || root, config.paths.results);
    const display = relative(root, base).split(sep).join("/") || ".";
    if (!existsSync(base)) {
      throw new Error(`No saved eval runs under ${display}/. Run evals first, or pass --results <path>.`);
    }
    const runs = readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(resolve(base, entry.name, "results.jsonl")))
      .map((entry) => entry.name)
      .sort();
    if (!runs.length) {
      throw new Error(`No saved eval runs under ${display}/. Run evals first, or pass --results <path>.`);
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

export async function loadResults(path, root = process.cwd()) {
  const file = await resolveResultsPath(path, root);
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim());
  const records = lines.map((line) => JSON.parse(line));
  const displayPath = relative(root, file).split(sep).join("/") || file;
  return { file, displayPath, summary: summarizeRun(records) };
}

export const usage = `Usage: node .github/scripts/eval-report.mjs [options]

Reads Vally results.jsonl files and prints a Markdown report with per-case and
aggregate verdicts, scores, model, skills invoked, turns, token usage (input,
output, total), agent wall time, and total duration.
When --baseline is supplied, also prints a Baseline vs. Candidate comparison
table highlighting fixed failures, regressions, turn deltas, total/output token
deltas, and agent wall time deltas.

Options:
  --results, --candidate, --run-dir <path>
                    Candidate results.jsonl file or run directory. Defaults to
                    the newest run under .vally.yaml's paths.results (Vally's
                    default is vally-results/ when not configured).
  --baseline <path> Baseline results.jsonl file or run directory to compare
                    against the candidate run.
  -h, --help        Show this help message.

Examples:
  npm run eval:report
  npm run eval:compare -- --baseline evals/_shared/fixtures/pr-description/baseline-results.jsonl --candidate evals/_shared/fixtures/pr-description/candidate-results.jsonl`;

async function main(argv = process.argv.slice(2)) {
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
  const candidate = await loadResults(candidateInput);
  const baseline = baselineInput ? await loadResults(baselineInput) : undefined;
  const markdown = renderReport(candidate.summary, candidate.displayPath, {
    baselineSummary: baseline?.summary,
    baselinePath: baseline?.displayPath,
  });
  console.log(markdown);
  if (candidate.summary.errors.length || baseline?.summary.errors.length) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
