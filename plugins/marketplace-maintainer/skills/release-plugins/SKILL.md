---
name: release-plugins
description: "Prepare a marketplace release, fix catalog inconsistencies, or retire a stale plugin. Use to check changed plugin versions and changelogs and draft user-facing release notes. Don't use for a single contribution's PR draft, remote pin updates alone, or publishing without approval."
---

# Prepare a marketplace release

Find the user's marketplace checkout. Read its `AGENTS.md`, `CONTRIBUTING.md`,
and `marketplace.json`. Don't change the installed copy of this plugin. If the
checkout or release comparison base is missing, ask for it instead of guessing
which changes are being released.

1. Establish the release range and inspect changed plugin paths and catalog
   entries. If a check failed, read its exact output first. Fix only the cause
   and tightly coupled inconsistencies; don't loosen eval checks to make it pass.
2. For every changed plugin, compare the released and candidate versions in
   `plugin.json` and `marketplace.json`, the matching `## <version>` changelog
   entry, and descriptions. Use patch for fixes and wording,
   minor for new compatible behavior, and major for breaking changes. Don't
   increment a version already correctly bumped for this release. New plugins
   start at their initial version; changes outside a plugin's folder don't need
   a version bump.
3. Review compatibility and risk changes: renamed parts, removed tools,
   automatic hooks, credentials, network destinations, and dependencies. Refer
   to the read-only `plugin-reviewer` agent for a requested contribution review,
   not as a substitute for these checks.
4. If the user asks to retire a plugin, follow
   [Retire a plugin](references/retire-plugin.md). Don't retire one just because
   its checks fail.
5. Check that `marketplace.json` and every changed `plugin.json` are valid JSON,
   that each local entry's `name`, `version`, and `description` match its
   manifest. If remote entries changed, check their pins
   as the `update-remote-pins` skill describes. Report what you checked.
6. Check each changed plugin README's host checks, if it has them. Report
   untested hosts honestly. Don't run paid evals or model sessions without
   approval.
7. Draft concise release notes in chat, grouped by plugin and version, with
   user-visible changes, compatibility or migration steps, and retirements.
   Separate blockers and missing checks from the notes.

Return the release range, checked versions and changelogs, what you checked,
and draft notes. Don't create tags or releases, commit, push, publish, or
change GitHub settings without a separate user request.
