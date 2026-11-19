import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  BRANCH,
  evaluateMergeGate,
  newestRelease,
  planPublish,
  planUpdate,
} from "./update-pins.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha = (digit) => digit.repeat(40);
const bot = "pins-app[bot]";

const marketplace = `${JSON.stringify({
  name: "demo",
  plugins: [
    { name: "local", source: "./plugins/local" },
    {
      name: "eval",
      source: { source: "github", repo: "github/evals", path: "packages/plugin", ref: "copilot-evals-v0.24.60", sha: sha("1") },
      version: "0.24.60",
    },
  ],
}, null, 2)}\n`;
const workflow = [
  "steps:",
  `      - uses: github/evals-action@${sha("a")}`,
  "        with:",
  `      - uses: github/evals-action@${sha("a")} # github/evals-action#34`,
  `      - uses: other/action@${sha("a")}`,
  "",
].join("\n");

const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: true, ...extra });

function fakeApi(routes) {
  const calls = [];
  const api = (endpoint) => {
    calls.push(endpoint);
    if (!(endpoint in routes)) return { status: 404, body: "{}" };
    return { status: 200, body: JSON.stringify(routes[endpoint]) };
  };
  return Object.assign(api, { calls });
}

function upstream({ evalsReleases, actionReleases, actionCompare = "ahead" }) {
  return fakeApi({
    "repos/github/evals/releases?per_page=100": evalsReleases,
    "repos/github/evals-action/releases?per_page=100": actionReleases,
    "repos/github/evals/commits/copilot-evals-v0.24.68": { sha: sha("2") },
    "repos/github/evals-action/commits/v0.3.0": { sha: sha("b") },
    [`repos/github/evals-action/compare/${sha("a")}...${sha("b")}`]: { status: actionCompare },
  });
}

test("newestRelease picks the highest matching semver on the current channel and skips drafts", () => {
  const releases = [
    release("copilot-evals-v0.24.9"),
    release("copilot-evals-v0.24.70", { draft: true }),
    release("copilot-evals-v0.24.10"),
    release("copilot-evals-v1.0.0", { prerelease: false }),
    release("other-v9.9.9"),
  ];
  assert.equal(newestRelease(releases, "copilot-evals-v", true).tag_name, "copilot-evals-v1.0.0");
  assert.equal(newestRelease(releases.slice(0, 3), "copilot-evals-v", true).tag_name, "copilot-evals-v0.24.10");
  assert.equal(newestRelease(releases.slice(0, 3), "copilot-evals-v", false), undefined, "stable pins never move to prereleases");
});

test("planUpdate moves both pins forward and rewrites only evals-action uses lines", () => {
  const api = upstream({
    evalsReleases: [release("copilot-evals-v0.24.68"), release("copilot-evals-v0.24.60")],
    actionReleases: [release("v0.3.0"), release("v0.2.0")],
  });
  const plan = planUpdate({ files: { "marketplace.json": marketplace, "w.yml": workflow }, actionFiles: ["w.yml"], api });
  const entry = JSON.parse(plan.files["marketplace.json"]).plugins[1];
  assert.deepEqual([entry.source.ref, entry.source.sha, entry.version], ["copilot-evals-v0.24.68", sha("2"), "0.24.68"]);
  assert.equal(plan.files["marketplace.json"].endsWith("}\n"), true);
  assert.equal(plan.files["w.yml"], workflow
    .replace(`evals-action@${sha("a")}\n`, `evals-action@${sha("b")} # v0.3.0\n`)
    .replace(`evals-action@${sha("a")} # github/evals-action#34`, `evals-action@${sha("b")} # v0.3.0`));
  assert.match(plan.title, /copilot-evals-v0\.24\.68.*evals-action v0\.3\.0/);
  assert.match(plan.body, new RegExp(`compare/${sha("1")}\\.\\.\\.${sha("2")}`));
});

test("planUpdate never downgrades or sidegrades the action pin", () => {
  for (const actionCompare of ["behind", "diverged"]) {
    const plan = planUpdate({
      files: { "marketplace.json": marketplace, "w.yml": workflow },
      actionFiles: ["w.yml"],
      api: upstream({ evalsReleases: [release("copilot-evals-v0.24.60")], actionReleases: [release("v0.3.0")], actionCompare }),
    });
    assert.equal(plan.changes.length, 0, actionCompare);
    assert.equal(plan.files["w.yml"], workflow);
  }
});

test("planUpdate fails closed on inconsistent action pins or unreadable releases", () => {
  const mixed = `${workflow}      - uses: github/evals-action@${sha("c")}\n`;
  const api = upstream({ evalsReleases: [], actionReleases: [] });
  assert.throws(() => planUpdate({ files: { "marketplace.json": marketplace, "w.yml": mixed }, actionFiles: ["w.yml"], api }), /more than one github\/evals-action commit/);
  assert.throws(() => planUpdate({ files: { "marketplace.json": marketplace, "w.yml": workflow }, actionFiles: ["w.yml"], api: fakeApi({}) }), /HTTP 404/);
});

const pr = (overrides = {}) => ({
  number: 7,
  state: "open",
  draft: false,
  user: { login: bot, type: "Bot" },
  head: { ref: BRANCH, sha: sha("d"), repo: { full_name: "o/r" } },
  base: { ref: "main", repo: { full_name: "o/r", default_branch: "main" } },
  mergeable_state: "blocked",
  commits: 1,
  changed_files: 1,
  ...overrides,
});
const ready = (overrides = {}) => ({
  pr: pr(),
  commits: [{ author: { login: bot } }],
  files: [{ filename: "marketplace.json", status: "modified" }],
  checkRuns: { total_count: 2, check_runs: [{ name: "lint", status: "completed", conclusion: "success" }, { name: "Copilot", status: "completed", conclusion: "neutral" }] },
  status: { state: "pending", total_count: 0 },
  compare: { behind_by: 0 },
  bot,
  ...overrides,
});

test("merge gate merges only a current, bot-only, allowlisted PR with every check settled", () => {
  assert.equal(evaluateMergeGate(ready()).decision, "merge");
  assert.equal(evaluateMergeGate({ ...ready(), pr: undefined }).decision, "none");
  const waits = {
    "lint missing": { checkRuns: { total_count: 0, check_runs: [] } },
    "check running": { checkRuns: { total_count: 1, check_runs: [{ name: "lint", status: "in_progress", conclusion: null }] } },
    "status pending": { status: { state: "pending", total_count: 1 } },
    "behind main": { compare: { behind_by: 1 } },
    "head moved": { expectHead: sha("e") },
  };
  for (const [label, overrides] of Object.entries(waits)) {
    assert.equal(evaluateMergeGate(ready(overrides)).decision, "wait", label);
  }
  const blocks = {
    "human author": { pr: pr({ user: { login: "someone", type: "User" } }) },
    "other app": { pr: pr({ user: { login: "other[bot]", type: "Bot" } }) },
    "human commit": { pr: pr({ commits: 2 }), commits: [{ author: { login: bot } }, { author: { login: "someone" } }] },
    "truncated commits": { pr: pr({ commits: 101 }) },
    "truncated files": { pr: pr({ changed_files: 101 }) },
    "unexpected file": { files: [{ filename: ".github/workflows/validate.yml", status: "modified" }] },
    "added file": { files: [{ filename: "marketplace.json", status: "added" }] },
    "fork head": { pr: pr({ head: { ref: BRANCH, sha: sha("d"), repo: { full_name: "fork/r" } } }) },
    draft: { pr: pr({ draft: true }) },
    "failed check": { checkRuns: { total_count: 1, check_runs: [{ name: "lint", status: "completed", conclusion: "failure" }] } },
    "truncated checks": { checkRuns: { total_count: 101, check_runs: [{ name: "lint", status: "completed", conclusion: "success" }] } },
    "failed status": { status: { state: "failure", total_count: 1 } },
    conflict: { pr: pr({ mergeable_state: "dirty" }) },
  };
  for (const [label, overrides] of Object.entries(blocks)) {
    assert.equal(evaluateMergeGate(ready(overrides)).decision, "block", label);
  }
});

test("planPublish creates, skips identical current branches, and refuses human commits", () => {
  const base = { main: sha("1"), localTree: sha("2"), bot };
  assert.equal(planPublish({ ...base, remote: undefined }), "push");
  const remote = { sha: sha("3"), tree: sha("2"), parents: [sha("1")], authors: [bot], aheadBy: 1, behindBy: 0 };
  assert.equal(planPublish({ ...base, remote }), "skip");
  assert.equal(planPublish({ ...base, remote: { ...remote, tree: sha("4") } }), "push");
  assert.equal(planPublish({ ...base, remote: { ...remote, behindBy: 2 } }), "push");
  assert.throws(() => planPublish({ ...base, remote: { ...remote, authors: [bot, "someone"] } }), /not authored by/);
});

test("update-pins workflow keeps secrets out of read-only and dry-run jobs", () => {
  const text = readFileSync(resolve(root, ".github/workflows/update-pins.yml"), "utf8");
  const workflow = parse(text);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(workflow.on.workflow_run.branches, [BRANCH]);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const usesSecret = JSON.stringify(job).includes("secrets.");
    assert.equal(usesSecret, Boolean(job.environment), `${name}: secrets only in environment jobs`);
    if (job.environment) assert.match(job.if, /dry_run/, `${name}: secret jobs honor dry_run`);
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}\b/, `${name}: ${step.uses} is SHA-pinned`);
      if (step.uses?.startsWith("actions/checkout@")) {
        assert.equal(step.with["persist-credentials"], false, `${name}: checkout drops credentials`);
        assert.equal(step.with.ref, undefined, `${name}: always the default branch`);
      }
      assert.doesNotMatch(step.run ?? "", /npm (ci|install)/, `${name}: no dependency scripts`);
    }
  }
  assert.doesNotMatch(text, /pull_request_target|github\.event\.workflow_run\.head_sha/);
});
