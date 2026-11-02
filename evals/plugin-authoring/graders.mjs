import { existsSync, readFileSync, readdirSync } from "node:fs";
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
const text = (workspace, path) => existsSync(resolve(workspace, path)) ? readFileSync(resolve(workspace, path), "utf8") : "";
const ran = (trajectory, pattern) => calls(trajectory).some((call) =>
  call.success && pattern.test(JSON.stringify(call.args))
  && !/exit(?:ed)? (?:with )?code[: ]+[1-9]/i.test(JSON.stringify(call.result)));

export function evaluate(trajectory, workspace, mode) {
  const catalog = json(workspace, "marketplace.json");
  if (!Array.isArray(catalog?.plugins)) return [check("Preserved a valid catalog", false)];
  if (mode === "add") {
    const folder = resolve(workspace, "plugins/yaml-after-edit");
    const plugin = json(workspace, "plugins/yaml-after-edit/plugin.json");
    const entry = catalog.plugins.find((item) => item.name === "yaml-after-edit");
    const settings = json(workspace, ".github/copilot/settings.json");
    const contents = existsSync(folder) ? readdirSync(folder).sort().join(",") : "";
    return [
      check("Used the repository scaffolder", ran(trajectory, /new-plugin[\s\S]*yaml-after-edit/)),
      check("Created only the plugin shell", plugin?.name === "yaml-after-edit" && contents === "CHANGELOG.md,README.md,plugin.json"),
      check("Catalog and manifest agree", entry?.source === "./plugins/yaml-after-edit" && entry?.version === plugin?.version
        && entry?.description === plugin?.description),
      check("Enabled the local plugin", settings?.enabledPlugins?.["yaml-after-edit@fixture-plugins"] === true),
      check("Ran static verification", ran(trajectory, /npm(?:\.cmd)?\s+run\s+verify/)),
    ];
  }
  if (mode === "try") {
    return [
      check("Used isolated CLI installation", ran(trajectory, /COPILOT_HOME[\s\S]*fixture-copilot-home/)),
      check("Installed the selected local copy", ran(trajectory, /plugin\s+install\s+sample-notes@fixture-plugins/)),
      check("Listed the installed plugins", ran(trajectory, /plugin\s+list[\s\S]*--json/)),
      check("Uninstalled the test copy", ran(trajectory, /plugin\s+uninstall\s+sample-notes@fixture-plugins/)),
      check("Removed only the disposable test home", !existsSync(resolve(workspace, ".fixture-copilot-home"))
        && existsSync(resolve(workspace, "plugins/sample-notes/plugin.json"))),
    ];
  }
  if (mode === "submit") {
    const plugin = json(workspace, "plugins/sample-notes/plugin.json");
    const entry = catalog.plugins.find((item) => item.name === "sample-notes");
    const headings = ["## What and why", "## Checklist", "## Risk", "## Paid evals"];
    const riskRows = ["What runs, and when", "Files it reads or writes", "Network destinations",
      "Credentials or tokens", "Data it keeps", "Data it sends to the model",
      "New dependencies", "Remote sources"];
    const output = trajectory.output;
    return [
      check("Applied the requested patch version consistently", plugin?.version === "1.0.1" && entry?.version === "1.0.1"),
      check("Added the matching changelog heading", /^## 1\.0\.1\s*$/m.test(text(workspace, "plugins/sample-notes/CHANGELOG.md"))),
      check("Preserved PR-template heading order", headings.every((heading, i) => output.includes(heading)
        && (i === 0 || output.indexOf(heading) > output.indexOf(headings[i - 1])))),
      check("Filled all template risk questions", riskRows.every((row) =>
        output.split("\n").some((line) => line.includes(row) && /^\|[^|]+\|\s*[^|\s][^|]*\|\s*$/.test(line)))),
      check("Reported paid evals honestly", /(?:None|not run|Not run)/.test(output.slice(output.indexOf("## Paid evals")))),
      check("Ran static verification", ran(trajectory, /npm(?:\.cmd)?\s+run\s+verify/)),
      check("Did not create a PR or push", !calls(trajectory).some((call) => /(?:gh\s+pr\s+create|git\s+push)/.test(JSON.stringify(call.args)))),
    ];
  }
  throw new Error(`Unknown plugin-authoring grader mode: ${mode}`);
}

if (isMain(import.meta.url)) {
  await runGrade(`plugin-authoring-${process.argv[2]}`, (trajectory, workspace) => evaluate(trajectory, workspace, process.argv[2]));
}
