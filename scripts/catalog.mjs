import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseYaml(text, label) {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label}: ${document.errors.map((error) => error.message).join("; ")}`);
  return document.toJS();
}

export function frontmatter(text, label) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${label}: YAML frontmatter is required`);
  const data = parseYaml(match[1], label);
  if (!data || typeof data.name !== "string" || !namePattern.test(data.name) || data.name.length > 64
    || typeof data.description !== "string" || !data.description.trim() || data.description.length > 1024) {
    throw new Error(`${label}: a valid name and nonempty description are required`);
  }
  if (!text.slice(match[0].length).trim()) throw new Error(`${label}: instructions are empty`);
  return data;
}

export async function contained(base, path) {
  const root = await realpath(base);
  const target = await realpath(resolve(root, path));
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel.split(sep).includes("..")) throw new Error(`Path escapes its plugin: ${path}`);
  return target;
}
const relativePath = (value) => typeof value === "string" && value.length > 0
  && !/[\\:\u0000-\u001f\u007f]/.test(value)
  && value.split("/").every((part) => part && part !== "." && part !== "..");

export const shaHelp = "Look it up with: gh api repos/OWNER/REPO/commits/REF --jq .sha";

// A remote entry must pin a full commit sha. A tag or branch can move, so
// without one, installs follow whatever upstream points it at later.
export function validateRemoteSource(source, name = "remote plugin") {
  const fail = (message) => `${name}: ${message} See docs/remote-plugins.md.`;
  assert.ok(source && typeof source === "object" && !Array.isArray(source), fail('"source" must be a GitHub source object or a "./plugins/<name>" path.'));
  const unknown = Object.keys(source).filter((key) => !["source", "repo", "path", "ref", "sha"].includes(key));
  assert.ok(!unknown.length, fail(`unknown source field ${unknown.join(", ")}. Use only source, repo, path, ref, and sha.`));
  assert.equal(source.source, "github", fail('only "source": "github" remote references are supported.'));
  assert.ok(typeof source.repo === "string" && /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(source.repo),
    fail('"repo" must be OWNER/REPO, such as "github/evals", not a URL.'));
  if (source.path !== undefined) {
    assert.ok(relativePath(source.path), fail(`"path" must be a directory relative to the repository root, such as "packages/plugin", without a leading "./" or "/", "..", or backslashes. Omit "path" when plugin.json is at the repository root.`));
  }
  if (source.ref !== undefined) assert.ok(typeof source.ref === "string" && source.ref.trim()
    && !/[\u0000-\u001f\u007f]/.test(source.ref), fail('"ref" must be a nonempty tag or branch name.'));
  assert.ok(source.sha !== undefined, fail(`pin "sha" to the full 40-character commit ID you reviewed, so a moved tag or branch can't change what people install. ${shaHelp}`));
  assert.ok(typeof source.sha === "string" && /^[a-fA-F0-9]{40}$/.test(source.sha),
    fail(`"sha" must be a full 40-character commit ID, not a tag, branch, or short ID. ${shaHelp}`));
}

// A ref is optional, but it tells reviewers which release the sha came from.
export function remoteWarnings(entry) {
  const warnings = [];
  if (entry.source.ref === undefined) warnings.push(`${entry.name}: add "ref" with the upstream release tag the sha came from, so reviewers can tell what's pinned.`);
  return warnings;
}

export function partitionCatalog(catalog) {
  assert.ok(catalog && typeof catalog === "object" && !Array.isArray(catalog), "marketplace.json must be a JSON object.");
  assert.ok(typeof catalog.name === "string" && namePattern.test(catalog.name),
    `name "${catalog.name ?? ""}" must be lowercase letters, digits, and single hyphens, such as my-team-plugins.`);
  assert.ok(typeof catalog.owner?.name === "string" && catalog.owner.name.trim(), 'set owner.name, such as { "name": "My Team" }.');
  assert.ok(Array.isArray(catalog.plugins), 'plugins must be a list. Use "plugins": [] for an empty marketplace.');
  const names = new Set();
  const localPlugins = [];
  const remotePlugins = [];
  catalog.plugins.forEach((entry, index) => {
    assert.ok(typeof entry?.name === "string" && namePattern.test(entry.name),
      `plugins[${index}]: name "${entry?.name ?? ""}" must be lowercase letters, digits, and single hyphens.`);
    assert.ok(!names.has(entry.name), `Duplicate plugin: ${entry.name}`);
    names.add(entry.name);
    if (typeof entry.source === "string") {
      assert.ok(entry.source.startsWith("./plugins/") && relativePath(entry.source.slice(2)), `${entry.name}: Local source must stay under ./plugins/, such as "./plugins/${entry.name}".`);
      localPlugins.push(entry);
    } else {
      validateRemoteSource(entry.source, entry.name);
      assert.ok(entry.version === undefined || (typeof entry.version === "string" && entry.version.trim()),
        `${entry.name}: remote version must be nonempty text.`);
      remotePlugins.push(entry);
    }
  });
  return { catalog, localPlugins, remotePlugins };
}

export async function readCatalog(directory) {
  return partitionCatalog(JSON.parse(await readFile(resolve(directory, "marketplace.json"), "utf8")));
}

// Shared view of .vally.yaml so the repository tools follow the same eval
// filenames, suites, skill paths, and params that Vally uses.
export const defaultEvalFilenames = Object.freeze(["eval.yaml", "eval.yml"]);

export async function readVallyConfig(directory) {
  let text;
  try { text = await readFile(resolve(directory, ".vally.yaml"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  const config = parseYaml(text, ".vally.yaml") ?? {};
  assert.ok(typeof config === "object" && !Array.isArray(config), ".vally.yaml must be a mapping.");
  return config;
}

const asList = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];

export function evalFilenames(config) {
  const names = asList(config?.paths?.evalFilenames);
  return names.length ? names : [...defaultEvalFilenames];
}

// Supports the `*` and `?` wildcards Vally users rely on, such as `*.eval.yaml`.
export function evalFilenameMatcher(patterns) {
  const regexes = patterns.map((pattern) => {
    assert.ok(typeof pattern === "string" && pattern && !/[/\\[\]{}!()]/.test(pattern),
      `.vally.yaml evalFilenames: use plain file names with * or ? wildcards, not "${pattern}".`);
    return new RegExp(`^${pattern.replace(/[.+^$|]/g, "\\$&").replaceAll("*", "[^/]*").replaceAll("?", ".")}$`);
  });
  return (name) => regexes.some((regex) => regex.test(name));
}

// Vally reads eval-level params from <basename>.params<ext> beside the eval.
export function paramsFileName(evalFileName) {
  const ext = extname(evalFileName);
  return `${basename(evalFileName, ext)}.params${ext}`;
}

const globRegExp = (glob) => new RegExp(`^${glob.replace(/[.+^$|()[\]{}]/g, "\\$&").replaceAll("**/", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", "(?:.*/)?")}$`);

// Selects the cases a saved run should contain, using the same suite
// definitions and eval file names as .vally.yaml.
export function expectedCases(specs, config, { suite, evalSpecs, directory = repositoryRoot } = {}) {
  let selected = specs;
  if (evalSpecs?.length) {
    const wanted = evalSpecs.map((path) => resolve(directory, path));
    for (const path of wanted) if (!specs.some((item) => item.path === path)) throw new Error(`No eval spec at ${path}.`);
    selected = specs.filter((item) => wanted.includes(item.path));
  }
  const name = suite ?? (evalSpecs?.length ? undefined : "full");
  let filter = {};
  if (name) {
    const definition = config?.suites?.[name];
    if (!definition) throw new Error(`Unknown suite ${name}. Configured suites: ${Object.keys(config?.suites ?? {}).join(", ") || "none"}.`);
    filter = definition.filter ?? {};
    if (definition.evals) {
      const globs = asList(definition.evals).map(globRegExp);
      selected = selected.filter((item) => globs.some((glob) => glob.test(relative(directory, item.path).split(sep).join("/"))));
    }
  }
  const expected = new Set();
  for (const { spec } of selected) {
    for (const stimulus of spec.stimuli) {
      if (!Object.entries(filter).every(([key, value]) => asList(value).some((item) => asList(stimulus.tags?.[key]).includes(item)))) continue;
      if (expected.has(stimulus.name)) throw new Error(`Duplicate case: ${stimulus.name}`);
      expected.add(stimulus.name);
    }
  }
  if (!expected.size) throw new Error("The selected suite or eval specs contain no cases.");
  return expected;
}
