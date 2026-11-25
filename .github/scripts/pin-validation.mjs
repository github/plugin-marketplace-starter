import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubApi } from "./check-remote-pins.mjs";

const canonical = "github/plugin-marketplace-starter";
const pluginBranch = "automation/update-plugin-pin";
const actionBranch = /^dependabot\/github_actions\/evals-action-[0-9a-f]{10}$/;
const actionFiles = new Set([".github/workflows/evals.yml", ".github/workflows/skill-eval-comparison.yml"]);
const pin = /^([+-])([ \t]*- uses: github\/evals-action@)([0-9a-f]{40}) # (v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/;

function parseStableVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error("Pin tag must be a stable semantic version.");
  return match.slice(1).map((part) => BigInt(part));
}

function compareVersions(left, right) {
  const a = parseStableVersion(left), b = parseStableVersion(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function getJson(api, endpoint) {
  const result = api(endpoint);
  if (result.status !== 200) throw new Error(`${endpoint}: GitHub API returned HTTP ${result.status}.`);
  return JSON.parse(result.body);
}

function validPr(pr, repo, defaultBranch, author) {
  return pr.state === "open" && !pr.draft &&
    pr.user?.login === author && pr.user?.type === "Bot" &&
    pr.head?.repo?.full_name === repo &&
    pr.base?.repo?.full_name === repo && pr.base?.ref === defaultBranch;
}

function verifyActionPins(api, files, changedFiles) {
  if (!Number.isInteger(changedFiles) || changedFiles < 1 || changedFiles > actionFiles.size) throw new Error("Unexpected changed-file count.");
  if (!Array.isArray(files) || files.length !== changedFiles) throw new Error("Incomplete changed-file list.");
  let candidate;
  const oldPins = [];
  for (const file of files) {
    if (!actionFiles.has(file.filename) || file.status !== "modified" || typeof file.patch !== "string") throw new Error("Unexpected changed file or missing patch.");
    const blocks = [];
    let block = [];
    for (const line of file.patch.split("\n")) {
      if (!line.startsWith("+") && !line.startsWith("-")) {
        if (block.length) blocks.push(block);
        block = [];
        continue;
      }
      const match = pin.exec(line);
      if (!match) throw new Error("PR changes more than evals-action pins.");
      block.push(match);
    }
    if (block.length) blocks.push(block);
    const removed = [], added = [];
    for (const changes of blocks) {
      const blockRemoved = changes.filter((entry) => entry[1] === "-");
      const blockAdded = changes.filter((entry) => entry[1] === "+");
      if (!blockRemoved.length || blockRemoved.length !== blockAdded.length || blockRemoved.some((entry, index) => entry[2] !== blockAdded[index][2])) {
        throw new Error("Action pin replacements must be in-place and paired.");
      }
      removed.push(...blockRemoved);
      added.push(...blockAdded);
    }
    if (!removed.length || file.additions !== added.length || file.deletions !== removed.length) throw new Error("Incomplete or unpaired action pin changes.");
    oldPins.push(...removed.map((entry) => ({ sha: entry[3], tag: entry[4] })));
    for (const entry of added) {
      const next = `${entry[3]} ${entry[4]}`;
      if (candidate && candidate !== next) throw new Error("Action pins do not agree.");
      candidate = next;
    }
  }
  const [sha, tag] = candidate.split(" ");
  if (oldPins.some((old) => compareVersions(tag.slice(1), old.tag.slice(1)) <= 0)) throw new Error("Action tag must advance to a newer stable semantic version.");
  if (getJson(api, `repos/github/evals-action/commits/${encodeURIComponent(tag)}`).sha !== sha) throw new Error("Action tag does not resolve to the proposed pin.");
  const release = getJson(api, `repos/github/evals-action/releases/tags/${encodeURIComponent(tag)}`);
  if (release.tag_name !== tag || release.draft !== false || release.prerelease !== false) {
    throw new Error("Action pin must target a published stable release.");
  }
  for (const old of oldPins) {
    if (getJson(api, `repos/github/evals-action/compare/${old.sha}...${sha}`).status !== "ahead") throw new Error("Action pin is not a forward update.");
  }
}

function marketplaceContent(api, endpoint) {
  const response = api(endpoint);
  if (response.status !== 200) throw new Error(`${endpoint}: GitHub API returned HTTP ${response.status}.`);
  if (typeof response.body !== "string") throw new Error(`${endpoint}: marketplace content isn't text.`);
  const text = response.body;
  const data = JSON.parse(text);
  if (`${JSON.stringify(data, null, 2)}\n` !== text) throw new Error("marketplace.json isn't in canonical 2-space JSON format.");
  return data;
}

function verifyPluginPin(api, repo, pr, head, files) {
  if (pr.changed_files !== 1 || files.length !== 1 || files[0].filename !== "marketplace.json" || files[0].status !== "modified") {
    throw new Error("Plugin pin PR must change only marketplace.json.");
  }
  const baseEndpoint = `repos/${repo}/contents/marketplace.json?ref=${pr.base.sha}`;
  const headEndpoint = `repos/${repo}/contents/marketplace.json?ref=${head}`;
  const before = marketplaceContent(api, baseEndpoint);
  const after = marketplaceContent(api, headEndpoint);
  const findPin = (data) => {
    const matches = data.plugins?.filter((plugin) => plugin.name === "eval" && plugin.source?.repo === "github/evals");
    if (matches?.length !== 1) throw new Error("marketplace.json must contain exactly one github/evals eval plugin.");
    return matches[0];
  };
  const oldPin = findPin(before);
  const newPin = findPin(after);
  const parsePin = (entry) => {
    const match = /^copilot-evals-v(\d+\.\d+\.\d+)$/.exec(entry.source?.ref ?? "");
    if (!match || entry.version !== match[1] || !/^[0-9a-f]{40}$/.test(entry.source?.sha ?? "")) throw new Error("Plugin pin must contain a matching release tag, version, and full SHA.");
    return { tag: entry.source.ref, version: entry.version, sha: entry.source.sha };
  };
  const old = parsePin(oldPin), next = parsePin(newPin);
  if (compareVersions(next.version, old.version) <= 0 || old.tag === next.tag || old.sha === next.sha) throw new Error("Plugin pin did not advance.");
  const release = (tag) => {
    const result = getJson(api, `repos/github/evals/releases/tags/${encodeURIComponent(tag)}`);
    if (result.tag_name !== tag || result.draft !== false || typeof result.prerelease !== "boolean") {
      throw new Error(`Plugin pin release ${tag} is missing, unpublished, or has an unknown channel.`);
    }
    return result;
  };
  const oldRelease = release(old.tag);
  const nextRelease = release(next.tag);
  if (oldRelease.prerelease !== nextRelease.prerelease) throw new Error("Plugin pin release changed channels.");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const expected = clone(before);
  const expectedPin = findPin(expected);
  expectedPin.source.ref = next.tag;
  expectedPin.source.sha = next.sha;
  expectedPin.version = next.version;
  if (JSON.stringify(expected) !== JSON.stringify(after)) throw new Error("Plugin PR changes more than the github/evals release pin.");
  if (getJson(api, `repos/github/evals/commits/${encodeURIComponent(next.tag)}`).sha !== next.sha) throw new Error("Plugin release tag does not resolve to the proposed pin.");
  if (getJson(api, `repos/github/evals/compare/${old.sha}...${next.sha}`).status !== "ahead") throw new Error("Plugin pin is not a forward update.");
}

function getPullRequest(api, repo, branch) {
  const owner = repo.split("/")[0];
  const matches = getJson(api, `repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`);
  if (!Array.isArray(matches)) throw new Error("Pull request list response is not an array.");
  if (matches.length > 1) throw new Error("More than one open PR uses the automation branch.");
  return matches.length ? getJson(api, `repos/${repo}/pulls/${matches[0].number}`) : undefined;
}

function verifyPinPr(api, repo, pr, headBranch, headSha, kind, defaultBranch) {
  const author = kind === "plugin" ? "github-actions[bot]" : "dependabot[bot]";
  if (!validPr(pr, repo, defaultBranch, author)) throw new Error("Pin PR isn't open from the expected automation identity and base.");
  if (pr.head?.ref !== headBranch || pr.head?.sha !== headSha) throw new Error("Pin PR head doesn't match the inspected head.");
  const commit = getJson(api, `repos/${repo}/commits/${headSha}`);
  const expectedCommitter = commit.committer?.login === author ||
    (kind === "action" && commit.committer?.login === "web-flow" && commit.commit?.verification?.verified === true);
  if (commit.author?.login !== author || !expectedCommitter) {
    throw new Error("PR head commit was not authored and committed by the expected verified automation identity.");
  }
  const endpoint = `repos/${repo}/pulls/${pr.number}`;
  const files = getJson(api, `${endpoint}/files?per_page=100&page=1`);
  if (kind === "plugin") verifyPluginPin(api, repo, pr, headSha, files);
  else verifyActionPins(api, files, pr.changed_files);
  const current = getJson(api, endpoint);
  if (!validPr(current, repo, defaultBranch, author) || current.head?.sha !== headSha || current.head?.ref !== headBranch) {
    throw new Error("PR head changed during inspection.");
  }
  return current;
}

export function verifyCurrentPinPr({ api = githubApi, repo, event, prNumber, branch, headSha }) {
  if (repo !== canonical) throw new Error("Invalid repository.");
  let kind, pr;
  if (event === "pull_request" && branch?.startsWith("dependabot/github_actions/evals-action-")) {
    if (!actionBranch.test(branch)) throw new Error("Unexpected Dependabot action-pin branch.");
    if (!/^\d+$/.test(String(prNumber ?? ""))) throw new Error("Invalid pull request number.");
    kind = "action";
    pr = getJson(api, `repos/${repo}/pulls/${prNumber}`);
  } else if (event === "workflow_dispatch" && branch === pluginBranch) {
    kind = "plugin";
    pr = getPullRequest(api, repo, branch);
  } else {
    return "Skipped a Validate run unrelated to pin automation.";
  }
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "")) throw new Error("Invalid pin PR head SHA.");
  if (!pr) throw new Error("No open pin PR exists for the validated head.");
  const defaultBranch = getJson(api, `repos/${repo}`).default_branch;
  verifyPinPr(api, repo, pr, branch, headSha, kind, defaultBranch);
  return `Validated ${kind} pin PR #${pr.number} at ${headSha}.`;
}

export function completePinValidation({ api = githubApi, repo, runId, execute = run }) {
  if (repo !== canonical || !/^\d+$/.test(String(runId ?? ""))) throw new Error("Invalid repository or workflow run ID.");
  const workflow = getJson(api, `repos/${repo}/actions/workflows/validate.yml`);
  if (workflow.path !== ".github/workflows/validate.yml") throw new Error("Unexpected Validate workflow path.");
  const runData = getJson(api, `repos/${repo}/actions/runs/${runId}`);
  if (runData.workflow_id !== workflow.id || runData.path !== workflow.path) throw new Error("Validate run did not come from the expected workflow.");
  let author, kind;
  if (runData.event === "workflow_dispatch" && runData.head_branch === pluginBranch) {
    author = "github-actions[bot]";
    kind = "plugin";
  } else if (runData.event === "pull_request" && actionBranch.test(runData.head_branch ?? "")) {
    author = "dependabot[bot]";
    kind = "action";
  } else {
    return "Skipped a Validate run unrelated to pin automation.";
  }
  if (runData.repository?.full_name !== repo || runData.head_repository?.full_name !== repo || !/^[0-9a-f]{40}$/.test(runData.head_sha ?? "")) {
    return "Skipped a Validate run that is not for a commit in the canonical repository.";
  }
  if (runData.status !== "completed" || runData.conclusion !== "success") return "Skipped an unsuccessful Validate run.";
  const defaultBranch = getJson(api, `repos/${repo}`).default_branch;
  const jobs = getJson(api, `repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=1`).jobs;
  if (!Array.isArray(jobs) || !jobs.some((job) => job.name === "lint" && job.conclusion === "success") || jobs.some((job) => job.conclusion !== "success")) throw new Error("Validate did not finish with every job, including lint, successful.");
  const pr = getPullRequest(api, repo, runData.head_branch);
  if (!pr || !validPr(pr, repo, defaultBranch, author)) return "Skipped because no matching open automation PR exists.";
  if (pr.head?.ref !== runData.head_branch || pr.head?.sha !== runData.head_sha) return "Skipped a stale Validate run for an older PR head.";
  const current = verifyPinPr(api, repo, pr, runData.head_branch, runData.head_sha, kind, defaultBranch);
  const number = current.number;
  if (kind === "plugin") {
    execute("gh", [
      "api", "--method", "POST", `repos/${repo}/statuses/${runData.head_sha}`,
      "-f", "state=success", "-f", "context=lint", "-f", `target_url=${runData.html_url}`,
      "-f", "description=Validate passed for the exact plugin pin PR head.",
    ]);
  }
  execute("gh", ["pr", "merge", String(number), "-R", repo, "--auto", "--squash", "--match-head-commit", runData.head_sha]);
  return `Enabled auto-merge for verified ${kind} pin PR #${number} at ${runData.head_sha}.`;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.error?.code}).`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  try {
    const result = process.argv[2] === "verify-current-pr"
      ? verifyCurrentPinPr({
        repo: process.env.GITHUB_REPOSITORY,
        event: process.env.PIN_VALIDATION_EVENT,
        prNumber: process.env.PIN_PR_NUMBER,
        branch: process.env.PIN_PR_BRANCH,
        headSha: process.env.PIN_PR_HEAD_SHA,
      })
      : completePinValidation({ repo: process.env.GITHUB_REPOSITORY, runId: process.env.WORKFLOW_RUN_ID });
    console.log(result);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
