import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectNative, comparisonContext, inventorySkills, loadComparison, postComparison, projectTrials, publisherContext, renderComparison, validateSelection } from "./skill-eval-comment.mjs";

const trial = (extra = {}) => ({
  type: "trial-result", runId: "native", evalName: "draft", stimulus: "draft-positive", model: "model-a", variant: "main",
  status: "success", gradeResult: { passed: false, details: [
    { graderType: "completed", name: "completed", passed: true },
    { graderType: "skill-invocation", name: "routing", passed: false, evidence: "SECRET_RAW_GRADER_OUTPUT" },
  ] }, trajectory: { output: "SECRET_RAW_ANSWER", events: [] }, ...extra,
});
const footer = { type: "run-summary", runId: "native", hadExecutionErrors: false, passed: false };
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
  const data = collectNative(`${JSON.stringify(trial())}\n${JSON.stringify(footer)}\n`, "native", 1);
  assert.equal(data.state, "complete");
  assert.equal(data.rows[0].checks.filter((check) => check.passed).length, 1);
  assert.match(data.rows[0].checks[1].reason, /activation/);
  assert.doesNotMatch(JSON.stringify(data), /SECRET/);
  assert.throws(() => projectTrials([trial(), trial(), footer], "native"), /one trial/);
  assert.throws(() => projectTrials([trial({ runId: "other" }), footer], "native"), /identity/);
  assert.throws(() => projectTrials([trial(), { ...footer, runId: "other" }], "native"), /completion/);
  assert.equal(collectNative("", "native", 1).state, "error");
  assert.equal(collectNative(`${JSON.stringify(trial())}\n${JSON.stringify(footer)}`, "native", 2).state, "error");
  const errored = projectTrials([trial({ gradeResult: { passed: false, details: [{ status: "error" }] } }), footer], "native");
  assert.equal(errored[0].state, "error");
  assert.equal(errored[0].passed, false);
  assert.equal(projectTrials([trial({ status: "skipped" }), footer], "native")[0].state, "not-run");
});

test("native CLI outcomes preserve behavioral failures and completed checks beside grading errors", () => {
  const contents = (...rows) => rows.map((row) => JSON.stringify(row)).join("\n");
  assert.equal(collectNative(contents(trial(), footer), "native", 1).state, "complete");
  assert.equal(collectNative(contents(trial(), footer), "native", 2).state, "error");
  assert.equal(collectNative(contents(trial(), { ...footer, passed: true }), "native", 1).state, "error");
  assert.equal(collectNative(contents(footer), "native", 0).state, "not-run");
  const errored = trial({ gradeResult: { passed: false, details: [
    { graderType: "skill-invocation", name: "routing", passed: false },
    { graderType: "program", status: "error", passed: false },
  ] } });
  const data = collectNative(contents(errored, { ...footer, hadExecutionErrors: true }), "native", 1);
  assert.equal(data.state, "error");
  assert.equal(data.rows[0].state, "error");
  assert.equal(data.rows[0].checks.length, 1);
  assert.equal(data.rows[0].checks[0].id, "0:skill-invocation");
  const rendered = renderComparison(selection, [{ ...pair(), after: data }], "https://example.test");
  assert.match(rendered, /After failures in changed skills \(1 grader\/model results\)/);
  assert.match(rendered, /After \(comparison unknown\) \| routing/);
  assert.match(rendered, /⚠️ Error/);
  assert.throws(() => collectNative(contents(trial(), footer), "other", 0), /completion/);
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

test("partial arms and absent matching graders cannot create resolved or new failure claims", () => {
  for (const change of ["partial", "missing-check"]) {
    const sample = pair();
    if (change === "partial") sample.after.state = "error";
    else sample.after.rows[0].checks.pop();
    const rendered = renderComparison(selection, [sample], "https://example.test");
    assert.match(rendered, /0 resolved · 📉 0 new failures/);
    assert.match(rendered, /Before \(comparison unknown\) \| routing/);
    assert.match(rendered, /comparison unknown/);
    assert.doesNotMatch(rendered, /resolved After|After \(new\)|📈 1\/2/);
    if (change === "partial") assert.match(rendered, /1\/2 → ⚠️ Error/);
    else assert.match(rendered, /1\/2 → 1\/1 \(comparison unknown\)/);
  }
});

test("malformed native output never leaks parser excerpts", () => {
  assert.throws(() => collectNative(`${JSON.stringify(trial())}\nSECRET_RAW_INVALID_JSON`, "native", 1), (error) => {
    assert.equal(error.message, "Malformed native JSONL evidence.");
    assert.doesNotMatch(error.message, /SECRET/);
    return true;
  });
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
  const context = { repository: "example/repo", pullNumber: 2, runNumber: 5, attempt: "1" };
  const calls = [];
  let head = selection.head, comments = [];
  const api = async (endpoint, method = "GET", body) => {
    calls.push({ endpoint, method, body });
    if (endpoint.endsWith("/pulls/2")) return { state: "open", head: { sha: head, repo: { full_name: "example/repo" } } };
    if (method === "GET") return comments;
    return { id: 8 };
  };
  await postComparison(selection, "Report", api, context);
  assert.equal(calls.at(-1).method, "POST");
  comments = [{ id: 8, user: { login: "github-actions[bot]" }, body: calls.at(-1).body.body }];
  calls.length = 0;
  await postComparison(selection, "Updated", api, context);
  assert.equal(calls.at(-1).method, "PATCH");
  assert.match(calls.at(-1).endpoint, /issues\/comments\/8$/);
  comments[0].body = comments[0].body.replace("run:5:1", "run:6:1");
  assert.equal(await postComparison(selection, "Older", api, context), "stale");
  head = "c".repeat(40);
  await assert.rejects(postComparison(selection, "Wrong head", api, context), /head changed/);
});

function sourceFixture() {
  const context = { repository: "example/repo", run: "999", attempt: "7", runNumber: 9,
    pullNumber: 2, head: selection.head, runHead: "c".repeat(40),
    sourceRun: "11", sourceAttempt: "2", trusted: "d".repeat(40),
    base: selection.base, merge: "c".repeat(40) };
  const selected = {
    ...selection, repository: context.repository, run: context.run, attempt: context.attempt, merge: context.runHead,
    sourceRun: context.sourceRun, sourceAttempt: context.sourceAttempt, trusted: context.trusted,
    include: [{ id: "skill-aaaaaaaaaaaa", plugin: "local", skill: "draft", directory: "plugins/local/skills/draft",
      evalPath: "evals/local/skills/draft/eval.yaml", base: selection.base, head: selection.head }],
  };
  const source = { id: 11, run_attempt: 2, pull_requests: [{ number: 2 }] };
  const run = { ...source, repository: { full_name: context.repository }, head_repository: { full_name: context.repository },
    event: "pull_request", status: "completed", conclusion: "failure", head_sha: context.runHead,
    run_number: 5, workflow_id: 7, pull_requests: [{ number: 2, head: { sha: selection.head } }] };
  const api = async (endpoint) => {
    if (endpoint.endsWith("/actions/runs/11/attempts/2")) return run;
    if (endpoint.endsWith("/actions/workflows/7")) return { path: ".github/workflows/skill-evals.yml" };
    if (endpoint.endsWith(`/git/commits/${selected.merge}`)) return {
      sha: selected.merge, parents: [{ sha: selected.base }, { sha: selected.head }],
    };
    throw new Error("Unexpected test API request.");
  };
  return { context, selected, source, run, api };
}

test("publisher authenticates workflow, source attempt and PR independently from its own run", async () => {
  const { context, source, run, api } = sourceFixture();
  const env = { GITHUB_EVENT_NAME: "workflow_run", GITHUB_REPOSITORY: context.repository,
    GITHUB_RUN_ID: "999", GITHUB_RUN_ATTEMPT: "7", GITHUB_RUN_NUMBER: "9", GITHUB_SHA: "d".repeat(40) };
  const { sourceRun, sourceAttempt, trusted, base, merge, ...sourceContext } = context;
  assert.deepEqual(await publisherContext({ workflow_run: source }, api, env), {
    ...sourceContext, run: "11", attempt: "2", runNumber: 5,
  });
  const { base: selectedBase, merge: selectedMerge, ...authenticated } = context;
  assert.deepEqual(await comparisonContext({ workflow_run: source }, api, env), authenticated);
  assert.equal((await comparisonContext({ workflow_run: source }, api, env, "2")).attempt, "2");
  await assert.rejects(comparisonContext({ workflow_run: source }, api, env, "8"), /trusted comparison/);
  await assert.rejects(comparisonContext({ workflow_run: source }, api, { ...env, GITHUB_RUN_NUMBER: "" }), /trusted comparison/);
  await assert.rejects(publisherContext({ workflow_run: source }, api, { ...env, GITHUB_EVENT_NAME: "pull_request" }), /workflow_run/);
  for (const change of [
    { event: "workflow_dispatch" }, { head_repository: { full_name: "fork/repo" } },
    { repository: { full_name: "other/repo" } }, { pull_requests: [] }, { run_attempt: 1 },
  ]) {
    await assert.rejects(publisherContext({ workflow_run: source }, async (endpoint) =>
      endpoint.includes("/actions/runs/") ? { ...run, ...change } : api(endpoint), env));
  }
  await assert.rejects(publisherContext({ workflow_run: source }, async (endpoint) =>
    endpoint.includes("/actions/workflows/") ? { path: ".github/workflows/spoofed.yml" } : api(endpoint), env), /workflow path/);
});

test("untrusted artifacts are bounded data, source-bound and re-sanitized before rendering", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "comparison-publisher-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { selected, context, api } = sourceFixture();
  writeFileSync(join(root, "selection.json"), JSON.stringify(selected));
  const arm = {
    id: selected.include[0].id, key: "local/draft", arm: "before", repository: context.repository,
    run: context.run, attempt: context.attempt, merge: selected.merge,
    data: pair().before,
  };
  arm.data.rows[0].model = "@everyone | <script>bad</script>";
  arm.data.rows[0].eval = "A&B";
  arm.data.rows[0].checks[1].name = "A&B";
  arm.data.rows[0].checks[1].reason = "SECRET_UNTRUSTED_EVIDENCE";
  writeFileSync(join(root, `${arm.id}-before.json`), JSON.stringify(arm));
  const loaded = await loadComparison(root, context, api);
  const rendered = renderComparison(loaded.selection, loaded.pairs, "https://example.test");
  assert.doesNotMatch(rendered, /<script>|@everyone|SECRET_UNTRUSTED_EVIDENCE/i);
  assert.match(rendered, /A&amp;B/);
  assert.doesNotMatch(rendered, /A&amp;amp;B/);
  assert.match(rendered, /Required activation/);
  assert.match(rendered, /⚠️ Error/);
  await assert.rejects(validateSelection({ ...selected, attempt: "1" }, context, api), /authenticated source/);
  await assert.rejects(validateSelection({ ...selected, include: [{ ...selected.include[0], id: "../../outside" }] }, context, api), /selection entry/);
  await assert.rejects(validateSelection(selected, context, async () => ({
    sha: selected.merge, parents: [{ sha: selected.head }, { sha: selected.base }],
  })), /merge parents/);
  writeFileSync(join(root, `${arm.id}-before.json`), JSON.stringify({ ...arm, attempt: "1" }));
  await assert.rejects(loadComparison(root, context, api), /Mixed comparison artifacts/);
  writeFileSync(join(root, "selection.json"), " ".repeat(1024 * 1024 + 1));
  await assert.rejects(loadComparison(root, context, api), /bounded regular/);
});

test("native CLI projection binds its run and trusted workflow without an Action report", (t) => {
  const root = mkdtempSync(join(tmpdir(), "comparison-native-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { selected } = sourceFixture();
  writeFileSync(join(root, "selection.json"), JSON.stringify(selected));
  writeFileSync(join(root, "native.jsonl"), [trial(), footer].map((row) => JSON.stringify(row)).join("\n"));
  const env = {
    ...process.env, GITHUB_REPOSITORY: selected.repository, GITHUB_RUN_ID: selected.run,
    GITHUB_RUN_ATTEMPT: selected.attempt, GITHUB_SHA: selected.trusted,
    COMPARISON_ID: selected.include[0].id, ARM: "before", SELECTION_FILE: join(root, "selection.json"),
    NATIVE_FILE: join(root, "native.jsonl"), NATIVE_RUN_ID: "native", NATIVE_EXIT: "1",
  };
  const args = [fileURLToPath(new URL("./skill-eval-comment.mjs", import.meta.url)), "native", root];
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const saved = readFileSync(join(root, `${selected.include[0].id}-before.json`), "utf8");
  assert.equal(JSON.parse(saved).data.state, "complete");
  assert.doesNotMatch(saved, /SECRET/);
  const mixed = spawnSync(process.execPath, args, { env: { ...env, NATIVE_RUN_ID: "wrong" }, encoding: "utf8", timeout: 10000 });
  assert.ifError(mixed.error);
  assert.notEqual(mixed.status, 0);
  assert.match(mixed.stderr, /completion/);
});
