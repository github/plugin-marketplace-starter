import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import Ajv from "ajv/dist/2020.js";
import { contained, frontmatter, readCatalog } from "./catalog.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const ignored = [".git", "node_modules", "vally-results", ".vally"];
const ajv = new Ajv({ allErrors: true });
const validatePlugin = ajv.compile(await json(resolve(root, "schemas/plugin.schema.json")));
const validateMcp = ajv.compile(await json(resolve(root, "schemas/mcp.schema.json")));

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.filter((entry) => !ignored.includes(entry.name))
    .map((entry) => entry.isDirectory() ? files(resolve(path, entry.name)) : resolve(path, entry.name)))).flat();
}

export async function validateMcpConfig(directory, label) {
  const config = await json(resolve(directory, "mcp.json"));
  assert.ok(validateMcp(config), `${label}: ${ajv.errorsText(validateMcp.errors)}`);
  const servers = Object.entries(config.mcpServers);
  assert.ok(servers.length, `${label}: mcp.json declares no servers.`);
  for (const [name, server] of servers) {
    assert.equal(server.type, "stdio", `${label}/${name}: in-repo plugins ship self-contained local stdio servers.`);
    if (server.command.startsWith("./")) await contained(directory, server.command);
    else assert.match(server.command, /^[\w.-]+$/, `${label}/${name}: use a bare executable or a contained ./ path.`);
    for (const value of [...(server.args ?? []), server.cwd ?? "${PLUGIN_ROOT}"]) {
      assert.ok(!value.includes("${PLUGIN_DATA}") || value.startsWith("${PLUGIN_DATA}"), `${label}/${name}: invalid PLUGIN_DATA use.`);
      if (value.startsWith("${PLUGIN_ROOT}")) await contained(directory, `.${value.slice("${PLUGIN_ROOT}".length) || "/"}`);
    }
  }
  return servers.length;
}

export async function validateRepository(directory = root) {
  const { catalog, localPlugins, remotePlugins } = await readCatalog(directory);
  const names = new Set();
  const counts = { plugins: 0, skills: 0, agents: 0, hooks: 0, mcpServers: 0 };
  for (const entry of localPlugins) {
    names.add(entry.name);
    const source = await contained(resolve(directory, "plugins"), entry.source.slice("./plugins/".length));
    const manifest = await json(resolve(source, "plugin.json"));
    assert.ok(validatePlugin(manifest), `${entry.name}: ${ajv.errorsText(validatePlugin.errors)}`);
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, entry.version, `${entry.name}: catalog and manifest versions differ.`);
    assert.equal(manifest.description, entry.description, `${entry.name}: catalog and manifest descriptions differ.`);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.ok((await readFile(resolve(source, "CHANGELOG.md"), "utf8")).replaceAll("\r\n", "\n").includes(`## ${manifest.version}\n`),
      `${entry.name}: CHANGELOG.md needs a "## ${manifest.version}" heading.`);
    await stat(resolve(source, "README.md"));
    let assets = 0;
    const agents = new Set();
    for (const file of await files(source)) {
      const path = relative(source, file).split(sep).join("/");
      assert.ok(![".plugin", ".claude-plugin"].some((name) => file.includes(`${sep}${name}${sep}`)), "Use Agent Plugins 1.0 layout.");
      if (path.endsWith("/SKILL.md") || path === "SKILL.md") {
        assert.match(path, /^skills\/[^/]+\/SKILL\.md$/, `${entry.name}: skills belong in skills/<name>/SKILL.md.`);
        const meta = frontmatter(await readFile(file, "utf8"), file);
        assert.equal(meta.name, path.split("/")[1], `${file}: skill name must match its directory.`);
        counts.skills++;
        assets++;
      }
      if (path.endsWith(".agent.md")) {
        assert.match(path, /^com\.github\.copilot\/agents\/[^/]+\.agent\.md$/, `${entry.name}: agents belong in com.github.copilot/agents/.`);
        const meta = frontmatter(await readFile(file, "utf8"), file);
        assert.equal(`${meta.name}.agent.md`, path.split("/").at(-1), `${file}: agent name must match its file name.`);
        assert.ok(!agents.has(meta.name), `${file}: duplicate agent name.`);
        assert.ok(meta.tools === undefined || (Array.isArray(meta.tools) && meta.tools.every((tool) => typeof tool === "string" && tool)),
          `${file}: tools must be a list of names.`);
        agents.add(meta.name);
        counts.agents++;
        assets++;
      }
      if (path.endsWith("mcp.json")) {
        assert.equal(path, "mcp.json", `${entry.name}: put MCP configuration in the plugin's root mcp.json.`);
        counts.mcpServers += await validateMcpConfig(source, entry.name);
        assets++;
      }
      if (file.endsWith("hooks.json")) {
        assert.equal(path, "com.github.copilot/hooks/hooks.json");
        const hooks = await json(file);
        assert.equal(hooks.version, 1);
        assert.ok(hooks.hooks && Object.keys(hooks.hooks).length);
        for (const [event, commands] of Object.entries(hooks.hooks)) {
          assert.ok(["preToolUse", "postToolUse"].includes(event), `Unsupported starter hook event: ${event}`);
          assert.ok(Array.isArray(commands) && commands.length);
          for (const hook of commands) {
            assert.equal(hook.type, "command");
            assert.ok(Number.isFinite(hook.timeoutSec) && hook.timeoutSec > 0);
            const script = hook.command.match(/^node "\$\{PLUGIN_ROOT\}\/([^"]+)"$/)?.[1];
            assert.ok(script, "Hook must use a quoted plugin-relative script.");
            await contained(source, script);
          }
          counts.hooks++;
        }
        assets++;
      }
      if (/^com\.github\.copilot\/extensions\/[^/]+\/extension\.mjs$/.test(path)) assets++;
    }
    assert.ok(assets, `${entry.name}: plugin has no supported assets.`);
    counts.plugins++;
  }
  const actualPlugins = (await readdir(resolve(directory, "plugins"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(actualPlugins, [...names].sort(), "Every plugin must be registered.");
  const settings = await json(resolve(directory, ".github/copilot/settings.json"));
  assert.deepEqual(settings.extraKnownMarketplaces, {
    [catalog.name]: { source: { source: "directory", path: "." } },
  }, "The repository marketplace must point at this checkout.");
  assert.deepEqual(settings.enabledPlugins, Object.fromEntries(
    [...names].map((name) => [`${name}@${catalog.name}`, true]),
  ), "Enable every local plugin, but no remote plugins, in the repository overlay.");
  for (const file of await files(directory)) {
    if (/\.(?:mjs|js)$/.test(file)) {
      const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(check.status, 0, check.stderr || check.error?.message);
    }
    if (file.endsWith(".md")) {
      for (const match of (await readFile(file, "utf8")).matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(?:https?:|#)/.test(match[1])) continue;
        const target = resolve(file, "..", match[1].split("#")[0]);
        try { await stat(target); }
        catch { throw new Error(`${relative(directory, file)}: broken relative link ${match[1]}`); }
      }
    }
  }
  return { ...counts, remotePlugins: remotePlugins.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const counts = await validateRepository();
  const count = (number, noun) => `${number} ${noun}${number === 1 ? "" : "s"}`;
  console.log(`Validated ${count(counts.plugins, "local plugin")}: ${count(counts.skills, "skill")}, ${count(counts.agents, "agent")}, `
    + `${count(counts.hooks, "hook event")}, and ${count(counts.mcpServers, "MCP server")}.`);
  console.log(`Validated ${count(counts.remotePlugins, "remote reference")} as metadata only; no upstream code was fetched or run.`);
}
