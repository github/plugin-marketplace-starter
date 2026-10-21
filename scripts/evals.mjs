import { spawn } from "node:child_process";
import { readFile, readdir, writeFile, access } from "node:fs/promises";
import { resolve, delimiter } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stringify } from "yaml";

export const root = fileURLToPath(new URL("../", import.meta.url));
const cliDirectory = resolve(root, "node_modules/@microsoft/vally-cli");
const manifest = JSON.parse(await readFile(resolve(cliDirectory, "package.json"), "utf8"));
export const vallyCliPath = resolve(cliDirectory, typeof manifest.bin === "string" ? manifest.bin : manifest.bin.vally);
export const runtimeBridge = resolve(root, "scripts/eval-runtime.js");
export const brainstormHost = resolve(root, "evals/support/brainstorm-host.mjs");
export const jsonMcpServerPath = resolve(root, "plugins/json-configuration/dist/server.mjs");

// Absolute values for the relative defaults in .vally.yaml. MCP processes don't
// necessarily start in this checkout, so evals always receive absolute paths.
export const evalParams = Object.freeze({ BRAINSTORM_HOST: brainstormHost, JSON_MCP_SERVER: jsonMcpServerPath });

export function runtimeEnvironment(base = process.env) {
  const env = { ...base };
  const key = Object.keys(base).find((name) => name.toLowerCase() === "path");
  for (const name of Object.keys(env)) if (name.toLowerCase() === "path") delete env[name];
  return {
    ...env,
    PATH: [resolve(root, "node_modules/.bin"), key ? base[key] : ""].filter(Boolean).join(delimiter),
    COPILOT_CLI_PATH: runtimeBridge,
    MARKETPLACE_VALLY_CLI: vallyCliPath,
    VALLY_TELEMETRY_OPTOUT: "1",
  };
}

export function vallyArguments(command, args = []) {
  if (!["eval", "lint", "grade"].includes(command)) throw new Error("Use eval, lint, grade, or action-params.");
  const defaults = command === "eval"
    ? ["--workers", "1", "--max-retries", "1", "--junit", "--output-dir", "vally-results"]
    : command === "lint" ? ["plugins", "--eval-spec", "evals", "--strict"] : [];
  const params = Object.entries(evalParams).flatMap(([name, value]) => ["--param", `${name}=${value}`]);
  return [vallyCliPath, command, ...defaults, ...params, ...args];
}

// The Evals Action runs Vally directly and can't pass --param, so CI writes
// eval-level params files (gitignored) holding this runner's absolute paths.
export async function writeActionParams(directory = resolve(root, "evals")) {
  const written = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name !== "eval.yaml") continue;
    const spec = resolve(entry.parentPath, entry.name);
    const text = await readFile(spec, "utf8");
    const params = Object.fromEntries(Object.entries(evalParams).filter(([name]) => text.includes(`\${${name}}`)));
    if (!Object.keys(params).length) continue;
    const target = resolve(entry.parentPath, "eval.params.yaml");
    await writeFile(target, stringify({ params }));
    written.push(target);
  }
  return written;
}

async function main() {
  const [command = "eval", ...args] = process.argv.slice(2);
  if (command === "action-params") {
    for (const file of await writeActionParams()) console.log(`Wrote ${file}`);
    return;
  }
  await access(resolve(root, "node_modules/@github/copilot/npm-loader.js"));
  for (const path of Object.values(evalParams)) await access(path);
  const child = spawn(process.execPath, vallyArguments(command, args), { cwd: root, stdio: "inherit", env: runtimeEnvironment() });
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    if (signal) console.error(`Vally terminated by ${signal}.`);
    process.exitCode = code ?? 1;
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
