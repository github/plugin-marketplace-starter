import { appendFile, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { expectedCases, readVallyConfig } from "./catalog.mjs";

export { expectedCases };
import { root, readEvals } from "./validate-evals.mjs";

const hasGraderError = (grade) => grade?.status === "error" || (grade?.details ?? []).some(hasGraderError);
const escape = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function summarize(records, expected) {
  if (!records.length || records.at(-1)?.type !== "run-summary") throw new Error("The run has no completion summary.");
  const runIds = new Set(records.map((record) => record.runId));
  if (runIds.size !== 1 || typeof records[0].runId !== "string") throw new Error("Missing or mixed run identities.");
  const rows = [];
  const errors = [];
  const seen = new Set();
  for (const record of records) {
    if (record.type === "run-summary") {
      if (typeof record.hadExecutionErrors !== "boolean") throw new Error("Invalid run summary.");
      if (record.hadExecutionErrors) errors.push("Vally reported execution errors.");
      continue;
    }
    if (record.type !== "trial-result" || !expected.has(record.stimulus)) throw new Error("Unexpected trial identity.");
    if (!["success", "error", "skipped"].includes(record.status)) throw new Error("Unknown trial status.");
    seen.add(record.stimulus);
    const grade = record.gradeResult;
    const runtimeErrors = (record.trajectory?.events ?? []).filter((event) => event.type === "error");
    const fatal = record.status !== "success" || !grade || hasGraderError(grade) || runtimeErrors.length > 0;
    if (!fatal && (typeof grade.passed !== "boolean" || !Number.isFinite(grade.score) || grade.score < 0 || grade.score > 1)) {
      throw new Error(`Invalid grade: ${record.stimulus}`);
    }
    if (fatal) errors.push(`${record.stimulus}: ${record.error ?? record.skipReason
      ?? (runtimeErrors.map((event) => event.data?.message).filter(Boolean).join("; ") || "No valid execution/grading result.")}`);
    rows.push({
      name: record.stimulus,
      status: fatal ? "ERROR / NOT EVALUATED" : grade.passed ? "PASS" : "BEHAVIORAL FAILURE",
      score: fatal ? undefined : grade.score,
      failures: (grade?.details ?? []).filter((detail) => !detail.passed),
    });
  }
  if (!rows.length) throw new Error("No cases were evaluated.");
  for (const name of expected) if (!seen.has(name)) errors.push(`${name}: no result recorded.`);
  return { rows, errors };
}

export function render(summary, path) {
  return [
    "## Starter behavioral evals", "", `Saved run: \`${escape(path)}\``, "",
    "Valid failed verdicts are report-only. Infrastructure errors and incomplete results fail this check.", "",
    "| Case | Outcome | Score |", "| --- | --- | --- |",
    ...summary.rows.map((row) => `| ${escape(row.name)} | ${row.status} | ${row.score === undefined ? "Not scored" : `${(row.score * 100).toFixed(1)}%`} |`),
    "", ...summary.rows.flatMap((row) => row.failures.map((detail) => `- ${escape(row.name)} / ${escape(detail.name)}: ${escape(detail.evidence)}`)),
    ...summary.errors.map((error) => `- ERROR: ${escape(error)}`), "",
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({ options: {
    suite: { type: "string" }, "eval-spec": { type: "string", multiple: true }, "run-dir": { type: "string" },
  } });
  let directory = values["run-dir"];
  if (!directory) {
    const base = resolve(root, "vally-results");
    const runs = (await readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    if (!runs.length) throw new Error("No saved eval runs.");
    directory = resolve(base, runs.at(-1));
  }
  const config = await readVallyConfig(root);
  const expected = expectedCases(await readEvals(root, config), config, { suite: values.suite, evalSpecs: values["eval-spec"] });
  const text = await readFile(resolve(directory, "results.jsonl"), "utf8");
  const records = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const summary = summarize(records, expected);
  const markdown = render(summary, directory);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (summary.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
