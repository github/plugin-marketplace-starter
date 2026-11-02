# Retire a plugin

1. Confirm the exact plugin name, reason, and user approval to remove it. Check
   whether it's local or remote and record its current version. Don't infer
   retirement approval from a failing check or a request for release notes.
2. For a local plugin, delete `plugins/<name>/` and `evals/<name>/`. For either
   kind, remove its entry from `marketplace.json`.
3. Remove its `<name>@<marketplace>` key from `enabledPlugins` in
   `.github/copilot/settings.json`.
4. Remove its row from the README's plugin table, its
   `copilot plugin install <name>@<marketplace>` lines, and anything else in
   Markdown that describes it. If the table is left empty, add a row that says
   `_None yet._`.
5. Search the repository for the plugin's name and fix any links or mentions
   that are left. Keep other plugins' files and shared files in `evals/graders/`
   and `evals/support/`. Check that `marketplace.json` and
   `.github/copilot/settings.json` are still valid JSON.
6. Draft a retirement note with the reason, last supported version, and any
   migration option. Removing a catalog entry doesn't uninstall existing copies
   or block installation from another marketplace. Users may need to uninstall
   their copy; don't do that on their behalf.

Don't commit, push, publish a release, or change organizational policies unless
separately requested.
