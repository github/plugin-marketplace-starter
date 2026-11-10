import { calls, check, isMain, runGrade } from "./common.mjs";

export const headings = ["## Summary", "## Changes", "## Verification", "## Risks / Rollback"];

function section(output, heading) {
  const start = output.indexOf(heading);
  if (start === -1) return "";
  const rest = output.slice(start + heading.length);
  const nextMatch = /\r?\n##\s+/.exec(rest);
  return nextMatch ? rest.slice(0, nextMatch.index) : rest;
}

export function evaluate(trajectory) {
  const output = trajectory.output ?? "";
  const inOrder = headings.every((heading, index) => output.includes(heading)
    && (index === 0 || output.indexOf(heading) > output.indexOf(headings[index - 1])));
  const changesSection = section(output, "## Changes");
  const verificationSection = section(output, "## Verification");
  const risksSection = section(output, "## Risks / Rollback");
  const claimsBacklogShipped = /(?:\badded\b|\bimplemented\b|\bshipped\b|\bcompleted\b)[^\n]*(?:retry backoff|#42)/i.test(changesSection)
    || (/(?:retry backoff|#42)/i.test(changesSection) && !/(?:not\b|out of scope|deferred|excluded|open|separate)/i.test(changesSection));

  return [
    check("Wrote ## Summary, ## Changes, ## Verification, and ## Risks / Rollback in order", inOrder),
    check("Described the --timeout validation and test changes in ## Changes", /--timeout/.test(changesSection)
      && /cli\.mjs/.test(changesSection)
      && /cli\.test\.mjs/.test(changesSection)),
    check("Excluded unshipped retry backoff (#42) from shipped ## Changes", !claimsBacklogShipped),
    check("Recorded the supplied npm test verification result", /npm test/i.test(verificationSection) && /pass|14/i.test(verificationSection)),
    check("Included a non-empty ## Risks / Rollback section", risksSection.trim().length > 0),
    check("Did not run shell commands or create a pull request", !calls(trajectory).some((call) =>
      /^(?:bash|powershell|shell|create|edit|apply_patch)$/.test(call.event.data?.toolName ?? "")
      || /(?:gh\s+pr\s+create|git\s+push)/.test(JSON.stringify(call.args)))),
  ];
}

if (isMain(import.meta.url)) {
  await runGrade("pr-description-contract", evaluate);
}
