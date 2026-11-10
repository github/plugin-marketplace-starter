import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDefaultGraderRegistry } from "@microsoft/vally";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const skillEvals = [
  ["plugin-authoring", ["add-plugin", "try-plugin-locally", "submit-plugin"]],
  ["marketplace-maintainer", ["update-remote-pins", "release-plugins"]],
].flatMap(([plugin, skills]) => skills.map((skill) => ({
  skill, skills,
  spec: parse(readFileSync(resolve(root, "evals", plugin, "skills", skill, "eval.yaml"), "utf8")),
})));

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
  const grade = (text = output(), commands = [], toolCalls = []) => score("local-guidance", evaluate({
    output: text,
    events: [...commands.map((command) => ({ toolName: "powershell", arguments: { command } })), ...toolCalls].map((call, index) => ({
      type: "tool_call", data: { toolCallId: String(index), ...call },
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

test("local guidance ignores read-only and descriptive arguments but still checks shell commands", async (t) => {
  const { output, grade, selected } = await fixture(t);
  for (const call of [
    { toolName: "grep", arguments: { pattern: "copilot --plugin-dir" } },
    { toolName: "report_intent", arguments: { intent: "Copilot command preparation" } },
    { toolName: "report_intent", arguments: { intent: "Checking git state without checkout" } },
    { toolName: "functions.powershell", arguments: { command: "git status --short", description: "Checking git state without checkout" } },
  ]) {
    assert.equal(grade(output(), [], [call]).passed, true, JSON.stringify(call));
  }
  for (const toolName of ["bash", "powershell", "shell", "functions.powershell", "functions.bash"]) {
    for (const command of [`copilot --plugin-dir "${selected}"`, "git checkout candidate"]) {
      assert.equal(grade(output(), [], [{ toolName, arguments: { command } }]).passed, false, `${toolName}: ${command}`);
    }
  }
});

test("every skill eval case keeps a strict native required or disallowed invocation check", () => {
  for (const { skill, skills, spec } of skillEvals) {
    assert.equal(spec.scoring.threshold, 1, skill);
    for (const stimulus of spec.stimuli) {
      const invocation = stimulus.graders.filter((grader) => grader.type === "skill-invocation");
      assert.equal(invocation.length, 1, stimulus.name);
      assert.deepEqual(invocation[0].config, stimulus.tags?.control === "negative"
        ? { disallowed: skills } : { required: [skill] }, stimulus.name);
    }
  }
});

test("native skill grader requires exact activation in every positive and boundary case", async () => {
  const grader = createDefaultGraderRegistry().get("skill-invocation");
  assert.ok(grader);
  for (const { skill, spec } of skillEvals) {
    const reads = [
      `C:\\skills\\${skill}\\SKILL.md`,
      `/skills/${skill}/references/guide.md`,
    ].flatMap((path, index) => [
      { type: "tool_call", data: { toolCallId: `read-${index}`, toolName: "view", arguments: { path } } },
      { type: "tool_result", data: { toolCallId: `read-${index}`, success: true, result: "Skill contents" } },
    ]);
    const search = [
      { type: "tool_call", data: { toolCallId: "search", toolName: "grep", arguments: { pattern: `/skills/${skill}/SKILL.md` } } },
      { type: "tool_result", data: { toolCallId: "search", success: true, result: "Found skill path" } },
    ];
    for (const stimulus of spec.stimuli.filter((item) => item.tags?.control !== "negative")) {
      const config = stimulus.graders.find((item) => item.type === "skill-invocation").config;
      for (const [label, events, passed] of [
        ["matching activation", [{ type: "skill_activation", data: { name: skill } }], true],
        ["no activation", [], false],
        ["wrong activation", [{ type: "skill_activation", data: { name: `${skill}-other` } }], false],
        ["successful file reads", reads, false],
        ["successful search", search, false],
      ]) {
        const result = await grader.grade({
          stimulus, config,
          trajectory: { output: `Completed using ${skill}; see /skills/${skill}/SKILL.md.`, endReason: "completed", events },
        });
        assert.equal(result.passed, passed, `${stimulus.name}: ${label}`);
        assert.equal(result.score, passed ? 1 : 0, `${stimulus.name}: ${label}`);
      }
    }
  }
});

test("native skill grader passes no activation and rejects every forbidden skill in negative cases", async () => {
  const grader = createDefaultGraderRegistry().get("skill-invocation");
  assert.ok(grader);
  for (const { spec } of skillEvals) {
    for (const stimulus of spec.stimuli.filter((item) => item.tags?.control === "negative")) {
      const config = stimulus.graders.find((item) => item.type === "skill-invocation").config;
      const absent = await grader.grade({ stimulus, config, trajectory: { output: "Done.", events: [] } });
      assert.equal(absent.passed, true, stimulus.name);
      for (const name of config.disallowed) {
        const result = await grader.grade({
          stimulus, config,
          trajectory: { output: "Done.", events: [{ type: "skill_activation", data: { name } }] },
        });
        assert.equal(result.passed, false, `${stimulus.name}: ${name}`);
        assert.equal(result.score, 0, `${stimulus.name}: ${name}`);
      }
    }
  }
});

test("local program grader reports outcome checks independently of invocation", async (t) => {
  const { directory, output } = await fixture(t);
  const input = resolve(directory, "grader-input.json");
  writeFileSync(input, JSON.stringify({ trajectory: { output: output(), events: [] } }));
  const result = spawnSync(process.execPath, [resolve(directory, "grader.mjs")], {
    cwd: directory, encoding: "utf8", timeout: 10000,
    env: { ...process.env, EVALUATE_GRADER_INPUT: input, EVALUATE_WORKSPACE: directory },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    name: "plugin-authoring-try", kind: "code", passed: true, score: 1,
    evidence: "All contract assertions passed.",
  });
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
