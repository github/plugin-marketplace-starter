import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readCatalog, partitionCatalog, remoteWarnings, validateRemoteSource } from "../scripts/catalog.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the catalog separates local plugins from pinned, opt-in remote references", async () => {
  const { catalog, localPlugins, remotePlugins } = await readCatalog(root);
  assert.equal(localPlugins.length + remotePlugins.length, catalog.plugins.length);
  for (const remote of remotePlugins) assert.doesNotThrow(() => validateRemoteSource(remote.source, remote.name));
  const local = { name: "dup", source: "./plugins/dup" };
  const sha = "a".repeat(40);
  assert.throws(() => partitionCatalog({ ...catalog, plugins: [local, local] }), /Duplicate/);
  assert.throws(() => partitionCatalog({ ...catalog, plugins: [{ name: "escape", source: "./plugins/../outside" }] }), /escape: Local source/);
  assert.throws(() => partitionCatalog({ ...catalog, plugins: [{ name: "remote", source: { source: "github", repo: "o/r", sha }, version: "" }] }), /version/);
  assert.deepEqual(remoteWarnings({ name: "loose", source: { source: "github", repo: "o/r", sha } }).length, 1);
});

test("an empty catalog is valid, and catalog errors are plain sentences", () => {
  const empty = partitionCatalog({ name: "empty", owner: { name: "Me" }, plugins: [] });
  assert.deepEqual([empty.localPlugins, empty.remotePlugins], [[], []]);
  assert.throws(() => partitionCatalog({ name: "Bad Name", owner: { name: "Me" }, plugins: [] }), /must be lowercase/);
  assert.throws(() => partitionCatalog({ name: "ok", plugins: [] }), /owner\.name/);
  assert.throws(() => partitionCatalog({ name: "ok", owner: { name: "Me" } }), /plugins must be a list/);
  assert.throws(() => partitionCatalog({ name: "ok", owner: { name: "Me" }, plugins: [{ name: "Bad" }] }), /plugins\[0\]: name "Bad"/);
});

test("remote references must pin a full sha, and errors name the entry", () => {
  const sha = "a".repeat(40);
  for (const source of [
    { source: "github", repo: "example/plugins", path: "packages/plugin", sha },
    { source: "github", repo: "example/plugin", ref: "v1.0.0", sha },
    { source: "github", repo: "example/plugin", sha },
  ]) assert.doesNotThrow(() => validateRemoteSource(source, "fixture"));
  for (const source of [
    null, [], { source: "github", sha }, { source: "url", repo: "example/plugin", sha },
    { source: "github", repo: "https://github.com/example/plugin", sha },
    { source: "github", repo: "example/plugin", path: "../plugin", sha },
    { source: "github", repo: "example/plugin", path: "./plugin", sha },
    { source: "github", repo: "example/plugin", path: ".", sha },
    { source: "github", repo: "example/plugin", path: "C:\\plugin", sha },
    { source: "github", repo: "example/plugin", ref: " ", sha },
    { source: "github", repo: "example/plugin", sha: "main" },
    { source: "github", repo: "example/plugin", sha: "abc1234" },
    { source: "github", repo: "example/plugin", ref: "main" },
    { source: "github", repo: "example/plugin", token: "not-supported", sha },
  ]) assert.throws(() => validateRemoteSource(source, "fixture"), /fixture: /);
  assert.throws(() => validateRemoteSource({ source: "github", repo: "o/r", ref: "main" }, "anarlog"), /anarlog: pin "sha".*gh api repos\/OWNER\/REPO\/commits\/REF/);
  assert.throws(() => validateRemoteSource({ source: "github", repo: "o/r", path: "./sub", sha }, "anarlog"), /anarlog: "path" must be.*Omit "path"/);
});
