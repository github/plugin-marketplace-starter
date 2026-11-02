import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { addToReadme, newPlugin, repositoryName } from "../scripts/new-plugin.mjs";
import { renameMarkdown } from "../scripts/rename-marketplace.mjs";
import { assertRemovable, ownedPaths, removePlugins } from "../scripts/remove-plugin.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = (name, ...args) => spawnSync(process.execPath, [`scripts/${name}`, ...args], { cwd: root, encoding: "utf8", timeout: 60_000 });

async function marketplace(t) {
  const directory = await mkdtemp(join(tmpdir(), "starter-new-plugin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "marketplace.json"), JSON.stringify({ name: "fixture", owner: { name: "Test" }, plugins: [] }));
  await mkdir(join(directory, ".github/copilot"), { recursive: true });
  await writeFile(join(directory, ".github/copilot/settings.json"), JSON.stringify({ enabledPlugins: {} }));
  return directory;
}

test("new-plugin creates only the plugin shell and registers it", async (t) => {
  const directory = await marketplace(t);
  await writeFile(join(directory, "README.md"), [
    "<!-- plugin-table -->", "| Plugin | What it does |", "|---|---|", "| _None yet._ | |", "",
    "```sh", "copilot plugin marketplace browse fixture", "```", "",
  ].join("\n"));
  const { created, updated } = await newPlugin("release-notes", { directory, description: "Draft release notes." });
  assert.deepEqual(created, ["plugins/release-notes/plugin.json", "plugins/release-notes/README.md", "plugins/release-notes/CHANGELOG.md"]);
  assert.deepEqual((await readdir(join(directory, "plugins/release-notes"))).sort(), ["CHANGELOG.md", "README.md", "plugin.json"]);
  assert.deepEqual(updated, ["marketplace.json", ".github/copilot/settings.json", "README.md"]);
  assert.ok(!existsSync(join(directory, "evals")) && !existsSync(join(directory, "test")) && !existsSync(join(directory, ".vally.yaml")));
  const manifest = JSON.parse(await readFile(join(directory, "plugins/release-notes/plugin.json"), "utf8"));
  assert.deepEqual([manifest.name, manifest.version, manifest.description, manifest.license], ["release-notes", "0.1.0", "Draft release notes.", "MIT"]);
  const catalog = JSON.parse(await readFile(join(directory, "marketplace.json"), "utf8"));
  assert.deepEqual(catalog.plugins, [{ name: "release-notes", source: "./plugins/release-notes", version: "0.1.0", description: "Draft release notes." }]);
  const settings = JSON.parse(await readFile(join(directory, ".github/copilot/settings.json"), "utf8"));
  assert.deepEqual(settings.enabledPlugins, { "release-notes@fixture": true });
  assert.match(await readFile(join(directory, "plugins/release-notes/CHANGELOG.md"), "utf8"), /^## 0\.1\.0$/m);
  const readme = await readFile(join(directory, "plugins/release-notes/README.md"), "utf8");
  assert.match(readme, /copilot plugin marketplace add OWNER\/REPO\ncopilot plugin install release-notes@fixture/);
  assert.match(readme, /cli-plugin-reference/);
  await assert.rejects(newPlugin("release-notes", { directory }), /already has a plugin named release-notes/);
  await assert.rejects(newPlugin("Bad_Name", { directory }), /must be lowercase/);
});

test("the shared eval folder names can't be plugin names", async (t) => {
  const directory = await marketplace(t);
  for (const name of ["graders", "support"]) {
    await assert.rejects(newPlugin(name, { directory }), /is reserved/, name);
    assert.ok(!existsSync(join(directory, "plugins", name)), name);
    const cli = script("new-plugin.mjs", name);
    assert.notEqual(cli.status, 0, name);
    assert.match(cli.stderr, new RegExp(`"${name}" is reserved`));
    assert.ok(!(await ownedPaths(name, { directory })).includes(`evals/${name}`), name);
  }
});

test("new plugins join the README's plugin table and install commands", () => {
  const readme = [
    "<!-- plugin-table -->", "| Plugin | What it does |", "|---|---|", "| _None yet._ | |", "",
    "```sh", "copilot plugin marketplace add me/plugins", "copilot plugin marketplace browse mine", "```",
  ].join("\n");
  const once = addToReadme(readme, { name: "alpha", marketplace: "mine", description: "Does a | b." });
  assert.match(once, /\| \[alpha\]\(plugins\/alpha\/\) \| Does a \\\| b\. \|\n\n/);
  assert.doesNotMatch(once, /None yet/);
  assert.match(once, /browse mine\ncopilot plugin install alpha@mine\n```/);
  const twice = addToReadme(once, { name: "beta", marketplace: "mine", description: "Beta." });
  assert.match(twice, /\[alpha\][^\n]*\n\| \[beta\]/);
  assert.match(twice, /install alpha@mine\ncopilot plugin install beta@mine/);
  assert.equal(addToReadme("# Rewritten README\n", { name: "x", marketplace: "m", description: "d" }), "# Rewritten README\n");
});

test("the repository name comes from package.json in any common form", () => {
  for (const repository of ["github:me/plugins", "https://github.com/me/plugins", "https://github.com/me/plugins.git",
    { url: "git+https://github.com/me/plugins.git" }, { url: "git@github.com:me/plugins.git" }]) {
    assert.equal(repositoryName({ repository }), "me/plugins", JSON.stringify(repository));
  }
  assert.equal(repositoryName({}), undefined);
});

test("renaming rewrites install commands and placeholders, and drops template-only notes", () => {
  const from = { name: "plugin-marketplace-starter", repo: "github/plugin-marketplace-starter" };
  const to = { name: "jdoe-skills", repo: "jdoe/skills" };
  const readme = renameMarkdown([
    "# Plugin marketplace starter", "",
    "copilot plugin marketplace add github/plugin-marketplace-starter",
    "copilot plugin marketplace browse plugin-marketplace-starter",
    "copilot plugin install note-helper@plugin-marketplace-starter",
    "<!-- template-only -->", "This note describes the template.", "<!-- /template-only -->",
  ].join("\n"), { from, to });
  assert.equal(readme, [
    "# Jdoe Skills", "",
    "copilot plugin marketplace add jdoe/skills",
    "copilot plugin marketplace browse jdoe-skills",
    "copilot plugin install note-helper@jdoe-skills",
  ].join("\n"));
  const plugin = renameMarkdown([
    "```sh", "copilot plugin marketplace add OWNER/REPO", "copilot plugin install note-helper@plugin-marketplace-starter", "```", "",
    "Replace `OWNER/REPO` with the GitHub repository that hosts this marketplace.", "",
  ].join("\n"), { from, to });
  assert.equal(plugin, ["```sh", "copilot plugin marketplace add jdoe/skills", "copilot plugin install note-helper@jdoe-skills", "```", ""].join("\n"));
});

test("every script explains itself, and errors are plain messages", () => {
  for (const [name, args, pattern] of [
    ["evals.mjs", ["--help"], /Usage: node scripts\/evals\.mjs/],
    ["eval-report.mjs", ["--help"], /Usage: npm run eval:report/],
    ["new-plugin.mjs", ["--help"], /Creates the shell of a new plugin/],
    ["remove-plugin.mjs", ["--help"], /--dry-run/],
    ["rename-marketplace.mjs", ["--help"], /--repo <OWNER\/REPO>/],
    ["check-remotes.mjs", ["--help"], /uses the\s+network/],
  ]) {
    const result = script(name, ...args);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.match(result.stdout, pattern, name);
  }
  for (const [name, args, pattern] of [
    ["eval-report.mjs", ["--bogus"], /Unknown option '--bogus'\. Run npm run eval:report -- --help/],
    ["eval-report.mjs", ["--suite", "smoke", "--run-dir", "vally-results/not-a-run"], /results\.jsonl doesn't exist/],
    ["evals.mjs", ["frobnicate"], /Unknown command frobnicate/],
    ["new-plugin.mjs", ["x", "--bogus"], /Unknown option '--bogus'/],
  ]) {
    const result = script(name, ...args);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, pattern, name);
    assert.doesNotMatch(result.stderr, /\n\s+at /, `${name}: a plain message, not a stack trace`);
  }
});

test("a plugin owns its folders and its tests, but not a longer name's or the template's", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "starter-owned-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of ["test/notes.test.mjs", "test/notes-hook.test.mjs", "test/notes-sync.test.mjs", "test/notes-sync-grader.test.mjs",
    "test/catalog.test.mjs", "test/notes-guide.md", "evals/graders/common.mjs"]) {
    await mkdir(join(directory, file, ".."), { recursive: true });
    await writeFile(join(directory, file), "");
  }
  assert.deepEqual((await ownedPaths("notes", { directory, others: ["notes-sync"] })).sort(),
    ["evals/notes", "plugins/notes", "test/notes-hook.test.mjs", "test/notes.test.mjs"]);
  assert.ok(!(await ownedPaths("catalog", { directory })).includes("test/catalog.test.mjs"));
});

test("removal refuses anything that isn't a plugin name, before it touches the file system", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "starter-remove-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "marketplace.json"), JSON.stringify({ name: "fixture", owner: { name: "Test" }, plugins: [] }));
  for (const file of ["guides/keep.md", "scripts/keep.mjs", "plugins/real/plugin.json"]) {
    await mkdir(join(directory, file, ".."), { recursive: true });
    await writeFile(join(directory, file), "sentinel");
  }
  const outside = resolve(directory, "..");
  for (const name of ["../guides", "../scripts", "..\\guides", "plugins/../guides", "..", ".", "", "Docs", "a--b", outside, resolve(directory, "guides"), "x".repeat(65)]) {
    for (const dryRun of [true, false]) {
      await assert.rejects(removePlugins([name], { directory, dryRun }), /isn't a plugin name\. Plugin names are lowercase.*Nothing was removed/, JSON.stringify(name));
    }
  }
  // One bad name stops the whole request, even with a valid one beside it.
  await assert.rejects(removePlugins(["real", "../guides"], { directory }), /isn't a plugin name/);
  for (const file of ["guides/keep.md", "scripts/keep.mjs", "plugins/real/plugin.json"]) assert.ok(existsSync(join(directory, file)), file);
  await assert.rejects(removePlugins(["ghost"], { directory }), /No plugin named ghost/);
  // Deletion is limited to plugins/, evals/, and test/.
  for (const path of ["plugins/real", "evals/real", "test/real.test.mjs"]) assert.doesNotThrow(() => assertRemovable(directory, path), path);
  for (const path of ["plugins", "plugins/../guides", "../plugins/x", "guides/keep.md", "scripts/x.mjs", outside]) {
    assert.throws(() => assertRemovable(directory, path), /Refusing to remove/, path);
  }
  const cli = script("remove-plugin.mjs", "../scripts", "--dry-run");
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /"\.\.\/scripts" isn't a plugin name/);
  assert.doesNotMatch(cli.stdout, /Would remove/);
});
