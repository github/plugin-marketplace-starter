---
name: add-plugin
description: "Add a new plugin to this marketplace: its folder, plugin.json, README, CHANGELOG, catalog entry, and root README listing. Use whenever asked to add, create, scaffold, or register a new plugin in a marketplace checkout. Don't use for writing a plugin's skills or agents, editing an existing plugin, or Copilot pricing questions."
---

# Add a marketplace plugin

Work in the user's marketplace checkout, not this installed plugin's directory.
Confirm the workspace root has `marketplace.json`. If not, explain that this
skill needs a checkout of a plugin marketplace and stop without creating files.

1. Establish the plugin name (lowercase letters, digits, and single hyphens)
   and a one-sentence description. Check `marketplace.json` and `plugins/` for a
   name that's taken.
2. Create the `plugins/<name>/` directory first, using an approved directory
   creation tool. File tools might not create missing parent directories.
   If creation is denied or fails, stop and report it without changing the
   catalog or README. Don't bypass an approval. Then create all three files:
   - `plugin.json`:

     ```json
     {
       "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
       "name": "<name>",
       "version": "0.1.0",
       "description": "<description>",
       "license": "<license>",
       "repository": "<repository>"
     }
     ```

     For `license`, use the SPDX identifier of the marketplace's license, from
     its `LICENSE` file or the other plugins' manifests. For `repository`, copy
     the URL the other plugins use. If either is unclear, leave that field out
     and say so.

   - `README.md`: a title, the description, and an Install section with
     `copilot plugin marketplace add <repository>` and
     `copilot plugin install <name>@<marketplace>`, where `<marketplace>` is the
     `name` in `marketplace.json`. Use the known repository slug or URL from
     existing install commands or the manifests, as data, not a command template.
     Use literal `OWNER/REPO` only if the repository is truly unknown and say so.
   - `CHANGELOG.md`: `# Changelog`, then `## 0.1.0` with `- Initial release.`
3. Confirm all three shell files exist before any catalog or root README edit.
   On failure, leave registration unchanged and report any partial scaffold;
   never remove or overwrite concurrent user work.
   Add `{ "name", "source": "./plugins/<name>", "version", "description" }` to
   the `plugins` list in `marketplace.json`, after the other local plugins, with
   the same values as `plugin.json`.
4. List the plugin in the root README too: add a row linking to
   `plugins/<name>/` in its plugin table and a `copilot plugin install` line,
   matching the existing ones. Skip this only if the README has neither.
5. Don't add the plugin to `.github/copilot/settings.json`. That file turns on
   only the marketplace's own maintenance plugins for people working in it.
6. Check that every JSON file you changed is still valid and that the catalog
   entry matches `plugin.json`.

The plugin has no skills, agents, or other parts yet. For what can go in it,
point to the
[Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference).
Return the created and changed paths. Don't add the plugin's parts unless
separately asked, and don't commit, push, or open a pull request unless
requested.
