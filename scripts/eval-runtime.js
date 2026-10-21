import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The SDK launches .js entry points with Node; this forwards to the pinned full Copilot runtime.
// Defaults resolve from this checkout so hosted runners only need COPILOT_CLI_PATH pointing here.
const root = fileURLToPath(new URL("../", import.meta.url));
export const defaultRuntime = resolve(root, "node_modules/@github/copilot/npm-loader.js");

function absolute(value, fallback, name) {
  const path = value ?? fallback;
  if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path.`);
  return path;
}

// STARTER_PLUGIN_DIRS is a comma-separated list of plugin directories to mount
// with --plugin-dir, relative to the repository root or absolute. Evals set it in
// agent_environment.env so hook plugins load without a global installation.
// Commas, not the OS path delimiter, keep one eval file valid on every platform.
export function pluginDirectories(env = process.env) {
  return (env.STARTER_PLUGIN_DIRS ?? "").split(",").map((value) => value.trim()).filter(Boolean)
    .map((value) => isAbsolute(value) ? value : resolve(root, value));
}

export function runtimeArguments(args, env = process.env) {
  const flags = ["--disable-builtin-mcps", "--no-ask-user"];
  for (const directory of pluginDirectories(env)) flags.push("--plugin-dir", directory);
  return [...flags, ...args];
}

export function runtimeEntry(env = process.env) {
  return absolute(env.STARTER_COPILOT_CLI, defaultRuntime, "STARTER_COPILOT_CLI");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const child = spawn(process.execPath, [runtimeEntry(), ...runtimeArguments(process.argv.slice(2))], {
    stdio: "inherit", windowsHide: true,
  });
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    if (signal) console.error(`Copilot runtime terminated by ${signal}.`);
    process.exitCode = code ?? 1;
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}
