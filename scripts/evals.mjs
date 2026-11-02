import { isEntrypoint } from "./entrypoint.mjs";
import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readEvals, readVallyConfig } from "./catalog.mjs";
import { runCli } from "./problems.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const cliDirectory = resolve(root, "node_modules/@microsoft/vally-cli");
const manifest = JSON.parse(await readFile(resolve(cliDirectory, "package.json"), "utf8"));
export const vallyCliPath = resolve(cliDirectory, typeof manifest.bin === "string" ? manifest.bin : manifest.bin.vally);
export const runtimeBridge = resolve(root, "scripts/eval-runtime.js");

// A string param whose value contains a slash is a repository-relative path.
// Other params, such as matrix values, pass through to Vally unchanged.
export const isPathParam = (value) => typeof value === "string" && value.includes("/") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);

// Absolute values for the relative path defaults in .vally.yaml. MCP processes
// don't necessarily start in this checkout, so evals always receive absolute paths.
export async function pathParams(directory = root) {
  const config = await readVallyConfig(directory);
  return Object.freeze(Object.fromEntries(Object.entries(config?.params ?? {})
    .filter(([, value]) => isPathParam(value))
    .map(([name, value]) => [name, resolve(directory, value)])));
}

export const evalParams = await pathParams();

export function runtimeEnvironment(base = process.env) {
  const env = { ...base };
  const key = Object.keys(base).find((name) => name.toLowerCase() === "path");
  for (const name of Object.keys(env)) if (name.toLowerCase() === "path") delete env[name];
  return {
    ...env,
    PATH: [resolve(root, "node_modules/.bin"), key ? base[key] : ""].filter(Boolean).join(delimiter),
    COPILOT_CLI_PATH: runtimeBridge,
    VALLY_TELEMETRY_OPTOUT: "1",
  };
}

export function vallyArguments(command, args = [], params = evalParams) {
  if (!["eval", "lint"].includes(command)) throw new Error("Use eval or lint.");
  const defaults = command === "eval"
    ? ["--workers", "1", "--max-retries", "1", "--junit", "--output-dir", "vally-results"]
    : command === "lint" ? ["plugins", "--eval-spec", "evals", "--strict"] : [];
  const flags = Object.entries(params).flatMap(([name, value]) => ["--param", `${name}=${value}`]);
  return [vallyCliPath, command, ...defaults, ...flags, ...args];
}

export const usage = `Usage: node scripts/evals.mjs <command> [Vally options]

Runs the pinned Vally CLI with this repository's setup: .vally.yaml path params
as absolute paths, and the pinned Copilot runtime, which custom-agent evals need.

Commands:
  eval   Run evals with real Copilot sessions. Costs AI credits. With no
         --suite, --eval-spec, or --tag, it runs the full suite.
  lint   Check skills and eval specs without a model (npm run eval:lint).

Examples:
  npm run eval -- --suite smoke
  npm run eval -- --eval-spec evals/plugin-authoring/skills/add-plugin/eval.yaml
  node scripts/evals.mjs eval --help`;

// Runs the full suite unless the command line already selects something.
export function withDefaultSuite(args) {
  const selects = args.some((arg) => ["--suite", "--eval-spec", "-e", "--tag", "--help", "-h"].some((name) => arg === name || arg.startsWith(`${name}=`)));
  return selects ? args : ["--suite", "full", ...args];
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ["--help", "-h", "help"].includes(command)) {
    console.log(usage);
    if (!command) process.exitCode = 1;
    return;
  }
  if (!["eval", "lint"].includes(command)) throw new Error(`Unknown command ${command}.\n\n${usage}`);
  // A marketplace with no plugins left has nothing to lint.
  if (command === "lint" && !args.length && !existsSync(resolve(root, "plugins")) && !(await readEvals(root)).length) {
    console.log("No plugins or eval specs to lint yet.");
    return;
  }
  await access(resolve(root, "node_modules/@github/copilot/npm-loader.js"));
  for (const [name, path] of Object.entries(evalParams)) {
    try { await access(path); }
    catch { throw new Error(`.vally.yaml param ${name} points to a missing path: ${path}. Update .vally.yaml.`); }
  }
  const vally = vallyArguments(command, command === "eval" ? withDefaultSuite(args) : args);
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, vally, { cwd: root, stdio: "inherit", env: runtimeEnvironment() });
    const forward = (signal) => () => child.kill(signal);
    const onInt = forward("SIGINT");
    const onTerm = forward("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    child.on("error", (error) => { console.error(error); done(1); });
    child.on("exit", (exitCode, signal) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      if (signal) console.error(`Vally terminated by ${signal}.`);
      done(exitCode ?? 1);
    });
  });
  if (code !== 0) process.exitCode = code;
}

if (isEntrypoint(import.meta.url)) await runCli(main);
