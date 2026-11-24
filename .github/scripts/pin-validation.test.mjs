import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { completePinValidation } from "./pin-validation.mjs";

const repo = "github/plugin-marketplace-starter";
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const oldPinSha = "c".repeat(40);
const newPinSha = "d".repeat(40);
const branch = "dependabot/github_actions/github/evals-action-v0.2.1";
const workflowPath = ".github/workflows/validate.yml";
const actionFile = {
  filename: ".github/workflows/skill-eval-comparison.yml",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: `@@ -1 +1 @@\n-      - uses: github/evals-action@${oldPinSha} # v0.2.0\n+      - uses: github/evals-action@${newPinSha} # v0.2.1`,
};
const beforeMarketplace = {
  plugins: [{
    name: "eval",
    source: { source: "github", repo: "github/evals", path: "packages/plugin", ref: "copilot-evals-v0.24.60", sha: oldPinSha },
    version: "0.24.60",
  }],
};
const afterMarketplace = structuredClone(beforeMarketplace);
afterMarketplace.plugins[0].source.ref = "copilot-evals-v0.24.68";
afterMarketplace.plugins[0].source.sha = newPinSha;
afterMarketplace.plugins[0].version = "0.24.68";

function fixture({ kind = "action", change = {}, failStatus = false } = {}) {
  const isPlugin = kind === "plugin";
  const prBranch = isPlugin ? "automation/update-plugin-pin" : branch;
  const author = isPlugin ? "github-actions[bot]" : "dependabot[bot]";
  const pr = {
    state: "open",
    draft: false,
    number: 42,
    changed_files: isPlugin ? 1 : 1,
    user: { login: author, type: "Bot" },
    head: { ref: prBranch, sha: headSha, repo: { full_name: repo } },
    base: { ref: "main", sha: baseSha, repo: { full_name: repo, default_branch: "main" } },
  };
  const activePr = change.pr ?? pr;
  const workflowRun = {
    workflow_id: 77,
    path: workflowPath,
    status: "completed",
    conclusion: "success",
    event: isPlugin ? "workflow_dispatch" : "pull_request",
    repository: { full_name: repo },
    head_repository: { full_name: repo },
    head_branch: prBranch,
    head_sha: headSha,
    html_url: "https://github.com/github/plugin-marketplace-starter/actions/runs/99",
  };
  const routes = {
    [`repos/${repo}/actions/workflows/validate.yml`]: { id: 77, path: workflowPath },
    [`repos/${repo}/actions/runs/99`]: workflowRun,
    [`repos/${repo}/actions/runs/99/jobs?per_page=100&page=1`]: { jobs: [{ name: "lint", conclusion: "success" }] },
    [`repos/${repo}`]: { default_branch: "main" },
    [`repos/${repo}/pulls?state=open&head=github:${encodeURIComponent(prBranch)}`]: change.noPr ? [] : change.multiplePrs ? [activePr, { ...activePr, number: 43 }] : [activePr],
    [`repos/${repo}/pulls/42`]: activePr,
    [`repos/${repo}/commits/${headSha}`]: { author: { login: author }, committer: { login: author } },
    [`repos/${repo}/pulls/42/files?per_page=100&page=1`]: isPlugin ? [{ filename: "marketplace.json", status: "modified" }] : [actionFile],
    "repos/github/evals-action/commits/v0.2.1": { sha: newPinSha },
    [`repos/github/evals-action/compare/${oldPinSha}...${newPinSha}`]: { status: "ahead" },
    [`repos/github/evals/commits/copilot-evals-v0.24.68`]: { sha: newPinSha },
    [`repos/github/evals/compare/${oldPinSha}...${newPinSha}`]: { status: "ahead" },
    [`repos/${repo}/contents/marketplace.json?ref=${baseSha}`]: beforeMarketplace,
    [`repos/${repo}/contents/marketplace.json?ref=${headSha}`]: afterMarketplace,
  };
  const calls = [];
  const api = (path) => {
    let data = routes[path];
    if (path === `repos/${repo}/pulls/42` && change.staleHead) {
      data = { ...pr, head: { ...pr.head, sha: oldPinSha } };
    }
    if (path === `repos/${repo}/actions/runs/99` && change.run) data = { ...workflowRun, ...change.run };
    if (path === `repos/${repo}/actions/runs/99/jobs?per_page=100&page=1` && change.jobs) data = change.jobs;
    if (path === `repos/${repo}/commits/${headSha}` && change.commit) data = change.commit;
    if (path === `repos/${repo}/pulls/42/files?per_page=100&page=1` && change.files) data = change.files;
    if (path === "repos/github/evals-action/compare/" + oldPinSha + "..." + newPinSha && change.comparison) data = change.comparison;
    if (path === "repos/github/evals-action/commits/v0.2.1" && change.resolved) data = { sha: change.resolved };
    if (path === `repos/${repo}/contents/marketplace.json?ref=${headSha}` && change.marketplace) data = change.marketplace;
    if (data === undefined) return { status: 404, body: "{}" };
    return { status: 200, body: JSON.stringify(data) };
  };
  const execute = (command, args) => {
    calls.push([command, ...args]);
    if (failStatus && args[0] === "api" && args[1] === "--method") throw new Error("status write denied");
    return "";
  };
  return { api, calls, execute };
}

test("enables Dependabot auto-merge only after successful Validate and forward action pins", () => {
  const f = fixture();
  completePinValidation({ repo, runId: 99, ...f });
  assert.deepEqual(f.calls, [["gh", "pr", "merge", "42", "-R", repo, "--auto", "--squash", "--match-head-commit", headSha]]);
});

test("publishes GitHub Actions lint status for plugin dispatch before enabling exact-head auto-merge", () => {
  const f = fixture({ kind: "plugin" });
  completePinValidation({ repo, runId: 99, ...f });
  const runUrl = JSON.parse(f.api(`repos/${repo}/actions/runs/99`).body).html_url;
  assert.deepEqual(f.calls, [
    ["gh", "api", "--method", "POST", `repos/${repo}/statuses/${headSha}`, "-f", "state=success", "-f", "context=lint", "-f", `target_url=${runUrl}`, "-f", "description=Validate passed for the exact plugin pin PR head."],
    ["gh", "pr", "merge", "42", "-R", repo, "--auto", "--squash", "--match-head-commit", headSha],
  ]);
});

test("requires exact workflow provenance, successful jobs, the automation author, and current PR head", () => {
  const invalidCases = [
    { repo: "other/repository" },
    { run: { workflow_id: 78 } },
    { run: { path: "untrusted.yml" } },
    { commit: { author: { login: "human" }, committer: { login: "human" } } },
    { jobs: { jobs: [{ name: "lint", conclusion: "failure" }] } },
    { staleHead: true },
  ];
  for (const change of invalidCases) {
    const f = fixture({ change });
    assert.throws(() => completePinValidation({ repo: change.repo ?? repo, runId: 99, ...f }));
    assert.deepEqual(f.calls, []);
  }
  assert.throws(() => completePinValidation({ repo, runId: "not-a-number", ...fixture() }), /workflow run ID/);
  const invalidPath = fixture();
  assert.throws(() => completePinValidation({ repo, runId: 99, ...invalidPath, api: (path) =>
    path === `repos/${repo}/actions/workflows/validate.yml`
      ? { status: 200, body: JSON.stringify({ id: 77, path: "untrusted.yml" }) }
      : invalidPath.api(path) }), /Unexpected Validate workflow path/);
});

test("ignores unrelated, stale, and absent PR runs without mutation", () => {
  const samplePr = JSON.parse(fixture().api(`repos/${repo}/pulls/42`).body);
  const cases = [
    { run: { event: "push" } },
    { run: { status: "in_progress" } },
    { run: { conclusion: "failure" } },
    { run: { head_repository: { full_name: "attacker/fork" } } },
    { run: { head_sha: "malformed" } },
    { noPr: true },
    { pr: { ...samplePr, user: { login: "someone", type: "User" } } },
    { pr: { ...samplePr, head: { ref: branch, sha: oldPinSha, repo: { full_name: repo } } } },
  ];
  for (const change of cases) {
    const f = fixture({ change });
    const result = completePinValidation({ repo, runId: 99, ...f });
    assert.match(result, /Skipped/);
    assert.deepEqual(f.calls, []);
  }
  const multiple = fixture({ change: { multiplePrs: true } });
  assert.throws(() => completePinValidation({ repo, runId: 99, ...multiple }), /More than one open PR/);
  assert.deepEqual(multiple.calls, []);
});

test("rejects untrusted action PRs, malformed edits, invalid tags, and non-forward pins", () => {
  const secondFile = {
    ...actionFile,
    filename: ".github/workflows/evals.yml",
    patch: actionFile.patch.replace(".github/workflows/skill-eval-comparison.yml", ".github/workflows/evals.yml"),
  };
  const invalid = [
    { files: [{ ...actionFile, filename: "marketplace.json" }] },
    { files: [{ ...actionFile, patch: `${actionFile.patch}\n+      - run: malicious` }] },
    { files: [{ ...actionFile, patch: undefined }] },
    { files: [{ ...actionFile, additions: 2 }] },
    { files: [{ ...actionFile, patch: actionFile.patch.replace("v0.2.1", "v0.1.9") }] },
    { files: [{ ...actionFile, patch: actionFile.patch.replace("v0.2.1", "v0.2.0") }] },
    { files: [{ ...actionFile, patch: actionFile.patch.replace("v0.2.1", "v0.2.1-rc.1") }] },
    { resolved: oldPinSha },
    { comparison: { status: "behind" } },
    { files: [actionFile, { ...secondFile, patch: secondFile.patch.replace(newPinSha, "e".repeat(40)) }], pr: { ...JSON.parse(fixture().api(`repos/${repo}/pulls/42`).body), changed_files: 2 } },
  ];
  for (const change of invalid) {
    const f = fixture({ change });
    assert.throws(() => completePinValidation({ repo, runId: 99, ...f }));
    assert.deepEqual(f.calls, []);
  }
  const grouped = fixture({ change: { files: [actionFile, secondFile], pr: { ...JSON.parse(fixture().api(`repos/${repo}/pulls/42`).body), changed_files: 2 } } });
  completePinValidation({ repo, runId: 99, ...grouped });
  assert.equal(grouped.calls.filter((call) => call[1] === "pr" && call[2] === "merge").length, 1);
});

test("rejects plugin PRs that alter anything beyond the verified forward pin", () => {
  const badMarketplace = structuredClone(afterMarketplace);
  badMarketplace.plugins[0].description = "unexpected";
  const badPin = structuredClone(afterMarketplace);
  badPin.plugins[0].source.ref = "unknown";
  const lowerVersionPin = structuredClone(afterMarketplace);
  lowerVersionPin.plugins[0].source.ref = "copilot-evals-v0.24.59";
  lowerVersionPin.plugins[0].version = "0.24.59";
  const sameCommit = structuredClone(afterMarketplace);
  sameCommit.plugins[0].source.sha = oldPinSha;
  for (const [marketplace, match] of [
    [badMarketplace, /more than the github\/evals release pin/],
    [badPin, /matching release tag/],
    [lowerVersionPin, /did not advance/],
    [sameCommit, /did not advance/],
  ]) {
    const f = fixture({ kind: "plugin", change: { marketplace } });
    assert.throws(() => completePinValidation({ repo, runId: 99, ...f }), match);
    assert.deepEqual(f.calls, []);
  }
});

test("stops if status publication fails and does not enqueue a merge", () => {
  const f = fixture({ kind: "plugin", failStatus: true });
  assert.throws(() => completePinValidation({ repo, runId: 99, ...f }), /status write denied/);
  assert.equal(f.calls.some((call) => call[1] === "pr" && call[2] === "merge"), false);
});

test("workflow runs trusted default-branch code with scoped permissions", () => {
  const workflow = parse(readFileSync(new URL("../workflows/complete-pin-validation.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on.workflow_run, { workflows: ["Validate"], types: ["completed"] });
  assert.deepEqual(workflow.permissions, { actions: "read", contents: "write", "pull-requests": "write", statuses: "write" });
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.match(workflow.jobs.validate.if, /github\.repository == 'github\/plugin-marketplace-starter'/);
  assert.match(workflow.jobs.validate.if, /vars\.PIN_AUTOMATION == 'true'/);
  const checkout = workflow.jobs.validate.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ github.event.repository.default_branch }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(workflow.jobs.validate.steps.at(-1).run, "node .github/scripts/pin-validation.mjs");
});
