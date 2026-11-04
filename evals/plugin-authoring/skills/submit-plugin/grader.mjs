import { calls, check, isMain, json, runGrade, text } from "./common.mjs";

export function evaluate(trajectory, workspace) {
  const catalog = json(workspace, "marketplace.json");
  if (!Array.isArray(catalog?.plugins)) return [check("Preserved a valid catalog", false)];
  const plugin = json(workspace, "plugins/sample-notes/plugin.json");
  const entry = catalog.plugins.find((item) => item.name === "sample-notes");
  const headings = ["## What changed", "## Version and changelog", "## Checks", "## Risk"];
  const output = trajectory.output;
  const section = (heading) => {
    const start = output.indexOf(heading);
    if (start === -1) return "";
    const next = output.indexOf("\n## ", start + heading.length);
    return output.slice(start, next === -1 ? undefined : next);
  };
  return [
    check("Applied the requested patch version consistently", plugin?.version === "1.0.1" && entry?.version === "1.0.1"),
    check("Added the matching changelog heading", /^## 1\.0\.1\s*$/m.test(text(workspace, "plugins/sample-notes/CHANGELOG.md"))),
    check("Wrote the PR body's sections in order", headings.every((heading, i) => output.includes(heading)
      && (i === 0 || output.indexOf(heading) > output.indexOf(headings[i - 1])))),
    check("Described the wording change", /empty/i.test(section("## What changed"))),
    check("Stated the new version", /1\.0\.1/.test(section("## Version and changelog"))),
    check("Said honestly that it runs no code", /no code|runs nothing|doesn't run|does not run|none/i.test(section("## Risk"))),
    check("Did not create a PR or push", !calls(trajectory).some((call) => /(?:gh\s+pr\s+create|git\s+push)/.test(JSON.stringify(call.args)))),
  ];
}

if (isMain(import.meta.url)) {
  await runGrade("plugin-authoring-submit", evaluate, "submit-plugin");
}
