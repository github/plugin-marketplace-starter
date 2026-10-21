import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

// TypeScript sources that tsconfig.json includes (plugins/**/*.ts).
export async function typeScriptSources(directory = root) {
  try {
    return (await readdir(resolve(directory, "plugins"), { recursive: true }))
      .filter((path) => path.endsWith(".ts") && !path.split(/[\\/]/).includes("node_modules"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// Type-checks plugin TypeScript. tsc fails when there are no inputs, which
// happens once you remove the only MCP server example, so skip it then.
async function main() {
  if (!(await typeScriptSources()).length) {
    console.log("No plugin TypeScript sources to type-check.");
    return;
  }
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("typescript/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.tsc;
  const result = spawnSync(process.execPath, [resolve(dirname(manifestPath), bin), "--noEmit"], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
