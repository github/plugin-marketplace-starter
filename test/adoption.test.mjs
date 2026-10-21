import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { parse, stringify } from "yaml";
import { root } from "../scripts/validate-evals.mjs";

const skipped = new Set([".git", "node_modules", "vally-results", ".vally"]);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

function run(directory, ...args) {
  const result = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8", timeout: 120_000, env: { ...process.env, VALLY_TELEMETRY_OPTOUT: "1" } });
  assert.equal(result.status, 0, `${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}${result.error?.message ?? ""}`);
  return result.stdout;
}

// Follows the README's "Make it yours" and "Add a plugin" steps on a copy of
// this repository, then runs the same model-free checks as npm run verify.
test("a team can rename the marketplace, drop examples and the remote entry, and add its own plugin", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "starter-adoption-")));
  try {
    await cp(root, directory, { recursive: true, filter: (source) => !resolve(source).slice(resolve(root).length).split(sep).some((part) => skipped.has(part)) });
    await symlink(resolve(root, "node_modules"), join(directory, "node_modules"), "junction");

    const catalog = await json(join(directory, "marketplace.json"));
    const removed = "json-configuration";
    catalog.name = "acme-ai-customizations";
    catalog.owner = { name: "Acme" };
    catalog.plugins = catalog.plugins.filter((entry) => typeof entry.source === "string" && entry.name !== removed);
    catalog.plugins.push({ name: "release-notes", source: "./plugins/release-notes", version: "1.0.0",
      description: "Draft release notes from a list of merged changes." });
    await writeJson(join(directory, "marketplace.json"), catalog);
    await writeJson(join(directory, ".github/copilot/settings.json"), {
      extraKnownMarketplaces: { [catalog.name]: { source: { source: "directory", path: "." } } },
      enabledPlugins: Object.fromEntries(catalog.plugins.map((entry) => [`${entry.name}@${catalog.name}`, true])),
    });
    await rm(join(directory, "plugins", removed), { recursive: true });
    await rm(join(directory, "evals", removed), { recursive: true });
    for (const file of ["README.md", "AGENTS.md", "CONTRIBUTING.md"]) {
      let text;
      try { text = await readFile(join(directory, file), "utf8"); } catch { continue; }
      await writeFile(join(directory, file), text.replace(new RegExp(`\\[([^\\]]*)\\]\\((?:\\./)?plugins/${removed}[^)]*\\)`, "g"), "$1"));
    }

    const plugin = join(directory, "plugins/release-notes");
    await mkdir(join(plugin, "skills/release-notes"), { recursive: true });
    await writeJson(join(plugin, "plugin.json"), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "release-notes", version: "1.0.0", description: "Draft release notes from a list of merged changes.", license: "MIT",
    });
    await writeFile(join(plugin, "README.md"), "# Release notes\n\nDrafts release notes from merged changes.\n");
    await writeFile(join(plugin, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n\n- Initial skill.\n");
    await writeFile(join(plugin, "skills/release-notes/SKILL.md"), [
      "---", "name: release-notes",
      "description: Draft release notes from a supplied list of merged changes. Use when the user asks for release notes or a changelog entry.",
      "---", "", "# Release notes", "",
      "Read the supplied changes, group them under Added, Changed, and Fixed headings, and write the notes to RELEASE_NOTES.md.",
      "Don't invent changes that weren't supplied.", "",
    ].join("\n"));
    await mkdir(join(directory, "evals/release-notes"), { recursive: true });
    await writeFile(join(directory, "evals/release-notes/release-notes.eval.yaml"), stringify({
      name: "release-notes", description: "Drafts grouped release notes from supplied changes.", type: "capability",
      defaults: { executor: "copilot-sdk", model: "gpt-5.4-mini", timeout: "2m", runs: 1 },
      agent_environment: { skills: ["../../plugins/release-notes/skills/release-notes"] },
      stimuli: [
        { name: "drafts-release-notes", prompt: "Use release-notes for these changes: added export, fixed login timeout.",
          tags: { assets: "skill:release-notes/release-notes", suite: "smoke", control: "positive" },
          graders: [
            { type: "skill-invocation", config: { required: ["release-notes"] } },
            { type: "file-matches", config: { path: "RELEASE_NOTES.md", pattern: "Fixed" } },
          ] },
        { name: "release-notes-ignores-arithmetic", prompt: "What is two plus two? Reply with only the digit.",
          tags: { assets: "skill:release-notes/release-notes", control: "negative" },
          graders: [
            { type: "skill-invocation", config: { disallowed: ["release-notes"] } },
            { type: "output-contains", config: { substring: "4" } },
          ] },
      ],
      scoring: { threshold: 1 },
    }));

    const vally = parse(await readFile(join(directory, ".vally.yaml"), "utf8"));
    vally.paths.skills = vally.paths.skills.filter((path) => !path.includes(`/${removed}/`)).concat("plugins/release-notes/skills");
    vally.params = Object.fromEntries(Object.entries(vally.params).filter(([, value]) => !String(value).includes(`/${removed}/`)));
    await writeFile(join(directory, ".vally.yaml"), stringify(vally));

    assert.match(run(directory, "scripts/validate.mjs"), /0 remote references/);
    // node_modules is linked into the copy, which changes bundle path comments,
    // so rebuild here; the real checkout runs build --check.
    assert.match(run(directory, "scripts/build.mjs"), /Built 2 generated artifacts/);
    const coverage = run(directory, "scripts/validate-evals.mjs");
    assert.match(coverage, /skill:release-notes\/release-notes/);
    assert.doesNotMatch(coverage, new RegExp(removed.replace("-", "\\-") + "/"));
    run(directory, "scripts/evals.mjs", "lint");
    const params = run(directory, "scripts/evals.mjs", "action-params");
    assert.doesNotMatch(params, /json-configuration/);

    // A missing .vally.yaml skill path fails with a message that names the file.
    vally.paths.skills = vally.paths.skills.filter((path) => !path.includes("release-notes"));
    await writeFile(join(directory, ".vally.yaml"), stringify(vally));
    const stale = spawnSync(process.execPath, ["scripts/validate.mjs"], { cwd: directory, encoding: "utf8", timeout: 120_000 });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /\.vally\.yaml paths\.skills must list plugins\/release-notes\/skills/);
  } finally {
    // Remove the link itself first so cleanup can never reach the real node_modules.
    await unlink(join(directory, "node_modules")).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
