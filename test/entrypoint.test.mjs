import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

// Node resolves import.meta.url through symlinks but leaves argv unresolved, so a
// naive "am I the entrypoint?" check silently skips main() when a script runs
// from a linked path. macOS temp folders (/var -> /private/var) hit this in CI.
function linkedCopy(t, files) {
  const real = mkdtempSync(join(tmpdir(), "entrypoint-real-"));
  const linked = `${real}-link`;
  for (const [from, to] of files) {
    mkdirSync(join(real, to, ".."), { recursive: true });
    cpSync(join(root, from), join(real, to));
  }
  // A junction needs no elevation on Windows; elsewhere this is a directory symlink.
  symlinkSync(real, linked, "junction");
  t.after(() => {
    rmSync(linked, { recursive: true, force: true });
    rmSync(real, { recursive: true, force: true });
  });
  return linked;
}

test("scripts run main() when started through a linked directory", (t) => {
  const linked = linkedCopy(t, [["scripts/entrypoint.mjs", "scripts/entrypoint.mjs"]]);
  writeFileSync(join(linked, "scripts", "main.mjs"),
    'import { isEntrypoint } from "./entrypoint.mjs";\nif (isEntrypoint(import.meta.url)) console.log("main ran");\n');
  const result = spawnSync(process.execPath, [join(linked, "scripts", "main.mjs")], { cwd: linked, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /main ran/);
});

test("entrypoint checks compare real paths everywhere", () => {
  const sources = ["scripts", "plugins", "evals"].flatMap((directory) => {
    if (!existsSync(join(root, directory))) return [];
    return readdirSync(join(root, directory), { recursive: true })
      .map((path) => `${directory}/${path.split(sep).join("/")}`)
      .filter((path) => /\.(?:mjs|js|ts)$/.test(path) && !path.split("/").some((part) => part === "dist" || part === "node_modules"));
  });
  const fragile = /import\.meta\.url\s*===\s*pathToFileURL\(|resolve\(process\.argv\[1\]\)\s*===\s*fileURLToPath\(/;
  const offenders = sources.filter((path) => fragile.test(readFileSync(join(root, path), "utf8")));
  assert.deepEqual(offenders, [], "Use isEntrypoint() from scripts/entrypoint.mjs, or compare realpathSync() results in self-contained files.");
});
