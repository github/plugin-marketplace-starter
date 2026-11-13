import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDefaultGraderRegistry } from "@microsoft/vally";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const prDescriptionTest = existsSync(resolve(root, "plugins/pr-description")) ? test : test.skip;

prDescriptionTest("pr-description eval stages catalog-local skills and enforces non-collision", async () => {
  const evalDir = resolve(root, "evals/pr-description/skills/pr-description");
  const spec = parse(readFileSync(resolve(evalDir, "eval.yaml"), "utf8"));
  assert.equal(spec.scoring.threshold, 1);
  const project = parse(readFileSync(resolve(root, ".vally.yaml"), "utf8"));
  assert.equal(spec.agent_environment, "marketplace");
  const skills = project.environments.marketplace.skills;
  for (const configuredSkill of skills) {
    assert.ok(existsSync(resolve(evalDir, configuredSkill)), `configured cohort skill path is missing: ${configuredSkill}`);
  }
  const staged = new Set(skills.map((skill) => resolve(evalDir, skill)));
  const catalog = JSON.parse(readFileSync(resolve(root, "marketplace.json"), "utf8"));
  for (const plugin of catalog.plugins.filter((plugin) => typeof plugin.source === "string")) {
    const directory = resolve(root, plugin.source, "skills");
    if (!existsSync(directory)) continue;
    for (const skill of readdirSync(directory)) {
      const source = resolve(directory, skill);
      if (existsSync(resolve(source, "SKILL.md"))) {
        assert.ok(staged.has(source), `Add catalog skill ${plugin.name}/${skill} to the native marketplace environment.`);
      }
    }
  }

  const grader = createDefaultGraderRegistry().get("skill-invocation");
  const positive = spec.stimuli.find((item) => item.tags?.control === "positive");
  const negative = spec.stimuli.find((item) => item.tags?.control === "negative");
  const posConfig = positive.graders.find((item) => item.type === "skill-invocation").config;
  const negConfig = negative.graders.find((item) => item.type === "skill-invocation").config;
  const activation = (name) => ({ type: "skill_activation", data: { name } });

  const exactMatch = await grader.grade({
    stimulus: positive, config: posConfig,
    trajectory: { output: "ok", events: [activation("pr-description")] },
  });
  assert.equal(exactMatch.passed, true);

  if (posConfig.disallowed?.length) {
    const neighborCollision = await grader.grade({
      stimulus: positive, config: posConfig,
      trajectory: { output: "ok", events: [activation("pr-description"), activation(posConfig.disallowed[0])] },
    });
    assert.equal(neighborCollision.passed, false, "activating a configured neighbor must fail");
  }

  const negativeTriggered = await grader.grade({
    stimulus: negative, config: negConfig,
    trajectory: { output: "ok", events: [activation("pr-description")] },
  });
  assert.equal(negativeTriggered.passed, false, "activating pr-description on the negative case must fail");
});

prDescriptionTest("pr-description program grader enforces ordered headings, factual changes, and unshipped backlog exclusion", async (t) => {
  const gradingDir = resolve(root, ".github/scripts", `.pr-grader-test-${randomUUID()}`);
  mkdirSync(gradingDir, { recursive: true });
  t.after(() => rmSync(gradingDir, { recursive: true, force: true }));
  copyFileSync(resolve(root, "evals/pr-description/skills/pr-description/grader.mjs"), resolve(gradingDir, "grader.mjs"));
  copyFileSync(resolve(root, "evals/_shared/graders/common.mjs"), resolve(gradingDir, "common.mjs"));
  const { evaluate: evaluatePrDescription } = await import(pathToFileURL(resolve(gradingDir, "grader.mjs")));
  const { score } = await import(pathToFileURL(resolve(gradingDir, "common.mjs")));
  const validOutput = [
    "## Summary",
    "Validate `--timeout` as a positive integer in `src/cli.mjs` and add unit tests. Retry backoff (#42) remains open and out of scope.",
    "",
    "## Changes",
    "- Added positive integer validation for `--timeout` in `src/cli.mjs`.",
    "- Added unit tests for `--timeout 0` and `--timeout -5` in `test/cli.test.mjs`.",
    "",
    "## Verification",
    "- `npm test` passed (14 tests).",
    "",
    "## Risks / Rollback",
    "- Low risk; revert the commit if needed.",
  ].join("\n");
  assert.equal(score("pr-description-contract", evaluatePrDescription({ output: validOutput, events: [] })).passed, true);
  for (const passingLine of [
    "- `npm test` (14 tests): passed.",
    "- `npm test` \u2014 14 tests, all passing.",
    "- Ran `npm test`; 14/14 tests passed.",
    "- `npm test`: 14 tests passed, 0 failed, 0 errors.",
    "- `npm test` passed (14 tests, no errors).",
    "- `npm test`: 14 passed, # fail 0, 0 failures.",
  ]) {
    const output = validOutput.replace("- `npm test` passed (14 tests).", passingLine);
    assert.equal(score("pr-description-contract", evaluatePrDescription({ output, events: [] })).passed, true, passingLine);
  }
  for (const negatedLine of [
    "- `npm test` (14 tests).",
    "- `npm test` did not pass (14 tests).",
    "- `npm test` (14 tests): not passing.",
    "- `npm test`: 14 tests; 12 passed, 2 failures.",
    "- `npm test` failed (14 tests).",
  ]) {
    const output = validOutput.replace("- `npm test` passed (14 tests).", negatedLine);
    const result = score("pr-description-contract", evaluatePrDescription({ output, events: [] }));
    assert.equal(result.passed, false, negatedLine);
    assert.match(result.evidence, /Recorded the supplied npm test verification result/);
  }
  for (const leakedChanges of [
    "- Added unit tests for `--timeout 0` and `--timeout -5` in `test/cli.test.mjs`.\n- Implemented exponential retry backoff (#42).",
    "- Rejects `--timeout` values that are not positive integers.\n- Adds exponential retry backoff (#42).",
  ]) {
    const output = validOutput.replace(
      "- Added unit tests for `--timeout 0` and `--timeout -5` in `test/cli.test.mjs`.", leakedChanges);
    const result = score("pr-description-contract", evaluatePrDescription({ output, events: [] }));
    assert.equal(result.passed, false);
    assert.match(result.evidence, /Excluded unshipped retry backoff/);
  }
  const missingRisks = validOutput.split("## Risks / Rollback")[0];
  assert.equal(score("pr-description-contract", evaluatePrDescription({ output: missingRisks, events: [] })).passed, false);
  for (const prohibitedTool of ["bash", "functions.bash", "functions.powershell", "mcp:edit", "tools/write_file"]) {
    const result = score("pr-description-contract", evaluatePrDescription({
      output: validOutput,
      events: [{ type: "tool_call", data: { toolCallId: "1", toolName: prohibitedTool, arguments: { command: "git status" } } }],
    }));
    assert.equal(result.passed, false, `must reject prohibited tool ${prohibitedTool}`);
    assert.match(result.evidence, /Did not run shell commands or create a pull request/);
  }
});
