import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

// Every repository path that belongs to one included plugin, beyond the generic
// plugins/<name>/ and evals/<name>/ directories. A plugin's evals, graders, and
// fixtures all live under evals/<name>/, so they need no entry here. `npm run
// remove-example` deletes these, and example-only tests skip when the files they
// need are gone. Keep this map in step when you add a test or param for an example.
export const examples = Object.freeze({
  "plugin-authoring": {
    paths: ["test/plugin-authoring-grader.test.mjs"],
    params: [],
  },
  "marketplace-maintainer": {
    paths: ["test/marketplace-maintainer-grader.test.mjs"],
    params: [],
  },
});

// Top-level folders in evals/ that hold files several plugins share. They can't
// be plugin names, since evals/<name>/ belongs to the plugin of that name.
export const reservedNames = Object.freeze(["graders", "support"]);

// Repository tooling that no plugin owns, even when a plugin's name would match
// the naming convention below.
export const protectedPaths = new Set([
  "evals/graders/common.mjs",
  "evals/support/canvas-host.mjs",
  "evals/support/canvas-loader.mjs",
  "evals/support/canvas-sdk.mjs",
  "evals/support/maintenance-workspace.mjs",
  ...["adoption", "canvas-host", "catalog", "eval-setup", "grader-common", "installation", "marketplace",
    "maintenance-workspace", "new-plugin", "remote-plugins", "rename-marketplace", "runtime-environment"].map((name) => `test/${name}.test.mjs`),
]);

// The paths a plugin owns: its directory, its evals directory (which holds its
// evals, graders, and fixtures), support files named after it, and for a shipped
// example, the extra files listed above. Support files outside evals/<name>/
// follow a naming convention, so `npm run remove-plugin` can find them too:
// evals/graders/<name>.mjs, evals/graders/<name>-*.mjs, the bundled grader pair
// evals/graders/src/<name>.mjs and evals/graders/dist/<name>.mjs (or <name>-*.mjs),
// evals/support/<name>-*, evals/fixtures/<name>/, test/<name>.test.mjs, and test/<name>-*.test.mjs. A
// file whose name also fits a longer plugin name in `others`, such as
// test/bug-report.test.mjs for a plugin named bug, belongs to that plugin.
export async function ownedPaths(name, { directory = root, others = [] } = {}) {
  const longer = others.filter((other) => other !== name && other.startsWith(`${name}-`));
  const mine = (base) => (base === name || base.startsWith(`${name}-`))
    && !longer.some((other) => base === other || base.startsWith(`${other}-`));
  const conventional = [];
  for (const [folder, suffix] of [["evals/graders", ".mjs"], ["evals/graders/src", ".mjs"], ["evals/graders/dist", ".mjs"],
    ["evals/support", ""], ["evals/fixtures", ""], ["test", ".test.mjs"]]) {
    let entries = [];
    try { entries = await readdir(resolve(directory, folder), { withFileTypes: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const entry of entries) {
      if (protectedPaths.has(`${folder}/${entry.name}`)) continue;
      if (folder === "evals/fixtures" ? !entry.isDirectory() || entry.name !== name : !entry.name.endsWith(suffix)) continue;
      const base = suffix ? entry.name.slice(0, -suffix.length) : entry.name.replace(/\.[^.]+$/, "");
      if (folder === "evals/fixtures" || mine(base)) conventional.push(`${folder}/${entry.name}`);
    }
  }
  const evals = reservedNames.includes(name) ? [] : [`evals/${name}`];
  return [...new Set([`plugins/${name}`, ...evals, ...(examples[name]?.paths ?? []), ...conventional])];
}

// Shipped examples whose plugin directory is still here.
export function presentExamples(directory = root) {
  return Object.keys(examples).filter((name) => existsSync(resolve(directory, "plugins", name)));
}

// Returns a skip reason when any of the files a test needs is missing, so
// example-only tests skip cleanly after you remove that example.
export function missing(...paths) {
  const gone = paths.filter((path) => !existsSync(resolve(root, path)));
  return gone.length ? `${gone.join(", ")} not found; this example was removed` : false;
}
