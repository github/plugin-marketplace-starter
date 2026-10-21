import { existsSync } from "node:fs";
import { readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseDocument } from "yaml";
import { examples, ownedPaths, presentExamples } from "./examples.mjs";
import { runCli } from "./problems.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const usage = (directory = root) => `Usage: npm run remove-plugin -- <name>... [--dry-run]
       npm run remove-example -- <example>... [--dry-run]
       npm run remove-example -- --all [--dry-run]

Removes each plugin and everything it owns: plugins/<name>/, evals/<name>/, and
support files named after it (evals/graders/<name>.mjs, evals/support/<name>-*,
evals/fixtures/<name>/, test/<name>.test.mjs, and test/<name>-*.test.mjs). For a
shipped example, it also removes the graders, eval support files, and tests
listed for it in scripts/examples.mjs. It removes the plugin's marketplace.json
entry, repository settings key, .vally.yaml skill path and params, install
commands, table rows, and marked sections in Markdown files. Links that still
point at removed files become plain text.

A remote plugin (a marketplace.json entry that points at another repository)
loses its catalog entry and its marked sections in Markdown.

  --all       With remove-example, remove every shipped example that's left.
  --dry-run   List what would change without changing anything.

Shipped examples still here: ${presentExamples(directory).join(", ") || "none"}.`;

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

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isDelimiter = (line) => /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line);

// Keeps a table readable once every body row is gone, instead of leaving a bare
// header: one row that says there's nothing listed yet.
function placeholderRow(header) {
  const columns = header.trim().replace(/^\||\|$/g, "").split("|").length;
  return `| ${["_None yet._", ...Array(columns - 1).fill("")].join(" | ")} |`.replace(/ {2,}\|/g, " |");
}

// Removes what a Markdown file says about removed plugins: sections wrapped in
// <!-- plugin:NAME --> ... <!-- /plugin:NAME --> (or the `markers` given, such
// as `examples` once no shipped example is left), install commands that name
// them, and table rows whose first cell links to removed files. A table that
// loses every row gets a placeholder row. Other links to removed files become
// plain text. `removed(link)` says whether a relative link target is gone.
export function pruneMarkdown(text, names, removed, markers = []) {
  const sections = new Set([...names.map((name) => `plugin:${name}`), ...markers]);
  const lines = text.split(/\r?\n/);
  const kept = [];
  let skipping;
  const links = (line) => [...line.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1])
    .filter((link) => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link));
  let table;
  lines.forEach((line, index) => {
    const marker = line.match(/^\s*<!--\s*(\/?)([a-z0-9:-]+)\s*-->\s*$/);
    if (marker && sections.has(marker[2])) { skipping = marker[1] ? undefined : marker[2]; return; }
    if (skipping) return;
    if (names.some((name) => line.includes(`copilot plugin install ${name}@`))) return;
    const header = isTableRow(line) && isDelimiter(lines[index + 1] ?? "");
    if (table && (header || !isTableRow(line))) {
      if (table.dropped && !table.rows) kept.push(placeholderRow(table.header));
      table = undefined;
    }
    if (header) table = { header: line, rows: 0, dropped: 0, delimiter: true };
    else if (table?.delimiter) table.delimiter = false;
    else if (isTableRow(line)) {
      const firstCell = line.match(/^\s*\|([^|]*)\|/)?.[1];
      if (firstCell && links(firstCell).some(removed)) { if (table) table.dropped++; return; }
      if (table) table.rows++;
    }
    kept.push(line);
  });
  if (table?.dropped && !table.rows) kept.push(placeholderRow(table.header));
  return kept.join("\n").replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (match, label, link) =>
    !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link) && removed(link) ? label : match);
}

// Removes directories left empty by a removal, up to (but never including) a
// top-level directory such as plugins/ or evals/.
async function removeEmptyDirectories(directory, paths) {
  const top = resolve(directory);
  for (const path of paths) {
    let current = resolve(directory, path);
    while (!existsSync(current) && resolve(current, "..") !== top) current = resolve(current, "..");
    while (current.startsWith(top + sep) && resolve(current, "..") !== top && existsSync(current)) {
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
  const remote = [];
  for (const name of names) {
    if (examplesOnly && !examples[name]) throw new Error(`${name} isn't a shipped example. Examples: ${Object.keys(examples).join(", ")}. Use npm run remove-plugin for your own plugins.`);
    const entry = catalog.plugins.find((item) => item.name === name);
    if (entry && typeof entry.source !== "string") { remote.push(name); continue; }
    if (!entry && !existsSync(resolve(directory, "plugins", name))) throw new Error(`No plugin named ${name} in marketplace.json or plugins/.`);
  }
  const local = names.filter((name) => !remote.includes(name));
  const others = catalog.plugins.map((entry) => entry.name).filter((name) => !names.includes(name));
  const owned = [...new Set((await Promise.all(local.map((name) => ownedPaths(name, { directory, others: [...others, ...local] })))).flat())]
    .filter((path) => existsSync(resolve(directory, path)));
  const removedRoots = owned.map((path) => resolve(directory, path));
  const params = new Set(local.flatMap((name) => examples[name]?.params ?? []));
  const remainingExamples = presentExamples(directory).filter((name) => !local.includes(name));
  const lastExample = local.some((name) => examples[name]) && !remainingExamples.length;
  // The examples guide goes with the last shipped example.
  if (lastExample && existsSync(resolve(directory, "docs/examples.md"))) {
    owned.push("docs/examples.md");
    removedRoots.push(resolve(directory, "docs/examples.md"));
  }
  const changes = { removed: owned, remote, updated: [] };
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
  if (existsSync(vallyPath) && local.length) {
    const vally = parseDocument(await readFile(vallyPath, "utf8"));
    const ownedBy = (value) => typeof value === "string" && owned.some((path) => value === path || value.startsWith(`${path}/`));
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
      return removedRoots.some((path) => target === path || target.startsWith(path + sep));
    };
    const next = pruneMarkdown(text, names, removed, lastExample ? ["examples"] : []);
    if (next !== text.replace(/\r\n/g, "\n")) {
      await writeFile(file, next);
      changes.updated.push(file.slice(directory.length).replace(/^[\\/]/, "").split(sep).join("/"));
    }
  }
  changes.localLeft = catalog.plugins.filter((entry) => typeof entry.source === "string").length;
  return changes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli(async () => {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      example: { type: "boolean" },
      all: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    } });
    const names = values.all ? [...new Set([...positionals, ...presentExamples(root)])] : positionals;
    if (values.all && !values.example) throw new Error("--all works with npm run remove-example, which only removes shipped examples.");
    if (values.help || !names.length) {
      console.log(values.all ? "There are no shipped examples left to remove." : usage());
      if (!values.help && !values.all) process.exitCode = 1;
      return;
    }
    const changes = await removePlugins(names, { examplesOnly: values.example, dryRun: values["dry-run"] });
    console.log(values["dry-run"] ? "Would remove:" : "Removed:");
    for (const path of changes.removed) console.log(`  ${path}`);
    for (const name of changes.remote) console.log(`  the ${name} remote catalog entry`);
    if (changes.updated.length) console.log(`Updated ${changes.updated.join(", ")}.`);
    if (values["dry-run"]) return;
    if (!changes.localLeft) {
      console.log("\nThere are no local plugins left. npm run verify still passes; add your first with npm run new-plugin -- <name>.");
    } else {
      console.log("\nNext: run npm run verify. It warns about any prose that still mentions the removed plugins.");
    }
  });
}
