import assert from "node:assert/strict";
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Top-level folders in evals/ that hold files several plugins share. They can't
// be plugin names, since evals/<name>/ belongs to the plugin of that name.
export const reservedNames = Object.freeze(["graders", "support"]);

export function parseYaml(text, label) {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label}: ${document.errors.map((error) => error.message).join("; ")}`);
  return document.toJS();
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
  const fail = (message) => `${name}: ${message}`;
  assert.ok(source && typeof source === "object" && !Array.isArray(source), fail('"source" must be a GitHub source object or a "./plugins/<name>" path.'));
  const unknown = Object.keys(source).filter((key) => !["source", "repo", "path", "ref", "sha"].includes(key));
  assert.ok(!unknown.length, fail(`unknown source field ${unknown.join(", ")}. Use only source, repo, path, ref, and sha.`));
  assert.equal(source.source, "github", fail('only "source": "github" remote references are supported.'));
  assert.ok(typeof source.repo === "string" && /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/.test(source.repo),
    fail('"repo" must be OWNER/REPO, such as "octo-org/plugins", not a URL.'));
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
// filenames, suites, and params that Vally uses.
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

const globRegExp = (glob) => new RegExp(`^${glob.replace(/[.+^$|()[\]{}]/g, "\\$&").replaceAll("**/", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", "(?:.*/)?")}$`);

// Every eval spec under evals/, the way Vally finds them: the configured
// evalFilenames, skipping dist, node_modules, and hidden directories.
export async function readEvals(directory = repositoryRoot, config) {
  const vally = config ?? await readVallyConfig(directory);
  const isEval = evalFilenameMatcher(evalFilenames(vally));
  const specs = [];
  async function walk(path) {
    let entries = [];
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const entry of entries) {
      const child = resolve(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Do not use symlinked eval inputs: ${child}`);
      if (entry.isDirectory()) {
        if (!["dist", "node_modules"].includes(entry.name) && !entry.name.startsWith(".")) await walk(child);
      } else if (isEval(entry.name)) specs.push({ path: child, spec: parseYaml(await readFile(child, "utf8"), child) });
    }
  }
  await walk(resolve(directory, "evals"));
  return specs;
}

// A case's tags as Vally sees them: the eval's top-level tags, with the case's
// own tags winning on the same key.
export function effectiveTags(spec, stimulus) {
  return { ...(spec?.tags ?? {}), ...(stimulus?.tags ?? {}) };
}

// Vally's tag matching: every key in the filter must have one of its values.
export function matchesTags(tags, filter = {}) {
  const values = (key) => Object.hasOwn(tags, key) ? asList(tags[key]).map(String) : [];
  return Object.entries(filter).every(([key, wanted]) => asList(wanted).some((item) => values(key).includes(String(item))));
}

// The cases a saved run of a .vally.yaml suite should contain, using the
// suite's `evals` globs and tag filter the way Vally does.
export function expectedCases(specs, config, { suite = "full", directory = repositoryRoot } = {}) {
  const definition = config?.suites?.[suite];
  if (!definition) throw new Error(`Unknown suite ${suite}. Configured suites: ${Object.keys(config?.suites ?? {}).join(", ") || "none"}.`);
  let selected = specs;
  if (definition.evals) {
    const globs = asList(definition.evals).map(globRegExp);
    selected = selected.filter((item) => globs.some((glob) => glob.test(relative(directory, item.path).split(sep).join("/"))));
  }
  const expected = new Set();
  for (const { spec } of selected) {
    for (const stimulus of spec.stimuli ?? []) {
      if (!matchesTags(effectiveTags(spec, stimulus), definition.filter ?? {})) continue;
      if (expected.has(stimulus.name)) throw new Error(`Duplicate case: ${stimulus.name}`);
      expected.add(stimulus.name);
    }
  }
  if (!expected.size) throw new Error(`The ${suite} suite contains no cases.`);
  return expected;
}
