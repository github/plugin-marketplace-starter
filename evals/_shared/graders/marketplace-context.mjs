import { check, isMain, runGrade } from "./common.mjs";

export function evaluate(trajectory, expected) {
  const loaded = trajectory.metadata?.skillsLoaded;
  return [
    check("Context evidence comes from the native Copilot SDK executor", trajectory.metadata?.executor === "copilot-sdk"),
    check("Every marketplace skill was reported loaded by the session",
      expected.length > 0 && Array.isArray(loaded) && expected.every((name) => loaded.includes(name))),
  ];
}

if (isMain(import.meta.url)) {
  await runGrade("marketplace-context", (trajectory) => evaluate(trajectory, process.argv.slice(2)));
}
