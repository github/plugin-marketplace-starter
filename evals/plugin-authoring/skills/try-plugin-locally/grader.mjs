import { isAbsolute, relative, resolve } from "node:path";
import { calls, check, isMain, json, matchesTool, runGrade } from "./common.mjs";

export function evaluate(trajectory, workspace) {
  const catalog = json(workspace, "marketplace.json");
  const plugin = json(workspace, "plugins/sample-notes/plugin.json");
  const selected = resolve(workspace, "plugins/sample-notes");
  const output = trajectory.output;
  const blocks = [...output.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  const commandLines = blocks.flatMap((block) => block.trim().split(/\r?\n/));
  const localCommands = commandLines.map((line) => /^\s*copilot\s+--plugin-dir\s+(?:"([^"]+)"|'([^']+)'|([^\s"'`]+))\s*$/.exec(line))
    .filter(Boolean);
  const path = localCommands[0]?.slice(1).find((value) => value !== undefined);
  const operands = [...output.matchAll(/--plugin-dir(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s"'`]+))/g)]
    .map((match) => match.slice(1).find((value) => value !== undefined));
  const selectedPath = (value) => typeof value === "string" && isAbsolute(value) && relative(selected, resolve(value)) === "";
  // Grade guidance, not an echoed command or a CLI install as evidence of discovery.
  const attempted = calls(trajectory).filter((call) => ["bash", "powershell", "shell"].some((tool) =>
    matchesTool(call.event.data?.toolName, tool)))
    .map((call) => typeof call.args === "string" ? call.args : call.args?.command)
    .filter((command) => typeof command === "string").join("\n");
  const invokedCopilot = /(?:^|[;&|\r\n])\s*(?:&\s*)?(?:(?:["'](?:[^"'\r\n]*[/\\])?)?copilot(?:\.(?:exe|cmd))?["']?(?=\s|$)|node(?:\.exe)?\s+["']?[^;\r\n]*[/\\]copilot[/\\]npm-loader\.js\b)/i.test(attempted);
  // Keep repeated option forms and quoted/unquoted operands disjoint.
  const mutatedBranch = /(?:^|[;&|\r\n])\s*(?:&\s*)?(?:["'](?:[^"'\r\n]*[/\\])?)?git(?:\.exe)?["']?\s+(?:(?:-c|--git-dir|--work-tree)\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"';|&]+)\s+|--(?!(?:git-dir|work-tree)\s)[\w-]+(?:=[^\s;|&]+)?\s+)*(?:switch|checkout|stash|reset|clean)\b/i.test(attempted);
  return [
    check("Preserved the selected local plugin", Array.isArray(catalog?.plugins) && catalog.plugins.some((entry) =>
      entry?.name === "sample-notes" && ["./plugins/sample-notes", "plugins/sample-notes"].includes(entry.source))
      && plugin?.name === "sample-notes"),
    check("Prepared the selected absolute local session command", localCommands.length === 1 && selectedPath(path)
      && operands.length === 1 && selectedPath(operands[0])),
    check("Explained a fresh session and source trust", /\b(?:fresh|new)\s+(?:Copilot CLI\s+)?session\b/i.test(output)
      && /\b(?:review|inspect)\b[^.\n]*\b(?:source|code|plugin)\b/i.test(output)
      && /\btrust\b/i.test(output) && /\bpermissions?\b/i.test(output)),
    check("Left the session and host checks honestly unverified", /\bSession:\s*not started\b/i.test(output)
      && /\bDiscovery:\s*unverified\b/i.test(output) && /\bBehaviou?r:\s*unverified\b/i.test(output)
      && !/\b(?:Discovery|Behaviou?r):\s*(?:verified|passed|successful)\b/i.test(output)),
    check("Did not launch Copilot or attempt installation or branch mutations",
      !invokedCopilot
      && !mutatedBranch
      && !/\bCOPILOT_(?:CACHE_)?HOME\s*=/i.test(attempted)
      && !/\bcopilot\s+plugin\s+(?:install|uninstall|update|marketplace\s+(?:add|remove))\b/i.test(commandLines.join("\n"))),
  ];
}

if (isMain(import.meta.url)) {
  await runGrade("plugin-authoring-try", evaluate);
}
