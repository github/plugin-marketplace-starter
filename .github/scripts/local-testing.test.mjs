import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

async function fixture(t) {
  const directory = resolve(root, ".github/scripts", `.local-test-${randomUUID()} space`);
  mkdirSync(directory);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(resolve(root, "evals/_shared/fixtures/sample-marketplace"), directory, { recursive: true });
  copyFileSync(resolve(root, "evals/plugin-authoring/skills/try-plugin-locally/grader.mjs"), resolve(directory, "grader.mjs"));
  copyFileSync(resolve(root, "evals/_shared/graders/common.mjs"), resolve(directory, "common.mjs"));
  const { evaluate } = await import(pathToFileURL(resolve(directory, "grader.mjs")));
  const { score } = await import(pathToFileURL(resolve(directory, "common.mjs")));
  const selected = resolve(directory, "plugins/sample-notes");
  const output = (path = selected) => [
    "Review the local plugin source and accept host trust and tool permissions before starting a fresh Copilot CLI session.",
    "```sh", `copilot --plugin-dir "${path}"`, "```",
    "Session: not started", "Discovery: unverified", "Behavior: unverified",
  ].join("\n");
  const grade = (text = output(), commands = []) => score("local-guidance", evaluate({
    output: text,
    events: commands.map((command, index) => ({
      type: "tool_call", data: { toolCallId: String(index), toolName: "powershell", arguments: { command } },
    })),
  }, directory));
  return { directory, selected, output, grade };
}

test("local guidance accepts the selected absolute checkout path with spaces without running Copilot", async (t) => {
  const { output, grade, selected } = await fixture(t);
  for (const path of [selected, selected.replaceAll("\\", "/")]) {
    assert.equal(grade(output(path)).passed, true);
  }
  assert.equal(grade(output(), [`Write-Output 'copilot --plugin-dir "${selected}"'`]).passed, true,
    "echoing a prepared command is allowed without claiming host verification");
  if (process.platform === "win32") assert.equal(grade(output(selected.toLowerCase())).passed, true);
});

test("local guidance rejects relative, wrong, installed, and published plugin sources", async (t) => {
  const { directory, output, grade } = await fixture(t);
  for (const path of [
    "./plugins/sample-notes", directory, resolve(directory, "plugins/other"),
    resolve(directory, "installed/sample-notes"), "sample-notes@fixture-plugins",
    "https://github.com/example/marketplace",
  ]) {
    const result = grade(output(path));
    assert.equal(result.passed, false, path);
    assert.match(result.evidence, /selected absolute local session command/);
  }
  const additional = output().replace('"\n```', `" --plugin-dir "${resolve(directory, "installed/sample-notes")}"\n` + "```");
  assert.equal(grade(additional).passed, false, "an extra source must not hide behind a correct local path");
});

test("local guidance rejects attempted install, uninstall, profile, session, and branch mutations even without a successful tool result", async (t) => {
  const { output, grade, selected } = await fixture(t);
  for (const command of [
    "copilot plugin install sample-notes@fixture-plugins",
    "copilot plugin install $spec",
    "copilot plugin uninstall $spec",
    "copilot plugin marketplace add .",
    `copilot --plugin-dir "${selected}"`,
    "copilot", "copilot -p 'Try the plugin'",
    '& "C:\\trusted path\\copilot.exe" --plugin-dir "C:\\plugin"',
    'node "node_modules/@github/copilot/npm-loader.js" --plugin-dir .',
    "$env:COPILOT_HOME = 'new-profile'",
    "git switch candidate", "git -C . switch candidate", "git checkout candidate", "git stash", "git reset --hard",
  ]) {
    const result = grade(output(), [command]);
    assert.equal(result.passed, false, command);
    assert.match(result.evidence, /Did not launch Copilot/);
  }
  assert.equal(grade(output().replace("Session: not started", "```sh\ncopilot plugin install $spec\n```\nSession: not started")).passed, false);
});

test("local guidance doesn't count an echoed command as verified host discovery or behavior", async (t) => {
  const { output, grade, selected } = await fixture(t);
  const fabricated = output().replaceAll("unverified", "verified");
  assert.equal(grade(fabricated, [`Write-Output 'copilot --plugin-dir "${selected}"'`]).passed, false);
  for (const status of ["Session: not started", "Discovery: unverified", "Behavior: unverified"]) {
    const result = grade(output().replace(status, ""));
    assert.equal(result.passed, false);
    assert.match(result.evidence, /honestly unverified/);
  }
  assert.equal(grade(output().replace("trust and tool permissions", "prompts")).passed, false);
});

test("local guidance refuses a missing or changed selected local manifest/catalog", async (t) => {
  const { directory, grade } = await fixture(t);
  writeFileSync(resolve(directory, "plugins/sample-notes/plugin.json"), '{"name":"different"}');
  assert.equal(grade().passed, false);
  writeFileSync(resolve(directory, "marketplace.json"), "{}");
  assert.equal(grade().passed, false);
});
