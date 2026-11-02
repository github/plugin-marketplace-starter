---
name: add-plugin
description: "Scaffold a new plugin in this marketplace. Use when adding a plugin to a marketplace checkout or turning a workflow into a new plugin there. Don't use for writing a plugin's skills or agents, editing an existing plugin, or Copilot pricing questions."
---

# Add a marketplace plugin

Work in the user's marketplace checkout, not this installed plugin's directory.
Find the workspace root and confirm it has `scripts/new-plugin.mjs` and
`marketplace.json`. If not, explain that this skill needs a checkout of the
marketplace starter and stop without creating files.

1. Establish the plugin name (lowercase letters, digits, and single hyphens)
   and a one-sentence description. Check `marketplace.json` for a name
   collision. The names `graders` and `support` are reserved. If the
   contribution guide asks for a New plugin issue first, draft it rather than
   filing it, and don't invent an issue number.
2. From the checkout root, run
   `npm run new-plugin -- <name> --description "<what it does>"`.
   Use this command, not manual catalog or overlay edits. Report a command
   failure and fix its cause before continuing.
3. Run `npm run verify` and report the exact command and its result. Don't run
   paid evals.
4. Tell the user what was created: `plugins/<name>/` with `plugin.json`,
   `README.md`, and `CHANGELOG.md`, plus its catalog entry, its overlay entry,
   and its row in the README. The plugin has no skills, agents, or other parts
   yet. For what can go in it, point to the
   [Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference).

Return the created paths and the validation result. Don't add a plugin's
skills, agents, or other parts unless separately asked, and don't commit,
push, or open a pull request unless requested.
