# Retire a plugin

1. Confirm the exact plugin name, reason, and user approval to remove it. Check
   whether it is local or remote and record its current version. Don't infer
   retirement approval from a failing check or a request for release notes.
2. From the marketplace checkout, run
   `npm run remove-plugin -- <name> --dry-run` and inspect the owned paths.
   If an unexpected shared or unrelated file would be removed, stop and
   resolve ownership first.
3. Run the same command without `--dry-run`. Don't manually delete catalog,
   overlay, or `.vally.yaml` entries. The command removes the plugin, its evals
   and tests, and marked documentation.
4. Search for leftovers and stale links, including unmarked prose and params.
   Preserve shared template tooling and other plugins' files.
5. Run `npm run verify`. Report failures and cleanup gaps explicitly.
6. Draft a retirement note with the reason, last supported version, and any
   verified migration option. Removing a catalog entry doesn't uninstall
   existing copies or block installation from another marketplace. Users may
   need to uninstall their copy; don't do that on their behalf.

Don't commit, push, publish a release, or change organizational policies unless
separately requested.
