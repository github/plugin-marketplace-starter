// Prints sanitized failure identity from github/evals-action's native-diagnostics-path.
// It reads only the native eval JSONL (<id>.stdout.log) and prints eval and stimulus names, grader types,
// verdicts, scores, and the check names of repository program graders. It never prints prompts, model or
// tool output, trajectories, grader evidence, labels, metadata, errors, stderr, or raw log lines.
import { appendFileSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maxLogBytes = 64 * 1024 * 1024;
const maxTrials = 200;
const maxGraders = 32;
const maxChecks = 32;
const stdoutLog = /^[A-Za-z0-9-]{1,64}\.stdout\.log$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const graderType = /^[a-z][a-z0-9-]{0,63}$/;
// Repository program graders name checks with constant sentences, plus common.mjs's lowercase condition labels.
const checkName = /^[A-Z][A-Za-z0-9 ,'()-]{0,199}$/;
const longWord = /[^ ]{33,}/;
const trialStatuses = new Set(["success", "error", "skipped"]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const formatScore = (value) => typeof value === "number" && Number.isFinite(value)
  ? String(Math.round(value * 1000) / 1000)
  : "unknown";
const verdict = (passed) => passed === true ? "PASS" : passed === false ? "FAIL" : "UNKNOWN";
const safeIdentifier = (value) => typeof value === "string" && identifier.test(value) ? value : "[redacted]";
const safeCheckName = (value) => typeof value === "string" && checkName.test(value) && !longWord.test(value)
  ? value
  : "[redacted]";

function describeGrader(grader, index) {
  if (!isObject(grader)) return [`  UNKNOWN grader #${index + 1}`];
  const type = typeof grader.graderType === "string" && graderType.test(grader.graderType) ? grader.graderType : "unknown";
  const configured = typeof grader.configuredName === "string" && identifier.test(grader.configuredName)
    ? ` (${grader.configuredName})`
    : "";
  const error = grader.status === "error" ? ", grader error" : "";
  const lines = [`  ${verdict(grader.passed)} grader #${index + 1} ${type}${configured}, score ${formatScore(grader.score)}${error}`];
  // Built-in graders can name nested details after model output, so only program graders list checks.
  if (type === "program" && Array.isArray(grader.details)) {
    grader.details.slice(0, maxChecks).forEach((check, checkIndex) => {
      if (isObject(check)) lines.push(`    ${verdict(check.passed)} check #${checkIndex + 1} ${safeCheckName(check.name)}`);
    });
    if (grader.details.length > maxChecks) lines.push(`    ${grader.details.length - maxChecks} more checks omitted`);
  }
  return lines;
}

export function summarizeRecords(records) {
  const lines = [];
  let trials = 0;
  for (const record of records) {
    if (!isObject(record)) continue;
    if (record.type === "trial-result") {
      trials += 1;
      if (trials > maxTrials) continue;
      const grade = isObject(record.gradeResult) ? record.gradeResult : undefined;
      const status = trialStatuses.has(record.status) ? record.status : "unknown";
      const trial = Number.isInteger(record.trialIndex) && record.trialIndex >= 0 ? `, trial index ${record.trialIndex}` : "";
      lines.push(`${verdict(grade?.passed)} ${safeIdentifier(record.evalName)} / ${safeIdentifier(record.stimulus)}: status ${status}, score ${formatScore(grade?.score)}${trial}`);
      if (grade && grade.passed !== true && Array.isArray(grade.details)) {
        grade.details.slice(0, maxGraders).forEach((grader, index) => lines.push(...describeGrader(grader, index)));
        if (grade.details.length > maxGraders) lines.push(`  ${grade.details.length - maxGraders} more graders omitted`);
      }
    } else if (record.type === "run-summary" && Array.isArray(record.evals)) {
      for (const item of record.evals.slice(0, maxTrials)) {
        if (!isObject(item)) continue;
        lines.push(`${verdict(item.passed)} eval ${safeIdentifier(item.name)}: overall score ${formatScore(item.overallScore)}, threshold ${formatScore(item.threshold)}`);
      }
    }
  }
  if (trials > maxTrials) lines.push(`${trials - maxTrials} more trials omitted`);
  return lines;
}

export function readRecords(directory) {
  const root = resolve(directory);
  if (!lstatSync(root).isDirectory()) return [];
  const logs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && stdoutLog.test(entry.name))
    .map((entry) => ({ path: join(root, entry.name), stat: lstatSync(join(root, entry.name)) }))
    .filter(({ stat }) => stat.isFile() && stat.size <= maxLogBytes)
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs || a.path.localeCompare(b.path));
  const records = [];
  for (const { path } of logs) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line.trimStart().startsWith("{")) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (isObject(record) && (record.type === "trial-result" || record.type === "run-summary")) records.push(record);
    }
  }
  return records;
}

export function diagnose(directory) {
  if (typeof directory !== "string" || !directory) return ["No native diagnostics path was provided."];
  let lines;
  try {
    lines = summarizeRecords(readRecords(directory));
  } catch {
    return ["Native diagnostics could not be read."];
  }
  return lines.length ? lines : ["No eval trial results were found in the native diagnostics."];
}

function main() {
  const lines = diagnose(process.argv[2] || process.env.NATIVE_DIAGNOSTICS_PATH);
  console.log(["Sanitized eval diagnostics (identifiers, verdicts, and scores only):", ...lines].join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Sanitized eval diagnostics\n\n\`\`\`text\n${lines.join("\n")}\n\`\`\`\n`);
    } catch {
      console.log("The step summary could not be written.");
    }
  }
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  try {
    main();
  } catch {
    console.log("Sanitized eval diagnostics failed.");
  }
  // Diagnostics never change the job outcome.
  process.exitCode = 0;
}
