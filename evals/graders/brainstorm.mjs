import { check, isMain, normalize, runGrade } from "./common.mjs";

export function assessFallback(trajectory) {
  const text = normalize(trajectory.output).replaceAll("\u2019", "'");
  const bullets = text.match(/^\s*(?:[-*]|\d+\.)\s+.+$/gm) ?? [];
  const unavailable = /(?:can't|cannot|couldn't)\s+(?:present|open|show|display|render|use|access)\b[^.!?\n]{0,100}\b(?:board|canvas)\b|\b(?:board|canvas)\b[^.!?\n]{0,100}\b(?:unavailable|not available|not supported|not exposed|isn't available|aren't available)\b|(?:don't have|do not have|doesn't expose|does not expose|without|no)\b[^.!?\n]{0,100}\b(?:board|canvas)\b/i.test(text);
  return [
    check("Must explain that the board/canvas is unavailable in this host.", unavailable),
    check("Must continue with two chat ideas.", (bullets.length === 2 || (bullets.length === 3 && bullets.at(-1).includes("?")))
      && text.split(/\s+/).length <= 180),
    check("Must ask one focused follow-up question.", (text.match(/\?/g) ?? []).length === 1),
    check("Must not claim a board was opened or updated.",
      !/\b(?:opened|created|updated)\s+(?:the|a|your)\s+(?:canvas|board)\b/i.test(text)),
  ];
}

if (isMain(import.meta.url)) {
  await runGrade("brainstorm-contract", (trajectory) => {
    if (process.argv[2] === "fallback") return assessFallback(trajectory);
    throw new Error("Use the fallback brainstorm scenario.");
  });
}
