---
name: add-plugin
description: "Add a new plugin to this marketplace. Use when adding a plugin to a marketplace checkout or turning a workflow into a new plugin there. Don't use for writing a plugin's skills or agents, editing an existing plugin, or Copilot pricing questions."
---

# Add a marketplace plugin

Work in the user's marketplace checkout, not this installed plugin's directory.
Confirm the workspace root has `marketplace.json`. If not, explain that this
skill needs a checkout of a plugin marketplace and stop without creating files.

1. Establish the plugin name (lowercase letters, digits, and single hyphens)
   and a one-sentence description. Check `marketplace.json` and `plugins/` for a
   name that's taken. Don't use `graders` or `support`; those folders in
   `evals/` hold shared files.
2. Create `plugins/<name>/` with three files:
   - `plugin.json`:

     ```json
     {
       "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
       "name": "<name>",
       "version": "0.1.0",
       "description": "<description>",
       "license": "MIT"
     }
     ```

   - `README.md`: a title, the description, and an Install section with
     `copilot plugin marketplace add OWNER/REPO` and
     `copilot plugin install <name>@<marketplace>`, where `<marketplace>` is the
     `name` in `marketplace.json`.
   - `CHANGELOG.md`: `# Changelog`, then `## 0.1.0` with `- Initial release.`
3. Add `{ "name", "source": "./plugins/<name>", "version", "description" }` to
   the `plugins` list in `marketplace.json`, after the other local plugins, with
   the same values as `plugin.json`.
4. Add `"<name>@<marketplace>": true` to `enabledPlugins` in
   `.github/copilot/settings.json`.
5. If the root README has a plugin table or install commands, add a row and an
   install line for the new plugin.
6. Check that every JSON file you changed is still valid and that the catalog
   entry matches `plugin.json`.

The plugin has no skills, agents, or other parts yet. For what can go in it,
point to the
[Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference).
Return the created and changed paths. Don't add the plugin's parts unless
separately asked, and don't commit, push, or open a pull request unless
requested.
