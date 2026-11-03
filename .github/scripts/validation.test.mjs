import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLocalCatalog } from "./check-local-catalog.mjs";
import { checkRemotePin, githubApi } from "./check-remote-pins.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const schema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const sha = "a".repeat(40);
const entry = (extra = {}) => ({
  name: "tool",
  version: "1.0.0",
  source: { source: "github", repo: "owner/repo", path: "plugin", sha },
  ...extra,
});
const manifest = (extra = {}) => ({ name: "tool", version: "1.0.0", ...extra });

function fixture(t) {
  const directory = resolve(root, ".github/scripts", `.test-${randomUUID()}`);
  mkdirSync(directory);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fakeApi(files, { commit = { status: 200, body: JSON.stringify({ sha }) }, calls = [] } = {}) {
  return (endpoint) => {
    calls.push(endpoint);
    if (endpoint === `repos/owner/repo/commits/${sha}`) return commit;
    const prefix = "repos/owner/repo/contents/";
    assert.ok(endpoint.startsWith(prefix), endpoint);
    const file = decodeURIComponent(endpoint.slice(prefix.length).split("?")[0]);
    const data = files[file];
    if (data === undefined) return { status: 404, body: "Not Found" };
    if (data.status) return data;
    return { status: 200, body: typeof data === "string" ? data : JSON.stringify(data) };
  };
}

test("local catalog checks name, version, and description, including a description-only mismatch", (t) => {
  const directory = fixture(t);
  mkdirSync(resolve(directory, "plugins/tool"), { recursive: true });
  const local = { ...manifest(), description: "The manifest description." };
  const catalog = { plugins: [{ ...local, source: "./plugins/tool" }] };
  writeFileSync(resolve(directory, "plugins/tool/plugin.json"), JSON.stringify(local));
  writeFileSync(resolve(directory, "marketplace.json"), JSON.stringify(catalog));
  checkLocalCatalog(directory);
  for (const field of ["name", "version", "description"]) {
    catalog.plugins[0] = { ...local, source: "./plugins/tool", [field]: "different" };
    writeFileSync(resolve(directory, "marketplace.json"), JSON.stringify(catalog));
    assert.throws(() => checkLocalCatalog(directory), new RegExp(`marketplace\\.json.*plugin\\.json disagree on ${field}`));
  }
  writeFileSync(resolve(directory, "plugins/tool/plugin.json"), "{");
  assert.throws(() => checkLocalCatalog(directory), SyntaxError);
});

test("Agent Plugins-schema root wins without reading a competing legacy .plugin manifest", () => {
  for (const version of ["1.0.0", "1.1.0"]) {
    const calls = [];
    assert.equal(checkRemotePin(entry(), fakeApi({
      "plugin/plugin.json": manifest({ $schema: schema.replace("1.0.0", version) }),
      "plugin/.plugin/plugin.json": manifest({ name: "other" }),
    }, { calls })), "plugin/plugin.json");
    assert.equal(calls.length, 2);
  }
});

test("an unsupported Agent Plugins root schema is rejected rather than falling back to legacy", () => {
  assert.throws(() => checkRemotePin(entry(), fakeApi({
    "plugin/plugin.json": manifest({ $schema: schema.replace("1.0.0", "99.0.0") }),
    "plugin/.plugin/plugin.json": manifest(),
  })), /unsupported Agent Plugins schema/);
});

test("legacy .plugin wins over a root without the Agent Plugins schema", () => {
  assert.equal(checkRemotePin(entry(), fakeApi({
    "plugin/plugin.json": manifest({ name: "other", $schema: "https://example.com/plugin.schema.json" }),
    "plugin/.plugin/plugin.json": manifest(),
  })), "plugin/.plugin/plugin.json");
});

test("legacy fallback order is .plugin, root, .github/plugin, then .claude-plugin", () => {
  const paths = [".plugin/plugin.json", "plugin.json", ".github/plugin/plugin.json", ".claude-plugin/plugin.json"];
  for (let index = 0; index < paths.length; index++) {
    const files = Object.fromEntries(paths.slice(index).map((path, offset) => [
      `plugin/${path}`, manifest({ name: offset ? "wrong" : "tool" }),
    ]));
    assert.equal(checkRemotePin(entry(), fakeApi(files)), `plugin/${paths[index]}`);
  }
});

test("a repository-root remote works when path is omitted", () => {
  const remote = entry();
  delete remote.source.path;
  assert.equal(checkRemotePin(remote, fakeApi({ "plugin.json": manifest({ $schema: schema }) })), "plugin.json");
});

test("remote name and supplied versions must match; optional versions retain their behavior", () => {
  assert.throws(() => checkRemotePin(entry(), fakeApi({ "plugin/plugin.json": manifest({ name: "other" }) })), /named other, expected tool/);
  assert.throws(() => checkRemotePin(entry(), fakeApi({ "plugin/plugin.json": manifest({ version: "2.0.0" }) })), /version 2\.0\.0, expected 1\.0\.0/);
  assert.equal(checkRemotePin(entry({ version: undefined }), fakeApi({ "plugin/plugin.json": manifest({ version: "2.0.0" }) })), "plugin/plugin.json");
  assert.equal(checkRemotePin(entry(), fakeApi({ "plugin/plugin.json": { name: "tool" } })), "plugin/plugin.json");
});

test("invalid remote sources and non-full pins fail before any API request", () => {
  const never = () => { assert.fail("API must not be called"); };
  assert.throws(() => checkRemotePin(entry({ source: { source: "url" } }), never), /only github/);
  assert.throws(() => checkRemotePin(entry({ source: { source: "github", sha: "abc" } }), never), /full 40-character commit/);
});

test("missing manifests fail, and malformed JSON isn't swallowed as a missing file", () => {
  assert.throws(() => checkRemotePin(entry(), fakeApi({})), /no plugin.json under plugin at/);
  assert.throws(() => checkRemotePin(entry(), fakeApi({
    "plugin/plugin.json": "{",
    "plugin/.plugin/plugin.json": manifest(),
  })), /tool: plugin\/plugin.json.*isn't valid JSON/);
  assert.throws(() => checkRemotePin(entry(), fakeApi({
    "plugin/plugin.json": manifest(),
    "plugin/.plugin/plugin.json": "{",
  })), /tool: plugin\/.plugin\/plugin.json.*isn't valid JSON/);
});

test("commit authentication, server, missing-pin, JSON, and SHA errors are distinct failures", () => {
  for (const status of [401, 403, 404, 500]) {
    assert.throws(() => checkRemotePin(entry(), fakeApi({}, { commit: { status, body: "{}" } })), new RegExp(`commit.*HTTP ${status}`));
  }
  assert.throws(() => checkRemotePin(entry(), fakeApi({}, { commit: { status: 200, body: "{" } })), /commit response isn't valid JSON/);
  assert.throws(() => checkRemotePin(entry(), fakeApi({}, { commit: { status: 200, body: '{"sha":"different"}' } })), /didn't return the pinned commit/);
});

test("manifest authentication and server errors stop rather than falling through to another file", () => {
  for (const status of [401, 403, 500]) {
    const calls = [];
    assert.throws(() => checkRemotePin(entry(), fakeApi({
      "plugin/plugin.json": { status, body: "{}" },
      "plugin/.plugin/plugin.json": manifest(),
    }, { calls })), new RegExp(`plugin.json.*HTTP ${status}`));
    assert.equal(calls.length, 2);
  }
  assert.throws(() => checkRemotePin(entry(), () => { throw new Error("network unavailable"); }), /network unavailable/);
});

test("gh transport retains HTTP statuses and raw JSON without exposing stderr", () => {
  const run = (_command, args) => {
    assert.ok(args.includes("--include"));
    return { status: 0, stdout: 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"name":"tool"}', stderr: "" };
  };
  assert.deepEqual(githubApi("repos/owner/repo", run), { status: 200, body: '{"name":"tool"}' });
  assert.deepEqual(githubApi("repos/owner/repo", () => ({
    status: 1, stdout: "HTTP/2.0 403 Forbidden\nContent-Type: application/json\n\n{}", stderr: "sensitive diagnostic",
  })), { status: 403, body: "{}" });
  assert.throws(() => githubApi("repos/owner/repo", () => ({ status: 1, stdout: "", stderr: "sensitive diagnostic" })), /exit 1; no HTTP response/);
  assert.throws(() => githubApi("repos/owner/repo", () => ({ error: { code: "ENOENT" } })), /Couldn't run gh api \(ENOENT\)/);
});

test("schema script keeps pinned AJV and draft2020, and cleans its directory on success and failures", (t) => {
  const directory = fixture(t);
  mkdirSync(resolve(directory, ".github/scripts"), { recursive: true });
  const script = readFileSync(resolve(root, ".github/scripts/validate-schema.sh"), "utf8");
  assert.match(script, /ajv-cli@5\.0\.0 validate --spec=draft2020/);
  for (const failure of ["none", "curl", "npx"]) {
    const command = `
curl() { printf '{}' > "$4"; ${failure === "curl" ? "return 9" : "return 0"}; }
npx() { ${failure === "npx" ? "return 8" : "return 0"}; }
${script}`;
    const result = spawnSync("bash", ["-c", command], { cwd: directory, encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, failure === "none" ? 0 : failure === "curl" ? 9 : 8, result.stderr);
    assert.deepEqual(readdirSync(resolve(directory, ".github/scripts")), []);
  }
});

test("schema-directory collisions never delete pre-existing contents", (t) => {
  const directory = fixture(t);
  mkdirSync(resolve(directory, ".github/scripts"), { recursive: true });
  const script = readFileSync(resolve(root, ".github/scripts/validate-schema.sh"), "utf8");
  const result = spawnSync("bash", ["-c", `
mkdir ".github/scripts/.schema-check-$$"
printf 'keep' > ".github/scripts/.schema-check-$$/marker"
${script}`], { cwd: directory, encoding: "utf8" });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  const remaining = readdirSync(resolve(directory, ".github/scripts"));
  assert.equal(remaining.length, 1);
  assert.equal(readFileSync(resolve(directory, ".github/scripts", remaining[0], "marker"), "utf8"), "keep");
});

test("validation calls CI scripts, and paid eval activation is manual-only", () => {
  const validate = readFileSync(resolve(root, ".github/workflows/validate.yml"), "utf8");
  assert.doesNotMatch(validate, /node -e|run: \|/);
  for (const script of ["validate-schema.sh", "check-local-catalog.mjs", "check-remote-pins.mjs"]) {
    assert.ok(validate.includes(`.github/scripts/${script}`));
  }
  assert.match(validate, /node --test \.github\/scripts\/\*\.test\.mjs/);
  const evals = readFileSync(resolve(root, ".github/workflows/evals.yml"), "utf8");
  assert.match(evals, /^on:\n  workflow_dispatch:\npermissions:/m);
  assert.doesNotMatch(evals, /pull_request:|ENABLE_EVALS|environment:|^\s+if:/m);
  assert.match(evals, /copilot-requests: write/);
  assert.match(evals, /npm run eval -- --suite smoke --require-pass/);
  assert.deepEqual(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts, {
    lint: "vally lint plugins --eval-spec evals --strict",
    eval: "vally eval --workers 1 --max-retries 1",
  });
});
