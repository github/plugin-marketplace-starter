import { isEntrypoint } from "./entrypoint.mjs";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import { contained, readCatalog, remoteWarnings } from "./catalog.mjs";
import { Problems, runCli } from "./problems.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const ignored = [".git", "node_modules", "vally-results", ".vally", ".copilot-home"];
const ajv = new Ajv({ allErrors: true });
const validatePluginManifest = ajv.compile(await json(resolve(root, "schemas/plugin.schema.json")));

// Plugin directories under plugins/. A marketplace with no local plugins may not
// have that directory at all, because git doesn't keep empty directories.
export async function pluginDirectories(directory) {
  try {
    return (await readdir(resolve(directory, "plugins"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.filter((entry) => !ignored.includes(entry.name))
    .map((entry) => entry.isDirectory() ? files(resolve(path, entry.name)) : resolve(path, entry.name)))).flat();
}

// Relative link targets in Markdown, ignoring fenced code blocks, inline code,
// web URLs, mailto links, and same-page anchors.
export function markdownLinks(text) {
  const prose = text
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, "")
    .replace(/(`+)[^\n]*?\1/g, "");
  return [...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1])
    .filter((link) => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link));
}

export const templateDefaults = Object.freeze({ marketplace: "plugin-marketplace-starter", owner: "GitHub", package: "plugin-marketplace-starter" });

// Warnings, not failures: the template's names, which a team renames with
// npm run rename-marketplace when it makes the marketplace its own.
export async function templateWarnings(directory, catalog) {
  const warnings = [];
  if (catalog?.name === templateDefaults.marketplace) {
    warnings.push(`marketplace.json: name is still the template's "${templateDefaults.marketplace}". Run npm run rename-marketplace to rename it everywhere at once.`);
  }
  if (catalog?.owner?.name === templateDefaults.owner) {
    warnings.push(`marketplace.json: owner.name is still the template's "${templateDefaults.owner}". Set it to your team or organization, for example with npm run rename-marketplace.`);
  }
  try {
    if ((await json(resolve(directory, "package.json"))).name === templateDefaults.package) {
      warnings.push(`package.json: name is still the template's "${templateDefaults.package}". Run npm run rename-marketplace, or rename it to match your repository.`);
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return warnings;
}

const plural = (number, noun) => `${number} ${noun}${number === 1 ? "" : "s"}`;

async function validatePlugin(directory, entry, problems) {
  const label = `plugins/${entry.source.slice("./plugins/".length)}`;
  const source = await problems.check(label, () => contained(resolve(directory, "plugins"), entry.source.slice("./plugins/".length)));
  if (!source) return;
  const manifest = await problems.check(`${label}/plugin.json`, () => json(resolve(source, "plugin.json")));
  if (manifest) {
    const where = `${label}/plugin.json`;
    problems.checkSync(where, () => assert.ok(validatePluginManifest(manifest), ajv.errorsText(validatePluginManifest.errors)));
    problems.checkSync(where, () => assert.equal(manifest.name, entry.name, `name "${manifest.name}" doesn't match the marketplace.json entry "${entry.name}".`));
    problems.checkSync(where, () => assert.equal(manifest.version, entry.version, `version ${manifest.version} doesn't match the marketplace.json entry (${entry.version}). Change both together.`));
    problems.checkSync(where, () => assert.equal(manifest.description, entry.description, "description must match the marketplace.json entry exactly."));
    problems.checkSync(where, () => assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "use a MAJOR.MINOR.PATCH version."));
    await problems.check(`${label}/CHANGELOG.md`, async () => assert.ok((await readFile(resolve(source, "CHANGELOG.md"), "utf8")).replaceAll("\r\n", "\n").includes(`## ${manifest.version}\n`),
      `needs a "## ${manifest.version}" heading for the current version.`));
  }
  await problems.check(`${label}/README.md`, () => stat(resolve(source, "README.md")));
}

export async function validateRepository(directory = root) {
  const problems = new Problems(directory);
  const parsed = await problems.check("marketplace.json", () => readCatalog(directory));
  problems.throwIfAny();
  const { catalog, localPlugins, remotePlugins } = parsed;
  const names = new Set(localPlugins.map((entry) => entry.name));
  for (const entry of localPlugins) await validatePlugin(directory, entry, problems);
  await problems.check("plugins/", async () => {
    const unregistered = (await pluginDirectories(directory)).filter((name) => !names.has(name)).sort();
    assert.ok(!unregistered.length, `Every plugin must be registered in marketplace.json. Not listed: ${unregistered.join(", ")}.`);
  });
  await problems.check(".github/copilot/settings.json", async () => {
    const settings = await json(resolve(directory, ".github/copilot/settings.json"));
    assert.deepEqual(settings.extraKnownMarketplaces, {
      [catalog.name]: { source: { source: "directory", path: "." } },
    }, `The repository marketplace must point at this checkout: set extraKnownMarketplaces to { "${catalog.name}": { "source": { "source": "directory", "path": "." } } }.`);
    const expected = [...names].map((name) => `${name}@${catalog.name}`).sort();
    const actual = Object.keys(settings.enabledPlugins ?? {}).sort();
    assert.ok(expected.every((key) => settings.enabledPlugins?.[key] === true) && actual.length === expected.length,
      `Enable every local plugin in the repository overlay, and nothing else. Expected enabledPlugins keys: ${expected.join(", ") || "none"}; found: ${actual.join(", ") || "none"}. `
      + "Never enable a remote plugin there: checking out this repository must not activate code fetched from another repository.");
  });
  for (const file of (await files(directory)).filter((path) => path.endsWith(".md"))) {
    for (const link of markdownLinks(await readFile(file, "utf8"))) {
      try { await stat(resolve(file, "..", decodeURI(link.split("#")[0]))); }
      catch { problems.add(relative(directory, file).split(sep).join("/"), `broken relative link ${link}`); }
    }
  }
  problems.throwIfAny();
  const warnings = [...remotePlugins.flatMap(remoteWarnings), ...await templateWarnings(directory, catalog)];
  return { plugins: localPlugins.length, remotePlugins: remotePlugins.length, warnings };
}

if (isEntrypoint(import.meta.url)) {
  await runCli(async () => {
    const result = await validateRepository();
    console.log(`Validated ${plural(result.plugins, "local plugin")} and ${plural(result.remotePlugins, "remote reference")}. Remote references are checked as metadata only; no upstream code was fetched or run.`);
    if (!result.plugins) console.log("There are no local plugins yet. Add one with npm run new-plugin -- <name>.");
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  });
}
