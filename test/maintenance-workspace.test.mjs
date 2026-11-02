import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspace } from "../evals/support/maintenance-workspace.mjs";
import { fixture } from "./support/maintenance-workspace.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));

test("maintenance workspaces use real tooling without staging eval specs or grader answers", async (t) => {
  const directory = await fixture(t);
  assert.equal(await readFile(resolve(directory, "scripts/new-plugin.mjs"), "utf8"),
    await readFile(resolve(root, "scripts/new-plugin.mjs"), "utf8"));
  const staged = (await readdir(resolve(directory, "evals"), { recursive: true })).filter((name) => name.endsWith(".yaml") || name.endsWith(".mjs"));
  assert.equal(staged.filter((name) => name.endsWith(".yaml")).length, 0);
  assert.deepEqual(staged.filter((name) => name.includes("graders")).map((name) => name.replaceAll("\\", "/")), ["graders/common.mjs"]);
  const output = execFileSync(process.execPath, ["scripts/validate.mjs"], { cwd: directory, encoding: "utf8", timeout: 30_000 });
  assert.match(output, /Validated 1 local plugin:/);
  execFileSync(process.execPath, ["scripts/new-plugin.mjs", "fixture-hook", "--with", "hook", "--no-skill"],
    { cwd: directory, encoding: "utf8", timeout: 30_000 });
  const after = execFileSync(process.execPath, ["scripts/validate.mjs"], { cwd: directory, encoding: "utf8", timeout: 30_000 });
  assert.match(after, /Validated 2 local plugins/);
});

test("recorded upstream checks use the real remote checker and reject a wrong pin", async (t) => {
  const directory = await fixture(t, "remote");
  const run = () => execFileSync(process.execPath, ["fixture/check-remotes.mjs"],
    { cwd: directory, encoding: "utf8", timeout: 10_000, stdio: "pipe" });
  assert.match(run(), /offline, not live GitHub/);
  const path = resolve(directory, "marketplace.json");
  const catalog = JSON.parse(await readFile(path, "utf8"));
  const remote = catalog.plugins.find((item) => item.name === "outside-notes");
  remote.source.sha = "b".repeat(40);
  remote.source.ref = "v1.1.0";
  remote.version = "1.1.0";
  await writeFile(path, JSON.stringify(catalog));
  assert.match(run(), /Recorded upstream checks passed/);
  remote.version = "9.0.0";
  await writeFile(path, JSON.stringify(catalog));
  assert.throws(run, /catalog says version/);
});

test("fixture setup refuses source, ancestors, unknown scenarios, and nonempty destinations", async (t) => {
  await assert.rejects(createWorkspace(root), /cannot overwrite/);
  await assert.rejects(createWorkspace(resolve(root, "..")), /cannot overwrite/);
  await assert.rejects(createWorkspace(root, "unknown"), /Unknown fixture/);
  const directory = await mkdtemp(resolve(tmpdir(), "maintenance-preserve-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(resolve(directory, "existing"));
  await assert.rejects(createWorkspace(directory), /must be empty/);
  assert.deepEqual(await readdir(directory), ["existing"]);
});

test("the all-component scaffold builds and its MCP echo tool works over stdio", { timeout: 60_000 }, async (t) => {
  const directory = await fixture(t);
  execFileSync(process.execPath, ["scripts/remove-plugin.mjs", "sample-notes"],
    { cwd: directory, encoding: "utf8", timeout: 30_000 });
  execFileSync(process.execPath, ["scripts/new-plugin.mjs", "scratch", "--with", "agent", "--with", "mcp",
    "--with", "hook", "--with", "extension"], { cwd: directory, encoding: "utf8", timeout: 30_000 });
  execFileSync(process.execPath, ["scripts/typecheck.mjs"], { cwd: directory, encoding: "utf8", timeout: 30_000 });
  execFileSync(process.execPath, ["scripts/validate-evals.mjs"], { cwd: directory, encoding: "utf8", timeout: 30_000, stdio: "pipe" });
  const client = new Client({ name: "fixture-check", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [resolve(directory, "plugins/scratch/dist/server.mjs")],
  }));
  try {
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === "echo"));
    const result = await client.callTool({ name: "echo", arguments: { text: "synthetic-roundtrip" } });
    assert.deepEqual(result.structuredContent, { text: "synthetic-roundtrip" });
  } finally {
    await client.close();
  }
  const hook = resolve(directory, "plugins/scratch/com.github.copilot/hooks/scratch.mjs");
  const linked = resolve(directory, "linked-hook.mjs");
  try { await symlink(hook, linked, "file"); }
  catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) return t.diagnostic("File symlinks need elevated permissions on this host; MCP roundtrip passed.");
    throw error;
  }
  try {
    const output = execFileSync(process.execPath, [linked],
      { input: "not json", encoding: "utf8", timeout: 10_000 });
    assert.match(JSON.parse(output).additionalContext, /^scratch:/);
  } finally {
    await unlink(linked);
  }
});
