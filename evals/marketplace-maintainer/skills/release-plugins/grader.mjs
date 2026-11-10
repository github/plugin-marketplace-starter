import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calls, check, isMain, json, runGrade } from "./common.mjs";

// Pass "release", "retire", or "unknown-base" for the scenario.
export function evaluate(trajectory, workspace, mode) {
  const catalog = json(workspace, "marketplace.json");
  if (!Array.isArray(catalog?.plugins)) return [check("Preserved a valid catalog", false)];
  if (mode === "unknown-base") {
    const statements = trajectory.output.match(/[^.!?\n;]+[.!?]?/g) ?? [];
    const evidence = /\b(?:released?\s+(?:base|tag|commit|record|version)|release\s+(?:record|base|tag)|first[- ]release|(?:first|initial)\s+release)\b/i;
    const request = /\b(?:please\s+(?:provide|share|supply|confirm|specify)|(?:can|could|would)\s+you\s+(?:provide|share|supply|confirm|specify)|I\s+(?:need|require))\b|\b(?:what|which)\b[^?]*\?/i;
    const ready = /\b(?:ready\s+(?:to|for)\s+(?:the\s+)?release|release[- ]ready)\b/i;
    const unready = /\b(?:not|isn't|aren't)\s+(?:(?:yet|currently|fully)\s+)?(?:ready\s+(?:to|for)\s+(?:the\s+)?release|release[- ]ready)\b/gi;
    return [
      check("Asked for a released base or first-release confirmation", statements.some((statement) =>
        request.test(statement) && evidence.test(statement))),
      check("Did not claim release readiness without evidence", !ready.test(trajectory.output.replace(unready, ""))),
    ];
  }
  if (mode === "release") {
    const plugin = json(workspace, "plugins/sample-notes/plugin.json");
    const entry = catalog.plugins.find((item) => item.name === "sample-notes");
    return [
      check("Kept the already bumped release version", plugin?.version === "1.0.1" && entry?.version === "1.0.1"),
      check("Kept the matching changelog", /^## 1\.0\.1\s*$/m.test(readFileSync(resolve(workspace, "plugins/sample-notes/CHANGELOG.md"), "utf8"))),
      check("Drafted the actual user-visible change", /sample-notes/.test(trajectory.output)
        && /1\.0\.1/.test(trajectory.output) && /empty.input/i.test(trajectory.output)),
      check("Did not publish", !calls(trajectory).some((call) =>
        /(?:gh\s+release\s+create|git\s+(?:push|tag)\b)/.test(JSON.stringify(call.args)))),
    ];
  }
  if (mode === "retire") {
    return [
      check("Removed plugin files and catalog entry", !existsSync(resolve(workspace, "plugins/sample-notes"))
        && catalog.plugins.every((item) => item.name !== "sample-notes")),
      check("Removed the plugin's evals", !existsSync(resolve(workspace, "evals/sample-notes"))),
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
