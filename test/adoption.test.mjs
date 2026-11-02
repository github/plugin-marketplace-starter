import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pruneMarkdown } from "../scripts/remove-plugin.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// Never copied into a scratch repository: dependencies are linked, and results,
// eval state, and isolated Copilot homes don't belong to the template.
const skipped = new Set([".git", "node_modules", "vally-results", ".vally", ".copilot-home"]);
// Tests that would recurse or install every plugin into a Copilot home; they
// run in the real checkout only.
const outerOnly = new Set(["adoption.test.mjs", "installation.test.mjs"]);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));

function run(directory, ...args) {
  return new Promise((done, fail) => {
    execFile(process.execPath, args, {
      cwd: directory, encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, VALLY_TELEMETRY_OPTOUT: "1", NODE_TEST_CONTEXT: undefined },
    }, (error, stdout, stderr) => {
      if (error && error.code !== undefined && typeof error.code !== "number") fail(error);
      else done({ status: error ? error.code ?? 1 : 0, stdout, stderr });
    });
  });
}

async function ok(directory, ...args) {
  const result = await run(directory, ...args);
  assert.equal(result.status, 0, `${args.join(" ")} failed in ${directory}:\n${result.stdout}\n${result.stderr}`);
  // Warnings go to stderr, so return both.
  return `${result.stdout}${result.stderr}`;
}

// Copies the repository one entry at a time, so it also works when the scratch
// directory is inside the checkout (for example, when TEMP points there).
async function copyTree(source, destination, exclude) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    if (skipped.has(entry.name) || from === exclude) continue;
    if (entry.isDirectory()) await copyTree(from, join(destination, entry.name), exclude);
    else if (entry.isFile()) await copyFile(from, join(destination, entry.name));
  }
}

async function scratchRepository(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "starter-adoption-")));
  t.after(async () => {
    // Remove the link itself first so cleanup can never reach the real node_modules.
    await unlink(join(directory, "node_modules")).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });
  await copyTree(await realpath(root), directory, directory);
  await symlink(resolve(root, "node_modules"), join(directory, "node_modules"), "junction");
  return directory;
}

// The same model-free checks as npm run verify, run inside a scratch copy.
async function verify(directory, { tests = true } = {}) {
  const validated = await ok(directory, "scripts/validate.mjs");
  await ok(directory, "scripts/evals.mjs", "lint");
  if (tests) {
    const files = (await readdir(join(directory, "test"))).filter((name) => name.endsWith(".test.mjs") && !outerOnly.has(name))
      .map((name) => `test/${name}`);
    const result = await run(directory, "--test", "--test-reporter=tap", ...files);
    const lines = result.stdout.split("\n");
    const failures = lines.flatMap((line, index) => /^\s*not ok/.test(line) ? lines.slice(index, index + 20) : []);
    assert.equal(result.status, 0, `Tests failed after customization:\n${failures.join("\n")}\n${result.stderr}`);
    assert.match(result.stdout, /# fail 0/);
  }
  return validated;
}

const localPlugins = async (directory) => (await json(join(directory, "marketplace.json"))).plugins
  .filter((entry) => typeof entry.source === "string").map((entry) => entry.name);

// Follows the README's "Make it yours" steps on a disposable copy.
test("a team can rename the marketplace, add its own plugin, and remove one", { timeout: 600_000 }, async (t) => {
  const directory = await scratchRepository(t);
  await ok(directory, "scripts/rename-marketplace.mjs", "--name", "jdoe-skills", "--owner", "jdoe", "--repo", "jdoe/my-skills");
  const catalog = await json(join(directory, "marketplace.json"));
  assert.deepEqual([catalog.name, catalog.owner.name], ["jdoe-skills", "jdoe"]);
  const settings = await json(join(directory, ".github/copilot/settings.json"));
  assert.deepEqual(Object.keys(settings.extraKnownMarketplaces), ["jdoe-skills"]);
  assert.ok(Object.keys(settings.enabledPlugins).every((key) => key.endsWith("@jdoe-skills")));
  const manifest = await json(join(directory, "package.json"));
  assert.deepEqual([manifest.name, manifest.repository.url], ["jdoe-skills", "https://github.com/jdoe/my-skills"]);
  const lock = await json(join(directory, "package-lock.json"));
  assert.deepEqual([lock.name, lock.packages[""].name], ["jdoe-skills", "jdoe-skills"]);
  const readme = await readFile(join(directory, "README.md"), "utf8");
  assert.doesNotMatch(readme, /plugin-marketplace-starter/);
  for (const name of await localPlugins(directory)) {
    const pluginReadme = await readFile(join(directory, "plugins", name, "README.md"), "utf8");
    assert.match(pluginReadme, new RegExp(`copilot plugin install ${name}@jdoe-skills`));
    assert.doesNotMatch(pluginReadme, /OWNER\/REPO/);
  }

  // A new plugin's README uses the real repository, and the shell passes verify.
  await ok(directory, "scripts/new-plugin.mjs", "regex-explainer", "--description", "Explain regular expressions.");
  assert.match(await readFile(join(directory, "plugins/regex-explainer/README.md"), "utf8"),
    /copilot plugin marketplace add jdoe\/my-skills\ncopilot plugin install regex-explainer@jdoe-skills/);
  assert.match(await readFile(join(directory, "README.md"), "utf8"), /\| \[regex-explainer\]\(plugins\/regex-explainer\/\) \| Explain regular expressions\. \|/);
  const validated = await verify(directory);
  assert.doesNotMatch(validated, /name is still the template's/);

  // Scaffolding refuses names that would collide or aren't valid plugin names.
  for (const name of ["regex-explainer", "Bad_Name", "graders"]) {
    const refused = await run(directory, "scripts/new-plugin.mjs", name);
    assert.notEqual(refused.status, 0, name);
    assert.match(refused.stderr, /already|must be lowercase|reserved/, name);
    assert.doesNotMatch(refused.stderr, /\n\s+at /, "Expected a plain message, not a stack trace.");
  }

  await ok(directory, "scripts/remove-plugin.mjs", "regex-explainer");
  assert.ok(!existsSync(join(directory, "plugins/regex-explainer")));
  assert.doesNotMatch(await readFile(join(directory, "README.md"), "utf8"), /regex-explainer/);
  assert.ok(!(await localPlugins(directory)).includes("regex-explainer"));
  await verify(directory, { tests: false });

  for (const args of [["--name", "Bad Name", "--owner", "x", "--repo", "a/b"], ["--name", "ok", "--owner", "x", "--repo", "https://github.com/a/b"]]) {
    const refused = await run(directory, "scripts/rename-marketplace.mjs", ...args);
    assert.notEqual(refused.status, 0);
    assert.doesNotMatch(refused.stderr, /\n\s+at /);
  }
});

// Removing every included plugin proves the template works with no plugins at
// all, then a new plugin scaffolds into what's left.
test("an empty marketplace passes verify, and new plugins scaffold into it", { timeout: 900_000 }, async (t) => {
  const directory = await scratchRepository(t);
  const included = await localPlugins(directory);
  if (included.length) await ok(directory, "scripts/remove-plugin.mjs", ...included);
  for (const name of included) {
    for (const path of [`plugins/${name}`, `evals/${name}`]) assert.ok(!existsSync(join(directory, path)), `${path} should be removed with ${name}.`);
    assert.ok(!(await readdir(join(directory, "test"))).some((file) => file.startsWith(`${name}-`)), `${name}'s tests should be removed.`);
  }
  for (const path of ["evals/graders/common.mjs", "scripts/new-plugin.mjs"]) assert.ok(existsSync(join(directory, path)), `${path} is shared and stays.`);
  const readme = await readFile(join(directory, "README.md"), "utf8");
  if (readme.includes("<!-- plugin-table -->")) assert.match(readme, /<!-- plugin-table -->\n\| Plugin \| What it does \|\n\|---\|---\|\n\| _None yet\._ \| \|\n/);
  for (const name of included) assert.doesNotMatch(readme, new RegExp(`plugins/${name}|install ${name}@`));
  const empty = await verify(directory);
  assert.match(empty, /There are no local plugins yet/);

  await ok(directory, "scripts/new-plugin.mjs", "notes");
  assert.match(await readFile(join(directory, "README.md"), "utf8"), /\| \[notes\]\(plugins\/notes\/\) \|/);
  await verify(directory, { tests: false });
});

test("removal renumbers a list that lost a marked step", () => {
  const text = ["1. One", "   <!-- plugin:gone -->", "2. Gone", "   more about it", "   <!-- /plugin:gone -->", "3. Three", "   detail", "", "4. Four", "", "Other text.", "1. Separate", "3. List"].join("\n");
  assert.equal(pruneMarkdown(text, ["gone"], () => false), ["1. One", "2. Three", "   detail", "", "3. Four", "", "Other text.", "1. Separate", "2. List"].join("\n"));
  assert.equal(pruneMarkdown("1. One\n3. Kept as is\n", [], () => false), "1. One\n3. Kept as is\n");
});

test("removal prunes install commands, marked sections, table rows, and links to removed files", () => {
  assert.equal(pruneMarkdown(["| Plugin | Notes |", "|---|---|", "| [gone](plugins/gone/) | row |", "", "after"].join("\n"),
    ["gone"], (link) => link.startsWith("plugins/gone")), ["| Plugin | Notes |", "|---|---|", "| _None yet._ | |", "", "after"].join("\n"));
  const removed = (link) => link.startsWith("plugins/gone") || link.startsWith("../plugins/gone");
  const text = [
    "| [gone](plugins/gone/) | row |",
    "| [kept](plugins/kept/) | row |",
    "| Hook | [gone](plugins/gone/) |",
    "copilot plugin install gone@market",
    "copilot plugin install kept@market",
    "<!-- plugin:gone -->",
    "Only about gone.",
    "<!-- /plugin:gone -->",
    "See [the gone README](../plugins/gone/README.md) and [kept](plugins/kept/).",
  ].join("\n");
  assert.equal(pruneMarkdown(text, ["gone"], removed), [
    "| [kept](plugins/kept/) | row |",
    "| Hook | gone |",
    "copilot plugin install kept@market",
    "See the gone README and [kept](plugins/kept/).",
  ].join("\n"));
});
