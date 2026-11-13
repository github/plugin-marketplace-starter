import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubApi } from "./check-remote-pins.mjs";

// Unlike $, the end assertion also rejects a final line break.
const name = /^[a-z0-9][a-z0-9._-]*(?![\s\S])/;
const sha = /^[a-f0-9]{40}(?![\s\S])/;
const parse = (contents) => {
  try { return JSON.parse(contents); } catch { throw new Error("Invalid skill selection JSON."); }
};
const json = (path) => parse(readFileSync(path, "utf8"));

function pinnedTree(repo, commit) {
  const response = githubApi(`repos/${repo}/git/trees/${commit}?recursive=1`, (command, args, options) =>
    spawnSync(command, args, { ...options, timeout: 30000, maxBuffer: 8 * 1024 * 1024 }));
  if (response.status !== 200) throw new Error(`Pinned skill inventory returned GitHub HTTP ${response.status}.`);
  return parse(response.body);
}

export function inventorySkills(root, readTree = pinnedTree) {
  const skills = [];
  for (const plugin of json(resolve(root, "marketplace.json")).plugins) {
    if (typeof plugin.name !== "string" || !name.test(plugin.name)) throw new Error("Unsupported catalog plugin name.");
    let names;
    if (typeof plugin.source === "string") {
      if (plugin.source !== `./plugins/${plugin.name}` && plugin.source !== `plugins/${plugin.name}`) {
        throw new Error("Expected a self-contained local plugin path.");
      }
      const directory = resolve(root, plugin.source, "skills");
      names = existsSync(directory) ? readdirSync(directory).filter((skill) =>
        name.test(skill) && existsSync(resolve(directory, skill, "SKILL.md"))) : [];
    } else {
      const source = plugin.source;
      if (source?.source !== "github" || typeof source.repo !== "string" || !/^[\w.-]+\/[\w.-]+(?![\s\S])/.test(source.repo) ||
          typeof source.sha !== "string" || !sha.test(source.sha)) {
        throw new Error("Remote skill inventory requires a pinned GitHub source.");
      }
      if (source.path !== undefined && (typeof source.path !== "string" || source.path.split("/").includes(".."))) {
        throw new Error("Unsupported remote plugin path.");
      }
      const prefix = source.path ? `${source.path}/` : "";
      const tree = readTree(source.repo, source.sha);
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("Incomplete pinned remote skill inventory.");
      names = tree.tree.flatMap((entry) => {
        if (entry.type !== "blob" || !entry.path.startsWith(`${prefix}skills/`)) return [];
        const parts = entry.path.slice(`${prefix}skills/`.length).split("/");
        return parts.length === 2 && parts[1] === "SKILL.md" && name.test(parts[0]) ? [parts[0]] : [];
      });
    }
    for (const skill of names) skills.push({
      key: `${plugin.name}/${skill}`,
      hasEval: existsSync(resolve(root, "evals", plugin.name, "skills", skill, "eval.yaml")),
    });
  }
  return skills.sort((a, b) => a.key.localeCompare(b.key));
}

export function selectSkillEvals(root, context, environment, readTree = pinnedTree) {
  if (!environment.protection_rules?.some((rule) => rule.type === "required_reviewers" && rule.reviewers?.length)) {
    throw new Error("Configure the evals environment with required maintainer reviewers before enabling paid PR evals.");
  }
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (![context.base, context.head, context.merge].every((value) => sha.test(value ?? "")) ||
      git("rev-parse", "HEAD") !== context.merge || git("rev-parse", "HEAD^1") !== context.base ||
      git("rev-parse", "HEAD^2") !== context.head) {
    throw new Error("Expected the verified PR merge and its exact parents.");
  }
  const changed = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", context.base, "HEAD", "--", "plugins"],
    { cwd: root, encoding: "utf8" });
  const keys = [...new Set(changed.split("\0").flatMap((file) => {
    const match = /^plugins\/([^/]+)\/skills\/([^/]+)\//.exec(file);
    return match ? [`${match[1]}/${match[2]}`] : [];
  }))].sort();
  const skills = inventorySkills(root, readTree);
  const catalogued = new Set(skills.map((skill) => skill.key));
  const include = [];
  for (const key of keys) {
    if (key.split("/").length !== 2 || !key.split("/").every((part) => name.test(part))) {
      throw new Error("Unsupported plugin or skill path in PR changes.");
    }
    const [plugin, skill] = key.split("/");
    const directory = `plugins/${plugin}/skills/${skill}`;
    const evalPath = `evals/${plugin}/skills/${skill}/eval.yaml`;
    const present = (ref) => {
      const result = spawnSync("git", ["cat-file", "-e", `${ref}:${directory}/SKILL.md`], { cwd: root, stdio: "ignore" });
      if (result.error) throw result.error;
      if (result.status !== 0 && result.status !== 128) throw new Error("Could not inspect the skill source tree.");
      return result.status === 0;
    };
    if (catalogued.has(key) && present(context.base) && present(context.head) && existsSync(resolve(root, evalPath))) {
      include.push({ key, id: `skill-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`,
        directory, evalPath, base: context.base, head: context.head });
    }
  }
  return { ...context, include, changed: keys, skills };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const [contextFile, environmentFile, outputFile] = process.argv.slice(2);
    if (!contextFile || !environmentFile || !outputFile) throw new Error("Expected context, environment and selection file paths.");
    const selection = selectSkillEvals(process.cwd(), json(contextFile), json(environmentFile));
    for (const key of selection.changed.filter((key) => !selection.include.some((entry) => entry.key === key))) {
      console.log(`::warning::No before/after pair for ${key}: a catalogued skill, both source versions and its repo eval are required. No eval was run.`);
    }
    writeFileSync(outputFile, `${JSON.stringify(selection)}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT,
      `matrix=${JSON.stringify({ include: selection.include })}\ncount=${selection.include.length}\nattempt=${selection.attempt}\nselection=${JSON.stringify(selection)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
