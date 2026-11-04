import { check, isMain, json, runGrade } from "./common.mjs";

export function evaluate(trajectory, workspace) {
  const catalog = json(workspace, "marketplace.json");
  if (!Array.isArray(catalog?.plugins)) return [check("Preserved a valid catalog", false)];
  const entry = catalog.plugins.find((item) => item.name === "outside-notes");
  return [
    check("Updated the exact reviewed SHA, ref and version", entry?.source?.sha === "b".repeat(40)
      && entry?.source?.ref === "v1.1.0" && entry?.version === "1.1.0"
      && entry?.source?.repo === "fixture-org/outside-notes"),
    check("Preserved the unrelated local entry", catalog.plugins.some((item) => item.name === "sample-notes" && item.version === "1.0.0")),
    check("Reported the upstream change and offline limit", /empty note lists/i.test(trajectory.output)
      && /offline|recorded/i.test(trajectory.output)),
  ];
}

if (isMain(import.meta.url)) {
  await runGrade("marketplace-maintainer-remote", evaluate, "update-remote-pins");
}
