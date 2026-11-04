import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { check, isMain, json, runGrade, text } from "./common.mjs";

export function evaluate(trajectory, workspace) {
  const catalog = json(workspace, "marketplace.json");
  if (!Array.isArray(catalog?.plugins)) return [check("Preserved a valid catalog", false)];
  const folder = resolve(workspace, "plugins/yaml-after-edit");
  const plugin = json(workspace, "plugins/yaml-after-edit/plugin.json");
  const entry = catalog.plugins.find((item) => item.name === "yaml-after-edit");
  const contents = existsSync(folder) ? readdirSync(folder).sort().join(",") : "";
  return [
    check("Created only the plugin shell", plugin?.name === "yaml-after-edit" && contents === "CHANGELOG.md,README.md,plugin.json"),
    check("Gave the manifest a version, description, and matching changelog heading", /^\d+\.\d+\.\d+$/.test(plugin?.version ?? "")
      && typeof plugin?.description === "string" && plugin.description.trim()
      && text(workspace, "plugins/yaml-after-edit/CHANGELOG.md").replaceAll("\r\n", "\n").includes(`## ${plugin.version}\n`)),
    check("Catalog and manifest agree", entry?.source === "./plugins/yaml-after-edit" && entry?.version === plugin?.version
      && entry?.description === plugin?.description),
    check("Listed it in the marketplace README", text(workspace, "README.md").includes("plugins/yaml-after-edit/")),
    check("Kept the existing plugin", catalog.plugins.some((item) => item.name === "sample-notes")),
  ];
}

if (isMain(import.meta.url)) {
  await runGrade("plugin-authoring-add", evaluate, "add-plugin");
}
