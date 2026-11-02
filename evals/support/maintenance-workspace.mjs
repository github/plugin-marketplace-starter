import { cp, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../../scripts/entrypoint.mjs";

const source = fileURLToPath(new URL("../../", import.meta.url));
const json = (path, data) => writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
const manifest = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "sample-notes", version: "1.0.0",
  description: "Summarize synthetic release notes.", license: "MIT",
};

// Copy tooling and policy, never this checkout's eval specs or grader answers.
export async function createWorkspace(destination, scenario = "authoring") {
  if (!["authoring", "release", "remote"].includes(scenario)) throw new Error(`Unknown fixture scenario: ${scenario}`);
  const directory = await realpath(resolve(destination));
  const sourceRoot = await realpath(source);
  const inside = (base, target) => {
    const path = relative(base, target);
    return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
  };
  if (inside(sourceRoot, directory) || inside(directory, sourceRoot)) {
    throw new Error("The fixture cannot overwrite the source checkout or its ancestors.");
  }
  const existing = await readdir(directory);
  if (existing.some((name) => ![".github", ".git"].includes(name))) {
    throw new Error("The fixture workspace must be empty except for staged agent/git metadata.");
  }
  for (const name of ["scripts", "schemas"]) await cp(resolve(source, name), resolve(directory, name), { recursive: true });
  for (const name of [".github", "docs", "plugins/sample-notes/skills/sample-notes", "fixture", "evals/support", "evals/graders"]) {
    await mkdir(resolve(directory, name), { recursive: true });
  }
  for (const name of ["support/canvas-host.mjs", "support/canvas-loader.mjs", "support/canvas-sdk.mjs", "graders/common.mjs"]) {
    await cp(resolve(source, "evals", name), resolve(directory, "evals", name));
  }
  const policyFiles = ["AGENTS.md", "CONTRIBUTING.md", "docs/customization-types.md", "docs/security.md",
    "docs/local-development.md", "docs/remote-plugins.md", "docs/eval-authoring.md"];
  for (const name of policyFiles) {
    const text = await readFile(resolve(source, name), "utf8");
    await writeFile(resolve(directory, name), text.replace(/\[([^\]]+)\]\((?!https?:|#)[^)]+\)/g, "$1"));
  }
  await cp(resolve(source, ".github/PULL_REQUEST_TEMPLATE.md"), resolve(directory, ".github/PULL_REQUEST_TEMPLATE.md"));
  await cp(resolve(source, "LICENSE"), resolve(directory, "LICENSE"));
  await cp(resolve(source, "tsconfig.json"), resolve(directory, "tsconfig.json"));
  await symlink(resolve(source, "node_modules"), resolve(directory, "node_modules"), "junction");
  const pkg = JSON.parse(await readFile(resolve(source, "package.json"), "utf8"));
  await json(resolve(directory, "package.json"), {
    ...pkg, name: "fixture-plugins",
    scripts: {
      ...pkg.scripts,
      // Exercise real structure/build checks, not subject-visible eval answer keys.
      verify: "node scripts/typecheck.mjs && node scripts/validate.mjs && node scripts/build.mjs --check",
      "check-remotes": "node fixture/check-remotes.mjs",
    },
  });
  await writeFile(resolve(directory, "README.md"), "# Fixture marketplace\n\n<!-- plugin-table -->\n| Plugin | Try it | Helps with |\n|---|---|---|\n| [sample-notes](plugins/sample-notes/) | Summarize notes | Notes |\n\n```sh\ncopilot plugin marketplace browse fixture-plugins\ncopilot plugin install sample-notes@fixture-plugins\n```\n");
  await json(resolve(directory, "plugins/sample-notes/plugin.json"), manifest);
  await writeFile(resolve(directory, "plugins/sample-notes/README.md"), "# Sample notes\n\n## Host checks\n\nTry a synthetic note.\n");
  const changed = scenario === "release";
  await writeFile(resolve(directory, "plugins/sample-notes/CHANGELOG.md"),
    `# Changelog\n\n${changed ? "## 1.0.1\n\n- Clarify empty-input wording.\n\n" : ""}## 1.0.0\n\n- Initial release.\n`);
  await writeFile(resolve(directory, "plugins/sample-notes/skills/sample-notes/SKILL.md"),
    '---\nname: sample-notes\ndescription: Summarize synthetic release notes when asked for a summary.\n---\n\nSummarize only the supplied notes. Ask for notes if the input is empty.\n');
  const candidate = { ...manifest, version: changed ? "1.0.1" : "1.0.0" };
  await json(resolve(directory, "plugins/sample-notes/plugin.json"), candidate);
  const remote = {
    name: "outside-notes",
    source: { source: "github", repo: "fixture-org/outside-notes", ref: "v1.0.0", sha: "a".repeat(40) },
    version: "1.0.0", description: "Read synthetic outside notes.",
  };
  await json(resolve(directory, "marketplace.json"), {
    name: "fixture-plugins", owner: { name: "Fixture" },
    plugins: [{ name: candidate.name, source: "./plugins/sample-notes", version: candidate.version, description: candidate.description },
      ...(scenario === "remote" ? [remote] : [])],
  });
  await mkdir(resolve(directory, ".github/copilot"), { recursive: true });
  await json(resolve(directory, ".github/copilot/settings.json"), {
    extraKnownMarketplaces: { "fixture-plugins": { source: { source: "directory", path: "." } } },
    enabledPlugins: { "sample-notes@fixture-plugins": true },
  });
  await writeFile(resolve(directory, ".vally.yaml"),
    "paths:\n  skills:\n    - plugins/sample-notes/skills\n  evals: [evals]\n  evalFilenames: [eval.yaml]\n  results: vally-results\nparams:\n  CANVAS_HOST: evals/support/canvas-host.mjs\nsuites:\n  smoke:\n    filter:\n      suite: smoke\n  full:\n    evals: [evals/**/eval.yaml]\n");
  await json(resolve(directory, "released.json"), { plugins: [manifest] });
  await json(resolve(directory, "upstream-snapshot.json"), {
    repo: remote.source.repo, path: "", old: { sha: "a".repeat(40), ref: "v1.0.0", version: "1.0.0" },
    latest: { sha: "b".repeat(40), ref: "v1.1.0", version: "1.1.0" },
    manifest: { ...manifest, name: remote.name, version: "1.1.0", description: remote.description },
    changes: ["Add support for empty note lists. No new hooks, network destinations, credentials, or dependencies."],
    access: "Synthetic public upstream; recorded responses only.",
  });
  await writeFile(resolve(directory, "fixture/check-remotes.mjs"), `import { readFile } from "node:fs/promises";
import { checkRemote } from "../scripts/check-remotes.mjs";
const catalog = JSON.parse(await readFile("marketplace.json", "utf8"));
const snapshot = JSON.parse(await readFile("upstream-snapshot.json", "utf8"));
const api = async (path) => {
  const prefix = "/repos/" + snapshot.repo;
  if (path === prefix) return { status: 200, body: {} };
  if (path === prefix + "/releases/latest") return { status: 200, body: { tag_name: snapshot.latest.ref } };
  for (const version of [snapshot.old, snapshot.latest]) {
    if (path === prefix + "/commits/" + version.sha || path === prefix + "/commits/" + version.ref)
      return { status: 200, body: { sha: version.sha } };
    if (path === prefix + "/contents/plugin.json?ref=" + version.sha)
      return { status: 200, body: { content: Buffer.from(JSON.stringify({ ...snapshot.manifest, version: version.version })).toString("base64") } };
  }
  throw new Error("Unrecorded fixture request: " + path);
};
for (const entry of catalog.plugins.filter(entry => typeof entry.source !== "string")) {
  const result = await checkRemote(entry, api);
  if (result.errors.length) throw new Error(result.errors.join("; "));
}
console.log("Recorded upstream checks passed (offline, not live GitHub verification).");
`);
  return directory;
}

if (isEntrypoint(import.meta.url)) {
  await createWorkspace(process.cwd(), process.argv[2]);
}
