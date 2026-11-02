import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadGrader } from "./support/grading.mjs";
import { fixture } from "./support/maintenance-workspace.mjs";

// This test belongs to the plugin-authoring plugin; npm run remove-plugin removes it with the plugin.
const grader = await loadGrader("evals/plugin-authoring/skills/add-plugin/eval.yaml", ".grading/plugin-authoring.mjs");
const trajectory = (commands, output = "") => ({
  output,
  events: commands.flatMap((command, i) => [
    { type: "tool_call", data: { toolCallId: `${i}`, toolName: "powershell", arguments: { command } } },
    { type: "tool_result", data: { toolCallId: `${i}`, success: true, result: "exit code 0" } },
  ]),
});
const passes = (checks) => checks.every((item) => item.passed);

test("add-plugin grader rejects no-op, extra content, and inconsistent registrations", async (t) => {
  const directory = await fixture(t);
  const evidence = trajectory(["npm run new-plugin -- yaml-after-edit", "npm run verify"]);
  assert.equal(passes(grader.evaluate(evidence, directory, "add")), false);
  execFileSync(process.execPath, ["scripts/new-plugin.mjs", "yaml-after-edit"],
    { cwd: directory, encoding: "utf8", timeout: 30_000 });
  assert.equal(passes(grader.evaluate(evidence, directory, "add")), true);
  assert.equal(passes(grader.evaluate(trajectory(["npm run verify"]), directory, "add")), false);
  await mkdir(resolve(directory, "plugins/yaml-after-edit/skills/yaml-after-edit"), { recursive: true });
  assert.equal(passes(grader.evaluate(evidence, directory, "add")), false);
  await rm(resolve(directory, "plugins/yaml-after-edit/skills"), { recursive: true });
  const path = resolve(directory, "marketplace.json");
  const catalog = JSON.parse(await readFile(path, "utf8"));
  catalog.plugins.find((item) => item.name === "yaml-after-edit").version = "9.0.0";
  await writeFile(path, JSON.stringify(catalog));
  assert.equal(passes(grader.evaluate(evidence, directory, "add")), false);
  await writeFile(path, "{invalid");
  assert.equal(passes(grader.evaluate(evidence, directory, "add")), false);
});

test("local-install grader requires install, list, uninstall, and cleanup, not a claimed success", async (t) => {
  const directory = await fixture(t);
  const evidence = trajectory(["COPILOT_HOME=.fixture-copilot-home", "copilot plugin install sample-notes@fixture-plugins",
    "copilot plugin list --json", "copilot plugin uninstall sample-notes@fixture-plugins"]);
  assert.equal(passes(grader.evaluate(evidence, directory, "try")), true);
  assert.equal(passes(grader.evaluate(trajectory([], "Installed and cleaned up"), directory, "try")), false);
  await mkdir(resolve(directory, ".fixture-copilot-home"));
  assert.equal(passes(grader.evaluate(evidence, directory, "try")), false);
});

test("submission grader requires a real version, changelog, and complete PR template", async (t) => {
  const directory = await fixture(t);
  const template = await readFile(resolve(directory, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8");
  const filled = template.replace(/\| \|$/gm, "| None; skill-only, no new access. |");
  const evidence = trajectory(["npm run verify"], `${filled}\nNone; not run.`);
  assert.equal(passes(grader.evaluate(evidence, directory, "submit")), false);
  const manifestPath = resolve(directory, "plugins/sample-notes/plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "1.0.1";
  await writeFile(manifestPath, JSON.stringify(manifest));
  const catalogPath = resolve(directory, "marketplace.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog.plugins[0].version = "1.0.1";
  await writeFile(catalogPath, JSON.stringify(catalog));
  await writeFile(resolve(directory, "plugins/sample-notes/CHANGELOG.md"), "# Changelog\n\n## 1.0.1\n\n- Clarify wording.\n");
  assert.equal(passes(grader.evaluate(evidence, directory, "submit")), true);
  assert.equal(passes(grader.evaluate({ ...evidence, output: `${template}\nNone; not run.` }, directory, "submit")), false);
  assert.equal(passes(grader.evaluate({ ...evidence, output: "PR ready" }, directory, "submit")), false);
});
