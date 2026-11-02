---
name: release-plugins
description: "Prepare a marketplace release, diagnose catalog health failures, or retire a stale plugin. Use to check changed plugin versions and changelogs, run verify, and draft user-facing release notes. Don't use for a single contribution's PR draft, remote pin updates alone, or publishing without approval."
---

# Prepare a marketplace release

Find the user's marketplace checkout. Read its `AGENTS.md`, `CONTRIBUTING.md`,
`marketplace.json`, and `docs/local-development.md`. Don't change the installed
copy of this plugin. If the checkout or release comparison base is missing,
ask for it instead of guessing which changes are being released.

1. Establish the release range and inspect changed plugin paths and catalog
   entries. If a health check failed, read the exact diagnostics first.
   Fix only the cause and tightly coupled inconsistencies; don't remove tests
   or loosen eval checks to make the catalog green.
2. For every changed plugin, compare the released and candidate versions in
   `plugin.json` and `marketplace.json`, the matching `## <version>` changelog
   entry, descriptions, overlay settings, and `.vally.yaml`. Apply the
   contribution guide's patch/minor/major rules, with major for breaking
   changes. Don't increment a version already correctly bumped for this release.
   New plugins start at their initial version; eval-only and external-doc changes
   don't require a plugin version bump.
3. Review compatibility and risk changes: renamed assets, removed tools,
   automatic hooks, credentials, destinations, and dependencies. Refer to the
   read-only `plugin-reviewer` agent for a requested contributed-plugin review,
   not as a substitute for validation.
4. If the user asks to retire a plugin, follow
   [Retire a plugin](references/retire-plugin.md). Don't retire one just because
   its checks fail.
5. Run `npm run build` if generated sources changed, then `npm run verify`.
   Report exact results and resolve release-related failures. If remote entries
   changed, follow `docs/remote-plugins.md` and report `check-remotes` separately;
   it uses the network and isn't part of `verify`.
6. Check the plugin READMEs' host checks and installation evidence from the
   local-development guide. Report untested hosts honestly. Don't run paid
   evals or model sessions without approval. A static pass isn't a behavioral
   or host-rendering pass.
7. Draft concise release notes in chat, grouped by plugin and version, describing
   user-visible changes, compatibility/migration steps, and retirements. Separate
   blockers and missing validation from the notes.

Return the release range, checked versions/changelogs, exact validation results,
and draft notes. Don't create tags/releases, commit, push, publish, or change
GitHub settings without a separate user request.
