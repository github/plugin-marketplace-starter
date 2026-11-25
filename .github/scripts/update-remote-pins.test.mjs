import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evalDirectory = resolve(root, "evals/marketplace-maintainer/skills/update-remote-pins");
const pinsTest = existsSync(evalDirectory) ? test : test.skip;
const label = "Reported the upstream change and offline limit";

async function fixture(t) {
  const spec = parse(readFileSync(resolve(evalDirectory, "eval.yaml"), "utf8"));
  const stimulus = spec.stimuli.find((item) => item.name === "update-remote-pins-uses-reviewed-release");
  const directory = resolve(root, ".github/scripts", `.remote-pins-test-${randomUUID()}`);
  const workspace = resolve(directory, "workspace");
  mkdirSync(workspace, { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of stimulus.agent_environment.files) {
    cpSync(resolve(evalDirectory, file.src), resolve(workspace, file.dest), { recursive: true });
  }
  for (const file of spec.grading_environment.files) {
    const destination = resolve(directory, file.dest);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    cpSync(resolve(evalDirectory, file.src), destination);
  }
  const { evaluate } = await import(pathToFileURL(resolve(directory, ".grading/grader.mjs")));
  const { score } = await import(pathToFileURL(resolve(directory, ".grading/common.mjs")));
  const catalog = JSON.parse(readFileSync(resolve(workspace, "marketplace.json"), "utf8"));
  const entry = catalog.plugins.find((item) => item.name === "outside-notes");
  Object.assign(entry, { version: "1.1.0" });
  Object.assign(entry.source, { sha: "b".repeat(40), ref: "v1.1.0" });
  writeFileSync(resolve(workspace, "marketplace.json"), JSON.stringify(catalog, null, 2));
  return (output) => score("marketplace-maintainer-remote", evaluate({ output, events: [] }, workspace));
}

const offline = "This used the recorded offline snapshot, not live GitHub verification.";

pinsTest("update-remote-pins accepts the fixture's upstream change in exact and paraphrased wording", async (t) => {
  const grade = await fixture(t);
  for (const summary of [
    "Upstream change: Add support for empty note lists.",
    "v1.1.0 now handles an empty notes list without errors.",
    "The only change: the notes list can now be empty.",
    "It adds support for empty lists of notes.",
    "Note lists that are empty are now supported.",
    "Lists with no notes are now handled.",
    "- v1.1.0 adds support for **empty** note lists.",
    "v1.1.0 adds empty-note-list support.",
  ]) {
    const result = grade(`${summary} No new hooks or dependencies. ${offline}`);
    assert.equal(result.passed, true, `${summary}: ${result.evidence}`);
  }
});

pinsTest("update-remote-pins rejects missing or unrelated upstream changes and a missing offline limit", async (t) => {
  const grade = await fixture(t);
  for (const [output, reason] of [
    [`Pinned outside-notes to v1.1.0. No new hooks or dependencies. ${offline}`, /no empty-note-list change/],
    [`Updated the synthetic outside notes plugin; see the release notes list. Nothing is empty. ${offline}`, /no empty-note-list change/],
    [`The release notes list is empty. ${offline}`, /no empty-note-list change/],
    [`The release-notes list is empty. ${offline}`, /no empty-note-list change/],
    [`Note lists must not be empty. ${offline}`, /no empty-note-list change/],
    [`Lists with no notes are not supported. ${offline}`, /no empty-note-list change/],
    [`Note lists that are empty are no longer supported. ${offline}`, /no empty-note-list change/],
    [`The release  notes list is empty. ${offline}`, /no empty-note-list change/],
    [`The release\nnotes list is empty. ${offline}`, /no empty-note-list change/],
    ["Upstream change: Add support for empty note lists. Verified on GitHub.", /no offline limit/],
  ]) {
    const result = grade(output);
    assert.equal(result.passed, false, output);
    assert.ok(result.evidence.includes(label), result.evidence);
    assert.match(result.evidence, reason);
  }
});

pinsTest("update-remote-pins failure evidence names missing conditions without echoing model output", async (t) => {
  const grade = await fixture(t);
  const token = `ghp_${"A".repeat(36)}`;
  const result = grade(`Pinned it with ${token}. {"token": "synthetic-opaque-value"}`);
  assert.equal(result.passed, false);
  assert.match(result.evidence, /\(no empty-note-list change, no offline limit\)/);
  assert.ok(!result.evidence.includes(token) && !result.evidence.includes("synthetic-opaque-value"), result.evidence);
});
