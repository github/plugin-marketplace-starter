import { isEntrypoint } from "./entrypoint.mjs";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { namePattern, readCatalog, reservedNames } from "./catalog.mjs";
import { runCli } from "./problems.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const usage = `Usage: npm run new-plugin -- <name> [--description "What it does."]

Creates the shell of a new plugin: plugins/<name>/ with plugin.json, README.md,
and CHANGELOG.md. It adds the plugin to marketplace.json, enables it in
.github/copilot/settings.json, and lists it in the README's plugin table and
install commands. npm run verify passes right away.

Then add the plugin's skills, agents, or other parts to plugins/<name>/.
The names graders and support are reserved.`;

export const pluginReference = "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const title = (name) => name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");

// OWNER/REPO from package.json "repository", which npm run rename-marketplace sets.
export function repositoryName(manifest) {
  const value = typeof manifest?.repository === "string" ? manifest.repository : manifest?.repository?.url;
  return value?.match(/^(?:github:)?([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)?.[1]
    ?? value?.match(/github\.com[/:]([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/)?.[1];
}

async function write(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function readmeFile(name, description, marketplace, repo) {
  return `# ${title(name)}

${description}

Add this plugin's skills, agents, or other parts to this folder. The
[Copilot CLI plugin reference](${pluginReference}) lists what a plugin can
contain and where each part goes.

## Install

\`\`\`sh
copilot plugin marketplace add ${repo ?? "OWNER/REPO"}
copilot plugin install ${name}@${marketplace}
\`\`\`
${repo ? "" : "\nReplace `OWNER/REPO` with the GitHub repository that hosts this marketplace.\n"}`;
}

// Adds the plugin to the README's plugin table (marked with <!-- plugin-table -->)
// and its install commands, when the README still has them. Returns whether it
// changed anything.
export function addToReadme(text, { name, marketplace, description }) {
  const lines = text.split(/\r?\n/);
  let changed = false;
  const marker = lines.findIndex((line) => line.trim() === "<!-- plugin-table -->");
  if (marker !== -1 && /^\s*\|/.test(lines[marker + 1] ?? "") && /^\s*\|[\s:|-]+\|\s*$/.test(lines[marker + 2] ?? "")) {
    let end = marker + 3;
    while (/^\s*\|/.test(lines[end] ?? "")) end++;
    const rows = lines.slice(marker + 3, end).filter((line) => !line.includes("_None yet._"));
    rows.push(`| [${name}](plugins/${name}/) | ${description.replaceAll("|", "\\|")} |`);
    lines.splice(marker + 3, end - marker - 3, ...rows);
    changed = true;
  }
  const install = new RegExp(`^copilot plugin install [a-z0-9-]+@${marketplace}\\s*$`);
  let at = lines.findLastIndex((line) => install.test(line));
  if (at === -1) at = lines.findIndex((line) => line.trim() === `copilot plugin marketplace browse ${marketplace}`);
  if (at !== -1) {
    lines.splice(at + 1, 0, `copilot plugin install ${name}@${marketplace}`);
    changed = true;
  }
  return changed ? lines.join("\n") : text;
}

export async function newPlugin(name, { description, directory = root } = {}) {
  if (!namePattern.test(name ?? "") || name.length > 64) {
    throw new Error(`Plugin name "${name ?? ""}" must be lowercase letters, digits, and single hyphens, such as release-notes.`);
  }
  if (reservedNames.includes(name)) {
    throw new Error(`Plugin name "${name}" is reserved: evals/${name}/ holds eval files that several plugins share. Pick another name.`);
  }
  const { catalog } = await readCatalog(directory);
  if (catalog.plugins.some((entry) => entry.name === name)) throw new Error(`marketplace.json already has a plugin named ${name}.`);
  if (existsSync(resolve(directory, "plugins", name))) throw new Error(`plugins/${name} already exists. Pick another name or remove it first.`);
  description ??= `Help with ${name.replaceAll("-", " ")} tasks.`;
  let manifest = {};
  try { manifest = await json(resolve(directory, "package.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const created = [];
  const add = async (path, text) => { await write(resolve(directory, path), text); created.push(path); };

  await add(`plugins/${name}/plugin.json`, `${JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name, version: "0.1.0", description, license: "MIT",
  }, null, 2)}\n`);
  await add(`plugins/${name}/README.md`, readmeFile(name, description, catalog.name, repositoryName(manifest)));
  await add(`plugins/${name}/CHANGELOG.md`, "# Changelog\n\n## 0.1.0\n\n- Initial release.\n");

  const catalogPath = resolve(directory, "marketplace.json");
  const rawCatalog = await json(catalogPath);
  const lastLocal = rawCatalog.plugins.findLastIndex((entry) => typeof entry.source === "string");
  rawCatalog.plugins.splice(lastLocal + 1, 0, { name, source: `./plugins/${name}`, version: "0.1.0", description });
  await writeJson(catalogPath, rawCatalog);

  const settingsPath = resolve(directory, ".github/copilot/settings.json");
  const settings = await json(settingsPath);
  settings.enabledPlugins = { ...settings.enabledPlugins, [`${name}@${catalog.name}`]: true };
  await writeJson(settingsPath, settings);

  const updated = ["marketplace.json", ".github/copilot/settings.json"];
  const readmePath = resolve(directory, "README.md");
  if (existsSync(readmePath)) {
    const before = await readFile(readmePath, "utf8");
    const after = addToReadme(before, { name, marketplace: catalog.name, description });
    if (after !== before) {
      await writeFile(readmePath, after);
      updated.push("README.md");
    }
  }
  return { created, updated };
}

if (isEntrypoint(import.meta.url)) {
  await runCli(async () => {
    let parsed;
    try {
      parsed = parseArgs({ allowPositionals: true, options: {
        description: { type: "string" },
        help: { type: "boolean", short: "h" },
      } });
    } catch (error) {
      throw new Error(`${error.message}. Run npm run new-plugin -- --help for the options.`);
    }
    const { values, positionals } = parsed;
    if (values.help || positionals.length !== 1) {
      console.log(usage);
      if (!values.help) process.exitCode = 1;
      return;
    }
    const result = await newPlugin(positionals[0], { description: values.description });
    console.log(`Created plugin ${positionals[0]}:`);
    for (const path of result.created) console.log(`  ${path}`);
    console.log(`Updated ${result.updated.join(", ")}.`);
    console.log(`\nNext: add the plugin's skills, agents, or other parts to plugins/${positionals[0]}/ (see ${pluginReference}), then run npm run verify.`);
  });
}
