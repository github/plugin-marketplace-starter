# Retire a plugin

1. Confirm the exact plugin name, reason, and user approval to remove it. Check
   whether it is local or remote and record its current version. Don't infer
   retirement approval from a failing check or a request for release notes.
2. From the marketplace checkout, run
   `npm run remove-plugin -- <name> --dry-run` and inspect the owned paths.
   Use `npm run remove-example -- <name> --dry-run` for an included plugin
   registered in `scripts/examples.mjs`. If an unexpected shared or unrelated
   file would be removed, stop and resolve ownership first.
3. Run the same command without `--dry-run`. Don't manually delete catalog,
   overlay, or `.vally.yaml` registrations. The command removes the plugin,
   its evals and owned support files, and marked documentation.
4. Search for leftovers and stale links, including unmarked prose, params,
   generated bundles/notices, and tests. Preserve shared template tooling and
   coverage for other plugins. If a mapping in `scripts/examples.mjs` is now
   obsolete, remove that mapping after the command has used it.
5. Run `npm run build` if generated sources were removed, then
   `npm run verify`. Report failures and cleanup gaps explicitly.
6. Draft a retirement note with the reason, last supported version, and any
   verified migration option. Removing a catalog entry doesn't uninstall
   existing copies or block installation from another marketplace. Users may
   need to uninstall their copy; don't do that on their behalf.

Don't commit, push, publish a release, or change organizational policies unless
separately requested.
