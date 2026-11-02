import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseYaml } from "../scripts/catalog.mjs";
import { markdownLinks, templateWarnings, validateRepository } from "../scripts/validate.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

// A one-plugin marketplace that passes validation, to break one piece at a time.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "starter-validate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plugin = join(directory, "plugins/notes");
  await mkdir(plugin, { recursive: true });
  await mkdir(join(directory, ".github/copilot"), { recursive: true });
  await writeFile(join(directory, "marketplace.json"), JSON.stringify({ name: "fixture", owner: { name: "Test" }, plugins: [
    { name: "notes", source: "./plugins/notes", version: "1.0.0", description: "Notes fixture." },
  ] }));
  await writeFile(join(directory, ".github/copilot/settings.json"), JSON.stringify({
    extraKnownMarketplaces: { fixture: { source: { source: "directory", path: "." } } },
    enabledPlugins: { "notes@fixture": true },
  }));
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "notes", version: "1.0.0", description: "Notes fixture.",
  }));
  await writeFile(join(plugin, "README.md"), "# Notes\n");
  await writeFile(join(plugin, "CHANGELOG.md"), "# Changelog\r\n\r\n## 1.0.0\r\n");
  return directory;
}

test("this repository passes validation", async () => {
  const result = await validateRepository(root);
  assert.ok(result.plugins >= 0);
});

test("a plugin shell with only plugin.json, README, and CHANGELOG is a valid marketplace plugin", async (t) => {
  const directory = await fixture(t);
  const result = await validateRepository(directory);
  assert.deepEqual([result.plugins, result.remotePlugins, result.warnings], [1, 0, []]);
});

test("the manifest must match its catalog entry and have a changelog heading for its version", async (t) => {
  const directory = await fixture(t);
  const manifestPath = join(directory, "plugins/notes/plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const [change, pattern] of [
    [{ version: "1.0.1" }, /doesn't match the marketplace\.json entry \(1\.0\.0\)/],
    [{ description: "Other." }, /description must match/],
    [{ name: "other" }, /name "other" doesn't match/],
    [{ surprise: true }, /must NOT have additional properties/],
  ]) {
    await writeFile(manifestPath, JSON.stringify({ ...manifest, ...change }));
    await assert.rejects(validateRepository(directory), pattern, JSON.stringify(change));
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(directory, "plugins/notes/CHANGELOG.md"), "# Changelog\n\n## 0.9.0\n");
  await assert.rejects(validateRepository(directory), /needs a "## 1\.0\.0" heading/);
  await writeFile(join(directory, "plugins/notes/CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n");
  await rm(join(directory, "plugins/notes/README.md"));
  await assert.rejects(validateRepository(directory), /plugins\/notes\/README\.md/);
});

test("every plugin folder is in the catalog, and the overlay enables exactly the local plugins", async (t) => {
  const directory = await fixture(t);
  await mkdir(join(directory, "plugins/uncatalogued"));
  await assert.rejects(validateRepository(directory), /Every plugin must be registered.*uncatalogued/);
  await rm(join(directory, "plugins/uncatalogued"), { recursive: true });
  const settingsPath = join(directory, ".github/copilot/settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  await writeFile(settingsPath, JSON.stringify({ ...settings, enabledPlugins: {} }));
  await assert.rejects(validateRepository(directory), /Enable every local plugin/);
  await writeFile(settingsPath, JSON.stringify({ ...settings, enabledPlugins: { ...settings.enabledPlugins, "remote@fixture": true } }));
  await assert.rejects(validateRepository(directory), /Never enable a remote plugin/);
  await writeFile(settingsPath, JSON.stringify({ ...settings, extraKnownMarketplaces: { other: { source: { source: "directory", path: "." } } } }));
  await assert.rejects(validateRepository(directory), /must point at this checkout/);
});

test("broken relative links fail, outside generated and isolated folders", async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, "README.md"), "[notes](plugins/notes/README.md) [gone](missing.md)\n");
  await assert.rejects(validateRepository(directory), /README\.md: broken relative link missing\.md/);
  await writeFile(join(directory, "README.md"), "[notes](plugins/notes/README.md)\n");
  await mkdir(join(directory, ".copilot-home/installed"), { recursive: true });
  await writeFile(join(directory, ".copilot-home/installed/README.md"), "[gone](missing.md)\n");
  await validateRepository(directory);
});

test("verify warns while the template's names remain", async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "plugin-marketplace-starter" }));
  const warnings = await templateWarnings(directory, { name: "plugin-marketplace-starter", owner: { name: "GitHub" } });
  assert.equal(warnings.length, 3);
  assert.match(warnings.join("\n"), /rename-marketplace/);
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "ours" }));
  assert.deepEqual(await templateWarnings(directory, { name: "ours", owner: { name: "Us" } }), []);
});

test("duplicate YAML keys are rejected", () => {
  assert.throws(() => parseYaml("name: first\nname: second", "fixture"), /unique|Map keys/);
});

test("the vendored schema keeps its Apache-2.0 license and attribution", async () => {
  assert.match(await readFile(resolve(root, "schemas/NOTICE"), "utf8"), /plugin\.schema\.json/);
  assert.match(await readFile(resolve(root, "schemas/LICENSE-APACHE-2.0.txt"), "utf8"), /Apache License/);
});

test("Markdown link checks ignore code, web, mailto, and anchor links", () => {
  const text = [
    "See [the guide](guide.md#setup) and [home](https://example.com) or [mail](mailto:security@example.com).",
    "Jump to [a section](#section). Inline `[x](not/a/link.md)` stays code.",
    "```js", "const pattern = /\\]\\((broken)\\)/; // [y](also/not/a/link.md)", "```",
    "~~~", "[z](fenced/tilde.md)", "~~~",
    "Then [real](plugins/a/README.md).",
  ].join("\n");
  assert.deepEqual(markdownLinks(text), ["guide.md#setup", "plugins/a/README.md"]);
  assert.deepEqual(markdownLinks("```\n[open](unclosed.md)\n"), []);
  assert.deepEqual(markdownLinks("```\r\n[x](crlf.md)\r\n```\r\n[y](after.md)\r\n"), ["after.md"]);
});
