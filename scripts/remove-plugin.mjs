import { existsSync } from "node:fs";
import { readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseDocument } from "yaml";
import { examples, ownedPaths } from "./examples.mjs";
import { runCli } from "./problems.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const usage = `Usage: npm run remove-plugin -- <name>... [--dry-run]
       npm run remove-example -- <example>... [--dry-run]

Removes each plugin and everything it owns: plugins/<name>/, evals/<name>/, and
for a shipped example its graders, eval support files, and example-only tests.
Also removes its marketplace.json entry, repository settings key, .vally.yaml
skill path and params, install commands, table rows, and marked sections in
Markdown files. Links that still point at it become plain text.

Shipped examples: ${Object.keys(examples).join(", ")}.`;

const skipped = new Set([".git", "node_modules", "vally-results", ".vally", ".copilot-home"]);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

async function markdownFiles(directory, removed) {
  const found = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (skipped.has(entry.name)) continue;
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) {
        if (!removed.some((owned) => child === owned || child.startsWith(owned + sep))) await walk(child);
      } else if (entry.name.endsWith(".md")) found.push(child);
    }
  }
  await walk(directory);
  return found;
}

// Removes what a Markdown file says about removed plugins: sections wrapped in
// <!-- plugin:NAME --> ... <!-- /plugin:NAME -->, install commands that name
// them, and table rows that link to removed files. Other links to removed files
// become plain text. `removed(link)` says whether a relative link target is gone.
export function pruneMarkdown(text, names, removed) {
  const kept = [];
  let skipping;
  const links = (line) => [...line.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1])
    .filter((link) => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link));
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*<!--\s*(\/?)plugin:([a-z0-9-]+)\s*-->\s*$/);
    if (marker && names.includes(marker[2])) { skipping = marker[1] ? undefined : marker[2]; continue; }
    if (skipping) continue;
    if (names.some((name) => line.includes(`copilot plugin install ${name}@`))) continue;
    if (/^\s*\|/.test(line) && links(line).some(removed)) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (match, label, link) =>
    !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link) && removed(link) ? label : match);
}

async function removeEmptyDirectories(directory, paths) {
  for (const path of paths) {
    let current = resolve(directory, path);
    while (current.startsWith(directory) && current !== resolve(directory) && existsSync(current)) {
      if ((await readdir(current)).length) break;
      await rmdir(current);
      current = resolve(current, "..");
    }
  }
}

export async function removePlugins(names, { directory = root, examplesOnly = false, dryRun = false } = {}) {
  if (!names.length) throw new Error("Name at least one plugin to remove.");
  const catalogPath = resolve(directory, "marketplace.json");
  const catalog = await json(catalogPath);
  for (const name of names) {
    if (examplesOnly && !examples[name]) throw new Error(`${name} isn't a shipped example. Examples: ${Object.keys(examples).join(", ")}. Use npm run remove-plugin for your own plugins.`);
    const entry = catalog.plugins.find((item) => item.name === name);
    if (entry && typeof entry.source !== "string") throw new Error(`${name} is a remote reference. Delete its marketplace.json entry by hand.`);
    if (!entry && !existsSync(resolve(directory, "plugins", name))) throw new Error(`No local plugin named ${name} in marketplace.json or plugins/.`);
  }
  const owned = names.flatMap(ownedPaths).filter((path) => existsSync(resolve(directory, path)));
  const removedRoots = owned.map((path) => resolve(directory, path));
  const params = new Set(names.flatMap((name) => examples[name]?.params ?? []));
  const changes = { removed: owned, updated: [] };
  if (dryRun) return changes;

  for (const path of owned) await rm(resolve(directory, path), { recursive: true, force: true });

  catalog.plugins = catalog.plugins.filter((entry) => !names.includes(entry.name));
  await writeJson(catalogPath, catalog);
  changes.updated.push("marketplace.json");

  const settingsPath = resolve(directory, ".github/copilot/settings.json");
  if (existsSync(settingsPath)) {
    const settings = await json(settingsPath);
    for (const key of Object.keys(settings.enabledPlugins ?? {})) {
      if (names.includes(key.split("@")[0])) delete settings.enabledPlugins[key];
    }
    await writeJson(settingsPath, settings);
    changes.updated.push(".github/copilot/settings.json");
  }

  const vallyPath = resolve(directory, ".vally.yaml");
  if (existsSync(vallyPath)) {
    const vally = parseDocument(await readFile(vallyPath, "utf8"));
    const ownedBy = (value) => typeof value === "string" && names.some((name) => ownedPaths(name).some((path) => value === path || value.startsWith(`${path}/`)));
    const skills = vally.getIn(["paths", "skills"]);
    if (skills?.items) skills.items = skills.items.filter((item) => !ownedBy(item.value ?? item));
    const configured = vally.get("params");
    if (configured?.items) configured.items = configured.items.filter((pair) => !params.has(String(pair.key?.value ?? pair.key)) && !ownedBy(pair.value?.value ?? pair.value));
    await writeFile(vallyPath, vally.toString());
    changes.updated.push(".vally.yaml");
  }

  // Generated grader notices go with the last grader source that produced them.
  const graderSources = resolve(directory, "evals/graders/src");
  const hasGraderSources = existsSync(graderSources) && (await readdir(graderSources)).some((name) => name.endsWith(".mjs"));
  if (!hasGraderSources && existsSync(resolve(directory, "evals/graders/dist"))) {
    await rm(resolve(directory, "evals/graders/dist"), { recursive: true, force: true });
    changes.removed.push("evals/graders/dist");
  }
  await removeEmptyDirectories(directory, [...owned, "evals/graders/src", "evals/graders/dist"]);

  for (const file of await markdownFiles(directory, removedRoots)) {
    const text = await readFile(file, "utf8");
    const removed = (link) => {
      const target = resolve(file, "..", decodeURI(link.split("#")[0]));
      return removedRoots.some((owned) => target === owned || target.startsWith(owned + sep));
    };
    const next = pruneMarkdown(text, names, removed);
    if (next !== text.replace(/\r\n/g, "\n")) {
      await writeFile(file, next);
      changes.updated.push(file.slice(directory.length).replace(/^[\\/]/, "").split(sep).join("/"));
    }
  }
  return changes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli(async () => {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      example: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    } });
    if (values.help || !positionals.length) {
      console.log(usage);
      if (!values.help) process.exitCode = 1;
      return;
    }
    const changes = await removePlugins(positionals, { examplesOnly: values.example, dryRun: values["dry-run"] });
    console.log(values["dry-run"] ? "Would remove:" : "Removed:");
    for (const path of changes.removed) console.log(`  ${path}`);
    if (changes.updated.length) console.log(`Updated ${changes.updated.join(", ")}.`);
    if (!values["dry-run"]) console.log("\nNext: run npm run verify. It warns about any prose that still mentions the removed plugins.");
  });
}
