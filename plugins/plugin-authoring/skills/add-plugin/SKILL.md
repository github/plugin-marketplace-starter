---
name: add-plugin
description: "Choose a customization type and scaffold a plugin in this marketplace. Use when adding a plugin, turning a workflow into a plugin, or choosing between a skill, agent, MCP server, hook, or canvas. Don't use for generic skill writing, editing an existing plugin, or Copilot pricing questions."
---

# Add a marketplace plugin

Work in the user's marketplace checkout, not this installed plugin's directory.
Find the workspace root and read its `AGENTS.md`, `CONTRIBUTING.md`,
`package.json`, and `docs/customization-types.md`. Confirm it has
`scripts/new-plugin.mjs` and `marketplace.json`; if not, explain that this skill
needs a checkout of the marketplace starter and stop without creating files.

1. Establish the workflow, plugin name, and supported hosts. Use the checkout's
   type table and **Where each type works** matrix, not assumptions about host
   support. Ask only for missing choices that change the implementation.
   - On-demand procedure: the default skill.
   - Specialist with a restricted tool list: `--with agent`.
   - Code-backed tools or external integration: `--with mcp`.
   - Deterministic action after an event, such as formatting YAML after edits:
     `--with hook --no-skill`, unless a separate on-demand procedure is needed.
   - Interactive panel: `--with extension`.
   Combine `--with` flags only when the workflow needs them. Don't scaffold a
   duplicate skill for an agent-only or hook-only workflow.
2. Check the existing catalog for name collisions. The names `graders` and
   `support` are reserved for shared eval files. Follow the contribution
   guide's new-plugin issue process; draft rather than file an issue unless
   requested. Don't invent an issue number.
3. From the checkout root, run
   `npm run new-plugin -- <name> [--with <type>]... [--no-skill] --description "<what it does>"`.
   Use this command, not manual catalog, overlay, or `.vally.yaml` registration.
   Report a command failure and fix its cause before continuing.
4. Explain the generated files and which scaffold text still needs replacing.
   Keep the plugin self-contained in Agent Plugins 1.0 layout. For writing the
   asset itself, link to the public guidance below instead of teaching a
   generic authoring workflow.
5. Explain where the evals went. `evals/` mirrors `plugins/`, and each asset
   gets a placeholder eval at the matching path:
   `evals/<name>/skills/<skill>/eval.yaml`,
   `evals/<name>/agents/<agent>/eval.yaml`, `evals/<name>/hooks/eval.yaml`,
   `evals/<name>/mcp/eval.yaml`, or
   `evals/<name>/extensions/<extension>/eval.yaml`. Put each eval file at the
   narrowest level that uses it: one asset's fixtures or grader in that asset's
   folder, files several of the plugin's evals share in `evals/<name>/`, and
   only files shared across plugins in `evals/graders/` or `evals/support/`.
   The placeholders pass `verify` but only prove the scaffold runs. Point at the
   checkout's `docs/eval-authoring.md` for replacing them; this skill doesn't
   write eval cases.
6. Run `npm run build` if generated sources changed, then `npm run verify`.
   Report the exact commands and their results. A scaffold passing static
   checks isn't evidence that its real workflow works. Don't run paid evals.

Return the chosen type and host limits, created paths, remaining scaffold work,
and validation results. Don't commit, push, publish, or open a pull request
unless separately requested.

## Public authoring guidance

- [Agent Skills specification](https://agentskills.io/specification)
- [Skill creation best practices](https://agentskills.io/skill-creation/best-practices)
- [Copilot custom agents](https://docs.github.com/en/copilot/concepts/customizations/custom-agents)
- [Creating Copilot plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
