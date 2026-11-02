import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspace } from "../evals/support/maintenance-workspace.mjs";
import { fixture } from "./support/maintenance-workspace.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("maintenance workspaces use real tooling without staging eval specs or grader answers", async (t) => {
  const directory = await fixture(t);
  assert.equal(await readFile(resolve(directory, "scripts/new-plugin.mjs"), "utf8"),
    await readFile(resolve(root, "scripts/new-plugin.mjs"), "utf8"));
  const staged = (await readdir(resolve(directory, "evals"), { recursive: true })).filter((name) => name.endsWith(".yaml") || name.endsWith(".mjs"));
  assert.equal(staged.filter((name) => name.endsWith(".yaml")).length, 0);
  assert.deepEqual(staged.filter((name) => name.includes("graders")).map((name) => name.replaceAll("\\", "/")), ["graders/common.mjs"]);
  const output = execFileSync(process.execPath, ["scripts/validate.mjs"], { cwd: directory, encoding: "utf8", timeout: 30_000 });
  assert.match(output, /Validated 1 local plugin /);
  execFileSync(process.execPath, ["scripts/new-plugin.mjs", "fixture-shell"], { cwd: directory, encoding: "utf8", timeout: 30_000 });
  const after = execFileSync(process.execPath, ["scripts/validate.mjs"], { cwd: directory, encoding: "utf8", timeout: 30_000 });
  assert.match(after, /Validated 2 local plugins /);
  execFileSync(process.execPath, ["scripts/remove-plugin.mjs", "fixture-shell"], { cwd: directory, encoding: "utf8", timeout: 30_000 });
  assert.ok(!existsSync(resolve(directory, "plugins/fixture-shell")));
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
