import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { missing } from "../scripts/examples.mjs";
import { loadGrader } from "./support/grading.mjs";
import { fixture } from "./support/maintenance-workspace.mjs";

const skip = missing("evals/marketplace-maintainer/graders.mjs");
const grader = skip ? undefined : await loadGrader("evals/marketplace-maintainer/skills/update-remote-pins/eval.yaml", ".grading/marketplace-maintainer.mjs");
const trajectory = (commands, output = "") => ({
  output,
  events: commands.flatMap((command, i) => [
    { type: "tool_call", data: { toolCallId: `${i}`, toolName: "powershell", arguments: { command } } },
    { type: "tool_result", data: { toolCallId: `${i}`, success: true, result: "exit code 0" } },
  ]),
});
const passes = (checks) => checks.every((item) => item.passed);

test("remote-pin grader rejects unchanged pins, wrong releases, and overlay enablement", { skip }, async (t) => {
  const directory = await fixture(t, "remote");
  const evidence = trajectory(["npm run check-remotes -- outside-notes", "npm run verify"], "Support for empty note lists. Offline recorded checks.");
  assert.equal(passes(grader.evaluate(evidence, directory, "remote")), false);
  const path = resolve(directory, "marketplace.json");
  const catalog = JSON.parse(await readFile(path, "utf8"));
  const remote = catalog.plugins.find((item) => item.name === "outside-notes");
  Object.assign(remote.source, { sha: "b".repeat(40), ref: "v1.1.0" });
  remote.version = "1.1.0";
  await writeFile(path, JSON.stringify(catalog));
  assert.equal(passes(grader.evaluate(evidence, directory, "remote")), true);
  remote.source.ref = "main";
  await writeFile(path, JSON.stringify(catalog));
  assert.equal(passes(grader.evaluate(evidence, directory, "remote")), false);
  remote.source.ref = "v1.1.0";
  await writeFile(path, JSON.stringify(catalog));
  const settingsPath = resolve(directory, ".github/copilot/settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  settings.enabledPlugins["outside-notes@fixture-plugins"] = true;
  await writeFile(settingsPath, JSON.stringify(settings));
  assert.equal(passes(grader.evaluate(evidence, directory, "remote")), false);
  await writeFile(path, "{invalid");
  assert.equal(passes(grader.evaluate(evidence, directory, "remote")), false);
});

test("release grader accepts an existing bump and rejects re-bumping or publication", { skip }, async (t) => {
  const directory = await fixture(t, "release");
  const evidence = trajectory(["npm run verify"], "sample-notes 1.0.1: clarify empty-input wording.");
  assert.equal(passes(grader.evaluate(evidence, directory, "release")), true);
  assert.equal(passes(grader.evaluate(trajectory([], "Ready to release"), directory, "release")), false);
  assert.equal(passes(grader.evaluate(trajectory(["npm run verify", "gh release create v1.0.1"], evidence.output), directory, "release")), false);
  const path = resolve(directory, "plugins/sample-notes/plugin.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.version = "1.0.2";
  await writeFile(path, JSON.stringify(manifest));
  assert.equal(passes(grader.evaluate(evidence, directory, "release")), false);
});

test("retirement grader checks actual removal and preserved scaffolding", { skip }, async (t) => {
  const directory = await fixture(t, "release");
  const evidence = trajectory(["npm run remove-plugin -- sample-notes --dry-run",
    "npm run remove-plugin -- sample-notes", "npm run verify"]);
  assert.equal(passes(grader.evaluate(evidence, directory, "retire")), false);
  execFileSync(process.execPath, ["scripts/remove-plugin.mjs", "sample-notes"],
    { cwd: directory, encoding: "utf8", timeout: 30_000 });
  assert.equal(passes(grader.evaluate(evidence, directory, "retire")), true);
});
