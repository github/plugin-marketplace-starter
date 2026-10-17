import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { resolve, delimiter } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
const cliDirectory = resolve(root, "node_modules/@microsoft/vally-cli");
const manifest = JSON.parse(await readFile(resolve(cliDirectory, "package.json"), "utf8"));
const cli = resolve(cliDirectory, typeof manifest.bin === "string" ? manifest.bin : manifest.bin.vally);
const runtime = resolve(root, "node_modules/@github/copilot/npm-loader.js");

export function runtimeEnvironment(base = process.env) {
  const env = { ...base };
  const key = Object.keys(base).find((name) => name.toLowerCase() === "path");
  for (const name of Object.keys(env)) if (name.toLowerCase() === "path") delete env[name];
  return {
    ...env,
    PATH: [resolve(root, "node_modules/.bin"), key ? base[key] : ""].filter(Boolean).join(delimiter),
    COPILOT_CLI_PATH: resolve(root, "scripts/eval-runtime.js"),
    STARTER_COPILOT_CLI: runtime,
    STARTER_FORMAT_PLUGIN: resolve(root, "plugins/format-json"),
    VALLY_TELEMETRY_OPTOUT: "1",
  };
}

async function main() {
  const [command = "eval", ...args] = process.argv.slice(2);
  if (!["eval", "lint", "grade"].includes(command)) throw new Error("Use eval, lint, or grade.");
  await access(runtime);
  const defaults = command === "eval"
    ? ["--workers", "1", "--max-retries", "1", "--junit", "--output-dir", "vally-results"]
    : command === "lint" ? ["plugins", "--eval-spec", "evals", "--strict"] : [];
  const child = spawn(process.execPath, [
    cli, command, ...defaults, ...args,
  ], { cwd: root, stdio: "inherit", env: runtimeEnvironment() });
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    if (signal) console.error(`Vally terminated by ${signal}.`);
    process.exitCode = code ?? 1;
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
