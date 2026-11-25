import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { BRANCH, main, newestRelease, planPublish, planUpdate, publish } from "./update-pins.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha = (digit) => digit.repeat(40);
const validationRunsEndpoint = `repos/o/r/actions/workflows/validate.yml/runs?branch=${encodeURIComponent(BRANCH)}&event=workflow_dispatch&per_page=100`;
const marketplace = `${JSON.stringify({
  name: "demo",
  plugins: [
    { name: "local", source: "./plugins/local" },
    { name: "eval", source: { source: "github", repo: "github/evals", path: "packages/plugin", ref: "copilot-evals-v0.24.60", sha: sha("1") }, version: "0.24.60" },
  ],
}, null, 2)}\n`;
const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: true, ...extra });
const bot = "github-actions[bot]";

function fakeApi(routes) {
  const calls = [];
  const api = (endpoint) => {
    calls.push(endpoint);
    if (!(endpoint in routes)) return { status: 404, body: "{}" };
    return { status: 200, body: JSON.stringify(routes[endpoint]) };
  };
  return Object.assign(api, { calls });
}

function upstream(status = "ahead") {
  return fakeApi({
    "repos/github/evals/releases?per_page=100&page=1": [release("copilot-evals-v0.24.68"), release("copilot-evals-v0.24.60")],
    "repos/github/evals/commits/copilot-evals-v0.24.68": { sha: sha("2") },
    [`repos/github/evals/compare/${sha("1")}...${sha("2")}`]: { status },
  });
}

test("planner updates only the plugin pin to a newer forward release", () => {
  const plan = planUpdate({ text: marketplace, api: upstream() });
  const entry = JSON.parse(plan.text).plugins[1];
  assert.deepEqual([entry.source.ref, entry.source.sha, entry.version], ["copilot-evals-v0.24.68", sha("2"), "0.24.68"]);
  assert.deepEqual(JSON.parse(plan.text).plugins[0], JSON.parse(marketplace).plugins[0]);
  assert.match(plan.body, new RegExp(`compare/${sha("1")}\\.\\.\\.${sha("2")}`));
  assert.match(plan.title, /copilot-evals-v0\.24\.68/);
});

test("planner keeps prerelease pins in their current channel when a stable release is newer", () => {
  const prereleaseTag = "copilot-evals-v0.24.68";
  const stableTag = "copilot-evals-v1.0.0";
  const api = fakeApi({
    "repos/github/evals/releases?per_page=100&page=1": [
      release(prereleaseTag),
      release(stableTag, { prerelease: false }),
      release("copilot-evals-v0.24.60"),
    ],
    [`repos/github/evals/commits/${prereleaseTag}`]: { sha: sha("2") },
    [`repos/github/evals/commits/${stableTag}`]: { sha: sha("3") },
    [`repos/github/evals/compare/${sha("1")}...${sha("2")}`]: { status: "ahead" },
    [`repos/github/evals/compare/${sha("1")}...${sha("3")}`]: { status: "ahead" },
  });
  const plan = planUpdate({ text: marketplace, api });
  assert.equal(JSON.parse(plan.text).plugins[1].source.ref, prereleaseTag);
});

test("release selection respects channel, numeric ordering, and drafts", () => {
  assert.equal(newestRelease([release("v0.24.9"), release("v0.24.10"), release("v1.0.0", { draft: true })], "v", true).tag_name, "v0.24.10");
  assert.equal(newestRelease([release("v1.0.0"), release("v0.9.0", { prerelease: false })], "v", false).tag_name, "v0.9.0");
});

test("planner blocks unknown channels, failed requests and non-forward commits", () => {
  assert.match(planUpdate({ text: marketplace, api: fakeApi({ "repos/github/evals/releases?per_page=100&page=1": [] }) }).blocked, /channel is unknown/);
  assert.match(planUpdate({ text: marketplace, api: () => ({ status: 403, body: "{}" }) }).blocked, /HTTP 403/);
  assert.match(planUpdate({ text: marketplace, api: () => { throw new Error("network unavailable"); } }).blocked, /network unavailable/);
  for (const status of ["behind", "diverged"]) {
    assert.match(planUpdate({ text: marketplace, api: upstream(status) }).blocked, new RegExp(status));
  }
  assert.match(planUpdate({ text: marketplace, api: upstream("identical") }).blocked, /identical/);
});

test("planner reads every release page and does not downgrade", () => {
  const filler = Array.from({ length: 100 }, (_, index) => release(`other-v0.0.${index}`));
  const api = fakeApi({
    "repos/github/evals/releases?per_page=100&page=1": filler,
    "repos/github/evals/releases?per_page=100&page=2": [release("copilot-evals-v0.24.60"), release("copilot-evals-v0.24.59")],
  });
  assert.equal(planUpdate({ text: marketplace, api }).text, marketplace);
  assert.equal(api.calls.length, 2);
});

test("planner resolves the current tag separately when it is absent from the release listing", () => {
  const api = fakeApi({
    "repos/github/evals/releases?per_page=100&page=1": [release("copilot-evals-v0.24.68")],
    "repos/github/evals/releases/tags/copilot-evals-v0.24.60": release("copilot-evals-v0.24.60"),
    "repos/github/evals/commits/copilot-evals-v0.24.68": { sha: sha("2") },
    [`repos/github/evals/compare/${sha("1")}...${sha("2")}`]: { status: "ahead" },
  });
  assert.equal(JSON.parse(planUpdate({ text: marketplace, api }).text).plugins[1].source.ref, "copilot-evals-v0.24.68");
  assert.ok(api.calls.includes("repos/github/evals/releases/tags/copilot-evals-v0.24.60"));
});

test("blocked update reports its reason without modifying the marketplace", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pin-test-"));
  const previous = process.cwd();
  const saved = { repo: process.env.GITHUB_REPOSITORY, output: process.env.GITHUB_OUTPUT, summary: process.env.GITHUB_STEP_SUMMARY };
  t.after(() => {
    process.chdir(previous);
    for (const [key, value] of Object.entries({ GITHUB_REPOSITORY: saved.repo, GITHUB_OUTPUT: saved.output, GITHUB_STEP_SUMMARY: saved.summary })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  process.chdir(directory);
  process.env.GITHUB_REPOSITORY = "o/r";
  process.env.GITHUB_OUTPUT = join(directory, "output");
  process.env.GITHUB_STEP_SUMMARY = join(directory, "summary");
  writeFileSync("marketplace.json", marketplace);
  const noPrEndpoint = `repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`;
  for (const [sourceApi, reason] of [[fakeApi({ "repos/github/evals/releases?per_page=100&page=1": [] }), /channel is unknown/], [() => ({ status: 403, body: "{}" }), /HTTP 403/], [upstream("diverged"), /diverged/]]) {
    const api = (endpoint) => endpoint === noPrEndpoint ? { status: 200, body: "[]" } : sourceApi(endpoint);
    assert.throws(() => main(["update"], api), reason);
    assert.match(readFileSync(process.env.GITHUB_OUTPUT, "utf8"), /blocked=true/);
    assert.match(readFileSync(process.env.GITHUB_OUTPUT, "utf8"), reason);
    assert.equal(readFileSync("marketplace.json", "utf8"), marketplace);
  }
});

test("publication preserves bot ownership and avoids replacing identical branch", () => {
  const mainSha = sha("3");
  const remote = { sha: sha("4"), tree: sha("5"), parents: [mainSha], aheadBy: 1, behindBy: 0, authors: [bot] };
  assert.equal(planPublish({ main: mainSha, localTree: sha("5"), remote }), "skip");
  for (const change of [
    { tree: sha("6") },
    { aheadBy: 2 },
    { behindBy: 1 },
    { parents: [] },
    { parents: [sha("7")] },
  ]) assert.equal(planPublish({ main: mainSha, localTree: sha("5"), remote: { ...remote, ...change } }), "push");
  assert.throws(() => planPublish({ main: mainSha, localTree: sha("5"), remote: { ...remote, authors: ["human"] } }), /not authored/);
});

test("publication dispatches Validate and leaves auto-merge to the trusted completion gate", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const endpoint = `repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`;
  const mainSha = sha("3"), remoteSha = sha("4"), localHead = sha("6"), localTree = sha("7");
  const pr = { number: 7, user: { login: bot, type: "Bot" }, head: { sha: remoteSha, repo: { full_name: "o/r" } }, base: { ref: "main", repo: { default_branch: "main" } } };
  let pushed = false;
  const api = (path) => {
    if (path === endpoint) return { status: 200, body: JSON.stringify([{ ...pr, head: { ...pr.head, sha: pushed ? localHead : remoteSha } }]) };
    if (path === "repos/o/r/pulls/7") return { status: 200, body: JSON.stringify({ state: "open", head: { sha: remoteSha }, auto_merge: null }) };
    if (path === `repos/o/r/branches/${encodeURIComponent(BRANCH)}`) return { status: 200, body: JSON.stringify({ commit: { sha: remoteSha, commit: { tree: { sha: sha("5") } }, parents: [{ sha: mainSha }] } }) };
    if (path === `repos/o/r/compare/${mainSha}...${remoteSha}`) return { status: 200, body: JSON.stringify({ ahead_by: 1, behind_by: 0, commits: [{ author: { login: bot }, committer: { login: bot } }] }) };
    return { status: 404, body: "{}" };
  };
  const calls = [];
  let headReads = 0;
  const execute = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? (++headReads === 1 ? mainSha : localHead) : localTree;
    if (args[0] === "status") return " M marketplace.json";
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ autoMergeRequest: null });
    if (args[0] === "push") pushed = true;
    return "";
  };
  assert.match(publish(api, "o/r", { title: "update", bodyFile: "body", execute }), /awaiting Validate/);
  const dispatch = calls.findIndex((call) => call[1] === "workflow");
  const merge = calls.findIndex((call) => call[1] === "pr" && call[2] === "merge");
  assert.ok(dispatch >= 0);
  assert.equal(merge, -1);
  assert.deepEqual(calls[dispatch].slice(-2), ["--ref", BRANCH]);
  assert.ok(calls.some((call) => call[1] === "api" && call[4] === "repos/o/r/pulls/7"));
  assert.ok(calls.some((call) => call[1] === "add" && call.at(-1) === "marketplace.json"));
  pushed = false;
  headReads = 0;
  assert.throws(() => publish(api, "o/r", { title: "update", bodyFile: "body", execute: (command, args) => {
    if (args[0] === "workflow") throw new Error("dispatch failed");
    if (args[0] === "pr" && args[1] === "merge") assert.fail("must not enable auto-merge in the publisher");
    return execute(command, args);
  } }), /dispatch failed/);
});

test("publisher dispatches validation without enabling auto-merge when the push is skipped", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const mainSha = sha("3"), remoteSha = sha("4"), tree = sha("5");
  const pr = { number: 7, user: { login: bot, type: "Bot" }, head: { sha: remoteSha, repo: { full_name: "o/r" } }, base: { ref: "main", repo: { default_branch: "main" } } };
  const api = fakeApi({
    [`repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`]: [pr],
    [`repos/o/r/branches/${encodeURIComponent(BRANCH)}`]: { commit: { sha: remoteSha, commit: { tree: { sha: tree } }, parents: [{ sha: mainSha }] } },
    [`repos/o/r/compare/${mainSha}...${remoteSha}`]: { ahead_by: 1, behind_by: 0, commits: [{ author: { login: bot }, committer: { login: bot } }] },
    [validationRunsEndpoint]: { workflow_runs: [] },
  });
  const calls = [];
  publish(api, "o/r", { title: "update", bodyFile: "body", execute: (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? mainSha : tree;
    if (args[0] === "status") return " M marketplace.json";
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ autoMergeRequest: null });
    return "";
  } });
  assert.equal(calls.some((call) => call[1] === "push"), false);
  assert.ok(calls.some((call) => call[1] === "workflow" && call[2] === "run"));
  assert.equal(calls.some((call) => call[1] === "pr" && call[2] === "merge"), false);
});

test("publisher disables auto-merge before pushing a replacement PR head", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const mainSha = sha("3"), remoteSha = sha("4"), remoteTree = sha("5"), localHead = sha("6"), localTree = sha("7");
  const endpoint = `repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`;
  const pr = { number: 7, user: { login: bot, type: "Bot" }, head: { sha: remoteSha, repo: { full_name: "o/r" } }, base: { ref: "main", repo: { default_branch: "main" } } };
  let pushed = false;
  const api = (path) => path === endpoint
    ? { status: 200, body: JSON.stringify([{ ...pr, head: { ...pr.head, sha: pushed ? localHead : remoteSha } }]) }
    : path === "repos/o/r/pulls/7"
      ? { status: 200, body: JSON.stringify({ state: "open", head: { sha: remoteSha }, auto_merge: { enabled_at: "now" } }) }
    : path === `repos/o/r/branches/${encodeURIComponent(BRANCH)}`
      ? { status: 200, body: JSON.stringify({ commit: { sha: remoteSha, commit: { tree: { sha: remoteTree } }, parents: [{ sha: mainSha }] } }) }
      : path === `repos/o/r/compare/${mainSha}...${remoteSha}`
        ? { status: 200, body: JSON.stringify({ ahead_by: 1, behind_by: 0, commits: [{ author: { login: bot }, committer: { login: bot } }] }) }
        : { status: 404, body: "{}" };
  const calls = [];
  let headReads = 0;
  publish(api, "o/r", { title: "update", bodyFile: "body", execute: (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? (++headReads === 1 ? mainSha : localHead) : localTree;
    if (args[0] === "status") return " M marketplace.json";
    if (args[0] === "push") pushed = true;
    return "";
  } });
  const disable = calls.findIndex((call) => call[1] === "pr" && call[2] === "merge" && call.at(-1) === "--disable-auto");
  const push = calls.findIndex((call) => call[1] === "push");
  const dispatch = calls.findIndex((call) => call[1] === "workflow");
  assert.ok(disable >= 0);
  assert.ok(disable < push);
  assert.ok(push < dispatch);
  assert.equal(calls.some((call) => call[1] === "pr" && call[2] === "merge" && call.includes("--auto")), false);
});

test("publisher skips duplicate Validate dispatch for a successfully validated unchanged PR head", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const mainSha = sha("3"), remoteSha = sha("4"), tree = sha("5");
  const pr = { number: 7, state: "open", user: { login: bot, type: "Bot" }, head: { sha: remoteSha, repo: { full_name: "o/r" } }, base: { ref: "main", repo: { default_branch: "main" } } };
  const validationUrl = "https://github.com/o/r/actions/runs/99";
  const api = fakeApi({
    [`repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`]: [pr],
    "repos/o/r/pulls/7": { ...pr, auto_merge: { enabled_at: "now" } },
    [`repos/o/r/branches/${encodeURIComponent(BRANCH)}`]: { commit: { sha: remoteSha, commit: { tree: { sha: tree } }, parents: [{ sha: mainSha }] } },
    [`repos/o/r/compare/${mainSha}...${remoteSha}`]: { ahead_by: 1, behind_by: 0, commits: [{ author: { login: bot }, committer: { login: bot } }] },
    [validationRunsEndpoint]: { workflow_runs: [{ event: "workflow_dispatch", head_branch: BRANCH, head_sha: remoteSha, status: "completed", conclusion: "success", html_url: validationUrl }] },
    [`repos/o/r/commits/${remoteSha}/statuses?per_page=100`]: [{ context: "lint", state: "success", target_url: validationUrl, creator: { login: bot } }],
  });
  const calls = [];
  publish(api, "o/r", { title: "update", bodyFile: "body", execute: (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? mainSha : tree;
    if (args[0] === "status") return " M marketplace.json";
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ autoMergeRequest: null });
    return "";
  } });
  assert.equal(calls.some((call) => call[1] === "workflow" && call[2] === "run"), false);
});

test("publisher retries Validate when completion did not bridge status and enable auto-merge", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const mainSha = sha("3"), remoteSha = sha("4"), tree = sha("5");
  const pr = { number: 7, state: "open", user: { login: bot, type: "Bot" }, head: { sha: remoteSha, repo: { full_name: "o/r" } }, base: { ref: "main", repo: { default_branch: "main" } } };
  const validationUrl = "https://github.com/o/r/actions/runs/99";
  const successfulRun = { event: "workflow_dispatch", head_branch: BRANCH, head_sha: remoteSha, status: "completed", conclusion: "success", html_url: validationUrl };
  const validStatus = { context: "lint", state: "success", target_url: validationUrl, creator: { login: bot } };
  const cases = [
    { autoMerge: null, statuses: [] },
    { autoMerge: { enabled_at: "now" }, statuses: [] },
    { autoMerge: null, statuses: [validStatus] },
    { autoMerge: { enabled_at: "now" }, statuses: [{ ...validStatus, target_url: "https://github.com/o/r/actions/runs/other" }] },
    { autoMerge: { enabled_at: "now" }, statuses: [{ ...validStatus, creator: { login: "human" } }] },
    { autoMerge: { enabled_at: "now" }, statuses: [{ context: "lint", state: "success", creator: { login: bot } }], run: { ...successfulRun, html_url: undefined } },
  ];
  for (const { autoMerge, statuses, run = successfulRun } of cases) {
    const api = fakeApi({
      [`repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`]: [pr],
      "repos/o/r/pulls/7": { ...pr, auto_merge: autoMerge },
      [`repos/o/r/branches/${encodeURIComponent(BRANCH)}`]: { commit: { sha: remoteSha, commit: { tree: { sha: tree } }, parents: [{ sha: mainSha }] } },
      [`repos/o/r/compare/${mainSha}...${remoteSha}`]: { ahead_by: 1, behind_by: 0, commits: [{ author: { login: bot }, committer: { login: bot } }] },
      [validationRunsEndpoint]: { workflow_runs: [run] },
      [`repos/o/r/commits/${remoteSha}/statuses?per_page=100`]: statuses,
    });
    const calls = [];
    publish(api, "o/r", { title: "update", bodyFile: "body", execute: (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === "rev-parse") return args[1] === "HEAD" ? mainSha : tree;
      if (args[0] === "status") return " M marketplace.json";
      return "";
    } });
    assert.ok(calls.some((call) => call[1] === "workflow" && call[2] === "run"), "expected a retry when completion effects are missing");
  }
});

test("publisher selects the newest matching Validate run before inspecting its status", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const mainSha = sha("3"), remoteSha = sha("4"), tree = sha("5");
  const pr = { number: 7, state: "open", user: { login: bot, type: "Bot" }, head: { sha: remoteSha, repo: { full_name: "o/r" } }, base: { ref: "main", repo: { default_branch: "main" } } };
  const validationUrl = "https://github.com/o/r/actions/runs/99";
  const api = fakeApi({
    [`repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`]: [pr],
    "repos/o/r/pulls/7": { ...pr, auto_merge: { enabled_at: "now" } },
    [`repos/o/r/branches/${encodeURIComponent(BRANCH)}`]: { commit: { sha: remoteSha, commit: { tree: { sha: tree } }, parents: [{ sha: mainSha }] } },
    [`repos/o/r/compare/${mainSha}...${remoteSha}`]: { ahead_by: 1, behind_by: 0, commits: [{ author: { login: bot }, committer: { login: bot } }] },
    [validationRunsEndpoint]: { workflow_runs: [
      { event: "workflow_dispatch", head_branch: BRANCH, head_sha: remoteSha, status: "completed", conclusion: "failure", html_url: "https://github.com/o/r/actions/runs/100", created_at: "2026-02-02T00:00:00Z" },
      { event: "workflow_dispatch", head_branch: BRANCH, head_sha: remoteSha, status: "completed", conclusion: "success", html_url: validationUrl, created_at: "2026-02-01T00:00:00Z" },
    ] },
    [`repos/o/r/commits/${remoteSha}/statuses?per_page=100`]: [{ context: "lint", state: "success", target_url: validationUrl, creator: { login: bot } }],
  });
  const calls = [];
  publish(api, "o/r", { title: "update", bodyFile: "body", execute: (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? mainSha : tree;
    if (args[0] === "status") return " M marketplace.json";
    return "";
  } });
  assert.ok(calls.some((call) => call[1] === "workflow" && call[2] === "run"), "a newer failed run must not be masked by an older successful run");
});

test("publisher refuses completed validation reuse if the PR head changed during verification", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const mainSha = sha("3"), remoteSha = sha("4"), tree = sha("5");
  const pr = { number: 7, state: "open", user: { login: bot, type: "Bot" }, head: { sha: remoteSha, repo: { full_name: "o/r" } }, base: { ref: "main", repo: { default_branch: "main" } } };
  const api = fakeApi({
    [`repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`]: [pr],
    "repos/o/r/pulls/7": { ...pr, head: { ...pr.head, sha: sha("a") }, auto_merge: { enabled_at: "now" } },
    [`repos/o/r/branches/${encodeURIComponent(BRANCH)}`]: { commit: { sha: remoteSha, commit: { tree: { sha: tree } }, parents: [{ sha: mainSha }] } },
    [`repos/o/r/compare/${mainSha}...${remoteSha}`]: { ahead_by: 1, behind_by: 0, commits: [{ author: { login: bot }, committer: { login: bot } }] },
    [validationRunsEndpoint]: { workflow_runs: [{ event: "workflow_dispatch", head_branch: BRANCH, head_sha: remoteSha, status: "completed", conclusion: "success", html_url: "https://github.com/o/r/actions/runs/99" }] },
  });
  const calls = [];
  assert.throws(() => publish(api, "o/r", { title: "update", bodyFile: "body", execute: (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? mainSha : tree;
    if (args[0] === "status") return " M marketplace.json";
    return "";
  } }), /changed during completion verification/);
  assert.equal(calls.some((call) => call[1] === "workflow" && call[2] === "run"), false);
});

test("publisher avoids duplicate Validate dispatch while the current-head run is active", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const mainSha = sha("3"), remoteSha = sha("4"), tree = sha("5");
  const pr = { number: 7, user: { login: bot, type: "Bot" }, head: { sha: remoteSha, repo: { full_name: "o/r" } }, base: { ref: "main", repo: { default_branch: "main" } } };
  for (const status of ["queued", "in_progress", "waiting"]) {
    const api = fakeApi({
      [`repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`]: [pr],
      [`repos/o/r/branches/${encodeURIComponent(BRANCH)}`]: { commit: { sha: remoteSha, commit: { tree: { sha: tree } }, parents: [{ sha: mainSha }] } },
      [`repos/o/r/compare/${mainSha}...${remoteSha}`]: { ahead_by: 1, behind_by: 0, commits: [{ author: { login: bot }, committer: { login: bot } }] },
      [validationRunsEndpoint]: { workflow_runs: [{ event: "workflow_dispatch", head_branch: BRANCH, head_sha: remoteSha, status }] },
    });
    const calls = [];
    publish(api, "o/r", { title: "update", bodyFile: "body", execute: (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === "rev-parse") return args[1] === "HEAD" ? mainSha : tree;
      if (args[0] === "status") return " M marketplace.json";
      return "";
    } });
    assert.equal(calls.some((call) => call[1] === "workflow" && call[2] === "run"), false, `unexpected dispatch for ${status} run`);
  }
});

test("publication refuses non-bot PRs", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const endpoint = `repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`;
  assert.throws(() => publish(fakeApi({ [endpoint]: [{ number: 7, user: { login: "human", type: "User" } }] }), "o/r", { title: "update", bodyFile: "body", execute: () => assert.fail("no writes") }), /not the expected/);
});

test("publication refuses duplicate automation PRs", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const endpoint = `repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`;
  const pr = { number: 7, user: { login: bot, type: "Bot" } };
  assert.throws(() => publish(fakeApi({ [endpoint]: [pr, { ...pr, number: 8 }] }), "o/r", {
    title: "update",
    bodyFile: "body",
    execute: () => assert.fail("must not execute with duplicate PRs"),
  }), /More than one open PR/);
});

test("plan reconciles existing plugin PRs unless workflow_dispatch is a dry run", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pin-test-"));
  const previous = process.cwd();
  const env = ["GITHUB_REPOSITORY", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY", "PIN_AUTOMATION_DRY_RUN"];
  const saved = Object.fromEntries(env.map((key) => [key, process.env[key]]));
  t.after(() => {
    process.chdir(previous);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  process.chdir(directory);
  process.env.GITHUB_REPOSITORY = "o/r";
  process.env.GITHUB_OUTPUT = join(directory, "output");
  process.env.GITHUB_STEP_SUMMARY = join(directory, "summary");
  const prListEndpoint = `repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`;
  const pr = {
    number: 7,
    state: "open",
    user: { login: bot, type: "Bot" },
    head: { ref: BRANCH, sha: sha("2"), repo: { full_name: "o/r" } },
    base: { ref: "main", repo: { full_name: "o/r", default_branch: "main" } },
  };
  const currentPr = { ...pr, auto_merge: { enabled_at: "now" } };
  const releasesEndpoint = "repos/github/evals/releases?per_page=100&page=1";
  const runScenario = ({ blocked = false, dryRun = false, headChange } = {}) => {
    writeFileSync("marketplace.json", marketplace);
    writeFileSync(process.env.GITHUB_OUTPUT, "");
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, "");
    process.env.PIN_AUTOMATION_DRY_RUN = String(dryRun);
    const calls = [];
    const requests = [];
    let prReads = 0;
    const api = (endpoint) => {
      requests.push(endpoint);
      if (endpoint === releasesEndpoint) {
        return blocked ? { status: 503, body: "{}" } : { status: 200, body: JSON.stringify([release("copilot-evals-v0.24.60")]) };
      }
      if (endpoint === prListEndpoint) return { status: 200, body: JSON.stringify([pr]) };
      if (endpoint === "repos/o/r/pulls/7") {
        prReads += 1;
        const changed = headChange === "before-disable" || (headChange === "before-close" && prReads > 1);
        const value = changed ? { ...currentPr, head: { ...currentPr.head, sha: sha("a") } } : currentPr;
        return { status: 200, body: JSON.stringify(value) };
      }
      return { status: 404, body: "{}" };
    };
    const execute = (command, args) => { calls.push([command, ...args]); return ""; };
    if (headChange === "before-disable") assert.throws(() => main(["update"], api, execute), /changed during pin-plan reconciliation/);
    else if (headChange === "before-close") assert.throws(() => main(["update"], api, execute), /changed before stale pin-plan cleanup/);
    else if (blocked) assert.throws(() => main(["update"], api, execute), /Pin update blocked/);
    else main(["update"], api, execute);
    return { calls, requests, output: readFileSync(process.env.GITHUB_OUTPUT, "utf8") };
  };

  const unchanged = runScenario();
  assert.ok(unchanged.requests.includes(prListEndpoint));
  assert.ok(unchanged.calls.some((call) => call[1] === "pr" && call[2] === "merge" && call.at(-1) === "--disable-auto"));
  assert.ok(unchanged.calls.some((call) => call[1] === "pr" && call[2] === "close"));

  const blocked = runScenario({ blocked: true });
  assert.match(blocked.output, /blocked=true/);
  assert.ok(blocked.requests.includes(prListEndpoint));
  assert.ok(blocked.calls.some((call) => call[1] === "pr" && call[2] === "merge" && call.at(-1) === "--disable-auto"));
  assert.equal(blocked.calls.some((call) => call[1] === "pr" && call[2] === "close"), false);

  const changedBeforeDisable = runScenario({ headChange: "before-disable" });
  assert.deepEqual(changedBeforeDisable.calls, []);
  const changedBeforeClose = runScenario({ headChange: "before-close" });
  assert.ok(changedBeforeClose.calls.some((call) => call[1] === "pr" && call[2] === "merge" && call.at(-1) === "--disable-auto"));
  assert.equal(changedBeforeClose.calls.some((call) => call[1] === "pr" && call[2] === "close"), false);

  const dryRun = runScenario({ dryRun: true });
  assert.match(dryRun.output, /changed=false/);
  assert.equal(dryRun.requests.includes(prListEndpoint), false);
  assert.deepEqual(dryRun.calls, []);
});

test("publisher rejects missing credentials and does not continue after an upstream API denial", (t) => {
  const savedToken = process.env.GH_TOKEN;
  delete process.env.GH_TOKEN;
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  assert.throws(() => publish(fakeApi({}), "o/r", { title: "update", bodyFile: "body", execute: () => assert.fail("must not execute") }), /GH_TOKEN/);
  process.env.GH_TOKEN = "synthetic-token";
  const endpoint = `repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`;
  const api = (path) => path === endpoint
    ? { status: 200, body: JSON.stringify([]) }
    : path === "repos/o/r" ? { status: 200, body: JSON.stringify({ default_branch: "main" }) }
      : path === `repos/o/r/branches/${encodeURIComponent(BRANCH)}` ? { status: 403, body: "{}" }
        : { status: 404, body: "{}" };
  assert.throws(() => publish(api, "o/r", {
    title: "update",
    bodyFile: "body",
    execute: (command, args) => args[0] === "rev-parse" ? sha("3") : assert.fail("must stop before writes"),
  }), /HTTP 403/);
});

test("CLI rejects missing repository configuration and unsupported commands", () => {
  const savedRepo = process.env.GITHUB_REPOSITORY;
  try {
    delete process.env.GITHUB_REPOSITORY;
    assert.throws(() => main(["unknown"]), /GITHUB_REPOSITORY/);
    process.env.GITHUB_REPOSITORY = "o/r";
    assert.throws(() => main(["unknown"]), /Usage:/);
  } finally {
    if (savedRepo === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = savedRepo;
  }
  const result = spawnSync(process.execPath, [resolve(root, ".github/scripts/update-pins.mjs"), "unknown"], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REPOSITORY: "o/r" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /::error::Usage:/);
});

test("publication creates one PR and fails closed if creation fails", (t) => {
  const savedToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "synthetic-token";
  t.after(() => { if (savedToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedToken; });
  const endpoint = `repos/o/r/pulls?state=open&head=o:${encodeURIComponent(BRANCH)}`;
  const pr = { number: 7, user: { login: bot, type: "Bot" }, head: { sha: sha("3"), repo: { full_name: "o/r" } }, base: { ref: "main", repo: { default_branch: "main" } } };
  let created = false;
  const api = (path) => path === endpoint
    ? { status: 200, body: JSON.stringify(created ? [pr] : []) }
    : path === "repos/o/r" ? { status: 200, body: JSON.stringify({ default_branch: "main" }) }
      : { status: 404, body: "{}" };
  const calls = [];
  const execute = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "rev-parse") return sha("3");
    if (args[0] === "status") return " M marketplace.json";
    if (args[0] === "pr" && args[1] === "create") created = true;
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ autoMergeRequest: null });
    return "";
  };
  publish(api, "o/r", { title: "update", bodyFile: "body", execute });
  assert.equal(calls.filter((call) => call[1] === "pr" && call[2] === "create").length, 1);
  assert.ok(calls.findIndex((call) => call[1] === "workflow") > calls.findIndex((call) => call[1] === "pr" && call[2] === "create"));
  created = false;
  assert.throws(() => publish(api, "o/r", { title: "update", bodyFile: "body", execute: (command, args) => {
    if (args[0] === "pr" && args[1] === "create") throw new Error("creation failed");
    if (args[0] === "workflow" || (args[0] === "pr" && args[1] === "merge")) assert.fail("must not dispatch or merge after failed creation");
    return execute(command, args);
  } }), /creation failed/);
});

test("workflow is canonical-only, keyless, and dry-run by default", () => {
  const workflow = parse(readFileSync(resolve(root, ".github/workflows/update-pins.yml"), "utf8"));
  assert.deepEqual(Object.keys(workflow.jobs), ["update"]);
  assert.deepEqual(workflow.permissions, { contents: "write", "pull-requests": "write", actions: "write" });
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.default, true);
  assert.equal(workflow.on.workflow_run, undefined);
  const condition = workflow.jobs.update.if;
  const allowed = (repo, event, enabled) => Boolean(runInNewContext(condition, { github: { repository: repo, event_name: event }, vars: { PIN_AUTOMATION: enabled } }));
  assert.equal(allowed("github/plugin-marketplace-starter", "schedule", "true"), true);
  assert.equal(allowed("github/plugin-marketplace-starter", "schedule", "false"), false);
  assert.equal(allowed("github/plugin-marketplace-starter", "workflow_dispatch", "false"), true);
  assert.equal(allowed("other/template", "workflow_dispatch", "true"), false);
  const planStep = workflow.jobs.update.steps.find((step) => step.id === "plan");
  assert.equal(planStep.env.PIN_AUTOMATION_DRY_RUN, "${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}");
  const text = JSON.stringify(workflow);
  assert.doesNotMatch(text, /secrets\.|create-github-app-token|environment|enqueue/);
  assert.match(text, /inputs\.dry_run/);
});

test("Dependabot is restricted and grouped for evals-action", () => {
  const config = parse(readFileSync(resolve(root, ".github/dependabot.yml"), "utf8"));
  assert.deepEqual(config.updates, [{ "package-ecosystem": "github-actions", directory: "/", schedule: { interval: "daily" }, allow: [{ "dependency-name": "github/evals-action" }], groups: { "evals-action": { patterns: ["github/evals-action"] } } }]);
  const comparison = readFileSync(resolve(root, ".github/workflows/skill-eval-comparison.yml"), "utf8");
  assert.equal([...comparison.matchAll(/uses: github\/evals-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/g)].length, 3);
});

test("comparison cancels superseded PR runs without cancelling manual runs or the serialized report", () => {
  const workflow = parse(readFileSync(resolve(root, ".github/workflows/skill-eval-comparison.yml"), "utf8"));
  assert.equal(workflow.concurrency, undefined);
  for (const job of ["select", "run-baseline", "run"]) {
    const concurrency = workflow.jobs[job].concurrency;
    const expression = concurrency["cancel-in-progress"].replace(/^\$\{\{\s*|\s*\}\}$/g, "");
    assert.equal(Boolean(runInNewContext(expression, { github: { event_name: "pull_request" } })), true);
    assert.equal(Boolean(runInNewContext(expression, { github: { event_name: "workflow_dispatch" } })), false);
  }
  assert.match(workflow.jobs.report.if, /needs\.run-baseline\.result != 'cancelled'/);
  assert.match(workflow.jobs.report.if, /needs\.run\.result != 'cancelled'/);
  assert.equal(workflow.jobs.report.concurrency["cancel-in-progress"], false);
});
