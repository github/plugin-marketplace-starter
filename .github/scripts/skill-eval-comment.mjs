import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const marker = "<!-- marketplace-skill-comparison:";
const safeName = /^[a-z0-9][a-z0-9._-]*$/;
const sha = /^[a-f0-9]{40}$/;
const text = (value) => stripVTControlCharacters(String(value ?? ""))
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("|", "&#124;").replaceAll("`", "&#96;").replaceAll("[", "&#91;").replaceAll("]", "&#93;")
  .replaceAll("@", "&#64;").slice(0, 200);
const json = (path) => {
  const contents = readFileSync(path, "utf8");
  try { return JSON.parse(contents); } catch { throw new Error("Malformed comparison JSON input."); }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
};
const github = (endpoint, method = "GET", body) => JSON.parse(execFileSync("gh", [
  "api", endpoint, "--method", method, ...(body ? ["--input", "-"] : []),
], { encoding: "utf8", input: body && JSON.stringify(body), timeout: 30000, maxBuffer: 8 * 1024 * 1024 }));

export function inventorySkills(root, readTree = (repo, commit) => github(`repos/${repo}/git/trees/${commit}?recursive=1`)) {
  const skills = [];
  for (const plugin of json(resolve(root, "marketplace.json")).plugins) {
    if (!safeName.test(plugin.name)) throw new Error("Unsupported catalog plugin name.");
    let names;
    if (typeof plugin.source === "string") {
      if (plugin.source !== `./plugins/${plugin.name}`) throw new Error("Expected a self-contained local plugin path.");
      const directory = resolve(root, plugin.source, "skills");
      names = existsSync(directory) ? readdirSync(directory).filter((name) =>
        safeName.test(name) && existsSync(resolve(directory, name, "SKILL.md"))) : [];
    } else {
      const source = plugin.source;
      if (source?.source !== "github" || !/^[\w.-]+\/[\w.-]+$/.test(source.repo) || !sha.test(source.sha)) {
        throw new Error("Remote skill inventory requires a pinned GitHub source.");
      }
      const prefix = source.path ? `${source.path}/` : "";
      if (prefix.split("/").some((part) => part === "..")) throw new Error("Unsupported remote plugin path.");
      const tree = readTree(source.repo, source.sha);
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("Incomplete pinned remote skill inventory.");
      names = tree.tree.flatMap((entry) => {
        if (entry.type !== "blob" || !entry.path.startsWith(`${prefix}skills/`)) return [];
        const parts = entry.path.slice(`${prefix}skills/`.length).split("/");
        return parts.length === 2 && parts[1] === "SKILL.md" && safeName.test(parts[0]) ? [parts[0]] : [];
      });
    }
    for (const name of names) {
      skills.push({
        key: `${plugin.name}/${name}`,
        hasEval: existsSync(resolve(root, "evals", plugin.name, "skills", name, "eval.yaml")),
      });
    }
  }
  return skills.sort((a, b) => a.key.localeCompare(b.key));
}

function failedReason(type) {
  return ({
    "skill-invocation": "Required activation was missing or a disallowed skill activated.",
    "program": "The configured output/workspace contract was not satisfied.",
    "diff-empty": "The workspace changed when it should have stayed unchanged.",
    "output-matches": "The answer did not match the configured output check.",
    "file-matches": "A file did not match its configured check.",
    "tool-calls": "Required tool use was missing or a disallowed tool was used.",
    "completed": "The session did not meet its completion checks.",
  })[type] ?? "The configured check failed.";
}

export function projectTrials(records, expectedRunId) {
  const summary = records.at(-1);
  if (summary?.type !== "run-summary" || summary.runId !== expectedRunId ||
      records.filter((row) => row.type === "run-summary").length !== 1) {
    throw new Error("Native completion evidence is missing or mixed.");
  }
  const identities = new Set();
  return records.slice(0, -1).map((row) => {
    if (row.type !== "trial-result" || row.runId !== expectedRunId ||
        !row.evalName || !row.stimulus || !row.model || !["success", "error", "skipped"].includes(row.status)) {
      throw new Error("Invalid native trial identity.");
    }
    const model = row.variant && row.variant !== "main" ? `${row.model} / ${row.variant}` : row.model;
    const id = JSON.stringify([row.evalName, row.stimulus, model]);
    if (identities.has(id)) throw new Error("Expected one trial per case/model, without retries.");
    identities.add(id);
    const grade = row.gradeResult;
    const error = (check) => check?.status === "error" || (check?.details ?? []).some(error);
    const state = row.status === "skipped" ? "not-run" :
      row.status !== "success" || !grade || error(grade) ||
      (row.trajectory?.events ?? []).some((event) => event.type === "error") ? "error" : "graded";
    if (state === "graded" && (typeof grade.passed !== "boolean" || !Array.isArray(grade.details) || !grade.details.length)) {
      throw new Error("Native individual grader evidence is missing.");
    }
    const checks = state !== "graded" ? [] : grade.details.map((check, index) => {
      if (typeof check.passed !== "boolean") throw new Error("Invalid native grader verdict.");
      const type = check.graderType ?? check.kind ?? "check";
      return {
        id: `${index}:${type}`,
        name: text(check.configuredName ?? check.name ?? type),
        passed: check.passed,
        // Never publish trajectories, raw grader output or exception strings.
        reason: check.passed ? "" : failedReason(type),
      };
    });
    return { eval: text(row.evalName), stimulus: text(row.stimulus), model: text(model), state, passed: state === "graded" && grade.passed, checks };
  });
}

export function collectArm(report, logs) {
  if (!report || report.schemaVersion !== 2 || report.command !== "run") {
    return { state: "error", code: "missing-action-report", rows: [] };
  }
  if (!report.nativeRunId) return { state: report.outcome === "not-run" ? "not-run" : "error", code: report.code, rows: [] };
  const matches = [];
  for (const log of logs) {
    if (!log.trimStart().startsWith("{")) continue; // The Action also retains its plain version check.
    let records;
    try { records = log.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)); }
    catch { throw new Error("Malformed native JSONL evidence."); }
    if (records[0]?.runId === report.nativeRunId) matches.push(records);
  }
  if (matches.length !== 1) throw new Error("Expected exactly one native JSONL log for this Action run.");
  return {
    state: report.completeness === "complete" && !["error", "cancelled"].includes(report.outcome) ? "complete" : "error",
    code: report.code,
    rows: projectTrials(matches[0], report.nativeRunId),
  };
}

const findRow = (arm, row) => arm?.rows.find((item) =>
  item.eval === row.eval && item.stimulus === row.stimulus && item.model === row.model);
const failures = (row) => new Set(row?.checks.filter((check) => !check.passed).map((check) => check.id) ?? []);
const difference = (a, b) => [...a].filter((id) => !b.has(id)).length;
function comparable(pair, before, after) {
  return pair.before?.state === "complete" && pair.after?.state === "complete" &&
    before?.state === "graded" && after?.state === "graded" &&
    before.checks.length === after.checks.length &&
    before.checks.every((check) => after.checks.some((other) => other.id === check.id));
}
function counts(arm, row) {
  if (arm?.state === "error") return "⚠️ Error";
  if (arm?.state === "not-run") return "⏭️ Not run";
  if (!row) return "❔ Unknown";
  if (row.state === "error") return "⚠️ Error";
  if (row.state === "not-run") return "⏭️ Not run";
  return `${row.checks.filter((check) => check.passed).length}/${row.checks.length}`;
}
function transition(pair, before, after) {
  const old = failures(before), current = failures(after);
  if (!comparable(pair, before, after)) return "";
  const added = difference(current, old), resolved = difference(old, current);
  if (added && resolved) return `🔄 `;
  if (added) return "📉 ";
  if (resolved) return "📈 ";
  return current.size ? "❌ " : "✅ ";
}

export function renderComparison(selection, pairs, evidenceUrl) {
  const models = [...new Set(pairs.flatMap((pair) => [...(pair.before?.rows ?? []), ...(pair.after?.rows ?? [])].map((row) => row.model)))].sort();
  if (!models.length) models.push("Model not observed");
  let added = 0, resolved = 0;
  for (const pair of pairs) for (const after of pair.after?.rows ?? []) {
    const before = findRow(pair.before, after);
    if (comparable(pair, before, after)) {
      added += difference(failures(after), failures(before));
      resolved += difference(failures(before), failures(after));
    }
  }
  const lines = [
    "# 🧪 Skill eval comparison", "",
    `**Changed skills:** 📈 ${resolved} resolved · 📉 ${added} new failures (grader/model results).`,
    `**Sources:** Before \`${selection.base}\` → After \`${selection.head}\` · [Evidence](${evidenceUrl})`,
    "**Trials:** One per scenario/model/arm, zero retries. Differences do not prove causation.", "",
    "**Cells: Before → After.** A scenario is one case; graders are its individual checks.", "",
  ];
  if (pairs.some((pair) => ["before", "after"].some((arm) => pair[arm]?.state !== "complete" ||
    pair[arm]?.rows.some((row) => row.state !== "graded")) ||
    (pair.after?.rows ?? []).some((after) => !comparable(pair, findRow(pair.before, after), after)))) {
    lines.push("**⚠️ Incomplete/error evidence:** affected cells are not passing results. Check the linked workflow.", "");
  }
  const rowIdentities = (pair) => [...new Map([...(pair.before?.rows ?? []), ...(pair.after?.rows ?? [])]
    .map((row) => [JSON.stringify([row.eval, row.stimulus]), row])).values()];
  for (const skill of selection.changed) {
    const pair = pairs.find((item) => item.key === skill);
    lines.push(`## Changed skill: ${text(skill)}`, "");
    if (!pair) {
      lines.push("⏭️ Not run — an existing skill in both revisions and its repo eval are required.", "");
      continue;
    }
    lines.push(`| Eval : scenario (passing / total graders) | ${models.join(" | ")} |`,
      `| --- | ${models.map(() => "---").join(" | ")} |`);
    const rows = rowIdentities(pair);
    for (const row of rows) {
      const cells = models.map((model) => {
        const identity = { ...row, model };
        const before = findRow(pair.before, identity), after = findRow(pair.after, identity);
        const unknown = before?.state === "graded" && after?.state === "graded" && !comparable(pair, before, after)
          ? " (comparison unknown)" : "";
        return `${transition(pair, before, after)}${counts(pair.before, before)} → ${counts(pair.after, after)}${unknown}`;
      });
      const short = row.stimulus.startsWith(`${row.eval}-`) ? row.stimulus.slice(row.eval.length + 1) : row.stimulus;
      lines.push(`| ${row.eval} : ${short} | ${cells.join(" | ")} |`);
    }
    if (!rows.length) lines.push(`| Evidence unavailable | ${models.map(() =>
      `${counts(pair.before)} → ${counts(pair.after)}`).join(" | ")} |`);
    lines.push("");
  }
  const detailLines = (arms) => {
    const output = [];
    for (const pair of pairs) {
      const entries = arms.flatMap((arm) => (pair[arm]?.rows ?? []).flatMap((row) =>
        row.checks.filter((check) => !check.passed).map((check) => ({ arm, row, check }))));
      if (!entries.length) continue;
      output.push(`### Skill: ${text(pair.key)}`, "");
      for (const identity of rowIdentities(pair)) {
        const rows = entries.filter(({ row }) => row.eval === identity.eval && row.stimulus === identity.stimulus);
        if (!rows.length) continue;
        output.push(`**Eval : scenario:** ${identity.eval} : ${identity.stimulus}`, "",
          "| Change | Failed grader | Model | Why it failed | Evidence |", "| --- | --- | --- | --- | --- |");
        for (const { arm, row, check } of rows) {
          const other = findRow(pair[arm === "before" ? "after" : "before"], row);
          const otherFailed = failures(other).has(check.id);
          const change = !comparable(pair, arm === "before" ? row : other, arm === "after" ? row : other) ? "comparison unknown" :
            arm === "after" ? otherFailed ? "already present" : "new" : otherFailed ? "persists After" : "resolved After";
          output.push(`| ${arm === "after" ? "After" : "Before"} (${change}) | ${check.name} | ${row.model} | ${check.reason} | [Native run](${evidenceUrl}) |`);
        }
        output.push("");
      }
    }
    return output.length ? output : ["No recorded failed graders. Missing/error results are not passes.", ""];
  };
  const failureCount = (arm) => pairs.reduce((sum, pair) => sum + (pair[arm]?.rows ?? [])
    .reduce((total, row) => total + failures(row).size, 0), 0);
  lines.push(`## ❌ After failures in changed skills (${failureCount("after")} grader/model results)`, "", ...detailLines(["after"]),
    "<details>", `<summary>🕰️ Before failures in changed skills: ${failureCount("before")} grader/model results</summary>`, "", ...detailLines(["before"]), "</details>", "");
  const evaluated = selection.skills.filter((skill) => pairs.some((pair) => pair.key === skill.key &&
    ((pair.before?.rows.length ?? 0) + (pair.after?.rows.length ?? 0) > 0))).length;
  lines.push("<details>", `<summary>🌐 All marketplace skills: ${evaluated} with results · ${selection.skills.length - evaluated} not evaluated</summary>`, "",
    "**Cells: passing scenarios / total recorded scenarios, Before → After.** Native scoring determines scenario passes; errors and missing results never pass.",
    "Only selected changed skills were evaluated. This run does not measure unchanged-skill regressions.", "",
    `| Skill (passing / total scenarios) | ${models.join(" | ")} |`, `| --- | ${models.map(() => "---").join(" | ")} |`);
  for (const skill of selection.skills) {
    const pair = pairs.find((item) => item.key === skill.key);
    const cells = models.map((model) => {
      if (!pair) return skill.hasEval ? "⏭️ Not run — unchanged/unpaired skill" : "⏭️ Not evaluated — no repo eval";
      const values = ["before", "after"].map((arm) => {
        const data = pair[arm], rows = data?.rows.filter((row) => row.model === model) ?? [];
        if (data?.state !== "complete") return data?.state === "not-run" ? "⏭️ Not run" : "⚠️ Error / incomplete";
        if (!rows.length) return "❔ Unknown";
        if (rows.some((row) => row.state !== "graded")) return "⚠️ Partial / not run";
        return `${rows.filter((row) => row.passed).length}/${rows.length}`;
      }).join(" → ");
      let added = 0, resolved = 0;
      for (const after of pair.after?.rows.filter((row) => row.model === model) ?? []) {
        const before = findRow(pair.before, after);
        if (comparable(pair, before, after)) {
          added += difference(failures(after), failures(before));
          resolved += difference(failures(before), failures(after));
        }
      }
      const unknown = (pair.after?.rows.filter((row) => row.model === model) ?? [])
        .some((after) => !comparable(pair, findRow(pair.before, after), after));
      return unknown ? `${values} (comparison unknown)` :
        added && resolved ? `🔄 ${values} (${added} new, ${resolved} resolved grader failures)` : values;
    });
    lines.push(`| ${text(skill.key)} | ${cells.join(" | ")} |`);
  }
  lines.push("", "<details>", `<summary>🔎 Marketplace failure details: ${failureCount("after")} After · ${failureCount("before")} Before (grader/model results)</summary>`, "",
    ...detailLines(["before", "after"]), "</details>", "", "</details>", "",
    "✅ Both pass · 📈 Failures resolved · 📉 New failures · 🔄 Both new and resolved · ❌ Existing failure.",
    "⚠️ Error · ⏭️ Not run · ❔ Unknown never count as passing. Failure reasons describe checks, not raw model/grader output.", "",
    "*Each changed skill is measured separately; evals, graders, fixtures and other skill sources stay at the merge revision.*");
  return lines.join("\n");
}

export async function postComparison(selection, body, api = github, env = process.env) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "") || !/^\d+$/.test(env.PR_NUMBER ?? "")) throw new Error("Invalid PR context.");
  const endpoint = `repos/${env.GITHUB_REPOSITORY}`;
  const pr = await api(`${endpoint}/pulls/${env.PR_NUMBER}`);
  if (pr.state !== "open" || pr.head.sha !== selection.head || pr.head.repo.full_name !== env.GITHUB_REPOSITORY) {
    throw new Error("PR closed, head changed, or fork context; no comment published.");
  }
  const key = `${marker}${env.GITHUB_WORKFLOW_REF} -->`;
  const comments = [];
  for (let page = 1; ; page++) {
    const batch = await api(`${endpoint}/issues/${env.PR_NUMBER}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const existing = comments.find((comment) => comment.user?.login === "github-actions[bot]" && comment.body.startsWith(key));
  const order = [Number(env.GITHUB_RUN_NUMBER), Number(env.GITHUB_RUN_ATTEMPT)];
  if (!order.every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error("Invalid workflow run order.");
  const previous = existing?.body.match(/<!-- run:(\d+):(\d+) -->/);
  if (previous && (Number(previous[1]) > order[0] || Number(previous[1]) === order[0] && Number(previous[2]) > order[1])) return "stale";
  const content = `${key}\n<!-- run:${order.join(":")} -->\n${body}`;
  if (content.length > 60000) throw new Error("Comparison exceeds the comment limit; no misleading truncated report published.");
  return api(existing ? `${endpoint}/issues/comments/${existing.id}` : `${endpoint}/issues/${env.PR_NUMBER}/comments`,
    existing ? "PATCH" : "POST", { body: content });
}

function validateIdentity(selection, env) {
  if (!sha.test(selection.base) || !sha.test(selection.head) || selection.merge !== env.GITHUB_SHA ||
      selection.repository !== env.GITHUB_REPOSITORY || selection.run !== env.GITHUB_RUN_ID ||
      selection.attempt !== env.GITHUB_RUN_ATTEMPT) throw new Error("Comparison artifact context changed.");
}

async function main() {
  const [command, path] = process.argv.slice(2);
  if (command === "collect") {
    const selection = json(resolve(process.env.SELECTION_FILE));
    validateIdentity(selection, process.env);
    const entry = selection.include.find((item) => item.id === process.env.COMPARISON_ID);
    if (!entry || !["before", "after"].includes(process.env.ARM)) throw new Error("Unknown comparison arm.");
    const report = process.env.ACTION_REPORT && existsSync(process.env.ACTION_REPORT) ? json(process.env.ACTION_REPORT) : undefined;
    if (report && (report.reportId !== `${entry.id}-${process.env.ARM}` ||
      report.revision !== selection.merge || String(report.workflowRunId) !== selection.run ||
      String(report.workflowRunAttempt) !== selection.attempt || report.repository !== selection.repository)) throw new Error("Action report identity changed.");
    const logs = process.env.NATIVE_DIRECTORY && existsSync(process.env.NATIVE_DIRECTORY)
      ? readdirSync(process.env.NATIVE_DIRECTORY).filter((file) => file.endsWith(".stdout.log")).map((file) => {
        const source = resolve(process.env.NATIVE_DIRECTORY, file);
        if (statSync(source).size > 64 * 1024 * 1024) throw new Error("Native log exceeds supported size.");
        return readFileSync(source, "utf8");
      }) : [];
    writeJson(resolve(path, `${entry.id}-${process.env.ARM}.json`), {
      id: entry.id, key: `${entry.plugin}/${entry.skill}`, arm: process.env.ARM,
      repository: selection.repository, run: selection.run, attempt: selection.attempt, merge: selection.merge,
      data: collectArm(report, logs),
    });
  } else if (command === "post") {
    const selection = json(resolve(path, "selection.json"));
    validateIdentity(selection, process.env);
    const pairs = selection.include.map((entry) => {
      const pair = { key: `${entry.plugin}/${entry.skill}` };
      for (const arm of ["before", "after"]) {
        const file = resolve(path, `${entry.id}-${arm}.json`);
        if (!existsSync(file)) { pair[arm] = { state: "error", rows: [] }; continue; }
        const saved = json(file);
        if (saved.key !== pair.key || saved.id !== entry.id || saved.arm !== arm ||
          saved.repository !== selection.repository || saved.run !== selection.run ||
          saved.attempt !== selection.attempt || saved.merge !== selection.merge) throw new Error("Mixed comparison artifacts.");
        pair[arm] = saved.data;
      }
      return pair;
    });
    const evidence = `${process.env.GITHUB_SERVER_URL}/${selection.repository}/actions/runs/${selection.run}`;
    console.log(JSON.stringify(await postComparison(selection, renderComparison(selection, pairs, evidence))));
  } else throw new Error("Expected collect or post.");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
