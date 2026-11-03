---
name: submit-plugin
description: "Prepare a marketplace plugin contribution or update for a pull request. Use to bump plugin versions and changelogs, flag compatibility changes, and write the pull request description. Don't use for a catalog-wide release, generic PRs, or publishing without approval."
---

# Prepare a plugin contribution

Work in the user's marketplace checkout. Read its `AGENTS.md` and
`CONTRIBUTING.md`. If the checkout can't be read, report that rather than
guessing its rules.

1. Establish the plugin and comparison base with the user or the existing PR.
   Inspect the working-tree changes and relevant history without discarding
   unrelated work. Never invent approval or an issue number.
2. Compare the public surface with the base: skill and agent names, tools,
   hook events, permissions, network access, and supported hosts. Flag renamed
   or removed parts and behavior changes for current users. A new automatic
   hook needs explicit risk review.
3. For each changed existing plugin, use semantic versioning: patch for fixes
   and wording, minor for new compatible behavior, major for breaking changes.
   Ask when compatibility is unclear. Update the version in `plugin.json` and
   the matching `marketplace.json` entry together, and add a `## <version>`
   heading with a short entry to `CHANGELOG.md`. Don't bump twice if the
   contribution already has the correct new version and changelog. A new plugin
   keeps its initial version.
4. Check that the catalog entry's name, version, and description match
   `plugin.json`, the JSON files are valid, and the README describes the change. If the plugin has evals in `evals/<name>/`,
   check that they use only synthetic data.
5. Write the pull request description in chat with these sections:

   ```markdown
   ## What changed
   One or two sentences, and any breaking change.

   ## Version and changelog
   <plugin>: <old version> -> <new version>, with a CHANGELOG.md entry.

   ## Checks
   What you checked, and anything you couldn't check, such as a host you
   didn't try.

   ## Risk
   ```

   Under **Risk**, if the plugin runs no code (only skills or agents), say so in
   one line. Otherwise answer each question from evidence, using "none" only
   when verified: what runs, and when; files it reads or writes; network
   destinations; credentials or tokens and where they come from; data it keeps,
   where, and for how long; data it sends to the model; new dependencies and
   their licenses; remote sources and the pinned sha; and who owns it.

Return the version and changelog changes, compatibility risks, and the pull
request description. Preparing it doesn't authorize creating an issue,
committing, pushing, opening a PR, or publishing; do those only if requested.
