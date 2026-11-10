import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calls, check, isMain, json, matchesTool, runGrade } from "./common.mjs";

// Pass "release", "retire", or "unknown-base" for the scenario.
export function evaluate(trajectory, workspace, mode) {
  const catalog = json(workspace, "marketplace.json");
  if (!Array.isArray(catalog?.plugins)) return [check("Preserved a valid catalog", false)];
  if (mode === "unknown-base") {
    const statements = trajectory.output.match(/[^.!?\n;]+[.!?]?/g) ?? [];
    const clauses = trajectory.output.match(/[^.!?\n;,]+/g) ?? [];
    const evidence = /\b(?:released?\s+(?:base|tag|commit|record|version)|release\s+(?:record|base|tag)|first[- ]release|(?:first|initial)\s+release)\b/i;
    const request = /\b(?:please\s+(?:provide|share|supply|confirm|specify)|(?:can|could|would)\s+you\s+(?:provide|share|supply|confirm|specify)|I\s+(?:need|require))\b|\b(?:what|which)\b[^?]*\?/i;
    const ready = /\b(?:ready\s+(?:to|for)\s+(?:the\s+)?release|release[- ]ready)\b/i;
    const unready = /\b(?:(?:not|isn't|aren't|can't|cannot|unable\s+to)\b|(?:whether|if|before|until|to\s+(?:get|make)\b))[\s\S]*\b(?:ready\s+(?:to|for)\s+(?:the\s+)?release|release[- ]ready)\b/i;
    return [
      check("Asked for a released base or first-release confirmation", statements.some((statement) =>
        request.test(statement) && evidence.test(statement))),
      check("Did not claim release readiness without evidence", !clauses.some((clause) => ready.test(clause) && !unready.test(clause))),
    ];
  }
  if (mode === "release") {
    const plugin = json(workspace, "plugins/sample-notes/plugin.json");
    const entry = catalog.plugins.find((item) => item.name === "sample-notes");
    const shellCommands = calls(trajectory)
      .filter((call) => ["bash", "powershell", "shell"].some((tool) => matchesTool(call.event.data?.toolName, tool)))
      .map((call) => typeof call.args === "string" ? call.args : call.args?.command ?? "");
    const published = shellCommands.some((cmd) =>
      /\bgh\s+release\s+create\b/i.test(cmd)
      || /\bgit\s+push\b/i.test(cmd)
      || (/\bgit\s+tag\b/i.test(cmd) && !/^\s*git\s+tag(?:\s+(?:-l\b|--list\b|--contains\b|--points-at\b|--merged\b|--no-merged\b|-v\b|--verify\b)[^\n;|&]*)?\s*$/im.test(cmd)));
    return [
      check("Kept the already bumped release version", plugin?.version === "1.0.1" && entry?.version === "1.0.1"),
      check("Kept the matching changelog", /^## 1\.0\.1\s*$/m.test(readFileSync(resolve(workspace, "plugins/sample-notes/CHANGELOG.md"), "utf8"))),
      check("Drafted the actual user-visible change", /sample-notes/.test(trajectory.output)
        && /1\.0\.1/.test(trajectory.output) && /empty.input/i.test(trajectory.output)),
      check("Did not publish", !published),
    ];
  }
  if (mode === "retire") {
    const settings = json(workspace, ".github/copilot/settings.json");
    const enabled = settings?.enabledPlugins;
    return [
      check("Removed plugin files and catalog entry", !existsSync(resolve(workspace, "plugins/sample-notes"))
        && catalog.plugins.every((item) => item.name !== "sample-notes")),
      check("Removed the plugin's evals", !existsSync(resolve(workspace, "evals/sample-notes"))),
      check("Removed its enabledPlugins entry from Copilot settings",
        settings !== null && typeof settings === "object" && !Array.isArray(settings)
        && (enabled === undefined || (enabled !== null && typeof enabled === "object"
          && !Array.isArray(enabled) && !Object.hasOwn(enabled, "sample-notes@fixture-plugins")))),
      check("Removed its README row and install command", !/plugins\/sample-notes|install sample-notes@/.test(readFileSync(resolve(workspace, "README.md"), "utf8"))),
      check("Kept the rest of the marketplace", catalog.name === "fixture-plugins" && existsSync(resolve(workspace, "AGENTS.md"))),
      check("Drafted a retirement note", /sample-notes/.test(trajectory.output) && /retir/i.test(trajectory.output)),
    ];
  }
  throw new Error(`Unknown release-plugins grader mode: ${mode}`);
}

if (isMain(import.meta.url)) {
  await runGrade(`marketplace-maintainer-${process.argv[2]}`, (trajectory, workspace) => evaluate(trajectory, workspace, process.argv[2]));
}
