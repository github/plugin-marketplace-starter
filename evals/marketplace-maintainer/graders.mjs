import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calls, check, isMain, runGrade } from "./common.mjs";

const json = (workspace, path) => {
  const file = resolve(workspace, path);
  if (!existsSync(file)) return undefined;
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
};
const ran = (trajectory, pattern) => calls(trajectory).some((call) =>
  call.success && pattern.test(JSON.stringify(call.args))
  && !/exit(?:ed)? (?:with )?code[: ]+[1-9]/i.test(JSON.stringify(call.result)));

export function evaluate(trajectory, workspace, mode) {
  const catalog = json(workspace, "marketplace.json");
  const settings = json(workspace, ".github/copilot/settings.json");
  if (!Array.isArray(catalog?.plugins) || !settings?.enabledPlugins) {
    return [check("Preserved a valid catalog and overlay", false)];
  }
  if (mode === "remote") {
    const entry = catalog.plugins.find((item) => item.name === "outside-notes");
    return [
      check("Updated the exact reviewed SHA, ref and version", entry?.source?.sha === "b".repeat(40)
        && entry?.source?.ref === "v1.1.0" && entry?.version === "1.1.0"
        && entry?.source?.repo === "fixture-org/outside-notes"),
      check("Preserved the unrelated local entry", catalog.plugins.some((item) => item.name === "sample-notes" && item.version === "1.0.0")),
      check("Kept the remote opt-in", Object.keys(settings.enabledPlugins).every((key) => !key.startsWith("outside-notes@"))),
      check("Ran remote and static checks", ran(trajectory, /npm(?:\.cmd)?\s+run\s+check-remotes/)
        && ran(trajectory, /npm(?:\.cmd)?\s+run\s+verify/)),
      check("Reported the upstream change and offline limit", /empty note lists/i.test(trajectory.output)
        && /offline|recorded/i.test(trajectory.output)),
    ];
  }
  if (mode === "release") {
    const plugin = json(workspace, "plugins/sample-notes/plugin.json");
    const entry = catalog.plugins.find((item) => item.name === "sample-notes");
    return [
      check("Kept the already bumped release version", plugin?.version === "1.0.1" && entry?.version === "1.0.1"),
      check("Kept the matching changelog", /^## 1\.0\.1\s*$/m.test(readFileSync(resolve(workspace, "plugins/sample-notes/CHANGELOG.md"), "utf8"))),
      check("Ran static verification", ran(trajectory, /npm(?:\.cmd)?\s+run\s+verify/)),
      check("Drafted the actual user-visible change", /sample-notes/.test(trajectory.output)
        && /1\.0\.1/.test(trajectory.output) && /empty.input/i.test(trajectory.output)),
      check("Did not publish", !calls(trajectory).some((call) =>
        /(?:gh\s+release\s+create|git\s+(?:push|tag)\b)/.test(JSON.stringify(call.args)))),
    ];
  }
  if (mode === "retire") {
    const vally = readFileSync(resolve(workspace, ".vally.yaml"), "utf8");
    return [
      check("Used the repository removal command", ran(trajectory, /npm(?:\.cmd)?\s+run\s+remove-plugin[\s\S]*sample-notes/)),
      check("Removed plugin files and catalog entry", !existsSync(resolve(workspace, "plugins/sample-notes"))
        && catalog.plugins.every((item) => item.name !== "sample-notes")),
      check("Removed overlay and skill registration", !Object.keys(settings.enabledPlugins).some((key) => key.startsWith("sample-notes@"))
        && !vally.includes("plugins/sample-notes/skills")),
      check("Kept shared scaffolding", existsSync(resolve(workspace, "scripts/new-plugin.mjs"))),
      check("Ran static verification", ran(trajectory, /npm(?:\.cmd)?\s+run\s+verify/)),
    ];
  }
  throw new Error(`Unknown marketplace-maintainer grader mode: ${mode}`);
}

if (isMain(import.meta.url)) {
  await runGrade(`marketplace-maintainer-${process.argv[2]}`, (trajectory, workspace) => evaluate(trajectory, workspace, process.argv[2]));
}
