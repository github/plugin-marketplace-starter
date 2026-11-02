---
name: submit-plugin
description: "Prepare a marketplace plugin contribution or update for a pull request. Use to synchronize plugin versions and changelogs, flag compatibility changes, validate the contribution, and draft the repository's PR template and risk table. Don't use for a catalog-wide release, generic PRs, or publishing without approval."
---

# Prepare a plugin contribution

Work in the user's marketplace checkout. Read its `AGENTS.md`,
`CONTRIBUTING.md`, `docs/security.md`, and `.github/PULL_REQUEST_TEMPLATE.md`
(or the selected template in `.github/PULL_REQUEST_TEMPLATE/`). Don't replace
the repository's template with a generic body. If the checkout or template
can't be read, report that prerequisite rather than inventing its contents.

1. Establish the plugin and comparison base with the user or the existing PR.
   Inspect the working-tree changes and relevant history without discarding
   unrelated work. For a new plugin, check the contribution issue requirement;
   never invent approval or an issue number.
2. Compare the public surface with the base: skill and agent names, tools and
   schemas, hook events, permissions, network access, and supported hosts.
   Flag renamed or removed skills/agents/tools and behavior changes for current
   users. A new automatic hook also needs explicit risk review.
3. For each changed existing plugin, use the contribution guide's versioning:
   patch for fixes/wording, minor for new compatible behavior, major for breaking
   changes. Ask when compatibility is unclear. Update `plugin.json` and the
   matching `marketplace.json` version together and add a `## <version>` heading
   to `CHANGELOG.md`. Don't bump twice if this contribution already has the
   correct new version and changelog. A new plugin keeps its initial version;
   changes only outside a plugin don't require a plugin version bump.
4. Check matching catalog descriptions, local overlay enablement, `.vally.yaml`
   skill paths and params, READMEs, and eval invocation/outcome assertions,
   negative controls, and smoke coverage. Refer eval-writing work to
   `docs/eval-authoring.md`; don't silently claim static coverage proves quality.
5. Run `npm run build` if generated-file sources changed, then `npm run verify`.
   Fix contribution-related failures, and report any remaining failure as a
   blocker. Paid evals and the evals workflow require separate approval.
6. Draft the PR body in chat using the actual template's headings, comments,
   checklist items, and ordering. Mark items honestly; include each exact
   validation command and result. Fill every risk-table row from evidence
   (use "none" only when verified), including what runs, files, network,
   credentials, retained data, model inputs, dependencies/licenses, and remote
   sources. Identify owner/approver gaps. In **Paid evals**, list actual runs
   and results or "None; not run." Call out breaking changes and host checks
   that weren't exercised.

Return the version/changelog changes, compatibility risks, validation results,
and complete PR draft. Preparing the draft doesn't authorize creating an issue,
committing, pushing, opening a PR, or publishing; do those only if requested.
