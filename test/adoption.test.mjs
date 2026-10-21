import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { parse, stringify } from "yaml";
import { root } from "../scripts/validate-evals.mjs";
import { examples } from "../scripts/examples.mjs";
import { pruneMarkdown } from "../scripts/remove-plugin.mjs";

// Never copied into a scratch repository: dependencies are linked, and results,
// eval state, and isolated Copilot homes don't belong to the template.
const skipped = new Set([".git", "node_modules", "vally-results", ".vally", ".copilot-home"]);
// Tests that would recurse or install every plugin into a Copilot home; they
// run in the real checkout only.
const outerOnly = new Set(["adoption.test.mjs", "installation.test.mjs"]);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const present = Object.keys(examples).filter((name) => existsSync(resolve(root, "plugins", name)));

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
  return result.stdout;
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
  // node_modules is linked into the copy, which changes bundle path comments,
  // so rebuild here; the real checkout runs build --check.
  await ok(directory, "scripts/build.mjs");
  await ok(directory, "scripts/build.mjs", "--check");
  const coverage = await ok(directory, "scripts/validate-evals.mjs");
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
  return { validated, coverage };
}

const newPlugin = (directory, ...args) => ok(directory, "scripts/new-plugin.mjs", ...args);
const removeExamples = (directory, ...names) => ok(directory, "scripts/remove-plugin.mjs", "--example", ...names);

// Follows the README's "Make it yours" steps on a copy of this repository, as a
// team that already has its own plugins would: one named like an old test
// fixture, and a second MCP server next to the JSON example.
test("a team can rename the marketplace, drop examples and the remote entry, and add its own plugins", { timeout: 600_000 }, async (t) => {
  const directory = await scratchRepository(t);
  const fixture = `adoption-${randomBytes(3).toString("hex")}`;
  if (!existsSync(join(directory, "plugins/release-notes"))) await newPlugin(directory, "release-notes");
  await newPlugin(directory, `${fixture}-tools`, "--with", "mcp", "--with", "agent", "--description", "Fixture tools for the adoption test.");
  const dropped = ["team-brainstorm", "format-json"].filter((name) => present.includes(name));
  if (dropped.length) await removeExamples(directory, ...dropped);

  const catalog = await json(join(directory, "marketplace.json"));
  catalog.name = `${fixture}-marketplace`;
  catalog.owner = { name: "Acme" };
  catalog.plugins = catalog.plugins.filter((entry) => typeof entry.source === "string");
  await writeJson(join(directory, "marketplace.json"), catalog);
  const manifest = await json(join(directory, "package.json"));
  await writeJson(join(directory, "package.json"), { ...manifest, name: `${fixture}-marketplace` });
  await writeJson(join(directory, ".github/copilot/settings.json"), {
    extraKnownMarketplaces: { [catalog.name]: { source: { source: "directory", path: "." } } },
    enabledPlugins: Object.fromEntries(catalog.plugins.map((entry) => [`${entry.name}@${catalog.name}`, true])),
  });

  const { validated, coverage } = await verify(directory);
  assert.match(validated, /0 remote references/);
  assert.doesNotMatch(validated, /name is still the template's/);
  assert.match(coverage, new RegExp(`skill:${fixture}-tools/${fixture}-tools`));
  assert.match(coverage, new RegExp(`agent:${fixture}-tools/${fixture}-tools-specialist`));
  assert.match(coverage, new RegExp(`mcp:${fixture}-tools/${fixture}-tools/echo`));
  for (const name of dropped) assert.doesNotMatch(coverage, new RegExp(`:${name}/`));
  const params = await ok(directory, "scripts/evals.mjs", "action-params");
  for (const name of dropped) assert.doesNotMatch(params, new RegExp(name));

  // Scaffolding refuses names that would collide or aren't valid plugin names.
  for (const name of [`${fixture}-tools`, "Bad_Name"]) {
    const refused = await run(directory, "scripts/new-plugin.mjs", name);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /already|must be lowercase/);
    assert.doesNotMatch(refused.stderr, /\n\s+at /, "Expected a plain message, not a stack trace.");
  }

  // Every problem is reported at once as `path: message`, without a stack trace.
  const vally = parse(await readFile(join(directory, ".vally.yaml"), "utf8"));
  vally.paths.skills = vally.paths.skills.filter((path) => !path.includes(fixture));
  await writeFile(join(directory, ".vally.yaml"), stringify(vally));
  await writeFile(join(directory, "README.md"), `${await readFile(join(directory, "README.md"), "utf8")}\n[one](missing-one.md) [two](missing-two.md)\n`);
  const stale = await run(directory, "scripts/validate.mjs");
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, new RegExp(`\\.vally\\.yaml paths\\.skills must list plugins/${fixture}-tools/skills`));
  assert.match(stale.stderr, /README\.md: broken relative link missing-one\.md/);
  assert.match(stale.stderr, /README\.md: broken relative link missing-two\.md/);
  assert.doesNotMatch(stale.stderr, /\n\s+at /);
});

test("removing every example leaves checks and tests that pass for a team's own plugin", { timeout: 600_000, skip: !present.length && "no examples left" }, async (t) => {
  const directory = await scratchRepository(t);
  const name = `adoption-${randomBytes(3).toString("hex")}`;
  await newPlugin(directory, name);
  await removeExamples(directory, ...present);
  for (const example of present) {
    for (const path of [`plugins/${example}`, `evals/${example}`, ...examples[example].paths]) {
      assert.ok(!existsSync(join(directory, path)), `${path} should be removed with ${example}.`);
    }
  }
  const vally = parse(await readFile(join(directory, ".vally.yaml"), "utf8"));
  for (const example of present) for (const param of examples[example].params) assert.equal(vally.params?.[param], undefined);
  const { validated, coverage } = await verify(directory);
  assert.doesNotMatch(validated, new RegExp(`mentions plugins/(${present.join("|")})`));
  assert.match(coverage, new RegExp(`skill:${name}/${name}`));
});

test("each example can be removed on its own", { timeout: 600_000, skip: !present.length && "no examples left" }, async (t) => {
  const pending = [...present];
  const worker = async () => {
    for (let name = pending.shift(); name; name = pending.shift()) {
      const directory = await scratchRepository(t);
      await removeExamples(directory, name);
      await verify(directory, { tests: false });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
});

test("removal prunes install commands, marked sections, table rows, and links to removed files", () => {
  const removed = (link) => link.startsWith("plugins/gone") || link.startsWith("../plugins/gone");
  const text = [
    "| [gone](plugins/gone/) | row |",
    "| [kept](plugins/kept/) | row |",
    "copilot plugin install gone@market",
    "copilot plugin install kept@market",
    "<!-- plugin:gone -->",
    "Only about gone.",
    "<!-- /plugin:gone -->",
    "See [the gone README](../plugins/gone/README.md) and [kept](plugins/kept/).",
  ].join("\n");
  assert.equal(pruneMarkdown(text, ["gone"], removed), [
    "| [kept](plugins/kept/) | row |",
    "copilot plugin install kept@market",
    "See the gone README and [kept](plugins/kept/).",
  ].join("\n"));
});
