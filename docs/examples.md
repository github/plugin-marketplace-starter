# Included plugins

The template includes two workflow plugins most teams keep after adoption.
They use the active marketplace checkout's scripts and guides, not files in
their installation directory. Neither teaches generic skill or eval writing.

<!-- plugin:plugin-authoring -->
## Plugin authors

[plugin-authoring](../plugins/plugin-authoring/) covers:

| Asset | Job | Try it |
|---|---|---|
| `add-plugin` skill | A1: choose a type and supported host; A2: scaffold and register it | "Add a plugin that formats YAML after edits" |
| `try-plugin-locally` skill | A5: test discovery before publishing and clean up | "Let me try my plugin before I open a PR" |
| `submit-plugin` skill | A6: prepare a compatible update and a validated PR draft | "Get my plugin ready for a pull request" |

Generic writing guidance (A3) is linked from `add-plugin`. For evals (A4), use
[Write an eval](eval-authoring.md) and [Evals](evals.md); no eval-writing skill
ships here.

Owned files: `plugins/plugin-authoring/`, `evals/plugin-authoring/` (one eval per
skill and the shared `graders.mjs`), and
`test/plugin-authoring-grader.test.mjs`.
<!-- /plugin:plugin-authoring -->

<!-- plugin:marketplace-maintainer -->
## Marketplace owners

[marketplace-maintainer](../plugins/marketplace-maintainer/) covers:

| Asset | Job | Try it |
|---|---|---|
| `plugin-reviewer` custom agent | O2: read-only contribution review with evidence-backed findings | "Delegate this plugin review to plugin-reviewer" |
| `update-remote-pins` skill | O3: add or deliberately update a reviewed remote pin | "Pin this outside plugin at its latest release" |
| `release-plugins` skill | O4: validate and draft release notes; O5: catalog health and retirement | "Get the catalog ready to release" |

The reviewer has only `read` and `search`, returns findings in chat, and cannot
run `verify`. Use the Validate workflow for that evidence. It has no matching
skill. See [host support](customization-types.md#where-each-type-works);
custom agents from plugins in the Copilot app remain not verified.

Owned files: `plugins/marketplace-maintainer/`, `evals/marketplace-maintainer/` (one
eval per skill and agent, the skills' shared `graders.mjs`, and the reviewer's
fixtures in `agents/plugin-reviewer/fixtures/`), and
`test/marketplace-maintainer-grader.test.mjs`.
<!-- /plugin:marketplace-maintainer -->

## Adopt or remove

Initial marketplace setup (O1) stays in the README's
[Make it yours](../README.md#make-it-yours). Use eval evidence to assess value
(O6), without treating a static pass as proof of behavioral quality.

Use `npm run remove-example -- <name>` to remove either included plugin, or
`npm run remove-example -- --all` for both. The ownership map in
[scripts/examples.mjs](../scripts/examples.mjs) makes removal include each
plugin's evals and support files. Adoption tests cover removal and an empty
marketplace.

Shared scaffolding, canvas eval support, TypeScript/build tooling, and schemas
stay because `new-plugin` still supports every type.
