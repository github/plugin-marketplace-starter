import { isEntrypoint } from "./entrypoint.mjs";
import { existsSync } from "node:fs";
import { readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseDocument } from "yaml";
import { namePattern, reservedNames } from "./catalog.mjs";
import { runCli } from "./problems.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const usage = `Usage: npm run remove-plugin -- <name>... [--dry-run]

Removes each plugin and everything it owns: plugins/<name>/, evals/<name>/, and
its tests, test/<name>.test.mjs and test/<name>-*.test.mjs. It removes the
plugin's marketplace.json entry, repository settings key, any .vally.yaml params
that point into its folders, its install commands and table rows in Markdown,
and Markdown sections marked <!-- plugin:<name> -->. Links that still point at
removed files become plain text. Shared files in evals/graders/ and
evals/support/ stay.

A remote plugin (a marketplace.json entry that points at another repository)
loses its catalog entry and its marked sections in Markdown.

  --dry-run   List what would change without changing anything.`;

// The template's own tests, which no plugin owns even when a plugin's name
// would match the naming rule below.
export const protectedTests = new Set(["adoption", "catalog", "entrypoint", "eval-setup", "grader-common", "installation",
  "maintenance-workspace", "marketplace", "new-plugin", "remote-plugins", "runtime-environment"].map((name) => `test/${name}.test.mjs`));

// The paths a plugin owns: plugins/<name>/, evals/<name>/, and its tests. A test
// whose name also fits a longer plugin name in `others`, such as
// test/notes-sync.test.mjs for a plugin named notes, belongs to that plugin.
export async function ownedPaths(name, { directory = root, others = [] } = {}) {
  const longer = others.filter((other) => other !== name && other.startsWith(`${name}-`));
  const mine = (base) => (base === name || base.startsWith(`${name}-`))
    && !longer.some((other) => base === other || base.startsWith(`${other}-`));
  let tests = [];
  try { tests = await readdir(resolve(directory, "test"), { withFileTypes: true }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const owned = tests.filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => `test/${entry.name}`)
    .filter((path) => !protectedTests.has(path) && mine(path.slice("test/".length, -".test.mjs".length)));
  return [`plugins/${name}`, ...(reservedNames.includes(name) ? [] : [`evals/${name}`]), ...owned];
}

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

// Renumbers top-level ordered lists after a marked step is removed, so a list
// that lost step 3 reads 1, 2, 3 rather than 1, 2, 4.
function renumber(lines) {
  let next;
  return lines.map((line) => {
    const item = line.match(/^(\d+)([.)])(\s.*)?$/);
    if (item) {
      next = next === undefined ? Number(item[1]) : next;
      return `${next++}${item[2]}${item[3] ?? ""}`;
    }
    if (line.trim() && !/^\s/.test(line)) next = undefined;
    return line;
  });
}

// Removes what a Markdown file says about removed plugins: sections wrapped in
// <!-- plugin:NAME --> ... <!-- /plugin:NAME --> (or the `markers` given, such
// install commands that name
// them, and table rows whose first cell links to removed files. A table that
// loses every row gets a placeholder row. Other links to removed files become
// plain text. `removed(link)` says whether a relative link target is gone.
export function pruneMarkdown(text, names, removed) {
  const sections = new Set(names.map((name) => `plugin:${name}`));
  const lines = text.split(/\r?\n/);
  const kept = [];
  let skipping;
  let pruned = false;
  const links = (line) => [...line.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1])
    .filter((link) => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link));
  let table;
  lines.forEach((line, index) => {
    const marker = line.match(/^\s*<!--\s*(\/?)([a-z0-9:-]+)\s*-->\s*$/);
    if (marker && sections.has(marker[2])) { skipping = marker[1] ? undefined : marker[2]; pruned = true; return; }
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
  return (pruned ? renumber(kept) : kept).join("\n").replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (match, label, link) =>
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

// Throws unless `path` stays inside plugins/, evals/, or test/, so a bad name
// can never point a recursive delete elsewhere.
export function assertRemovable(directory, path) {
  const target = resolve(directory, path);
  const rel = relative(resolve(directory), target);
  const parts = rel.split(sep);
  const inside = !isAbsolute(rel) && !parts.includes("..");
  const allowed = inside && parts.length > 1 && ["plugins", "evals", "test"].includes(parts[0]);
  if (!allowed) throw new Error(`Refusing to remove ${path}: removal only deletes files inside plugins/, evals/, or test/. Nothing was removed.`);
  return target;
}

export async function removePlugins(names, { directory = root, dryRun = false } = {}) {
  if (!names.length) throw new Error("Name at least one plugin to remove.");
  // Check every name before touching the file system, so a path such as
  // ../scripts never reaches a lookup or a delete.
  const invalid = names.filter((name) => typeof name !== "string" || !namePattern.test(name) || name.length > 64);
  if (invalid.length) {
    throw new Error(`${invalid.map((name) => JSON.stringify(String(name))).join(", ")} ${invalid.length === 1 ? "isn't a plugin name" : "aren't plugin names"}. `
      + "Plugin names are lowercase letters, digits, and single hyphens, such as release-notes. Nothing was removed.");
  }
  const catalogPath = resolve(directory, "marketplace.json");
  const catalog = await json(catalogPath);
  const remote = [];
  for (const name of names) {
    const entry = catalog.plugins.find((item) => item.name === name);
    if (entry && typeof entry.source !== "string") { remote.push(name); continue; }
    if (!entry && !existsSync(resolve(directory, "plugins", name))) throw new Error(`No plugin named ${name} in marketplace.json or plugins/.`);
  }
  const local = names.filter((name) => !remote.includes(name));
  const others = catalog.plugins.map((entry) => entry.name).filter((name) => !names.includes(name));
  const owned = [...new Set((await Promise.all(local.map((name) => ownedPaths(name, { directory, others: [...others, ...local] })))).flat())]
    .filter((path) => existsSync(resolve(directory, path)));
  const removedRoots = owned.map((path) => resolve(directory, path));
  for (const path of owned) assertRemovable(directory, path);
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
    const configured = vally.get("params");
    const kept = configured?.items?.filter((pair) => !ownedBy(pair.value?.value ?? pair.value));
    if (kept && kept.length !== configured.items.length) {
      configured.items = kept;
      await writeFile(vallyPath, vally.toString());
      changes.updated.push(".vally.yaml");
    }
  }

  await removeEmptyDirectories(directory, owned);

  for (const file of await markdownFiles(directory, removedRoots)) {
    const text = await readFile(file, "utf8");
    const removed = (link) => {
      const target = resolve(file, "..", decodeURI(link.split("#")[0]));
      return removedRoots.some((path) => target === path || target.startsWith(path + sep));
    };
    const next = pruneMarkdown(text, names, removed);
    if (next !== text.replace(/\r\n/g, "\n")) {
      await writeFile(file, next);
      changes.updated.push(file.slice(directory.length).replace(/^[\\/]/, "").split(sep).join("/"));
    }
  }
  changes.localLeft = catalog.plugins.filter((entry) => typeof entry.source === "string").length;
  return changes;
}

if (isEntrypoint(import.meta.url)) {
  await runCli(async () => {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    } });
    const names = positionals;
    if (values.help || !names.length) {
      console.log(usage);
      if (!values.help) process.exitCode = 1;
      return;
    }
    const changes = await removePlugins(names, { dryRun: values["dry-run"] });
    console.log(values["dry-run"] ? "Would remove:" : "Removed:");
    for (const path of changes.removed) console.log(`  ${path}`);
    for (const name of changes.remote) console.log(`  the ${name} remote catalog entry`);
    if (changes.updated.length) console.log(`Updated ${changes.updated.join(", ")}.`);
    if (values["dry-run"]) return;
    if (!changes.localLeft) {
      console.log("\nThere are no local plugins left. npm run verify still passes; add your first with npm run new-plugin -- <name>.");
    } else {
      console.log("\nNext: run npm run verify.");
    }
  });
}
