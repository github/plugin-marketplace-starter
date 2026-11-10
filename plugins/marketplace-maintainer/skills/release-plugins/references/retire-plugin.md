# Retire a plugin

1. Confirm the exact plugin name, reason, and user approval to remove it. Check
   whether it's local or remote and record its current version. Don't infer
   retirement approval from a failing check or a request for release notes.
2. For a local plugin, inspect and confirm the exact owned paths
   `plugins/<name>/` and, if present, `evals/<name>/`. Obtain the host's deletion
   permission before proceeding. Delete only those approved paths and verify
   they're gone before editing registrations. If deletion is denied or fails,
   stop with the catalog, settings, and README unchanged. Report any paths
   already deleted and those remaining; don't claim completion or overwrite
   concurrent work to roll back. For either kind, remove its catalog entry only
   after these required deletions succeed (remote entries have no local folder).
3. If `.github/copilot/settings.json` lists the plugin under `enabledPlugins`,
   remove that key. Otherwise leave the file alone.
4. Remove its row from the README's plugin table, its
   `copilot plugin install <name>@<marketplace>` lines, and anything else in
   Markdown that specifically describes the retired plugin. If the table is left empty, add a row that says
   `_None yet._`.
5. Search the repository for the plugin's name and fix any links or mentions
   that are left, including removing its skills from `agent_environment.skills`
   or `disallowed` lists in surviving cohort evals under `evals/`. A substring
   match doesn't establish ownership: preserve generic illustrative examples,
   other plugins' files, shared tooling, and `evals/_shared/`. Report partial
   state if a later registration edit fails.
   Check that `marketplace.json` is still valid JSON.
6. Draft a retirement note with the reason, last supported version, and any
   migration option. Removing a catalog entry doesn't uninstall existing copies
   or block installation from another marketplace. Users may need to uninstall
   their copy; don't do that on their behalf.

Don't commit, push, publish a release, or change organizational policies unless
separately requested.
