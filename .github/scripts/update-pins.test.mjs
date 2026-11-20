import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import {
  BRANCH,
  assertBotPr,
  approvedCopilotReview,
  evaluateMergeGate,
  getMergeState,
  main,
  newestRelease,
  planPublish,
  planUpdate,
  publish,
  requestCopilotReview,
  requiredChecks,
  trustedValidateLint,
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
    "repos/github/evals/releases?per_page=100&page=1": evalsReleases,
    "repos/github/evals-action/releases?per_page=100&page=1": actionReleases,
    "repos/github/evals/commits/copilot-evals-v0.24.68": { sha: sha("2") },
    "repos/github/evals-action/commits/v0.3.0": { sha: sha("b") },
    [`repos/github/evals-action/compare/${sha("a")}...${sha("b")}`]: { status: actionCompare },
  });
}

function commandWorkspace(t) {
  const directory = mkdtempSync(join(tmpdir(), "update-pins-test-"));
  const previousDirectory = process.cwd();
  const keys = ["GITHUB_REPOSITORY", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY"];
  const previousEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.chdir(directory);
  execFileSync("git", ["init", "--quiet"]);
  execFileSync("git", ["config", "user.name", "test"]);
  execFileSync("git", ["config", "user.email", "test@example.invalid"]);
  for (const [file, contents] of Object.entries({
    "marketplace.json": marketplace,
    ".github/workflows/skill-eval-comparison.yml": workflow,
    "docs/checks-and-evals.md": "",
  })) {
    mkdirSync(dirname(resolve(directory, file)), { recursive: true });
    writeFileSync(file, contents);
  }
  execFileSync("git", ["add", "."]);
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"]);

  const output = join(directory, "github-output");
  const summary = join(directory, "step-summary");
  process.env.GITHUB_REPOSITORY = "o/r";
  process.env.GITHUB_OUTPUT = output;
  process.env.GITHUB_STEP_SUMMARY = summary;
  t.after(() => {
    process.chdir(previousDirectory);
    for (const key of keys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, output, summary };
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
  const rateLimited = (endpoint) => (endpoint.includes("/releases/tags/") ? { status: 403, body: "{}" } : api(endpoint));
  assert.throws(() => planUpdate({ files: { "marketplace.json": marketplace }, api: rateLimited }), /releases\/tags\/copilot-evals-v0\.24\.60: GitHub API returned HTTP 403/);
});

test("planUpdate reads every release page before choosing", () => {
  const filler = Array.from({ length: 100 }, (_, index) => release(`other-v0.0.${index}`));
  const api = fakeApi({
    "repos/github/evals/releases?per_page=100&page=1": filler,
    "repos/github/evals/releases?per_page=100&page=2": [release("copilot-evals-v0.24.68"), release("copilot-evals-v0.24.60")],
    "repos/github/evals/commits/copilot-evals-v0.24.68": { sha: sha("2") },
  });
  const plan = planUpdate({ files: { "marketplace.json": marketplace }, api });
  assert.equal(JSON.parse(plan.files["marketplace.json"]).plugins[1].source.ref, "copilot-evals-v0.24.68");
});

test("requiredChecks reads every rules page and keeps app bindings", () => {
  const filler = Array.from({ length: 100 }, () => ({ type: "deletion" }));
  const api = fakeApi({
    "repos/o/r/rules/branches/main?per_page=100&page=1": filler,
    "repos/o/r/rules/branches/main?per_page=100&page=2": [
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "evals", integration_id: 42 }] } },
    ],
    "repos/o/r/branches/main": { protection: { required_status_checks: { checks: [{ context: "ci/legacy", app_id: null }] } } },
  });
  assert.deepEqual(requiredChecks(api, "o/r", "main"), [{ context: "evals", app: 42 }, { context: "ci/legacy", app: null }]);
});

test("requiredChecks treats only the GitHub Free rulesets entitlement error as no rules", () => {
  const api = (endpoint) => endpoint.includes("/rules/branches/")
    ? { status: 403, body: JSON.stringify({ message: "Upgrade to GitHub Pro or make this repository public to enable this feature." }) }
    : { status: 200, body: JSON.stringify({ protection: { required_status_checks: null } }) };
  assert.deepEqual(requiredChecks(api, "o/r", "main"), []);
  assert.throws(() => requiredChecks(() => ({ status: 403, body: '{"message":"Resource not accessible by integration"}' }), "o/r", "main"), /HTTP 403/);
});

test("trusted Validate lint is required from a successful pull_request run on the exact head", () => {
  const head = sha("d");
  const runsEndpoint = `repos/o/r/actions/runs?head_sha=${head}&per_page=100&page=1`;
  const jobsEndpoint = "repos/o/r/actions/runs/10/jobs?per_page=100&page=1";
  const validRun = { id: 10, name: "Validate", path: ".github/workflows/validate.yml", event: "pull_request", head_sha: head, status: "completed", conclusion: "success", created_at: "2026-01-01T00:00:00Z", run_attempt: 1 };
  const api = fakeApi({
    [runsEndpoint]: { workflow_runs: [validRun] },
    [jobsEndpoint]: { jobs: [{ name: "lint", status: "completed", conclusion: "success" }] },
  });
  assert.equal(trustedValidateLint(api, "o/r", head), true);

  const untrusted = fakeApi({
    [runsEndpoint]: { workflow_runs: [{ ...validRun, name: "Unrelated workflow" }] },
  });
  assert.equal(trustedValidateLint(untrusted, "o/r", head), false);
  const wrongHead = fakeApi({
    [runsEndpoint]: { workflow_runs: [{ ...validRun, head_sha: sha("e") }] },
  });
  assert.equal(trustedValidateLint(wrongHead, "o/r", head), false);
});

test("approvedCopilotReview requires Copilot's latest approval on the exact head and reads every page", () => {
  const head = sha("d");
  const endpoint = "repos/o/r/pulls/7/reviews";
  const firstPage = `${endpoint}?per_page=100&page=1`;
  const secondPage = `${endpoint}?per_page=100&page=2`;
  const filler = Array.from({ length: 100 }, () => ({ user: { login: "other[bot]" }, state: "COMMENTED" }));
  const copilot = "copilot-pull-request-reviewer[bot]";
  const api = fakeApi({
    [firstPage]: filler,
    [secondPage]: [
      { user: { login: copilot }, state: "COMMENTED", commit_id: head, submitted_at: "2026-01-01T00:00:00Z" },
      { user: { login: copilot }, state: "APPROVED", commit_id: head, submitted_at: "2026-01-02T00:00:00Z" },
    ],
  });
  assert.equal(approvedCopilotReview(api, "o/r", 7, head), true);
  assert.deepEqual(api.calls, [firstPage, secondPage]);

  const commentOnly = fakeApi({
    [firstPage]: [
      { user: { login: "wbreza" }, state: "APPROVED", commit_id: head, submitted_at: "2026-01-01T00:00:00Z" },
      { user: { login: copilot }, state: "COMMENTED", commit_id: head, submitted_at: "2026-01-02T00:00:00Z" },
    ],
  });
  assert.equal(approvedCopilotReview(commentOnly, "o/r", 7, head), false);

  const supersededApproval = fakeApi({
    [firstPage]: [
      { user: { login: copilot }, state: "APPROVED", commit_id: head, submitted_at: "2026-01-01T00:00:00Z" },
      { user: { login: copilot }, state: "COMMENTED", commit_id: head, submitted_at: "2026-01-02T00:00:00Z" },
    ],
  });
  assert.equal(approvedCopilotReview(supersededApproval, "o/r", 7, head), false);

  const staleApproval = fakeApi({
    [firstPage]: [{ user: { login: copilot }, state: "APPROVED", commit_id: sha("e"), submitted_at: "2026-01-02T00:00:00Z" }],
  });
  assert.equal(approvedCopilotReview(staleApproval, "o/r", 7, head), false);
});

test("requestCopilotReview requests only when the current App PR head lacks a Copilot review", () => {
  const head = sha("d");
  const prList = "repos/o/r/pulls?state=open&head=o:automation%2Fupdate-pins";
  const reviews = "repos/o/r/pulls/7/reviews?per_page=100&page=1";
  const pinPr = { number: 7, user: { login: bot, type: "Bot" }, head: { sha: head } };
  let requests = 0;
  const requested = requestCopilotReview(fakeApi({
    [prList]: [pinPr],
    [reviews]: [],
  }), (endpoint) => {
    requests += 1;
    assert.equal(endpoint, "repos/o/r/pulls/7/copilot-code-review");
    return { status: 201, body: JSON.stringify({ state: "PENDING" }) };
  }, "o/r", bot);
  assert.deepEqual(requested, { state: "requested", pr: 7, head });
  assert.equal(requests, 1);

  const commentOnly = fakeApi({
    [prList]: [pinPr],
    [reviews]: [{
      user: { login: "copilot-pull-request-reviewer[bot]" },
      state: "COMMENTED",
      commit_id: head,
      submitted_at: "2026-01-01T00:00:00Z",
    }],
  });
  const alreadyReviewed = requestCopilotReview(commentOnly, () => {
    throw new Error("must not request another review for the same head");
  }, "o/r", bot);
  assert.deepEqual(alreadyReviewed, { state: "completed", pr: 7, head });

  const pending = requestCopilotReview(fakeApi({
    [prList]: [pinPr],
    [reviews]: [],
  }), () => ({ status: 409, body: "{}" }), "o/r", bot);
  assert.deepEqual(pending, { state: "pending", pr: 7, head });

  assert.throws(() => requestCopilotReview(fakeApi({
    [prList]: [pinPr],
    [reviews]: [],
  }), () => ({ status: 422, body: JSON.stringify({ failure_reason: "NOT_ELIGIBLE" }) }), "o/r", bot), /HTTP 422 \(NOT_ELIGIBLE\)/);
});

const pr = (overrides = {}) => ({
  number: 7,
  state: "open",
  draft: false,
  user: { login: bot, type: "Bot" },
  head: { ref: BRANCH, sha: sha("d"), repo: { full_name: "o/r" } },
  node_id: "PR_kwDOAAA",
  base: { ref: "main", repo: { full_name: "o/r", default_branch: "main" } },
  mergeable_state: "blocked",
  mergeable: true,
  commits: 1,
  changed_files: 1,
  ...overrides,
});
const ready = (overrides = {}) => ({
  pr: pr(),
  commits: [{ author: { login: bot }, committer: { login: bot } }],
  files: [{ filename: "marketplace.json", status: "modified" }],
  checkRuns: { total_count: 2, check_runs: [{ name: "lint", status: "completed", conclusion: "success" }, { name: "Copilot", status: "completed", conclusion: "neutral" }] },
  status: { state: "pending", total_count: 0 },
  compare: { behind_by: 0 },
  trustedLintPassed: true,
  reviewDecision: "APPROVED",
  automatedReviewApproved: true,
  bot,
  ...overrides,
});

test("merge gate merges only a current, bot-only, allowlisted PR with every check settled", () => {
  assert.equal(evaluateMergeGate(ready()).decision, "merge");
  assert.equal(evaluateMergeGate(ready()).prNodeId, "PR_kwDOAAA");
  assert.equal(evaluateMergeGate({ ...ready(), pr: undefined }).decision, "none");
  const waits = {
    "lint missing": { checkRuns: { total_count: 0, check_runs: [] } },
    "check running": { checkRuns: { total_count: 1, check_runs: [{ name: "lint", status: "in_progress", conclusion: null }] } },
    "status pending": { status: { state: "pending", total_count: 1 } },
    "behind main": { compare: { behind_by: 1 } },
    "head moved": { expectHead: sha("e") },
    "trusted lint missing": { trustedLintPassed: false },
    "GitHub approval missing": { reviewDecision: "REVIEW_REQUIRED" },
    "Copilot approval missing": { automatedReviewApproved: false },
    "GitHub doesn't recognize the Copilot approval": { reviewDecision: "REVIEW_REQUIRED", automatedReviewApproved: true },
    "mergeability pending": { pr: pr({ mergeable: null, mergeable_state: "unknown" }) },
    "content not generated": { stale: ["marketplace.json"] },
    "required check missing": { required: [{ context: "evals" }] },
    "required status pending": { required: [{ context: "ci/legacy" }], status: { state: "pending", total_count: 1, statuses: [{ context: "ci/legacy", state: "pending" }] } },
    "required check from another app": { required: [{ context: "Copilot", app: 42 }] },
    "app-bound status": { required: [{ context: "ci/legacy", app: 42 }], status: { state: "success", total_count: 1, statuses: [{ context: "ci/legacy", state: "success" }] } },
  };
  for (const [label, overrides] of Object.entries(waits)) {
    assert.equal(evaluateMergeGate(ready(overrides)).decision, "wait", label);
  }
  assert.equal(evaluateMergeGate(ready({ reviewDecision: "CHANGES_REQUESTED" })).decision, "block");
  assert.equal(evaluateMergeGate(ready({ required: [{ context: "Copilot" }] })).decision, "merge", "a settled required check run counts");
  const appRun = { checkRuns: { total_count: 2, check_runs: [{ name: "lint", status: "completed", conclusion: "success" }, { name: "Copilot", status: "completed", conclusion: "neutral", app: { id: 42 } }] } };
  assert.equal(evaluateMergeGate(ready({ ...appRun, required: [{ context: "Copilot", app: 42 }] })).decision, "merge", "the bound app's check run counts");
  assert.equal(evaluateMergeGate(ready({ required: [{ context: "ci/legacy" }], status: { state: "success", total_count: 1, statuses: [{ context: "ci/legacy", state: "success" }] } })).decision, "merge", "a successful required status counts");
  assert.equal(evaluateMergeGate(ready({
    checkRuns: { total_count: 0, check_runs: [] },
    status: { state: "success", total_count: 1, statuses: [{ context: "lint", state: "success" }] },
    trustedLintPassed: false,
  })).decision, "wait", "a same-named commit status cannot substitute for Validate's lint job");
  const blocks = {
    "human author": { pr: pr({ user: { login: "someone", type: "User" } }) },
    "other app": { pr: pr({ user: { login: "other[bot]", type: "Bot" } }) },
    "human commit": { pr: pr({ commits: 2 }), commits: [{ author: { login: bot }, committer: { login: bot } }, { author: { login: "someone" }, committer: { login: bot } }] },
    "amended bot commit": { commits: [{ author: { login: bot }, committer: { login: "someone" } }] },
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

test("merge gate leaves already-queued PRs in the queue without another enqueue", () => {
  const queued = ready({ isInMergeQueue: true });
  const result = evaluateMergeGate(queued);
  assert.equal(result.decision, "wait");
  assert.match(result.reason, /already in the merge queue/);
  assert.equal(evaluateMergeGate(ready({ isInMergeQueue: false })).decision, "merge");
  assert.equal(evaluateMergeGate({ ...queued, expectHead: sha("e") }).reason, "PR head changed since the gate ran.");
  assert.equal(evaluateMergeGate({ ...queued, pr: pr({ user: { login: "someone", type: "User" } }) }).decision, "block");
});

test("merge state reads both GitHub approval and queue membership", () => {
  const state = { reviewDecision: "APPROVED", isInMergeQueue: true };
  assert.deepEqual(getMergeState("o/r", 7, (command, args) => {
    assert.equal(command, "gh");
    assert.deepEqual(args.slice(0, 2), ["api", "graphql"]);
    assert.match(args[3], /pullRequest\(number:\$number\)\{reviewDecision isInMergeQueue\}/);
    assert.deepEqual(args.slice(4), ["-F", "owner=o", "-F", "name=r", "-F", "number=7", "--jq", ".data.repository.pullRequest"]);
    return JSON.stringify(state);
  }), state);
});

test("publication leaves a queued App PR untouched before git, branch updates, or review requests", () => {
  const endpoint = "repos/o/r/pulls?state=open&head=o:automation%2Fupdate-pins";
  const api = fakeApi({ [endpoint]: [pr()] });
  const result = publish(api, "o/r", {
    bot,
    mergeState: (repo, number) => {
      assert.equal(repo, "o/r");
      assert.equal(number, 7);
      return { reviewDecision: "APPROVED", isInMergeQueue: true };
    },
    requestReview: () => assert.fail("queued PRs must not request another review"),
  });
  assert.match(result, /already in the merge queue; leaving it unchanged/);
  assert.deepEqual(api.calls, [endpoint]);
});

test("update CLI reports the unchanged plan and writes its step outputs", (t) => {
  const { output, summary } = commandWorkspace(t);
  const api = fakeApi({
    "repos/github/evals/releases?per_page=100&page=1": [],
    "repos/github/evals-action/releases?per_page=100&page=1": [],
    "repos/o/r/pulls?state=open&head=o:automation%2Fupdate-pins": [],
  });

  main(["update"], api);

  assert.match(readFileSync(output, "utf8"), /changed=false/);
  assert.match(readFileSync(output, "utf8"), /open_pr=/);
  assert.match(readFileSync(summary, "utf8"), /Pins are current/);
  assert.deepEqual(api.calls, [
    "repos/github/evals/releases?per_page=100&page=1",
    "repos/github/evals/releases/tags/copilot-evals-v0.24.60",
    "repos/github/evals-action/releases?per_page=100&page=1",
    "repos/o/r/pulls?state=open&head=o:automation%2Fupdate-pins",
  ]);
});

test("publish CLI reports no changes without pushing or creating a PR", (t) => {
  const { summary } = commandWorkspace(t);
  const api = fakeApi({
    "repos/o/r/pulls?state=open&head=o:automation%2Fupdate-pins": [],
  });

  main(["publish", "--title", "test", "--body-file", "body.md", "--bot", bot], api);

  assert.match(readFileSync(summary, "utf8"), /nothing to publish/);
  assert.deepEqual(api.calls, [
    "repos/o/r/pulls?state=open&head=o:automation%2Fupdate-pins",
    "repos/o/r/branches/automation%2Fupdate-pins",
  ]);
});

test("gate CLI reports no PR as a non-blocking result", (t) => {
  const { output, summary } = commandWorkspace(t);
  const api = fakeApi({
    "repos/o/r/pulls?state=open&head=o:automation%2Fupdate-pins": [],
  });

  main(["gate"], api);

  assert.match(readFileSync(output, "utf8"), /decision=none/);
  assert.match(readFileSync(summary, "utf8"), /\*\*none\*\*: No open pin update PR/);
});

test("CLI requires a repository and rejects unknown commands", (t) => {
  commandWorkspace(t);
  const previous = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY;
  try {
    assert.throws(() => main(["gate"], fakeApi({})), /GITHUB_REPOSITORY must name this repository/);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previous;
  }
  assert.throws(() => main(["unknown"], fakeApi({})), /Usage: update-pins\.mjs/);
});

test("pin publication refuses to close or edit a PR not opened by its App", () => {
  assert.doesNotThrow(() => assertBotPr({ number: 7, user: { login: bot, type: "Bot" } }, bot));
  assert.throws(() => assertBotPr({ number: 7, user: { login: "maintainer", type: "User" } }, bot), /isn't authored by/);
  assert.throws(() => assertBotPr({ number: 7, user: { login: "other-app[bot]", type: "Bot" } }, bot), /isn't authored by/);
});

test("workflow-run planning requires opt-in and a successful same-repository PR run", () => {
  const { jobs } = parse(readFileSync(resolve(root, ".github/workflows/update-pins.yml"), "utf8"));
  const evaluate = (eventName, enabled, run) => Boolean(runInNewContext(jobs.plan.if, {
    github: { event_name: eventName, repository: "o/r", event: { workflow_run: run } },
    vars: { PIN_AUTOMATION: enabled },
  }));
  const trusted = { conclusion: "success", event: "pull_request", head_repository: { full_name: "o/r" } };
  assert.equal(evaluate("workflow_run", "true", trusted), true);
  for (const enabled of ["false", "", undefined]) {
    assert.equal(evaluate("workflow_run", enabled, trusted), false, `opt-in ${enabled}`);
  }
  for (const conclusion of ["failure", "cancelled", "skipped"]) {
    assert.equal(evaluate("workflow_run", "true", { ...trusted, conclusion }), false, conclusion);
  }
  for (const event of ["push", "workflow_dispatch", "merge_group", undefined]) {
    assert.equal(evaluate("workflow_run", "true", { ...trusted, event }), false, event);
  }
  assert.equal(evaluate("workflow_run", "true", { ...trusted, head_repository: { full_name: "fork/r" } }), false);
  assert.equal(evaluate("workflow_run", "true", { ...trusted, head_repository: {} }), false);
  assert.equal(evaluate("schedule", "true"), true);
  assert.equal(evaluate("schedule", "false"), false);
  assert.equal(evaluate("workflow_dispatch", "false"), true, "manual runs remain available while automation is paused");
  assert.equal(jobs.publish.needs, "plan", "publication cannot run when planning is skipped");

  const gateCondition = jobs.gate.if.replaceAll("needs.*.result", "[needs.plan.result, needs.publish.result]");
  for (const result of ["skipped", "failure", "cancelled"]) {
    assert.equal(runInNewContext(gateCondition, {
      always: () => true,
      contains: (values, value) => values.includes(value),
      needs: { plan: { result }, publish: { result: "skipped" } },
      github: { event_name: "workflow_dispatch" },
    }), false, `gate cannot run after planning is ${result}`);
  }
});

test("enqueue uses nested GraphQL input and narrowly scoped App permissions", () => {
  const { jobs } = parse(readFileSync(resolve(root, ".github/workflows/update-pins.yml"), "utf8"));
  const app = jobs.enqueue.steps.find((step) => step.id === "app");
  assert.deepEqual(Object.fromEntries(Object.entries(app.with).filter(([key]) => key.startsWith("permission-"))), {
    "permission-contents": "write",
    "permission-pull-requests": "write",
    "permission-workflows": "write",
  });
  const recheck = jobs.enqueue.steps.find((step) => step.id === "recheck");
  assert.equal(recheck.env.HEAD_SHA, "${{ needs.gate.outputs.head }}");
  assert.match(recheck.run, /gate --bot "\$BOT" --expect-head "\$HEAD_SHA"/);
  const mutation = jobs.enqueue.steps.at(-1);
  assert.equal(mutation.if, "steps.recheck.outputs.decision == 'merge'");
  assert.equal(mutation.env.PR_NODE_ID, "${{ steps.recheck.outputs.pr_node_id }}");
  assert.equal(mutation.env.HEAD_SHA, "${{ steps.recheck.outputs.head }}");
  assert.match(mutation.run, /enqueuePullRequest\(input: \$input\)/);
  assert.match(mutation.run, /-F "input\[pullRequestId\]=\$PR_NODE_ID"/);
  assert.match(mutation.run, /-F "input\[expectedHeadOid\]=\$HEAD_SHA"/);
  assert.match(mutation.run, /-F 'input\[jump\]=false'/);
  assert.doesNotMatch(mutation.run, /-F input\./);
});

test("update-pins workflow keeps secrets out of read-only and dry-run jobs", () => {
  const text = readFileSync(resolve(root, ".github/workflows/update-pins.yml"), "utf8");
  const workflow = parse(text);
  const validate = parse(readFileSync(resolve(root, ".github/workflows/validate.yml"), "utf8"));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.match(workflow.jobs.plan.if, /workflow_run/);
  assert.match(workflow.jobs.plan.if, /conclusion == 'success'/);
  assert.deepEqual(validate.on.merge_group, { types: ["checks_requested"] });
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
  const enqueue = workflow.jobs.enqueue;
  assert.equal(workflow.jobs.publish.steps.find((step) => step.uses?.startsWith("actions/create-github-app-token@")).with["permission-pull-requests"], "write");
  assert.deepEqual(enqueue.needs, "gate");
  assert.equal(JSON.stringify(enqueue).includes("inputs.dry_run"), true);
  assert.equal(JSON.stringify(enqueue).includes("expectedHeadOid"), true);
  assert.equal(JSON.stringify(enqueue).includes("pullRequestId"), true);
  assert.equal(JSON.stringify(enqueue).includes("/pulls/$PR/merge"), false);
  assert.doesNotMatch(text, /pull_request_target|github\.event\.workflow_run\.head_sha/);
});

test("comparison cancels superseded PR runs without cancelling manual runs or the serialized report", () => {
  const workflow = parse(readFileSync(resolve(root, ".github/workflows/skill-eval-comparison.yml"), "utf8"));
  assert.equal(workflow.concurrency, undefined, "workflow-level cancellation would also cancel an active report");
  const expectedGroups = {
    select: "skill-eval-comparison-${{ github.event.pull_request.number || github.ref }}-select",
    "run-baseline": "skill-eval-comparison-${{ github.event.pull_request.number || github.ref }}-run-baseline",
    run: "skill-eval-comparison-${{ github.event.pull_request.number || github.ref }}-run",
  };
  for (const [job, group] of Object.entries(expectedGroups)) {
    const concurrency = workflow.jobs[job].concurrency;
    assert.equal(concurrency.group, group);
    const cancelExpression = concurrency["cancel-in-progress"].replace(/^\$\{\{\s*|\s*\}\}$/g, "");
    const cancels = (eventName) => Boolean(runInNewContext(cancelExpression, { github: { event_name: eventName } }));
    assert.equal(cancels("pull_request"), true, `${job} cancels its superseded PR job`);
    assert.equal(cancels("workflow_dispatch"), false, `${job} does not cancel manual runs`);
  }
  assert.match(workflow.jobs.report.if, /needs\.run-baseline\.result != 'cancelled'/);
  assert.match(workflow.jobs.report.if, /needs\.run\.result != 'cancelled'/);
  assert.deepEqual(workflow.jobs.report.concurrency, {
    group: "evals-${{ github.workflow_ref }}",
    "cancel-in-progress": false,
  });
});
