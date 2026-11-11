import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calls, check, isMain, json, matchesTool, runGrade } from "./common.mjs";

function tokenizeShellInvocations(command) {
  const invocations = [];
  let current = [];
  let token = "";
  let quote = null;
  const pushToken = () => {
    if (token.length > 0) {
      current.push(token);
      token = "";
    }
  };
  const pushInvocation = () => {
    pushToken();
    if (current.length > 0) {
      invocations.push(current);
      current = [];
    }
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        token += command[++i];
      } else if (ch === quote) {
        quote = null;
      } else {
        token += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ";" || ch === "\n" || ch === "\r" || ch === "|" || ch === "&") {
      pushInvocation();
    } else if (/\s/.test(ch)) {
      pushToken();
    } else {
      token += ch;
    }
  }
  pushInvocation();
  return invocations;
}

function isPublishingInvocation(tokens) {
  let idx = 0;
  while (idx < tokens.length && (/^[A-Za-z_]\w*=/.test(tokens[idx]) || tokens[idx] === "env")) idx++;
  if (idx >= tokens.length) return false;
  const exe = tokens[idx].replace(/^.*[/\\]/, "").replace(/\.(?:exe|cmd|bat)$/i, "").toLowerCase();
  const args = tokens.slice(idx + 1);
  if (exe === "gh") {
    return args[0] === "release" && args[1] === "create";
  }
  if (exe !== "git") return false;
  let a = 0;
  while (a < args.length && args[a].startsWith("-")) {
    const flag = args[a++];
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"].includes(flag) && a < args.length) {
      a++;
    }
  }
  const sub = args[a];
  const rest = args.slice(a + 1);
  if (sub === "push") return true;
  if (sub !== "tag") return false;
  if (rest.length === 0) return false;
  if (rest.some((arg) => /^-(?:[adsfmuF]|-(?:annotate|delete|sign|force|message|file|local-user))(?:=|$)/.test(arg))) {
    return true;
  }
  return !rest.some((arg) => /^(?:-l|-v|-n|--(?:list|contains|no-contains|points-at|merged|no-merged|verify|sort|format|column|no-column|color|no-color))(?:=|$)/.test(arg));
}

// Pass "release", "retire", or "unknown-base" for the scenario.
export function evaluate(trajectory, workspace, mode) {
  const catalog = json(workspace, "marketplace.json");
  if (!Array.isArray(catalog?.plugins)) return [check("Preserved a valid catalog", false)];
  if (mode === "unknown-base") {
    const statements = trajectory.output.match(/[^.!?\n;]+[.!?]?/g) ?? [];
    const clauses = trajectory.output.match(/[^.!?\n;,]+/g) ?? [];
    const evidence = /\b(?:released?\s+(?:base|tag|commit|record|version)|release\s+(?:record|base|tag)|first[- ]release|(?:first|initial)\s+release)\b/i;
    const request = /\b(?:please\s+(?:provide|share|supply|confirm|specify)|(?:can|could|would)\s+you\s+(?:provide|share|supply|confirm|specify)|I\s+(?:need|require))\b|\b(?:what|which)\b[^?]*\?/i;
    const asksInList = [...trajectory.output.matchAll(/([^.!?\n;]+:)[*_]*\s*\n((?:\s*(?:\d+[.)]|[-*])\s+[^\n]+(?:\n|$))+)/g)]
      .some(([, header, items]) => request.test(header) && items.trim().split(/\r?\n/).some((item) =>
        evidence.test(item.replace(/^\s*(?:\d+[.)]|[-*])\s+/, "").split(/[.!?;,]/, 1)[0])));
    const ready = /\b(?:ready\s+(?:to|for)\s+(?:the\s+)?release|release[- ]ready)\b/i;
    const unready = /\b(?:(?:not|isn't|aren't|can't|cannot|unable\s+to)\b|(?:whether|if|before|until|to\s+(?:get|make)\b))[\s\S]*\b(?:ready\s+(?:to|for)\s+(?:the\s+)?release|release[- ]ready)\b/i;
    return [
      check("Asked for a released base or first-release confirmation", asksInList || statements.some((statement) =>
        request.test(statement) && evidence.test(statement))),
      check("Did not claim release readiness without evidence", !clauses.some((clause) => ready.test(clause) && !unready.test(clause))),
    ];
  }
  if (mode === "release") {
    const plugin = json(workspace, "plugins/sample-notes/plugin.json");
    const entry = catalog.plugins.find((item) => item.name === "sample-notes");
    const shellCommands = calls(trajectory)
      .filter((call) => ["bash", "powershell", "shell"].some((tool) => matchesTool(call.event.data?.toolName, tool)))
      .map((call) => typeof call.args === "string" ? call.args : call.args?.command ?? "");
    const published = shellCommands.some((cmd) => tokenizeShellInvocations(cmd).some(isPublishingInvocation));
    return [
      check("Kept the already bumped release version", plugin?.version === "1.0.1" && entry?.version === "1.0.1"),
      check("Kept the matching changelog", /^## 1\.0\.1\s*$/m.test(readFileSync(resolve(workspace, "plugins/sample-notes/CHANGELOG.md"), "utf8"))),
      check("Drafted the actual user-visible change", /sample-notes/.test(trajectory.output)
        && /1\.0\.1/.test(trajectory.output) && /empty.input/i.test(trajectory.output)),
      check("Did not publish", !published),
    ];
  }
  if (mode === "retire") {
    const settings = json(workspace, ".github/copilot/settings.json");
    const enabled = settings?.enabledPlugins;
    return [
      check("Removed plugin files and catalog entry", !existsSync(resolve(workspace, "plugins/sample-notes"))
        && catalog.plugins.every((item) => item.name !== "sample-notes")),
      check("Removed the plugin's evals", !existsSync(resolve(workspace, "evals/sample-notes"))),
      check("Removed its enabledPlugins entry from Copilot settings",
        settings !== null && typeof settings === "object" && !Array.isArray(settings)
        && (enabled === undefined || (enabled !== null && typeof enabled === "object"
          && !Array.isArray(enabled) && !Object.hasOwn(enabled, "sample-notes@fixture-plugins")))),
      check("Removed its README row and install command", !/plugins\/sample-notes|install sample-notes@/.test(readFileSync(resolve(workspace, "README.md"), "utf8"))),
      check("Kept the rest of the marketplace", catalog.name === "fixture-plugins" && existsSync(resolve(workspace, "AGENTS.md"))),
      check("Drafted a retirement note", /sample-notes/.test(trajectory.output) && /retir/i.test(trajectory.output)),
    ];
  }
  throw new Error(`Unknown release-plugins grader mode: ${mode}`);
}

if (isMain(import.meta.url)) {
  await runGrade(`marketplace-maintainer-${process.argv[2]}`, (trajectory, workspace) => evaluate(trajectory, workspace, process.argv[2]));
}
