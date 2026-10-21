import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

// Every repository path that belongs to one shipped example, beyond the generic
// plugins/<name>/ and evals/<name>/ directories. `npm run remove-example` deletes
// these, and example-only tests skip when the files they need are gone.
// Keep this map in step when you add a test, grader, fixture, or param for an example.
export const examples = Object.freeze({
  "bug-report": {
    paths: ["evals/graders/bug-report.mjs", "test/grader-bug-report.test.mjs"],
    params: [],
  },
  "team-brainstorm": {
    paths: [
      "evals/graders/brainstorm.mjs",
      "evals/support/brainstorm-host.mjs",
      "evals/support/brainstorm-loader.mjs",
      "evals/support/brainstorm-sdk.mjs",
      "test/board.test.mjs",
      "test/board-ui.test.mjs",
      "test/brainstorm-eval-host.test.mjs",
      "test/extension.test.mjs",
      "test/grader-brainstorm.test.mjs",
    ],
    params: ["BRAINSTORM_HOST"],
  },
  "format-json": {
    paths: ["evals/graders/format-json.mjs", "test/hook.test.mjs", "test/grader-format-json.test.mjs"],
    params: [],
  },
  "customization-authoring": {
    paths: ["evals/graders/src/authoring.mjs", "evals/graders/dist/authoring.mjs", "test/authoring-grader.test.mjs"],
    params: ["MARKETPLACE_VALLY_CLI"],
  },
  "code-review": {
    paths: ["evals/fixtures/review"],
    params: [],
  },
  "json-configuration": {
    paths: ["test/json-tools.test.mjs", "test/mcp-protocol.test.mjs"],
    params: ["JSON_MCP_SERVER"],
  },
});

// The paths a plugin owns: its directory, its evals directory, and for a shipped
// example, the extra files listed above.
export function ownedPaths(name) {
  return [`plugins/${name}`, `evals/${name}`, ...(examples[name]?.paths ?? [])];
}

// Returns a skip reason when any of the files a test needs is missing, so
// example-only tests skip cleanly after you remove that example.
export function missing(...paths) {
  const gone = paths.filter((path) => !existsSync(resolve(root, path)));
  return gone.length ? `${gone.join(", ")} not found; this example was removed` : false;
}
