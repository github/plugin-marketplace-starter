import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evalDirectory = resolve(root, "evals/marketplace-maintainer/skills/release-plugins");
const spec = parse(readFileSync(resolve(evalDirectory, "eval.yaml"), "utf8"));

async function fixture(t, name) {
  const directory = resolve(root, ".github/scripts", `.release-test-${randomUUID()}`);
  const workspace = resolve(directory, "workspace");
  mkdirSync(workspace, { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stimulus = spec.stimuli.find((item) => item.name === name);
  assert.ok(stimulus, `missing release case: ${name}`);
  for (const file of [...(spec.agent_environment.files ?? []), ...(stimulus.agent_environment?.files ?? [])]) {
    const destination = resolve(workspace, file.dest);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    cpSync(resolve(evalDirectory, file.src), destination, { recursive: true });
  }
  for (const file of spec.grading_environment.files) {
    const destination = resolve(directory, file.dest);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    cpSync(resolve(evalDirectory, file.src), destination);
  }
  const { evaluate } = await import(pathToFileURL(resolve(directory, ".grading/grader.mjs")));
  const { score } = await import(pathToFileURL(resolve(directory, ".grading/common.mjs")));
  const mode = stimulus.graders.find((item) => item.type === "program")?.config.args[1];
  return {
    workspace, stimulus,
    json: (path) => JSON.parse(readFileSync(resolve(workspace, path), "utf8")),
    grade: (output) => score("release-contract", evaluate({ output, events: [] }, workspace, mode)),
  };
}

test("unknown-release-base stages only current candidate files, with no released snapshot or alternative record", async (t) => {
  const { workspace, json } = await fixture(t, "release-plugins-asks-for-unknown-release-base");
  const files = readdirSync(workspace, { recursive: true })
    .filter((path) => statSync(resolve(workspace, path)).isFile())
    .map((path) => path.split(sep).join("/")).sort();
  assert.deepEqual(files, [
    ".github/copilot/settings.json",
    "AGENTS.md",
    "README.md",
    "marketplace.json",
    "plugins/sample-notes/CHANGELOG.md",
    "plugins/sample-notes/README.md",
    "plugins/sample-notes/plugin.json",
    "plugins/sample-notes/skills/sample-notes/SKILL.md",
  ], "extra files could accidentally supply release evidence to the no-evidence trial");
  assert.equal(json("marketplace.json").plugins[0].version, "1.0.1");
  assert.equal(json("plugins/sample-notes/plugin.json").version, "1.0.1");
  assert.match(readFileSync(resolve(workspace, "plugins/sample-notes/CHANGELOG.md"), "utf8"), /^## 1\.0\.1$/m);
});

test("unknown-release-base requires an actionable evidence request instead of a bare base mention or readiness claim", async (t) => {
  const { grade, stimulus } = await fixture(t, "release-plugins-asks-for-unknown-release-base");
  assert.ok(stimulus.graders.some((item) => item.type === "diff-empty"), "the no-edit boundary must remain enforced");
  for (const output of [
    "Please provide a known released base or confirm first-release status before I edit versions.",
    "Which released tag or commit should I compare against?",
    "Could you confirm first-release status before I edit?",
    "I need a release record or confirmation of the initial release before editing.",
    "This catalog is not ready to release. Please share the released base.",
  ]) {
    assert.equal(grade(output).passed, true, output);
  }
  for (const output of [
    "base",
    "The release record is missing and first-release status is unknown.",
    "I checked which released base applies.",
    "sample-notes 1.0.1 is ready to release against the base; no edits needed.",
    "Please provide the released base. This catalog is ready to release.",
    "Please provide the released base. I did not find evidence, but it is release-ready.",
  ]) {
    const result = grade(output);
    assert.equal(result.passed, false, output);
    assert.match(result.evidence, /Asked for a released base|Did not claim release readiness/);
  }
});

test("known-release and confirmed-first-release cases retain their fixtures and candidate versions", async (t) => {
  for (const name of ["release-plugins-keeps-already-bumped-version", "release-plugins-preserves-unreleased-initial-version"]) {
    const { workspace, stimulus, json, grade } = await fixture(t, name);
    assert.equal(json("released.json").plugins[0].version, "1.0.0");
    assert.equal(json("marketplace.json").plugins[0].version, "1.0.1");
    assert.equal(json("plugins/sample-notes/plugin.json").version, "1.0.1");
    const output = "sample-notes 1.0.1: clarify empty-input wording.";
    if (name === "release-plugins-keeps-already-bumped-version") {
      assert.equal(grade(output).passed, true);
    } else {
      assert.ok(stimulus.graders.some((item) => item.type === "diff-empty"));
      assert.match(output, new RegExp(stimulus.graders.find((item) => item.type === "output-matches").config.pattern));
      assert.match(readFileSync(resolve(workspace, "plugins/sample-notes/CHANGELOG.md"), "utf8"), /^## 1\.0\.1$/m);
    }
  }
});
