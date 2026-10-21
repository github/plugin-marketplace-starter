# Maintaining this marketplace

Follow [README.md](README.md) for team setup, package layout, installation,
versioning, validation, evals, CI, and host checks. Update those instructions in
place; don't duplicate them here.

## Agent-specific rules

- Group plugins by workflow, not by asset type. Keep every in-repo example
  self-contained and independently installable, without external services.
  Remote catalog references are separate from the local examples.
- Use the Agent Plugins 1.0 layout: root `plugin.json`, `skills/`, and `mcp.json`.
  Copilot agents, hooks, and SDK extensions live under `com.github.copilot/`.
  Don't adopt legacy `.plugin/` or `.claude-plugin/` layouts from documentation.
- Don't add a UI framework or database. Never vendor the runtime SDK. The only
  build step regenerates committed artifacts (the MCP server bundle, the
  authoring grader, and their notices). Run `npm run build` after changing their
  sources and commit the generated files with the change. Never make an
  installed plugin depend on this checkout's `node_modules`.
- Skill and agent descriptions explain when to invoke them. Put detailed
  instructions in the body, and don't duplicate a skill as a command.
- Formatter hooks must not return permission decisions. Return `{}` for no-ops,
  and never describe the hook as a security boundary or replacement for CI.
- Preserve coverage when replacing an example; don't delete tests just to
  make validation pass.
- Keep evals outside plugins, grouped by workflow under `evals/`. Update the
  corresponding evals whenever adding or changing an in-repo skill, agent, hook,
  extension, or MCP tool. Don't replace real skill, tool, or agent invocation
  assertions with output keywords. Keep eval-only transports and development
  dependencies outside `plugins/`. Headless contract results aren't proof of
  native canvas rendering.
- Never stage answer keys or eval specifications into the agent's workspace. Use
  only synthetic fixtures and disposable directories, not git worktrees.
- Inspect failed trajectories before changing assertions. Don't loosen a check
  just to get green results, and don't accept the default agent's answer when a
  custom agent failed to launch. A grader infrastructure exception must report
  `status: error`, not a failed behavioral verdict.
- Valid behavioral failures may be report-only locally; tooling, configuration,
  and grader errors must fail. Never hide failures with blanket catches or
  `continue-on-error`.
- `npm run eval:smoke`, `npm run eval`, and the evals workflow spend inference
  credits. Don't run them unless the user asks. Static checks don't establish
  behavioral quality.
- When upgrading Vally or Copilot, update the pins, the lockfile, and the
  workflow's `vally-version` together, and verify real custom-agent delegation
  and MCP behavior, not only schema validity.
- Keep remote plugins opt-in. Validate their catalog metadata without fetching
  or executing upstream code in checks, and document private-repository access.
  Don't claim the local evals cover remote assets.
- Keep secrets and token-bearing URLs out of files. Use host authentication
  for private repositories, not embedded credentials. Never copy private
  organizational code into the examples.
- Do not commit, push, publish, change visibility, or modify GitHub permissions
  unless the user requests it.

## Authoring references

Consult the relevant contract before changing package or catalog fields:

- [Agent Plugins 1.0 specification](https://agent-plugins.org/specification).
- [Canonical manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
  and [MCP configuration schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json),
  vendored in [schemas/](schemas/NOTICE).
- [Creating Copilot plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating).
- [Creating a team marketplace](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace).
- [CLI plugin and catalog reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference).
- [Vally eval schema](https://microsoft.github.io/vally/reference/eval-spec/) and
  [Evals Action](https://github.com/github/evals-action).

The README's [references](README.md#references) cover skills, hooks, and VS Code.