import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { inventorySkills, selectSkillEvals } from "./select-skill-evals.mjs";

test("marketplace inventory reads local skills and exact pinned remote trees without installing plugins", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "plugins/local/skills/draft"), { recursive: true });
  writeFileSync(join(root, "plugins/local/skills/draft/SKILL.md"), "synthetic");
  mkdirSync(join(root, "evals/local/skills/draft"), { recursive: true });
  writeFileSync(join(root, "evals/local/skills/draft/eval.yaml"), "synthetic");
  writeFileSync(join(root, "marketplace.json"), JSON.stringify({ plugins: [
    { name: "local", source: "./plugins/local" },
    { name: "remote", source: { source: "github", repo: "example/plugin", sha: "c".repeat(40), path: "package" } },
  ] }));
  const readTree = (repo, commit) => {
    assert.equal(repo, "example/plugin");
    assert.equal(commit, "c".repeat(40));
    return { truncated: false, tree: [
      { type: "blob", path: "package/skills/run/SKILL.md" },
      { type: "blob", path: "other/skills/unrelated/SKILL.md" },
    ] };
  };
  assert.deepEqual(inventorySkills(root, readTree), [
    { key: "local/draft", hasEval: true }, { key: "remote/run", hasEval: false },
  ]);
  assert.throws(() => inventorySkills(root, () => ({ truncated: true, tree: [] })), /Incomplete/);
  rmSync(join(root, "plugins"), { recursive: true });
  writeFileSync(join(root, "marketplace.json"), JSON.stringify({ plugins: [
    { name: "remote", source: { source: "github", repo: "example/plugin", sha: "c".repeat(40), path: "package" } },
  ] }));
  assert.deepEqual(inventorySkills(root, readTree), [{ key: "remote/run", hasEval: false }]);
});

test("selection requires approval protection and existing paired skills with repo evals at the verified merge", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "skill selection-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = resolve(directory, "repository"), hooks = resolve(directory, "hooks");
  mkdirSync(root);
  mkdirSync(hooks);
  const config = resolve(directory, "gitconfig");
  writeFileSync(config, "");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => {
    const result = spawnSync("git", [
      "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
      "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${hooks}`, ...args,
    ], { cwd: root, env, encoding: "utf8", timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const file = (path, content) => {
    mkdirSync(resolve(root, path, ".."), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  const target = "plugins/example/skills/changed";
  git("init", "--initial-branch=main");
  file(`${target}/SKILL.md`, "base");
  file(`${target}/r\u00e9sum\u00e9.md`, "base non-ASCII path");
  file("plugins/example/skills/neighbor/SKILL.md", "base neighbor");
  file("plugins/example/skills/deleted/SKILL.md", "deleted");
  file("evals/example/skills/changed/eval.yaml", "fixed measurement");
  file("marketplace.json", JSON.stringify({ plugins: [{ name: "example", source: "./plugins/example" }] }));
  file(".github/scripts/select-skill-evals.mjs", "throw new Error('Candidate selector must not run');");
  git("add", "."); git("commit", "-m", "Base fixture");
  git("checkout", "-b", "candidate");
  file(`${target}/SKILL.md`, "head");
  file(`${target}/r\u00e9sum\u00e9.md`, "head non-ASCII path");
  file("plugins/example/skills/neighbor/SKILL.md", "head neighbor");
  file("plugins/example/skills/added/SKILL.md", "added");
  rmSync(resolve(root, "plugins/example/skills/deleted"), { recursive: true });
  git("add", "."); git("commit", "-m", "Candidate fixture");
  const head = git("rev-parse", "HEAD");
  git("checkout", "main");
  file(`${target}/main.md`, "current-main-only file");
  git("add", "."); git("commit", "-m", "Advance main fixture");
  const base = git("rev-parse", "HEAD");
  git("merge", "--no-ff", "candidate", "-m", "Merge fixture");
  const context = {
    base, head, merge: git("rev-parse", "HEAD"), trusted: "d".repeat(40),
    repository: "fixture/repo", run: "2", attempt: "1", sourceRun: "1", sourceAttempt: "1",
    sourceWorkflow: ".github/workflows/skill-evals.yml",
  };
  const protection = { protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "Team" }] }] };
  assert.throws(() => selectSkillEvals(root, context, {}), /required maintainer reviewers/);
  assert.throws(() => selectSkillEvals(root, { ...context, head: "f".repeat(40) }, protection), /exact parents/);
  const selection = selectSkillEvals(root, context, protection);
  assert.deepEqual(selection.changed, ["example/added", "example/changed", "example/deleted", "example/neighbor"]);
  assert.equal(selection.include.length, 1);
  assert.deepEqual(selection.include[0], {
    key: "example/changed", id: selection.include[0].id, directory: target,
    evalPath: "evals/example/skills/changed/eval.yaml", base, head,
  });
  assert.match(selection.include[0].id, /^skill-[a-f0-9]{12}$/);
  assert.equal(readFileSync(resolve(root, `${target}/SKILL.md`), "utf8"), "head", "selection must not switch source files");
  const contextFile = resolve(directory, "context.json"), environmentFile = resolve(directory, "evals-environment.json");
  const selectionFile = resolve(directory, "selection.json"), outputFile = resolve(directory, "outputs");
  writeFileSync(contextFile, JSON.stringify(context));
  writeFileSync(environmentFile, JSON.stringify(protection));
  const trusted = resolve(directory, "trusted/.github/scripts");
  mkdirSync(trusted, { recursive: true });
  for (const script of ["select-skill-evals.mjs", "check-remote-pins.mjs"]) {
    copyFileSync(new URL(`./${script}`, import.meta.url), resolve(trusted, script));
  }
  const workflow = parse(readFileSync(new URL("../workflows/skill-eval-comment.yml", import.meta.url), "utf8"));
  const command = workflow.jobs.select.steps.find((step) => step.id === "select").run;
  const result = spawnSync("bash", ["-c", command], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { ...env, GITHUB_OUTPUT: outputFile, CONTEXT_FILE: contextFile,
      GITHUB_WORKSPACE: directory.replaceAll("\\", "/"), RUNNER_TEMP: directory.replaceAll("\\", "/") },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No before\/after pair for example\/added/);
  assert.match(result.stdout, /No before\/after pair for example\/deleted/);
  assert.match(result.stdout, /No before\/after pair for example\/neighbor/);
  assert.deepEqual(JSON.parse(readFileSync(selectionFile, "utf8")), selection);
  assert.match(readFileSync(outputFile, "utf8"), /\ncount=1\nattempt=1\n/);
});
