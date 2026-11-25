import { check, isMain, json, runGrade } from "./common.mjs";

// The fixture's only upstream change is "Add support for empty note lists"; accept equivalent
// wordings within one affirmative sentence, but not release notes or unrelated mentions of notes or emptiness.
const note = String.raw`\bnotes?`;
const negated = /\b(?:not|never|no\s+longer|cannot|unsupported)\b|n't\b/i;
const emptyNoteLists = [
  String.raw`\bempty\s+${note}\s+lists?\b`,
  String.raw`${note}\s+lists?\s+(?:(?:that|which|can|may|now|are|is|be)\s+){0,3}empty\b`,
  String.raw`\bempty\s+lists?\s+of\s+${note}\b`,
  String.raw`\blists?\s+(?:with|containing)\s+(?:no|zero)\s+${note}\b`,
].map((pattern) => new RegExp(pattern, "i"));

export function reportsUpstreamChange(output) {
  // Drop Markdown emphasis and join compound words so "**empty** note lists" and "empty-note-list" still match;
  // fold "release notes" (even across spaces or a soft wrap) into one word before splitting so it never matches.
  const plain = output.replace(/[*_`]/g, "").replace(/(?<=\w)-(?=\w)/g, " ").replace(/\brelease\s+notes?\b/gi, "releasenotes");
  return plain.split(/(?<=[.!?])\s+|\n+/).some((sentence) => !negated.test(sentence)
    && emptyNoteLists.some((pattern) => pattern.test(sentence)));
}

export function evaluate(trajectory, workspace) {
  const catalog = json(workspace, "marketplace.json");
  if (!Array.isArray(catalog?.plugins)) return [check("Preserved a valid catalog", false)];
  const entry = catalog.plugins.find((item) => item.name === "outside-notes");
  const change = reportsUpstreamChange(trajectory.output);
  const offline = /offline|recorded/i.test(trajectory.output);
  const missing = [!change && "no empty-note-list change", !offline && "no offline limit"].filter(Boolean);
  return [
    check("Updated the exact reviewed SHA, ref and version", entry?.source?.sha === "b".repeat(40)
      && entry?.source?.ref === "v1.1.0" && entry?.version === "1.1.0"
      && entry?.source?.repo === "fixture-org/outside-notes"),
    check("Preserved the unrelated local entry", catalog.plugins.some((item) => item.name === "sample-notes" && item.version === "1.0.0")),
    check("Reported the upstream change and offline limit", change && offline, missing.join(", ")),
  ];
}

if (isMain(import.meta.url)) {
  await runGrade("marketplace-maintainer-remote", evaluate);
}
