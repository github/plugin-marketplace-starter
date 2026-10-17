import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The SDK launches .js entry points with Node; this only forwards to the pinned CLI.
export function runtimeArguments(args, env = process.env) {
  const flags = ["--disable-builtin-mcps", "--no-ask-user"];
  if (env.STARTER_ENABLE_FORMAT_HOOK === "1") {
    if (!env.STARTER_FORMAT_PLUGIN || !isAbsolute(env.STARTER_FORMAT_PLUGIN)) {
      throw new Error("An absolute STARTER_FORMAT_PLUGIN is required for hook evals.");
    }
    flags.push("--plugin-dir", env.STARTER_FORMAT_PLUGIN);
  }
  return [...flags, ...args];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.STARTER_COPILOT_CLI || !isAbsolute(process.env.STARTER_COPILOT_CLI)) {
    throw new Error("The repository eval launcher must provide STARTER_COPILOT_CLI.");
  }
  const child = spawn(process.execPath, [
    process.env.STARTER_COPILOT_CLI, ...runtimeArguments(process.argv.slice(2)),
  ], { stdio: "inherit", windowsHide: true });
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    if (signal) console.error(`Copilot runtime terminated by ${signal}.`);
    process.exitCode = code ?? 1;
  });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}
