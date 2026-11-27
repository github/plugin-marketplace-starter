import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { runInNewContext } from "node:vm";
import { completePinValidation, verifyCurrentPinPr } from "./pin-validation.mjs";

const repo = "github/plugin-marketplace-starter";
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const oldPinSha = "c".repeat(40);
const newPinSha = "d".repeat(40);
const branch = "dependabot/github_actions/evals-action-a1b2c3d4e5";
const workflowPath = ".github/workflows/validate.yml";
const actionReleaseEndpoint = "repos/github/evals-action/releases/tags/v0.2.1";
const currentReleaseEndpoint = "repos/github/evals/releases/tags/copilot-evals-v0.24.60";
const nextReleaseEndpoint = "repos/github/evals/releases/tags/copilot-evals-v0.24.68";
const marketplaceFile = (value) => `${JSON.stringify(value, null, 2)}\n`;
const actionFile = {
  filename: ".github/workflows/skill-eval-comparison.yml",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: `@@ -1 +1 @@\n-      - uses: github/evals-action@${oldPinSha} # v0.2.0\n+      - uses: github/evals-action@${newPinSha} # v0.2.1`,
};
const movedActionFile = {
  ...actionFile,
  patch: `@@ -1,4 +1,4 @@
      - name: previous step
        run: echo ok
-      - uses: github/evals-action@${oldPinSha} # v0.2.0
         continue-on-error: true
+      - uses: github/evals-action@${newPinSha} # v0.2.1`,
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
  const prBranch = isPlugin ? "automation/update-plugin-pin" : change.branch ?? branch;
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
  const listedPr = { ...activePr };
  delete listedPr.changed_files;
  const commit = isPlugin
    ? { author: { login: author }, committer: { login: author } }
    : { author: { login: author }, committer: { login: "web-flow" }, commit: { verification: { verified: true, reason: "valid" } } };
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
    [`repos/${repo}/pulls?state=open&head=github:${encodeURIComponent(prBranch)}`]: change.noPr ? [] : change.multiplePrs ? [listedPr, { ...listedPr, number: 43 }] : [listedPr],
    [`repos/${repo}/pulls/42`]: activePr,
    [`repos/${repo}/commits/${headSha}`]: commit,
    [`repos/${repo}/pulls/42/files?per_page=100&page=1`]: isPlugin ? [{ filename: "marketplace.json", status: "modified" }] : [actionFile],
    "repos/github/evals-action/commits/v0.2.1": { sha: newPinSha },
    [actionReleaseEndpoint]: { tag_name: "v0.2.1", draft: false, prerelease: false },
    [`repos/github/evals-action/compare/${oldPinSha}...${newPinSha}`]: { status: "ahead" },
    [`repos/github/evals/commits/copilot-evals-v0.24.68`]: { sha: newPinSha },
    [currentReleaseEndpoint]: { tag_name: "copilot-evals-v0.24.60", draft: false, prerelease: true },
    [nextReleaseEndpoint]: { tag_name: "copilot-evals-v0.24.68", draft: false, prerelease: true },
    [`repos/github/evals/compare/${oldPinSha}...${newPinSha}`]: { status: "ahead" },
    [`repos/${repo}/contents/marketplace.json?ref=${baseSha}`]: marketplaceFile(beforeMarketplace),
    [`repos/${repo}/contents/marketplace.json?ref=${headSha}`]: marketplaceFile(afterMarketplace),
  };
  const calls = [];
  const api = (path) => {
    let data = routes[path];
    if (path === `repos/${repo}/pulls/42` && change.staleHead) {
      data = { ...pr, head: { ...pr.head, sha: oldPinSha } };
    }
    if (path === `repos/${repo}/pulls/42` && change.autoMerge !== undefined) {
      data = { ...data, auto_merge: change.autoMerge };
    }
    if (path === `repos/${repo}/actions/runs/99` && change.run) data = { ...workflowRun, ...change.run };
    if (path === `repos/${repo}/actions/runs/99/jobs?per_page=100&page=1` && change.jobs) data = change.jobs;
    if (path === `repos/${repo}/commits/${headSha}` && change.commit) data = change.commit;
    if (path === `repos/${repo}/pulls/42/files?per_page=100&page=1` && change.files) data = change.files;
    if (path === actionReleaseEndpoint && change.actionRelease) data = change.actionRelease;
    if (path === currentReleaseEndpoint && change.currentRelease) data = change.currentRelease;
    if (path === nextReleaseEndpoint && change.nextRelease) data = change.nextRelease;
    if (path === change.releaseFailure?.endpoint) return { status: change.releaseFailure.status, body: "{}" };
    if (path === "repos/github/evals-action/compare/" + oldPinSha + "..." + newPinSha && change.comparison) data = change.comparison;
    if (path === "repos/github/evals-action/commits/v0.2.1" && change.resolved) data = { sha: change.resolved };
    if (path === `repos/${repo}/contents/marketplace.json?ref=${headSha}` && change.marketplace) data = marketplaceFile(change.marketplace);
    if (path === `repos/${repo}/contents/marketplace.json?ref=${headSha}` && change.marketplaceText) data = change.marketplaceText;
    if (path === `repos/${repo}/contents/marketplace.json?ref=${headSha}` && change.marketplaceFailure) {
      return { status: change.marketplaceFailure, body: "unavailable" };
    }
    if (data === undefined) return { status: 404, body: "{}" };
    return { status: 200, body: typeof data === "string" ? data : JSON.stringify(data) };
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

test("Validate verifies current action and plugin heads before the required lint job can pass", () => {
  const action = fixture();
  assert.match(verifyCurrentPinPr({
    repo,
    event: "pull_request",
    prNumber: 42,
    branch,
    headSha,
    ...action,
  }), /Validated action pin PR #42/);
  assert.deepEqual(action.calls, []);

  const plugin = fixture({ kind: "plugin" });
  assert.match(verifyCurrentPinPr({
    repo,
    event: "workflow_dispatch",
    branch: "automation/update-plugin-pin",
    headSha,
    ...plugin,
  }), /Validated plugin pin PR #42/);
  assert.deepEqual(plugin.calls, []);

  const unavailable = fixture({ kind: "plugin", change: { marketplaceFailure: 503 } });
  assert.throws(() => verifyCurrentPinPr({
    repo,
    event: "workflow_dispatch",
    branch: "automation/update-plugin-pin",
    headSha,
    ...unavailable,
  }), /HTTP 503/);
  assert.deepEqual(unavailable.calls, []);
});

test("allows published action prereleases through required validation without enabling auto-merge", () => {
  const prerelease = {
    actionRelease: { tag_name: "v0.2.1", draft: false, prerelease: true },
  };
  const f = fixture({ change: prerelease });
  assert.match(verifyCurrentPinPr({
    repo,
    event: "pull_request",
    prNumber: 42,
    branch,
    headSha,
    ...f,
  }), /Validated action pin PR #42/);
  assert.match(completePinValidation({ repo, runId: 99, ...f }), /not eligible for auto-merge/);
  assert.deepEqual(f.calls, []);

  const previouslyEnabled = fixture({ change: {
    ...prerelease,
    autoMerge: { enabled_by: { login: "github-actions[bot]" } },
  } });
  assert.match(completePinValidation({ repo, runId: 99, ...previouslyEnabled }), /not eligible for auto-merge/);
  assert.deepEqual(previouslyEnabled.calls, [
    ["gh", "pr", "merge", "42", "-R", repo, "--disable-auto"],
  ]);
});

test("Validate verifies both pin branches under either PR or dispatch events", () => {
  const workflow = parse(readFileSync(new URL("../workflows/validate.yml", import.meta.url), "utf8"));
  for (const event of ["pull_request", "workflow_dispatch"]) {
    for (const kind of ["action", "plugin"]) {
      const prBranch = kind === "plugin" ? "automation/update-plugin-pin" : branch;
      const github = { repository: repo, event_name: event, head_ref: event === "pull_request" ? prBranch : "", ref_name: event === "pull_request" ? "42/merge" : prBranch };
      const allowed = (values) => Boolean(runInNewContext(workflow.jobs["validate-pin"].if, {
        github: values, startsWith: (text, prefix) => text.startsWith(prefix),
      }));
      assert.equal(allowed(github), true, `${event} on ${kind}`);
      assert.equal(allowed({ ...github, repository: "other/template" }), false);
      assert.equal(allowed({ ...github, event_name: "push" }), false);
      assert.equal(allowed({ ...github, head_ref: "feature", ref_name: "feature" }), false);
      assert.match(verifyCurrentPinPr({
        repo, event, branch: prBranch, headSha, prNumber: event === "pull_request" ? 42 : undefined,
        ...fixture({ kind }),
      }), new RegExp(`Validated ${kind} pin PR #42`));
      assert.throws(() => verifyCurrentPinPr({
        repo, event, branch: prBranch, headSha, prNumber: event === "pull_request" ? 42 : undefined,
        ...fixture({ kind, change: { staleHead: true } }),
      }), /head doesn't match/);
      // Cross-event runs (for example a UI branch update or a manual dispatch) must not pass lint on an unverified head.
      assert.throws(() => verifyCurrentPinPr({
        repo, event, branch: prBranch, headSha, prNumber: event === "pull_request" ? 42 : undefined,
        ...fixture({ kind, change: { commit: { author: { login: "human" }, committer: { login: "web-flow" }, commit: { verification: { verified: true } } } } }),
      }), /expected verified automation identity/);
      const otherBranch = kind === "plugin" ? branch : "automation/update-plugin-pin";
      assert.throws(() => verifyCurrentPinPr({
        repo, event, branch: otherBranch, headSha, prNumber: event === "pull_request" ? 42 : undefined,
        ...fixture({ kind }),
      }));
    }
  }
});

test("read-only pin validation rejects stale, malformed, or untrusted PR inputs", () => {
  const stale = fixture({ change: { staleHead: true } });
  assert.throws(() => verifyCurrentPinPr({
    repo,
    event: "pull_request",
    prNumber: 42,
    branch,
    headSha,
    ...stale,
  }), /head doesn't match/);
  assert.deepEqual(stale.calls, []);

  const untrusted = fixture({ change: { pr: {
    ...JSON.parse(fixture().api(`repos/${repo}/pulls/42`).body),
    user: { login: "someone", type: "User" },
  } } });
  assert.throws(() => verifyCurrentPinPr({
    repo,
    event: "pull_request",
    prNumber: 42,
    branch,
    headSha,
    ...untrusted,
  }), /expected automation identity/);
  assert.deepEqual(untrusted.calls, []);

  assert.throws(() => verifyCurrentPinPr({
    repo,
    event: "pull_request",
    prNumber: 42,
    branch: "dependabot/github_actions/evals-action-a1b2c3d4e",
    headSha,
    ...fixture(),
  }), /Unexpected Dependabot action-pin branch/);
  assert.match(verifyCurrentPinPr({
    repo,
    event: "pull_request",
    prNumber: 42,
    branch: "dependabot/github_actions/setup-node-1a2b3c4d5e",
    headSha,
    ...fixture(),
  }), /Skipped/);
});

test("revalidates both plugin releases and their channel before enabling auto-merge", () => {
  const invalidCases = [
    { currentRelease: { tag_name: "copilot-evals-v0.24.60", draft: true, prerelease: true } },
    { nextRelease: { tag_name: "copilot-evals-v0.24.68", draft: true, prerelease: true } },
    { currentRelease: { tag_name: "copilot-evals-v0.24.60", draft: false, prerelease: false } },
    { nextRelease: { tag_name: "copilot-evals-v0.24.68", draft: false, prerelease: false } },
    { currentRelease: { tag_name: "copilot-evals-v0.24.59", draft: false, prerelease: true } },
    { releaseFailure: { endpoint: currentReleaseEndpoint, status: 404 } },
    { releaseFailure: { endpoint: nextReleaseEndpoint, status: 503 } },
  ];
  for (const change of invalidCases) {
    const f = fixture({ kind: "plugin", change });
    assert.throws(() => completePinValidation({ repo, runId: 99, ...f }));
    assert.deepEqual(f.calls, []);
  }
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
    { run: { head_sha: "malformed" } },
    { run: { head_branch: "dependabot/github_actions/github/evals-action-v0.2.1" } },
    { run: { head_branch: "dependabot/github_actions/evals-action-a1b2c3d4e" } },
    { run: { head_branch: "dependabot/github_actions/evals-action-a1b2c3d4e5-extra" } },
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

test("accepts web-flow as Dependabot committer only for a verified commit", () => {
  const f = fixture({ change: { commit: {
    author: { login: "dependabot[bot]" },
    committer: { login: "web-flow" },
    commit: { verification: { verified: false, reason: "unsigned" } },
  } } });
  assert.throws(() => completePinValidation({ repo, runId: 99, ...f }), /verified/);
  assert.deepEqual(f.calls, []);
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

test("rejects action pin replacements that move step settings", () => {
  const f = fixture({ change: { files: [movedActionFile] } });
  assert.throws(() => completePinValidation({ repo, runId: 99, ...f }), /in-place/);
  assert.deepEqual(f.calls, []);
});

test("rejects draft, unknown-channel, or mismatched action releases", () => {
  const invalidCases = [
    { actionRelease: { tag_name: "v0.2.1", draft: true, prerelease: false } },
    { actionRelease: { tag_name: "v0.2.1", draft: false } },
    { actionRelease: { tag_name: "v0.2.1", draft: false, prerelease: "true" } },
    { actionRelease: { tag_name: "v0.2.0", draft: false, prerelease: false } },
    { releaseFailure: { endpoint: actionReleaseEndpoint, status: 404 } },
  ];
  for (const change of invalidCases) {
    const f = fixture({ change });
    assert.throws(() => completePinValidation({ repo, runId: 99, ...f }), /release|HTTP 404/i);
    assert.deepEqual(f.calls, []);
  }
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

test("rejects noncanonical marketplace JSON with duplicate properties", () => {
  const canonical = `${JSON.stringify(afterMarketplace, null, 2)}\n`;
  const duplicate = canonical.replace(
    '      "version": "0.24.68"\n',
    '      "version": "0.24.68",\n      "version": "0.24.68"\n',
  );
  assert.notEqual(duplicate, canonical);
  assert.deepEqual(JSON.parse(duplicate), afterMarketplace);
  const f = fixture({ kind: "plugin", change: { marketplaceText: duplicate } });
  assert.throws(() => completePinValidation({ repo, runId: 99, ...f }), /canonical/i);
  assert.deepEqual(f.calls, []);
});

test("stops if status publication fails and does not enqueue a merge", () => {
  const f = fixture({ kind: "plugin", failStatus: true });
  assert.throws(() => completePinValidation({ repo, runId: 99, ...f }), /status write denied/);
  assert.equal(f.calls.some((call) => call[1] === "pr" && call[2] === "merge"), false);
});

test("workflow runs trusted default-branch code with scoped permissions", () => {
  const workflow = parse(readFileSync(new URL("../workflows/complete-pin-validation.yml", import.meta.url), "utf8"));
  const publisher = parse(readFileSync(new URL("../workflows/update-pins.yml", import.meta.url), "utf8"));
  const validate = parse(readFileSync(new URL("../workflows/validate.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on.workflow_run, { workflows: ["Validate"], types: ["completed"] });
  assert.deepEqual(workflow.permissions, { actions: "read", contents: "write", "pull-requests": "write", statuses: "write" });
  assert.match(workflow.concurrency.group, /github\.event\.workflow_run\.head_branch == 'automation\/update-plugin-pin'/);
  assert.match(workflow.concurrency.group, /format\('complete-pin-validation-\{0\}', github\.event\.workflow_run\.id\)/);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(publisher.concurrency, { group: "update-plugin-pin", "cancel-in-progress": false });
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.match(workflow.jobs.validate.if, /github\.repository == 'github\/plugin-marketplace-starter'/);
  assert.match(workflow.jobs.validate.if, /vars\.PIN_AUTOMATION == 'true'/);
  const checkout = workflow.jobs.validate.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ github.event.repository.default_branch }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(workflow.jobs.validate.steps.at(-1).run, "node .github/scripts/pin-validation.mjs");

  const pinJob = validate.jobs["validate-pin"];
  assert.match(pinJob.if, /github\.repository == 'github\/plugin-marketplace-starter'/);
  assert.deepEqual(pinJob.permissions, { contents: "read", "pull-requests": "read" });
  const pinCheckout = pinJob.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(pinCheckout.with.ref, "${{ github.event.repository.default_branch }}");
  assert.equal(pinCheckout.with["persist-credentials"], false);
  assert.equal(pinJob.steps.at(-1).run, "node .github/scripts/pin-validation.mjs verify-current-pr");
  assert.equal(validate.jobs.lint.needs, "validate-pin");
  assert.equal(validate.jobs.lint.if, "${{ !cancelled() }}");
  assert.match(validate.jobs.lint.steps[0].if, /needs\.validate-pin\.result/);
});
