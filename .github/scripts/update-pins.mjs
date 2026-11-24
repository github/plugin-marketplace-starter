import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubApi } from "./check-remote-pins.mjs";

export const BRANCH = "automation/update-plugin-pin";
const bot = "github-actions[bot]";
const safeReleaseTag = (tag) => typeof tag === "string" && /^[A-Za-z0-9._-]+$/.test(tag);
class PinBlocked extends Error {}

function getJson(api, endpoint) {
  const response = api(endpoint);
  if (response.status !== 200) throw new PinBlocked(`${endpoint}: GitHub API returned HTTP ${response.status}.`);
  return JSON.parse(response.body);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const semver = (tag, prefix) => {
  if (!safeReleaseTag(tag)) return null;
  const match = new RegExp(`^${escapeRegExp(prefix)}(\\d+)\\.(\\d+)\\.(\\d+)$`).exec(tag ?? "");
  return match && match.slice(1).map(Number);
};
const compareSemver = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function newestRelease(releases, prefix, allowPrerelease) {
  return releases
    .filter((release) => !release.draft && (allowPrerelease || !release.prerelease) && semver(release.tag_name, prefix))
    .sort((a, b) => compareSemver(semver(b.tag_name, prefix), semver(a.tag_name, prefix)))[0];
}

export function planUpdate({ text, api = githubApi }) {
  const data = JSON.parse(text);
  if (`${JSON.stringify(data, null, 2)}\n` !== text) throw new Error("marketplace.json isn't in canonical 2-space JSON format.");
  const entry = data.plugins?.find((plugin) => plugin.name === "eval" && plugin.source?.repo === "github/evals");
  if (!entry || !safeReleaseTag(entry.source.ref)) return { blocked: "The github/evals plugin release pin is missing or invalid." };
  const match = /^(.*?)(\d+\.\d+\.\d+)$/.exec(entry.source.ref);
  if (!match || !/^[0-9a-f]{40}$/.test(entry.source.sha ?? "")) return { blocked: "The github/evals plugin pin must have a semver ref and full SHA." };
  const { ref, sha } = entry.source;
  const read = (endpoint) => {
    try {
      return api(endpoint);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new PinBlocked(`${endpoint}: ${error.message}`);
    }
  };
  try {
    const releases = [];
    for (let page = 1; ; page++) {
      const batch = getJson(read, `repos/github/evals/releases?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new PinBlocked("github/evals: releases response is not an array.");
      releases.push(...batch);
      if (batch.length < 100) break;
    }
    let current = releases.find((release) => release.tag_name === ref);
    if (!current) {
      const endpoint = `repos/github/evals/releases/tags/${encodeURIComponent(ref)}`;
      const response = read(endpoint);
      if (response.status === 404) throw new PinBlocked(`github/evals: no release for ${ref}, so its channel is unknown.`);
      if (response.status !== 200) throw new PinBlocked(`${endpoint}: GitHub API returned HTTP ${response.status}.`);
      current = JSON.parse(response.body);
    }
    if (typeof current.prerelease !== "boolean") throw new PinBlocked(`github/evals: release channel for ${ref} is unknown.`);
    const next = newestRelease(releases, match[1], current.prerelease);
    if (!next || compareSemver(semver(next.tag_name, match[1]), semver(ref, match[1])) <= 0) return { text, changes: [], title: "", body: "" };
    const nextSha = getJson(read, `repos/github/evals/commits/${encodeURIComponent(next.tag_name)}`).sha;
    if (!/^[0-9a-f]{40}$/.test(nextSha ?? "")) throw new PinBlocked(`github/evals: ${next.tag_name} did not resolve to a full commit SHA.`);
    const comparison = getJson(read, `repos/github/evals/compare/${sha}...${nextSha}`);
    if (comparison.status !== "ahead") throw new PinBlocked(`github/evals: ${next.tag_name} is ${comparison.status} relative to the pinned commit.`);
    entry.source.ref = next.tag_name;
    entry.source.sha = nextSha;
    if (entry.version === match[2]) entry.version = next.tag_name.slice(match[1].length);
    return {
      text: `${JSON.stringify(data, null, 2)}\n`,
      changes: [{ from: { tag: ref, sha }, to: { tag: next.tag_name, sha: nextSha } }],
      title: `chore(deps): update eval plugin to ${next.tag_name}`,
      body: `Updates the eval plugin from ${ref} to ${next.tag_name} ([changes](https://github.com/github/evals/compare/${sha}...${nextSha})).\n\nA CodeOwner review and required checks are needed before auto-merge.\n`,
    };
  } catch (error) {
    if (!(error instanceof PinBlocked)) throw error;
    return { blocked: error.message };
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed (exit ${result.status ?? result.error?.code}).`);
  return result.stdout.trim();
}

export function planPublish({ main, localTree, remote }) {
  if (!remote) return "push";
  if (remote.authors.some((author) => author !== bot)) throw new Error(`${BRANCH} contains commits not authored and committed by ${bot}.`);
  return remote.tree === localTree && remote.aheadBy === 1 && remote.behindBy === 0 && remote.parents.length === 1 && remote.parents[0] === main ? "skip" : "push";
}

function openPr(api, repo) {
  const [owner] = repo.split("/");
  const prs = getJson(api, `repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(BRANCH)}`);
  if (prs.length > 1) throw new Error(`More than one open PR uses ${BRANCH}.`);
  const pr = prs[0];
  if (pr && (pr.user?.login !== bot || pr.user?.type !== "Bot" || pr.head?.repo?.full_name !== repo || pr.base?.ref !== pr.base?.repo?.default_branch)) {
    throw new Error(`Open PR #${pr.number} is not the expected ${bot} PR against the default branch.`);
  }
  return pr;
}

function remoteBranch(api, repo, main) {
  const response = api(`repos/${repo}/branches/${encodeURIComponent(BRANCH)}`);
  if (response.status === 404) return undefined;
  if (response.status !== 200) throw new Error(`${BRANCH}: GitHub API returned HTTP ${response.status}.`);
  const { commit } = JSON.parse(response.body);
  const comparison = getJson(api, `repos/${repo}/compare/${main}...${commit.sha}`);
  if (comparison.commits.length !== comparison.ahead_by) throw new Error(`${BRANCH} has too many commits to verify.`);
  return { sha: commit.sha, tree: commit.commit.tree.sha, parents: commit.parents.map((parent) => parent.sha), aheadBy: comparison.ahead_by, behindBy: comparison.behind_by, authors: comparison.commits.flatMap((entry) => [entry.author?.login, entry.committer?.login]) };
}

function currentValidationRun(api, repo, head) {
  const result = getJson(api, `repos/${repo}/actions/workflows/validate.yml/runs?branch=${encodeURIComponent(BRANCH)}&event=workflow_dispatch&per_page=100`);
  if (!Array.isArray(result.workflow_runs)) throw new Error("Validate workflow-runs response is not an array.");
  return result.workflow_runs.find((run) =>
    run.event === "workflow_dispatch" &&
    run.head_branch === BRANCH &&
    run.head_sha === head &&
    (["queued", "in_progress", "waiting"].includes(run.status) || (run.status === "completed" && run.conclusion === "success")),
  );
}

export function publish(api, repo, { title, bodyFile, execute = run }) {
  if (!title || !bodyFile || !process.env.GH_TOKEN) throw new Error("Publication requires a title, body file, and GH_TOKEN.");
  const pr = openPr(api, repo);
  const base = pr?.base.ref ?? getJson(api, `repos/${repo}`).default_branch;
  const main = execute("git", ["rev-parse", "HEAD"]);
  const remote = remoteBranch(api, repo, main);
  if (pr && (!remote || pr.head?.sha !== remote.sha)) throw new Error(`Open PR #${pr.number} does not match the current ${BRANCH} head.`);
  if (!execute("git", ["status", "--porcelain", "--", "marketplace.json"])) throw new Error("No plugin pin change to publish.");
  if (remote) planPublish({ main, localTree: "", remote });
  execute("git", ["add", "--", "marketplace.json"]);
  execute("git", ["-c", `user.name=${bot}`, "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "--quiet", "--only", "-m", title, "--", "marketplace.json"]);
  const localHead = execute("git", ["rev-parse", "HEAD"]);
  const decision = planPublish({ main, localTree: execute("git", ["rev-parse", "HEAD^{tree}"]), remote });
  if (decision === "push") {
    if (pr) {
      const currentPr = getJson(api, `repos/${repo}/pulls/${pr.number}`);
      if (currentPr.state !== "open" || currentPr.head?.sha !== remote.sha) throw new Error(`Open PR #${pr.number} changed during publication.`);
      if (currentPr.auto_merge) execute("gh", ["pr", "merge", String(pr.number), "-R", repo, "--disable-auto"]);
    }
    const auth = Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString("base64");
    console.log(`::add-mask::${auth}`);
    execute("git", ["push", "--quiet", `--force-with-lease=refs/heads/${BRANCH}:${remote?.sha ?? ""}`, "origin", `HEAD:refs/heads/${BRANCH}`], {
      env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}` },
    });
  }
  if (pr) execute("gh", ["api", "--method", "PATCH", `repos/${repo}/pulls/${pr.number}`, "-f", `title=${title}`, "-F", `body=@${bodyFile}`]);
  else execute("gh", ["pr", "create", "-R", repo, "--base", base, "--head", BRANCH, "--title", title, "--body-file", bodyFile]);
  const current = openPr(api, repo);
  const publishedHead = decision === "push" ? localHead : remote.sha;
  if (!current || current.head?.sha !== publishedHead) throw new Error(`No open PR found at the published ${BRANCH} head.`);
  const existingValidation = decision === "skip" && pr ? currentValidationRun(api, repo, publishedHead) : undefined;
  if (!existingValidation) execute("gh", ["workflow", "run", "validate.yml", "-R", repo, "--ref", BRANCH]);
  if (existingValidation) return `Plugin pin PR #${current.number} already has a current-head Validate run and is awaiting CodeOwner approval.`;
  return `Plugin pin PR #${current.number} is awaiting Validate and CodeOwner approval.`;
}

function output(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value ?? ""}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

export function main(argv, api = githubApi) {
  const [command, ...rest] = argv;
  const args = {};
  for (let index = 0; index < rest.length; index += 2) args[rest[index].replace(/^--/, "")] = rest[index + 1];
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY must name this repository.");
  if (command === "update") {
    const text = readFileSync("marketplace.json", "utf8");
    const plan = planUpdate({ text, api });
    if (plan.blocked) {
      output({ blocked: true, reason: plan.blocked.replace(/[\r\n]+/g, " ") });
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Pin update blocked\n\n${plan.blocked}\n`);
      throw new Error(`Pin update blocked: ${plan.blocked}`);
    }
    if (plan.text !== text) writeFileSync("marketplace.json", plan.text);
    if (args["body-file"]) writeFileSync(args["body-file"], plan.body);
    output({ blocked: false, changed: plan.changes.length > 0, title: plan.title });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, plan.changes.length ? `### Pin update\n\n${plan.body}` : "### Pin update\n\nPin is current.\n");
  } else if (command === "publish") {
    console.log(publish(api, repo, { title: args.title, bodyFile: args["body-file"] }));
  } else {
    throw new Error("Usage: update-pins.mjs update [--body-file F] | publish --title T --body-file F");
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
