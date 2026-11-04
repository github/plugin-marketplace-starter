import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { calls, check, isMain, json, runGrade } from "./common.mjs";

const ran = (trajectory, pattern) => calls(trajectory).some((call) =>
  call.success && pattern.test(JSON.stringify(call.args))
  && !/exit(?:ed)? (?:with )?code[: ]+[1-9]/i.test(JSON.stringify(call.result)));

export function evaluate(trajectory, workspace) {
  const catalog = json(workspace, "marketplace.json");
  if (!Array.isArray(catalog?.plugins)) return [check("Preserved a valid catalog", false)];
  return [
    check("Used isolated CLI installation", ran(trajectory, /COPILOT_HOME[\s\S]*fixture-copilot-home|fixture-copilot-home[\s\S]*COPILOT_HOME/)),
    check("Installed the selected local copy", ran(trajectory, /plugin\s+install\s+sample-notes@fixture-plugins/)),
    check("Listed the installed plugins", ran(trajectory, /plugin\s+list[\s\S]*--json/)),
    check("Uninstalled the test copy", ran(trajectory, /plugin\s+uninstall\s+sample-notes@fixture-plugins/)),
    check("Removed only the disposable test home", !existsSync(resolve(workspace, ".fixture-copilot-home"))
      && existsSync(resolve(workspace, "plugins/sample-notes/plugin.json"))),
  ];
}

if (isMain(import.meta.url)) {
  await runGrade("plugin-authoring-try", evaluate, "try-plugin-locally");
}
