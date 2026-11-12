import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectArm, inventorySkills, postComparison, projectTrials, renderComparison } from "./skill-eval-comment.mjs";

const trial = (extra = {}) => ({
  type: "trial-result", runId: "native", evalName: "draft", stimulus: "draft-positive", model: "model-a", variant: "main",
  status: "success", gradeResult: { passed: false, details: [
    { graderType: "completed", name: "completed", passed: true },
    { graderType: "skill-invocation", name: "routing", passed: false, evidence: "SECRET_RAW_GRADER_OUTPUT" },
  ] }, trajectory: { output: "SECRET_RAW_ANSWER", events: [] }, ...extra,
});
const footer = { type: "run-summary", runId: "native", hadExecutionErrors: false };
const report = { schemaVersion: 2, command: "run", nativeRunId: "native", outcome: "failed", completeness: "complete", code: "native-failed" };
const selection = {
  base: "a".repeat(40), head: "b".repeat(40), changed: ["local/draft"],
  skills: [{ key: "local/draft", hasEval: true }, { key: "local/neighbor", hasEval: true }, { key: "remote/run", hasEval: false }],
};
const pair = () => ({
  key: "local/draft",
  before: { state: "complete", rows: projectTrials([trial(), footer], "native") },
  after: { state: "complete", rows: projectTrials([trial({ gradeResult: { passed: true, details: [
    { graderType: "completed", name: "completed", passed: true }, { graderType: "skill-invocation", name: "routing", passed: true },
  ] } }), footer], "native") },
});

test("native grader projection preserves counts and errors, rejects mixed/repeated trials, and omits raw output", () => {
  const data = collectArm(report, ["0.21.0\n", `${JSON.stringify(trial())}\n${JSON.stringify(footer)}\n`]);
  assert.equal(data.state, "complete");
  assert.equal(data.rows[0].checks.filter((check) => check.passed).length, 1);
  assert.match(data.rows[0].checks[1].reason, /activation/);
  assert.doesNotMatch(JSON.stringify(data), /SECRET/);
  assert.throws(() => projectTrials([trial(), trial(), footer], "native"), /one trial/);
  assert.throws(() => projectTrials([trial({ runId: "other" }), footer], "native"), /identity/);
  assert.throws(() => projectTrials([trial(), { ...footer, runId: "other" }], "native"), /completion/);
  assert.throws(() => collectArm(report, []), /exactly one/);
  assert.equal(collectArm(undefined, []).state, "error");
  assert.equal(collectArm({ ...report, outcome: "error", completeness: "partial" },
    [`${JSON.stringify(trial())}\n${JSON.stringify(footer)}`]).state, "error");
  const errored = projectTrials([trial({ gradeResult: { passed: false, details: [{ status: "error" }] } }), footer], "native");
  assert.equal(errored[0].state, "error");
  assert.equal(errored[0].passed, false);
  assert.equal(projectTrials([trial({ status: "skipped" }), footer], "native")[0].state, "not-run");
});

test("approved hierarchy shows grader versus scenario denominators, failed-check reasons and honest coverage", () => {
  const sample = pair();
  const rendered = renderComparison(selection, [sample], "https://github.com/example/repo/actions/runs/1");
  assert.match(rendered, /## Changed skill: local\/draft/);
  assert.match(rendered, /draft : positive \| 📈 1\/2 → 2\/2/);
  assert.match(rendered, /passing \/ total graders/);
  assert.match(rendered, /local\/draft \| 0\/1 → 1\/1/);
  assert.match(rendered, /passing scenarios \/ total recorded scenarios/);
  assert.match(rendered, /Before \(resolved After\) \| routing/);
  assert.match(rendered, /Required activation/);
  assert.match(rendered, /local\/neighbor \| ⏭️ Not run/);
  assert.match(rendered, /remote\/run \| ⏭️ Not evaluated — no repo eval/);
  assert.match(rendered, /does not measure unchanged-skill regressions/);
  assert.ok(rendered.indexOf("Before failures") < rendered.indexOf("All marketplace skills"));
  assert.ok(rendered.indexOf("All marketplace skills") < rendered.indexOf("Marketplace failure details"));
  assert.equal((rendered.match(/<details>/g) ?? []).length, 3);
  assert.doesNotMatch(rendered, /SECRET/);
});

test("equal aggregate counts expose changed failure identities and missing arms never become passes", () => {
  const sample = pair();
  sample.after.rows[0].passed = false;
  sample.after.rows[0].checks[0].passed = false;
  const rendered = renderComparison(selection, [sample], "https://example.test");
  assert.match(rendered, /🔄 0\/1 → 0\/1 \(1 new, 1 resolved/);
  assert.match(rendered, /After \(new\) \| completed/);
  assert.match(rendered, /Before \(resolved After\) \| routing/);
  sample.after = { state: "error", rows: [] };
  const missing = renderComparison(selection, [sample], "https://example.test");
  assert.match(missing, /Incomplete\/error evidence/);
  assert.match(missing, /1\/2 → ⚠️ Error/);
  assert.doesNotMatch(missing, /📈 1\/2/);
});

test("catalog inventory enumerates local and exact pinned remote skill folders without executing them", (t) => {
  const root = mkdtempSync(join(tmpdir(), "comparison-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "plugins/local/skills/draft"), { recursive: true });
  writeFileSync(join(root, "plugins/local/skills/draft/SKILL.md"), "not executed");
  mkdirSync(join(root, "evals/local/skills/draft"), { recursive: true });
  writeFileSync(join(root, "evals/local/skills/draft/eval.yaml"), "not executed");
  writeFileSync(join(root, "marketplace.json"), JSON.stringify({ plugins: [
    { name: "local", source: "./plugins/local" },
    { name: "remote", source: { source: "github", repo: "example/plugin", sha: "c".repeat(40), path: "package" } },
  ] }));
  const readTree = (repo, commit) => {
    assert.equal(repo, "example/plugin"); assert.equal(commit, "c".repeat(40));
    return { truncated: false, tree: [
      { type: "blob", path: "package/skills/run/SKILL.md" }, { type: "blob", path: "other/skills/unrelated/SKILL.md" },
    ] };
  };
  assert.deepEqual(inventorySkills(root, readTree), [
    { key: "local/draft", hasEval: true }, { key: "remote/run", hasEval: false },
  ]);
  assert.throws(() => inventorySkills(root, () => ({ truncated: true, tree: [] })), /Incomplete/);
});

test("comment publishing checks current PR head, bot ownership, run order and updates only one comment", async () => {
  const env = {
    GITHUB_REPOSITORY: "example/repo", PR_NUMBER: "2", GITHUB_WORKFLOW_REF: "example/repo/.github/workflows/skill-evals.yml@refs/pull/2/merge",
    GITHUB_RUN_NUMBER: "5", GITHUB_RUN_ATTEMPT: "1",
  };
  const calls = [];
  let head = selection.head, comments = [];
  const api = async (endpoint, method = "GET", body) => {
    calls.push({ endpoint, method, body });
    if (endpoint.endsWith("/pulls/2")) return { state: "open", head: { sha: head, repo: { full_name: "example/repo" } } };
    if (method === "GET") return comments;
    return { id: 8 };
  };
  await postComparison(selection, "Report", api, env);
  assert.equal(calls.at(-1).method, "POST");
  comments = [{ id: 8, user: { login: "github-actions[bot]" }, body: calls.at(-1).body.body }];
  calls.length = 0;
  await postComparison(selection, "Updated", api, env);
  assert.equal(calls.at(-1).method, "PATCH");
  assert.match(calls.at(-1).endpoint, /issues\/comments\/8$/);
  comments[0].body = comments[0].body.replace("run:5:1", "run:6:1");
  assert.equal(await postComparison(selection, "Older", api, env), "stale");
  head = "c".repeat(40);
  await assert.rejects(postComparison(selection, "Wrong head", api, env), /head changed/);
});

test("collect CLI binds native Action diagnostics to this selection without publishing raw evidence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "comparison-collect-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = {
    repository: "example/repo", run: "1", attempt: "1", merge: "c".repeat(40),
    base: selection.base, head: selection.head, include: [{ id: "skill-id", plugin: "local", skill: "draft" }],
  };
  writeFileSync(join(root, "selection.json"), JSON.stringify(context));
  const action = {
    ...report, reportId: "skill-id-before", revision: context.merge, repository: context.repository,
    workflowRunId: 1, workflowRunAttempt: 1,
  };
  writeFileSync(join(root, "report.json"), JSON.stringify(action));
  writeFileSync(join(root, "native.stdout.log"), `${JSON.stringify(trial())}\n${JSON.stringify(footer)}\n`);
  const options = {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, GITHUB_REPOSITORY: context.repository, GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: context.merge, COMPARISON_ID: "skill-id", ARM: "before", SELECTION_FILE: join(root, "selection.json"),
      ACTION_REPORT: join(root, "report.json"), NATIVE_DIRECTORY: root },
  };
  const args = [fileURLToPath(new URL("./skill-eval-comment.mjs", import.meta.url)), "collect", join(root, "derived")];
  const result = spawnSync(process.execPath, args, options);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const saved = readFileSync(join(root, "derived/skill-id-before.json"), "utf8");
  assert.equal(JSON.parse(saved).data.rows[0].checks.length, 2);
  assert.doesNotMatch(saved, /SECRET/);
  writeFileSync(join(root, "report.json"), JSON.stringify({ ...action, reportId: "wrong-report" }));
  const mixed = spawnSync(process.execPath, args, options);
  assert.ifError(mixed.error);
  assert.notEqual(mixed.status, 0);
  assert.match(mixed.stderr, /identity changed/);
});
