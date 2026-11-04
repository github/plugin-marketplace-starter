import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

const fail = (message) => { throw new Error(message); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
// Agent Plugins 1.0/1.1 names, also accepted by Copilot's marketplace catalog.
const identifier = (value) => typeof value === "string" && value.length <= 64
  && /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);

function absolute(value) {
  if (process.platform === "win32" && typeof value === "string") {
    // Git bash can leave quoted /c/... operands unconverted (notably apostrophes).
    value = value.replace(/^\/([A-Za-z])\//, "$1:/");
    if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+(?:\\|$))/.test(value)) {
      fail("Caller-selected Windows paths must be fully qualified.");
    }
  }
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value) || !isAbsolute(value)) {
    fail("Caller-selected paths must be absolute and contain no control characters.");
  }
  return resolve(value);
}

function noLinks(value) {
  const path = absolute(value);
  let current = parse(path).root;
  for (const part of relative(current, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    const item = lstatSync(current, { throwIfNoEntry: false });
    if (item?.isSymbolicLink()) fail(`Refusing a symlink or junction: ${current}`);
    if (!item) return undefined;
  }
  return lstatSync(path, { throwIfNoEntry: false });
}

function directory(value) {
  const path = absolute(value);
  if (!noLinks(path)?.isDirectory()) fail(`Directory must already exist: ${path}`);
  return realpathSync(path);
}

function json(path) {
  if (!noLinks(path)?.isFile()) fail(`Metadata must be a regular file: ${path}`);
  const text = readFileSync(path, "utf8");
  const data = JSON.parse(text);
  // JSON.parse alone silently accepts duplicate keys, including escaped aliases.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}[\]:,]/g) ?? [];
  const stack = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (tokens[index + 1] === ":") {
      const key = JSON.parse(token);
      if (stack.at(-1).has(key)) fail(`Duplicate metadata key in ${path}: ${key}`);
      stack.at(-1).add(key);
    }
  }
  if (!object(data)) fail(`Metadata must be a JSON object: ${path}`);
  return data;
}

function pluginTree(path) {
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    const item = noLinks(child);
    if (!item) fail(`Plugin changed during validation: ${child}`);
    if (item.isDirectory()) pluginTree(child);
    else if (!item.isFile()) fail(`Plugin contains a non-regular file: ${child}`);
  }
}

function selection(repoInput, plugin, homeInput, workInput) {
  if (!identifier(plugin)) fail("Select one valid plugin name from caller input, not checkout instructions.");
  const repo = directory(repoInput);
  const work = directory(workInput);
  const fromRepo = relative(repo, work);
  if (!fromRepo || (!isAbsolute(fromRepo) && fromRepo !== ".." && !fromRepo.startsWith(`..${sep}`))) {
    fail("The working directory must be outside the selected checkout. Choose another directory.");
  }
  const home = absolute(homeInput);
  directory(dirname(home));
  if (noLinks(home)) fail("The test home already exists; leave it untouched.");
  const catalog = json(join(repo, "marketplace.json"));
  if (!identifier(catalog.name) || !object(catalog.owner) || typeof catalog.owner.name !== "string"
      || !catalog.owner.name || !Array.isArray(catalog.plugins) || !catalog.plugins.length) {
    fail("Malformed marketplace metadata or unsafe marketplace name.");
  }
  if (catalog.metadata !== undefined && (!object(catalog.metadata)
      || (catalog.metadata.pluginRoot !== undefined && catalog.metadata.pluginRoot !== "."))) {
    fail("This check uses the checkout's fixed plugins/<name> layout, without pluginRoot overrides.");
  }
  const names = new Set();
  let selected = false;
  for (const entry of catalog.plugins) {
    if (!object(entry) || !identifier(entry.name) || names.has(entry.name)) {
      fail("Unsafe or duplicate plugin name in marketplace.json.");
    }
    names.add(entry.name);
    if (object(entry.source)) {
      if (entry.name === plugin) fail("A local-install check can't select a remote entry.");
      if (!["github", "url"].includes(entry.source.source)) fail("Malformed remote source metadata.");
      continue;
    }
    if (entry.source !== `./plugins/${entry.name}` && entry.source !== `plugins/${entry.name}`) {
      fail("Local sources must be plugins/<name> (optional ./), without traversal or remote URLs.");
    }
    if (["commands", "agents", "skills", "hooks", "mcpServers", "lspServers"].some((key) => key in entry)) {
      fail("Local catalog entries can't override the plugin's fixed component locations.");
    }
    const path = directory(join(repo, "plugins", entry.name));
    pluginTree(path);
    const manifest = json(join(path, "plugin.json"));
    if (!["1.0.0", "1.1.0"].some((version) => manifest.$schema === `https://agent-plugins.org/schemas/${version}/plugin.schema.json`)) {
      fail("This check requires an Agent Plugins root plugin.json (1.0.0 or 1.1.0).");
    }
    if (!identifier(manifest.name) || manifest.name !== entry.name) {
      fail("The root manifest and catalog must agree on a valid plugin name.");
    }
    if (entry.name === plugin) selected = true;
  }
  if (!selected) fail("The caller-selected plugin isn't in this marketplace.");
  return [repo, `${plugin}@${catalog.name}`, catalog.name, home, work];
}

try {
  const [mode, ...inputs] = process.argv.slice(2);
  if (mode === "owned-home" && inputs.length === 1) {
    const home = absolute(inputs[0]);
    if (!noLinks(home)?.isDirectory()) fail("Refusing to clean up a replaced test home.");
    noLinks(join(home, "cache"));
  } else {
    if (!["powershell", "shell"].includes(mode) || inputs.length !== 4) fail("Invalid validation arguments.");
    const fields = selection(...inputs);
    for (const field of fields) {
      console.log(mode === "shell" && process.platform === "win32"
        ? field.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_match, drive) => `/${drive.toLowerCase()}`)
        : field);
    }
  }
} catch (error) {
  console.error(`Local install check: ${error.message}`);
  process.exitCode = 1;
}
