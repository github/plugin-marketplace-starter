import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readCatalog, partitionCatalog, remoteWarnings, validateRemoteSource } from "../scripts/catalog.mjs";
import { discoverAssets, checkCoverage, root } from "../scripts/validate-evals.mjs";

test("the catalog separates local plugins from pinned, opt-in remote references", async () => {
  const { catalog, localPlugins, remotePlugins } = await readCatalog(root);
  assert.ok(localPlugins.length > 0);
  assert.equal(localPlugins.length + remotePlugins.length, catalog.plugins.length);
  const evals = remotePlugins.find((entry) => entry.source.repo === "github/evals");
  if (evals) {
    // The catalog name must match upstream's plugin.json name, not its marketplace name.
    assert.equal(evals.name, "github-copilot");
    assert.equal(evals.source.path, "packages/plugin");
    assert.deepEqual(remoteWarnings(evals), []);
    assert.equal(evals.version, evals.source.ref.replace(/^copilot-evals-v/, ""));
  }
  const local = localPlugins[0];
  assert.throws(() => partitionCatalog({ ...catalog, plugins: [...catalog.plugins, local] }), /Duplicate/);
  assert.throws(() => partitionCatalog({ ...catalog, plugins: [{ name: "escape", source: "./plugins/../outside" }] }), /Local source/);
  assert.throws(() => partitionCatalog({ ...catalog, plugins: [{ name: "remote", source: { source: "github", repo: "o/r" }, version: "" }] }), /version/);
  assert.deepEqual(remoteWarnings({ name: "loose", source: { source: "github", repo: "o/r" } }).length, 2);
});

test("remote references are structurally checked without requiring access to the upstream", () => {
  for (const source of [
    { source: "github", repo: "github/evals", path: "packages/plugin" },
    { source: "github", repo: "example/plugin", ref: "main" },
    { source: "github", repo: "example/plugin", sha: "a".repeat(40) },
  ]) assert.doesNotThrow(() => validateRemoteSource(source));
  for (const source of [
    null, [], { source: "github" }, { source: "url", repo: "example/plugin" },
    { source: "github", repo: "https://github.com/example/plugin" },
    { source: "github", repo: "example/plugin", path: "../plugin" },
    { source: "github", repo: "example/plugin", path: "C:\\plugin" },
    { source: "github", repo: "example/plugin", ref: " " },
    { source: "github", repo: "example/plugin", sha: "main" },
    { source: "github", repo: "example/plugin", token: "not-supported" },
  ]) assert.throws(() => validateRemoteSource(source));
});

test("new custom agents require actual staged profiles, delegation, and subagent outcome assertions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-agent-coverage-"));
  try {
    const path = resolve(directory, "plugins/review/com.github.copilot/agents/reviewer.agent.md");
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, "---\nname: reviewer\ndescription: A read-only reviewer.\n---\nReview supplied source.\n");
    await writeFile(resolve(directory, "marketplace.json"), JSON.stringify({
      name: "agent-fixture", owner: { name: "Test" },
      plugins: [{ name: "review", source: "./plugins/review" }],
    }));
    const assets = await discoverAssets(directory);
    assert.equal(assets[0].id, "agent:review/reviewer");
    const specs = [{ path: resolve(directory, "evals/review/eval.yaml"), spec: {
      agent_environment: { files: [{ src: "../../plugins/review/com.github.copilot/agents/reviewer.agent.md", dest: ".github/agents/reviewer.agent.md" }] },
      stimuli: [
        { name: "uses-reviewer", tags: { assets: assets[0].id, control: "positive", suite: "smoke" }, graders: [
          { type: "tool-calls", config: { required: [{ name: "^task$", args: { agent_type: "^reviewer$" } }] } },
          { type: "output-matches", scope: "subagent", config: { pattern: "finding" } },
        ] },
        { name: "negative", tags: { assets: assets[0].id, control: "negative" }, graders: [{ type: "output-contains", config: { substring: "No actionable findings." } }] },
      ],
    } }];
    assert.equal(checkCoverage(assets, specs), 2);
    const unstaged = structuredClone(specs);
    unstaged[0].spec.agent_environment.files = [];
    assert.throws(() => checkCoverage(assets, unstaged), /stage the actual agent/);
    const notInvoked = structuredClone(specs);
    notInvoked[0].spec.stimuli[0].graders.shift();
    assert.throws(() => checkCoverage(assets, notInvoked), /assert delegation/);
    const parentOnly = structuredClone(specs);
    delete parentOnly[0].spec.stimuli[0].graders[1].scope;
    assert.throws(() => checkCoverage(assets, parentOnly), /subagent's behavior/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
