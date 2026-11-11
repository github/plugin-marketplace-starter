import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { checkRemotePin, githubApi } from "./check-remote-pins.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const gitHash = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

function inside(directory, path) {
  const result = resolve(directory, path);
  const rel = relative(directory, result);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`Expected a path inside ${directory}: ${path}`);
  }
  return result;
}

function localSkills(directory) {
  const skills = resolve(directory, "skills");
  if (!existsSync(skills)) return [];
  return readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = resolve(skills, entry.name);
      if (!existsSync(resolve(path, "SKILL.md"))) throw new Error(`Missing SKILL.md: ${path}`);
      return path;
    });
}

export function checkMarketplaceEnvironment(directory = root, remoteSkills = undefined) {
  const catalog = readJson(resolve(directory, "marketplace.json"));
  const config = parse(readFileSync(resolve(directory, ".vally.yaml"), "utf8"));
  const configured = config.environments?.marketplace?.skills;
  if (!Array.isArray(configured)) throw new Error("Missing environments.marketplace.skills in .vally.yaml.");
  const evalDirectory = resolve(directory, "evals/_plugin/skills/_skill");
  const paths = configured.map((path) => resolve(evalDirectory, path));
  const expected = [];
  for (const entry of catalog.plugins) {
    if (typeof entry.source === "string") {
      expected.push(...localSkills(inside(directory, entry.source)));
    } else {
      const { source, repo, path = "", sha } = entry.source ?? {};
      if (source !== "github" || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !/^[a-f0-9]{40}$/.test(sha ?? "")) {
        throw new Error(`${entry.name}: expected a GitHub source pinned to a full commit SHA.`);
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.name)
        || (path && (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split("/").some((part) => [".", ".."].includes(part))))) {
        throw new Error(`${entry.name}: invalid remote plugin name or source path.`);
      }
      const skillsRoot = resolve(directory, ".vally/marketplace", entry.name, sha, "skills");
      expected.push(...(remoteSkills
        ? remoteSkills.get(entry.name)
        : paths.filter((candidate) => dirname(candidate) === skillsRoot)));
    }
  }
  if (new Set(paths.map((path) => basename(path))).size !== paths.length) throw new Error("Duplicate marketplace skill names.");
  if (paths.length !== expected.length || paths.some((path) => !expected.includes(path))) {
    throw new Error("marketplace.skills must match the catalog's skill directories and remote pins. Update .vally.yaml.");
  }
  return paths;
}

export function prepareEvalContext(directory = root, api = githubApi) {
  checkMarketplaceEnvironment(directory);
  const remoteSkills = new Map();
  for (const entry of readJson(resolve(directory, "marketplace.json")).plugins) {
    if (typeof entry.source === "string") continue;
    checkRemotePin(entry, api);
    const { repo, path = "", sha } = entry.source;
    const response = api(`repos/${repo}/git/trees/${sha}?recursive=1`);
    if (response.status !== 200) throw new Error(`${entry.name}: couldn't read the pinned skill tree (HTTP ${response.status}).`);
    const tree = JSON.parse(response.body);
    if (tree.truncated) throw new Error(`${entry.name}: GitHub truncated the tree; skill completeness is unknown.`);
    const prefix = `${path ? `${path}/` : ""}skills/`;
    const files = tree.tree.filter((item) => item.type === "blob" && item.path.startsWith(prefix));
    const destination = resolve(directory, ".vally/marketplace", entry.name, sha, "skills");
    const expectedFiles = files.map((item) => inside(destination, item.path.slice(prefix.length)));
    for (const [index, item] of files.entries()) {
      if (!["100644", "100755"].includes(item.mode)) throw new Error(`${entry.name}: unsupported skill file mode at ${item.path}.`);
      const file = expectedFiles[index];
      if (existsSync(file)) {
        if (gitHash(readFileSync(file)) !== item.sha) throw new Error(`Modified cached skill source: ${file}. Remove that cache and prepare again.`);
        continue;
      }
      const blob = api(`repos/${repo}/git/blobs/${item.sha}`, undefined, "application/vnd.github+json");
      if (blob.status !== 200) throw new Error(`${entry.name}: couldn't fetch ${item.path} (HTTP ${blob.status}).`);
      const content = JSON.parse(blob.body);
      if (content.encoding !== "base64") throw new Error(`${entry.name}: unexpected blob encoding at ${item.path}.`);
      const bytes = Buffer.from(content.content, "base64");
      if (gitHash(bytes) !== item.sha) throw new Error(`${entry.name}: content hash mismatch at ${item.path}.`);
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, bytes, { mode: item.mode === "100755" ? 0o755 : 0o644 });
        renameSync(temporary, file);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    if (existsSync(destination)) {
      for (const file of readdirSync(destination, { recursive: true, withFileTypes: true })) {
        if (file.isDirectory()) continue;
        const absolute = resolve(file.parentPath, file.name);
        if (!expectedFiles.includes(absolute)) throw new Error(`Unexpected cached skill file: ${absolute}. Remove that cache and prepare again.`);
      }
    }
    remoteSkills.set(entry.name, files
      .filter((item) => /^[^/]+\/SKILL\.md$/.test(item.path.slice(prefix.length)))
      .map((item) => dirname(inside(destination, item.path.slice(prefix.length)))));
  }
  return checkMarketplaceEnvironment(directory, remoteSkills);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const skills = prepareEvalContext(process.cwd());
  console.log(`Prepared ${skills.length} marketplace skills. No plugins installed or evals run.`);
}
