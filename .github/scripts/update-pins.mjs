import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubApi } from "./check-remote-pins.mjs";

// Moves remote marketplace pins and github/evals-action pins to their newest
// releases, and decides whether the resulting bot PR may merge. Run by
// .github/workflows/update-pins.yml; see docs/checks-and-evals.md#automatic-pin-updates.
export const BRANCH = "automation/update-pins";
export const ACTION_REPO = "github/evals-action";
export const ACTION_FILES = [".github/workflows/skill-eval-comparison.yml", "docs/checks-and-evals.md"];
export const ALLOWED_FILES = new Set(["marketplace.json", ...ACTION_FILES]);
const actionUses = /^(\s*(?:-\s+)?uses:\s*github\/evals-action@)([0-9a-f]{40})(?:[ \t]+#[ \t]*([^\n]*))?$/gm;
const settled = new Set(["success", "neutral", "skipped"]);
const copilotReviewer = "copilot-pull-request-reviewer[bot]";

function getJson(api, endpoint) {
  const response = api(endpoint);
  if (response.status !== 200) throw new Error(`${endpoint}: GitHub API returned HTTP ${response.status}.`);
  return JSON.parse(response.body);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const semver = (tag, prefix) => {
  const match = new RegExp(`^${escapeRegExp(prefix)}(\\d+)\\.(\\d+)\\.(\\d+)$`).exec(tag ?? "");
  return match && match.slice(1).map(Number);
};
const compareSemver = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function newestRelease(releases, prefix, allowPrerelease) {
  return releases
    .filter((release) => !release.draft && (allowPrerelease || !release.prerelease) && semver(release.tag_name, prefix))
    .sort((a, b) => compareSemver(semver(b.tag_name, prefix), semver(a.tag_name, prefix)))[0];
}

function listReleases(api, repo) {
  const releases = [];
  for (let page = 1; ; page += 1) {
    const batch = getJson(api, `repos/${repo}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

// A pin stays on its channel: stable pins only move to stable releases.
function candidate(api, repo, currentTag, prefix, notes) {
  const releases = listReleases(api, repo);
  let allowPrerelease = true;
  if (currentTag) {
    let current = releases.find((release) => release.tag_name === currentTag);
    if (!current) {
      const endpoint = `repos/${repo}/releases/tags/${encodeURIComponent(currentTag)}`;
      const response = api(endpoint);
      if (response.status === 404) {
        notes.push(`${repo}: no release for ${currentTag}, so its channel is unknown; left unchanged.`);
        return undefined;
      }
      if (response.status !== 200) throw new Error(`${endpoint}: GitHub API returned HTTP ${response.status}.`);
      current = JSON.parse(response.body);
    }
    allowPrerelease = current.prerelease;
  }
  const release = newestRelease(releases, prefix, allowPrerelease);
  if (!release) return undefined;
  if (currentTag && compareSemver(semver(release.tag_name, prefix), semver(currentTag, prefix)) <= 0) return undefined;
  return { tag: release.tag_name, sha: getJson(api, `repos/${repo}/commits/${encodeURIComponent(release.tag_name)}`).sha };
}

function updatePlugins(text, api, changes, notes) {
  const data = JSON.parse(text);
  if (`${JSON.stringify(data, null, 2)}\n` !== text) throw new Error("marketplace.json isn't in canonical 2-space JSON format.");
  for (const entry of data.plugins ?? []) {
    const source = entry.source;
    const match = typeof source === "object" ? /^(.*?)(\d+\.\d+\.\d+)$/.exec(source.ref ?? "") : null;
    if (!match) continue;
    const next = candidate(api, source.repo, source.ref, match[1], notes);
    if (!next) continue;
    changes.push({ name: entry.name, repo: source.repo, from: { tag: source.ref, sha: source.sha }, to: next });
    if (entry.version === match[2]) entry.version = next.tag.slice(match[1].length);
    Object.assign(source, { ref: next.tag, sha: next.sha });
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

function updateAction(files, actionFiles, api, changes, notes) {
  const pins = actionFiles.flatMap((file) => [...files[file].matchAll(actionUses)]);
  if (!pins.length) return;
  const shas = new Set(pins.map((pin) => pin[2]));
  if (shas.size > 1) throw new Error(`Found more than one github/evals-action commit (${[...shas].join(", ")}); align them first.`);
  const [currentSha] = shas;
  const tags = new Set(pins.map((pin) => (/^v\d+\.\d+\.\d+$/.test(pin[3] ?? "") ? pin[3] : undefined)));
  const currentTag = tags.size === 1 ? [...tags][0] : undefined;
  const next = candidate(api, ACTION_REPO, currentTag, "v", notes);
  if (!next || (next.sha === currentSha && pins.every((pin) => pin[3] === next.tag))) return;
  const { status } = getJson(api, `repos/${ACTION_REPO}/compare/${currentSha}...${next.sha}`);
  if (status !== "ahead" && status !== "identical") {
    notes.push(`${ACTION_REPO}: ${next.tag} is ${status} the pinned ${currentSha}; left unchanged.`);
    return;
  }
  changes.push({ name: ACTION_REPO, repo: ACTION_REPO, from: { tag: currentTag, sha: currentSha }, to: next });
  for (const file of actionFiles) {
    files[file] = files[file].replace(actionUses, (_, prefix) => `${prefix}${next.sha} # ${next.tag}`);
  }
}

export function planUpdate({ files, actionFiles = ACTION_FILES, api = githubApi }) {
  const next = { ...files };
  const changes = [];
  const notes = [];
  next["marketplace.json"] = updatePlugins(files["marketplace.json"], api, changes, notes);
  updateAction(next, actionFiles.filter((file) => file in next), api, changes, notes);
  const title = `chore(deps): update pins to ${changes.map((change) => `${change.name} ${change.to.tag}`).join(" and ")}`;
  const body = [
    "Moves these pins to their newest published releases on the same channel:",
    "",
    ...changes.map(({ name, repo, from, to }) =>
      `- **${name}**: ${from.tag ?? from.sha.slice(0, 12)} → ${to.tag} ([changes](https://github.com/${repo}/compare/${from.sha}...${to.sha}))`),
    ...notes.map((note) => `- ${note}`),
    "",
    "Opened by the [Update pins](../blob/main/.github/workflows/update-pins.yml) workflow. It enqueues this PR only after GitHub",
    "records a required approval and Copilot submits a GitHub `APPROVED` review on the current head; a comment-only review",
    "doesn't qualify. It",
    "replaces the PR when a newer release appears. Set the `PIN_AUTOMATION` variable to anything but `true` to pause it.",
    "",
  ].join("\n");
  return { files: next, changes, notes, title, body };
}

// A check bound to a GitHub App counts only when that App reported it; commit statuses can't prove their App.
const passed = ({ context, app }, checkRuns, status) =>
  checkRuns.check_runs.some((run) => run.name === context && (!(app > 0) || run.app?.id === app) && run.status === "completed" && settled.has(run.conclusion)) ||
  (!(app > 0) && (status.statuses ?? []).some((entry) => entry.context === context && entry.state === "success"));

export function evaluateMergeGate({ pr, commits, files, checkRuns, status, compare, required = [], stale = [], bot, expectHead, trustedLintPassed = false, reviewDecision, automatedReviewApproved = false }) {
  const result = (decision, reason) => ({ decision, reason, pr: pr?.number, prNodeId: pr?.node_id, head: pr?.head?.sha });
  if (!pr) return result("none", "No open pin update PR.");
  const author = pr.user?.login;
  if (pr.state !== "open" || pr.draft) return result("block", "PR is closed or a draft.");
  if (pr.head?.ref !== BRANCH || pr.head?.repo?.full_name !== pr.base?.repo?.full_name) return result("block", "PR head isn't this repository's pin branch.");
  if (pr.base?.ref !== pr.base?.repo?.default_branch) return result("block", "PR doesn't target the default branch.");
  if (pr.user?.type !== "Bot" || (bot && author !== bot)) return result("block", `PR author ${author} isn't the pin app.`);
  if (!commits.length || commits.length !== pr.commits || commits.some((commit) => commit.author?.login !== author || commit.committer?.login !== author)) return result("block", `Commits aren't all authored and committed by ${author}.`);
  const unexpected = files.filter((file) => file.status !== "modified" || !ALLOWED_FILES.has(file.filename));
  if (!files.length || files.length !== pr.changed_files || unexpected.length) return result("block", `Unexpected file changes: ${unexpected.map((file) => file.filename).join(", ") || "none"}.`);
  if (pr.mergeable === null || pr.mergeable_state === "unknown") return result("wait", "GitHub is still computing mergeability.");
  if (pr.mergeable_state === "dirty") return result("block", "PR has merge conflicts.");
  if (checkRuns.total_count !== checkRuns.check_runs.length) return result("block", "Too many check runs to verify in one page.");
  const failed = checkRuns.check_runs.filter((run) => run.status === "completed" && !settled.has(run.conclusion));
  if (failed.length) return result("block", `Checks failed: ${failed.map((run) => run.name).join(", ")}.`);
  if (status.total_count > 0 && ["failure", "error"].includes(status.state)) return result("block", "A commit status failed.");
  if (expectHead && pr.head.sha !== expectHead) return result("wait", "PR head changed since the gate ran.");
  if (compare.behind_by !== 0) return result("wait", "PR is behind the default branch; the next update rebases it.");
  if (!trustedLintPassed) return result("wait", "The Validate workflow's lint job hasn't passed on this head yet.");
  if (reviewDecision === "CHANGES_REQUESTED") return result("block", "A reviewer requested changes.");
  if (reviewDecision !== "APPROVED") return result("wait", "GitHub hasn't recorded a required approval on this head yet.");
  if (!automatedReviewApproved) return result("wait", "Copilot hasn't submitted an APPROVED review on this head yet.");
  // Git attribution can be set by anyone who can push, so the content itself must match a fresh update.
  if (stale.length) return result("wait", `Doesn't match a fresh pin update: ${stale.join(", ")}; the next update replaces it.`);
  if (checkRuns.check_runs.some((run) => run.status !== "completed")) return result("wait", "Checks are still running.");
  const missing = [{ context: "lint" }, ...required].filter((check) => !passed(check, checkRuns, status));
  if (missing.length) return result("wait", `Required checks haven't passed on this head yet: ${[...new Set(missing.map((check) => check.context))].join(", ")}.`);
  if (status.total_count > 0 && status.state !== "success") return result("wait", "Commit statuses are pending.");
  return result("merge", "Every gate passed.");
}

export function planPublish({ main, localTree, remote, bot }) {
  if (!remote) return "push";
  const others = remote.authors.filter((login) => login !== bot);
  if (others.length) throw new Error(`${BRANCH} has commits not authored by ${bot} (${others.join(", ")}); leaving it alone.`);
  const current = remote.tree === localTree && remote.aheadBy === 1 && remote.behindBy === 0 && remote.parents.length === 1 && remote.parents[0] === main;
  return current ? "skip" : "push";
}

export function assertBotPr(pr, bot) {
  if (pr && (pr.user?.type !== "Bot" || pr.user?.login !== bot)) {
    throw new Error(`Open PR #${pr.number} on ${BRANCH} isn't authored by ${bot}; leaving it alone.`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed (exit ${result.status ?? result.error?.code}).`);
  return result.stdout.trim();
}

function getReviewDecision(repo, number) {
  const [owner, name] = repo.split("/");
  const query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewDecision}}}";
  return run("gh", [
    "api", "graphql",
    "-f", `query=${query}`,
    "-F", `owner=${owner}`,
    "-F", `name=${name}`,
    "-F", `number=${number}`,
    "--jq", ".data.repository.pullRequest.reviewDecision",
  ]);
}

function openPr(api, repo) {
  const [owner] = repo.split("/");
  return getJson(api, `repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(BRANCH)}`)[0];
}

function remoteBranch(api, repo, main) {
  const response = api(`repos/${repo}/branches/${encodeURIComponent(BRANCH)}`);
  if (response.status === 404) return undefined;
  if (response.status !== 200) throw new Error(`${BRANCH}: GitHub API returned HTTP ${response.status}.`);
  const { commit } = JSON.parse(response.body);
  const compare = getJson(api, `repos/${repo}/compare/${main}...${commit.sha}`);
  return {
    sha: commit.sha,
    tree: commit.commit.tree.sha,
    parents: commit.parents.map((parent) => parent.sha),
    authors: compare.commits.flatMap((entry) => [entry.author?.login, entry.committer?.login]),
    aheadBy: compare.ahead_by,
    behindBy: compare.behind_by,
  };
}

function output(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value ?? ""}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

const readFiles = () =>
  Object.fromEntries(["marketplace.json", ...ACTION_FILES].filter((file) => existsSync(file)).map((file) => [file, readFileSync(file, "utf8")]));

export function requiredChecks(api, repo, branch) {
  const rules = [];
  for (let page = 1; ; page++) {
    const response = api(`repos/${repo}/rules/branches/${encodeURIComponent(branch)}?per_page=100&page=${page}`);
    if (response.status === 403 && /Upgrade to GitHub Pro or make this repository public to enable this feature/i.test(response.body)) break;
    if (response.status !== 200) throw new Error(`repos/${repo}/rules/branches/${encodeURIComponent(branch)}: GitHub API returned HTTP ${response.status}.`);
    const batch = JSON.parse(response.body);
    rules.push(...batch);
    if (batch.length < 100) break;
  }
  const classic = getJson(api, `repos/${repo}/branches/${encodeURIComponent(branch)}`).protection?.required_status_checks;
  return [
    ...rules
      .filter((rule) => rule.type === "required_status_checks")
      .flatMap((rule) => rule.parameters.required_status_checks.map((check) => ({ context: check.context, app: check.integration_id }))),
    ...(classic?.checks ?? (classic?.contexts ?? []).map((context) => ({ context }))).map((check) => ({ context: check.context, app: check.app_id })),
  ];
}

function paged(api, endpoint, key) {
  const items = [];
  const separator = endpoint.includes("?") ? "&" : "?";
  for (let page = 1; ; page++) {
    const response = getJson(api, `${endpoint}${separator}per_page=100&page=${page}`);
    const batch = key ? response[key] : response;
    if (!Array.isArray(batch)) throw new Error(`${endpoint}: GitHub API response is missing ${key ?? "an array"}.`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

export function trustedValidateLint(api, repo, head) {
  const runs = paged(api, `repos/${repo}/actions/runs?head_sha=${encodeURIComponent(head)}`, "workflow_runs")
    .filter((run) => run.name === "Validate" && run.path === ".github/workflows/validate.yml" && run.event === "pull_request" && run.head_sha === head)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.run_attempt - a.run_attempt);
  const latest = runs[0];
  if (!latest || latest.status !== "completed" || latest.conclusion !== "success") return false;
  const jobs = paged(api, `repos/${repo}/actions/runs/${latest.id}/jobs`, "jobs");
  return jobs.some((job) => job.name === "lint" && job.status === "completed" && job.conclusion === "success");
}

export function approvedCopilotReview(api, repo, number, head) {
  const reviews = paged(api, `repos/${repo}/pulls/${number}/reviews`)
    .filter((review) => review.user?.login === copilotReviewer && review.commit_id === head && Number.isFinite(Date.parse(review.submitted_at)))
    .sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at));
  return reviews.length > 0 && reviews[reviews.length - 1].state === "APPROVED";
}

// Files on the PR head that differ from what `update` produces on this checkout of the default branch.
function staleFiles(api, repo, head) {
  const expected = planUpdate({ files: readFiles(), actionFiles: ACTION_FILES, api }).files;
  return [...ALLOWED_FILES].filter((file) => {
    const response = api(`repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${head}`);
    if (response.status !== 200 && response.status !== 404) throw new Error(`${file}@${head}: GitHub API returned HTTP ${response.status}.`);
    return (response.status === 200 ? response.body : undefined) !== expected[file];
  });
}

function readGate(api, repo, { bot, expectHead }) {
  const listed = openPr(api, repo);
  if (!listed) return evaluateMergeGate({});
  const pr = getJson(api, `repos/${repo}/pulls/${listed.number}`);
  const head = pr.head.sha;
  return evaluateMergeGate({
    required: requiredChecks(api, repo, pr.base.ref),
    trustedLintPassed: trustedValidateLint(api, repo, head),
    reviewDecision: getReviewDecision(repo, pr.number),
    automatedReviewApproved: approvedCopilotReview(api, repo, pr.number, head),
    stale: staleFiles(api, repo, head),
    pr,
    commits: getJson(api, `repos/${repo}/pulls/${pr.number}/commits?per_page=100`),
    files: getJson(api, `repos/${repo}/pulls/${pr.number}/files?per_page=100`),
    checkRuns: getJson(api, `repos/${repo}/commits/${head}/check-runs?per_page=100`),
    status: getJson(api, `repos/${repo}/commits/${head}/status`),
    compare: getJson(api, `repos/${repo}/compare/${encodeURIComponent(pr.base.ref)}...${head}`),
    bot,
    expectHead,
  });
}

function publish(api, repo, { title, bodyFile, bot }) {
  const pr = openPr(api, repo);
  assertBotPr(pr, bot);
  const main = run("git", ["rev-parse", "HEAD"]);
  const remote = remoteBranch(api, repo, main);
  const paths = [...ALLOWED_FILES].filter((file) => existsSync(file));
  if (!run("git", ["status", "--porcelain", "--", ...paths])) {
    if (remote) planPublish({ main, localTree: "", remote, bot });
    if (pr) run("gh", ["pr", "close", String(pr.number), "-R", repo, "--delete-branch", "--comment", "The default branch already has these pins or newer ones."]);
    return pr ? `closed #${pr.number}` : "nothing to publish";
  }
  const id = getJson(api, `users/${encodeURIComponent(bot)}`).id;
  run("git", ["add", "--", ...paths]);
  run("git", ["-c", `user.name=${bot}`, "-c", `user.email=${id}+${bot}@users.noreply.github.com`, "commit", "--quiet", "-m", title]);
  const decision = planPublish({ main, localTree: run("git", ["rev-parse", "HEAD^{tree}"]), remote, bot });
  if (decision === "push") {
    const auth = Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString("base64");
    console.log(`::add-mask::${auth}`);
    run("git", ["push", "--quiet", `--force-with-lease=refs/heads/${BRANCH}:${remote?.sha ?? ""}`, "origin", `HEAD:refs/heads/${BRANCH}`], {
      env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}` },
    });
  }
  if (pr) run("gh", ["pr", "edit", String(pr.number), "-R", repo, "--title", title, "--body-file", bodyFile]);
  else run("gh", ["pr", "create", "-R", repo, "--base", getJson(api, `repos/${repo}`).default_branch, "--head", BRANCH, "--title", title, "--body-file", bodyFile]);
  return decision === "push" ? `pushed ${BRANCH}` : `${BRANCH} already current`;
}

function main(argv) {
  const [command, ...rest] = argv;
  const args = {};
  for (let index = 0; index < rest.length; index += 2) args[rest[index].replace(/^--/, "")] = rest[index + 1];
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY must name this repository.");
  if (command === "update") {
    const files = readFiles();
    const plan = planUpdate({ files, actionFiles: ACTION_FILES });
    for (const [file, text] of Object.entries(plan.files)) if (text !== files[file]) writeFileSync(file, text);
    if (args["body-file"]) writeFileSync(args["body-file"], plan.body);
    const pr = openPr(githubApi, repo);
    output({ changed: plan.changes.length > 0, title: plan.title, open_pr: pr?.number });
    summary(plan.changes.length ? `### Pin update\n\n${plan.body}` : `### Pin update\n\nPins are current.${plan.notes.map((note) => `\n- ${note}`).join("")}`);
  } else if (command === "publish") {
    const result = publish(githubApi, repo, { title: args.title, bodyFile: args["body-file"], bot: args.bot });
    console.log(result);
    summary(`### Publish\n\n${result}`);
  } else if (command === "gate") {
    const gate = readGate(githubApi, repo, { bot: args.bot, expectHead: args["expect-head"] });
    output({ decision: gate.decision, pr: gate.pr, pr_node_id: gate.prNodeId, head: gate.head });
    summary(`### Merge gate\n\n**${gate.decision}**${gate.pr ? ` for #${gate.pr}` : ""}: ${gate.reason}`);
    if (gate.decision === "block") throw new Error(gate.reason);
  } else {
    throw new Error("Usage: update-pins.mjs update [--body-file F] | publish --title T --body-file F --bot LOGIN | gate [--bot LOGIN] [--expect-head SHA]");
  }
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
