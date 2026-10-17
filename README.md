# Plugin marketplace starter

A GitHub template for teams that want to build, evaluate, and distribute AI
customizations as an Agent Plugins 1.0 marketplace. Start with the example
workflows, replace them with your team's skills or agents, and keep their evals
alongside the source.

The starter contains three self-contained example plugins, two skills, and an
optional remote reference to GitHub Copilot Evals. Installed examples need no
dependency installation. Contributor-only tooling provides model-free checks,
behavioral evals, and a manual GitHub Actions evaluation workflow.

| Plugin | Try it | Teaches |
|---|---|---|
| [bug-report](plugins/bug-report/) | "Turn these notes into a bug report" | A basic skill that loads the right template on demand |
| [format-json](plugins/format-json/) | Ask Copilot to edit a JSON file | CLI-compatible post-tool hooks, affected-file formatting |
| [team-brainstorm](plugins/team-brainstorm/) | "Let's brainstorm a release plan together" | Skills, canvas actions, a shared session-only UI |

## Make it yours

1. Click **Use this template** on GitHub to create your team's repository.
2. Edit the marketplace `name` and `owner` in [marketplace.json](marketplace.json).
   Replace the repository reference in the install commands below with your own
   `OWNER/REPO`. Keep the marketplace name unique. Update the same marketplace
   name and plugin keys in [.github/copilot/settings.json](.github/copilot/settings.json).
3. Keep, rename, or delete the local examples. Update each plugin's manifest, catalog
   entry, any skill metadata, README, changelog, and repository settings together.
   Review the optional remote plugin separately; remove its catalog entry if your
   team doesn't have upstream access. It is not enabled by the repository overlay.
4. If you rename the canvas, update both its ID in the extension and the
   companion skill's reference to it.
5. Run `npm ci` and `npm run verify`, then push your changes.
6. Test installation from your new GitHub repository before sharing it.

For agent-assisted setup and maintenance, see [AGENTS.md](AGENTS.md). It links
the plugin and marketplace specifications and adds agent-specific rules.

Only marketplace contributors need `npm ci` and Node.js 22.14 or newer for the
evaluation development tools. Installed examples still use Node.js 22.12 or newer
and the SDK supplied by Copilot. Review plugins before trusting
them. The formatter rewrites JSON files after agent edits.

## Install the examples

Use a current Copilot CLI or a VS Code Copilot host using the shared runtime.
VS Code users do not need a separate global Copilot CLI installation merely to
consume the plugins. The eval tooling uses its own pinned development dependency.
The canvas additionally needs a host that presents SDK canvases. Do not assume
every VS Code chat provider or CLI version supports that UI.

The portable skills can be used by other clients that support Agent Plugins and
Agent Skills. Copilot-specific hooks and canvas extensions still require those
host capabilities; plugin portability doesn't imply every component runs in
every harness.

### Copilot CLI

```sh
copilot plugin marketplace add digitarald/plugin-marketplace-starter
copilot plugin install bug-report@plugin-marketplace-starter
copilot plugin install team-brainstorm@plugin-marketplace-starter
copilot plugin install format-json@plugin-marketplace-starter
```

Start a new session in a project you trust. The formatting hook runs automatically
after successful supported edit tools; it does not add a skill or command.

### VS Code

Run **Chat: Install Plugin from Source**, enter
`digitarald/plugin-marketplace-starter`, and select an example. Use a Copilot
session backed by the shared runtime. Start a new session if the host requests
it after installation.

If the canvas is unavailable, the brainstorm skill explains the limitation and
continues in chat. The CLI-compatible hook has no separate VS Code variant.

### Optional GitHub Copilot Evals plugin

The root [marketplace.json](marketplace.json) includes an `evals` entry with this
remote source:

```json
{
  "source": "github",
  "repo": "github/evals",
  "path": "packages/plugin"
}
```

After adding this marketplace, install it explicitly:

```sh
copilot plugin install evals@plugin-marketplace-starter
```

[GitHub Copilot Evals](https://github.com/github/evals) provides create, review,
improve, and run skills. Its source repository is currently private, so each
installer needs a GitHub account with access. This catalog reference doesn't
grant access or copy upstream code. Repository installs provide the source
skills; use upstream release instructions for the prebuilt extension, canvas,
or MCP tooling.

The local Vally workflow below works without this optional plugin. Catalog
validation checks remote metadata only; normal checks and eval runs don't
download or execute `github/evals`, and don't claim to evaluate its assets.

## Develop without publishing

Opening this checkout in a trusted shared-runtime Copilot session makes all three
local examples available from the working files. The repository-scoped
[settings overlay](.github/copilot/settings.json) declares this directory as a
marketplace and enables each example. No global plugin installation is needed.
Start a new session after adding the overlay or changing plugin registrations.
Host trust prompts and managed policy still apply.

```sh
npm ci
npm run verify
copilot
```

Accept the folder-trust prompt for this checkout. After exiting the session,
check discovery from the same repository directory:

```sh
copilot plugin list --json
copilot plugin marketplace list --json
```

In a runtime with live repository marketplaces, the list shows all three examples
as enabled with `source: "live"`. Changes are read from this checkout on session
startup rather than a globally installed copy.

If the plugins and marketplace are missing from the lists, first check folder
trust. The CLI omits an untrusted checkout's repository settings from these
listings. Trust the folder through an interactive session, then retry. Do not
install the plugins globally just to make local discovery work.

Listing verifies discovery only. It does not prove that the formatting hook
executes or that the host can present the canvas. Use the host checks below to
verify those behaviors.

For hosts without repository-overlay support, or to test in a different project,
pass plugins explicitly with absolute paths:

```sh
copilot --plugin-dir /absolute/path/to/plugins/bug-report \
  --plugin-dir /absolute/path/to/plugins/team-brainstorm \
  --plugin-dir /absolute/path/to/plugins/format-json
```

No plugin code depends on this repository's development dependencies.

## How the marketplace fits together

```text
marketplace.json
plugins/
  bug-report/
    plugin.json
    skills/bug-report/SKILL.md
    skills/bug-report/templates/
      ui.md
      cli.md
  team-brainstorm/
    plugin.json
    skills/team-brainstorm/SKILL.md
    com.github.copilot/extensions/brainstorm/
      extension.mjs
      board.mjs
      server.mjs
      index.html
  format-json/
    plugin.json
    com.github.copilot/hooks/
      hooks.json
      format.mjs
scripts/                   # Catalog, schema, metadata, and syntax validation
test/                      # No-model behavior and extension contract tests
evals/                     # Model-backed specs, synthetic fixtures, and graders
.vally.yaml                # Smoke/full evaluation suites
.github/copilot/           # Enables this checkout's marketplace in Copilot
.github/workflows/         # Automatic validation and manual behavioral evals
```

Each plugin also has a README and changelog. Agent Plugins 1.0 discovers portable
skills from `skills/`. Copilot-specific hooks and SDK extensions belong in
`com.github.copilot/`. A portable MCP example would add `mcp.json` at the plugin
root; it is deliberately not included in this starter.

## Add a plugin

1. Copy the closest example into `plugins/<name>/`. `bug-report` is the smallest.
2. Give it a unique name and update its manifest and any skill metadata.
3. Add a relative source entry to the catalog and enable it in the repository settings.
4. Keep the plugin self-contained. Never import a sibling plugin or root
   development dependency at runtime.
5. Add focused tests, behavioral evals, and a short README explaining prerequisites
   and risks. Keep each plugin grouped around a workflow, not an asset type.
6. Change its version in the manifest, catalog, and changelog for every release.

The root catalog lists both local examples and optional remote references.
Deleting a local example also means removing its catalog entry, repository
enablement, tests, and evals. Remote references stay opt-in and aren't subject to
local asset coverage checks.

## Evaluate the plugin assets

The development-only [Vally](https://microsoft.github.io/vally/) setup adds
model-backed evals without changing the three shipped plugins, adding skills,
installing runtime dependencies into plugins, or introducing a build step.

```sh
npm ci
npm run verify
npm run eval:smoke
npm run eval
npm run eval:report -- --suite full
```

`verify` remains model-free: source checks, tests, eval coverage checks, and
strict Vally linting. `eval:smoke` and `eval` run real Copilot sessions and consume
inference credits. Authenticate using the
[Vally runtime setup](https://microsoft.github.io/vally/get-started/runtime-setup/).
The baseline is `gpt-5.4-mini`; override it with `--model MODEL_ID`.
Runs use one worker, per-case timeouts, and one bounded retry for a timeout or
rate limit. Valid failed behavioral verdicts are not retried to obtain a pass.

| Asset | Model-backed coverage | Boundary |
|---|---|---|
| Bug-report skill and templates | UI versus CLI template selection, supplied facts, missing reproduction details, example-credential redaction, non-trigger requests | Drafts stay in chat; no issue creation or command execution |
| JSON formatter hook | A real compact agent edit triggers the packaged hook; malformed JSON remains unchanged with a diagnostic | The grader requires the actual hook receipt and file effects, not a model's claim that it formatted the file |
| Team-brainstorm skill | Preserve existing notes, add two ideas, move a note by its real ID across turns, and fall back to chat without a canvas | Canvas interaction uses the headless SDK contract below |
| Brainstorm extension | Real registered actions and session state through an MCP test transport | The original HTTP, SSE, and lifecycle code executes; native UI rendering is not tested |

The existing brainstorm extension, board, HTTP server, and page retain their
model-free behavior, isolation, lifecycle, and DOM tests. The additional
MCP-based interaction case uses the same source assets without modifying them.

The specs live in [evals/](evals/) and are grouped by plugin. The
[grader programs](evals/graders/) use Node built-ins and are staged only for
grading, outside agent-visible inputs. They include counterexamples so a missing
template, fabricated hook result, or missing output cannot pass.
The source validator ignores generated `vally-results/` files.

### Add evals for your team's skills and agents

1. Create `evals/<workflow>/eval.yaml` with realistic tasks, expected outcomes,
   and at least one negative or non-trigger case. Keep private production data
   out of fixtures and expected answers out of agent-visible inputs.
2. Load the actual asset, rather than pasting its instructions into the task.
   Skill paths in `agent_environment.skills` are relative to the eval file.
   Stage a custom agent with `agent_environment.files`, copying its real
   `.agent.md` file to `.github/agents/<name>.agent.md` in the disposable workspace.
3. Assert both invocation and outcome. Skills use `skill-invocation`; agents
   require a `tool-calls` assertion for `^task$` and the exact `agent_type`, then
   a subagent-scoped outcome assertion. The default agent's answer isn't proof
   that the intended custom agent ran.
4. Tag each positive case with its asset identity and select a representative
   case with `suite: smoke`. Run `npm run verify`, then run the relevant eval,
   inspect its trajectory, and confirm a wrong outcome would fail the graders.

| Asset | `tags.assets` identity | Source layout |
|---|---|---|
| Skill | `skill:<plugin>/<skill-name>` | `plugins/<plugin>/skills/<skill-name>/SKILL.md` |
| Custom agent | `agent:<plugin>/<agent-name>` | `plugins/<plugin>/com.github.copilot/agents/<file>.agent.md` |
| Hook | `hook:<plugin>/<event-name>` | `plugins/<plugin>/com.github.copilot/hooks/hooks.json` |

Use `tags.control: positive` or `negative` to identify control cases. The
coverage checker requires positive outcome and smoke coverage for every local
skill, custom agent, and hook it discovers. The starter doesn't bundle a custom
agent yet; these conventions support adding one to an existing workflow.

Run one spec without launching the full suite:

```sh
node scripts/evals.mjs eval --eval-spec evals/bug-report/eval.yaml
```

Use the [Vally eval schema](https://microsoft.github.io/vally/reference/eval-spec/)
for fields and [grader catalog](https://microsoft.github.io/vally/reference/graders/)
for assertions. Existing specs show template routing, output checks, hook
effects, and negative controls. Catalog, asset, and suite identities must stay
consistent when you rename or remove examples.

### How the harness loads assets

The [launcher](scripts/evals.mjs) uses the pinned full Copilot CLI through
Vally's `copilot-sdk` executor. Its small [runtime bridge](scripts/eval-runtime.js)
mounts `format-json` explicitly for hook cases with the documented `--plugin-dir`
option. It doesn't depend on an interactive folder-trust prompt or a global
plugin installation. Other cases don't mount that plugin.

### MCP-based canvas evaluation

The [brainstorm fixture](evals/support/brainstorm-host.mjs) uses MCP only as an
evaluation transport. It follows the existing SDK contract-test approach:
three transport exports stand in for the host, while the actual extension,
board logic, HTTP server, and lifecycle callbacks run unchanged. It starts with
one synthetic note, keeps state only for that eval session, and closes its
servers on completion. It exposes no native window and returns no localhost URL
to the model. It is not a new installable MCP plugin or a vendored runtime SDK.

The launcher supplies the fixture's absolute path through `BRAINSTORM_HOST`.
Only the canvas-interaction case connects to it. The separate no-canvas case
still checks the skill's honest chat fallback. Neither the headless fixture nor
the model-free contract tests certify native Copilot App or VS Code rendering.

### Results and CI

Each run writes JSONL results, a Markdown report, JUnit, and session evidence
under a timestamped `vally-results/` directory. Use
`npm run eval:report -- --suite smoke` for a smoke run, or `--suite full` for the
full suite. `--run-dir PATH` selects a saved run explicitly. An incomplete run,
unexpected skip, runtime error, or grader infrastructure error fails reporting.
Valid failed behavioral verdicts remain visible but don't fail the command by
default. Add `--require-pass` when you want those verdicts to fail too.

Use `npm run eval:grade -- --help` to see Vally's saved-evidence grading options.
Re-grading these code-based assertions does not require another model run.
Passing these fixtures establishes their specific contracts, not universal
bug-report quality or brainstorming creativity.

The existing automatic validation workflow stays credential-free and never
invokes a model. The optional [manual behavioral workflow](.github/workflows/evals.yml)
runs only when explicitly dispatched after publication. It uses `GITHUB_TOKEN`
with `copilot-requests: write`; usage is billed to the repository owner or
organization. Organization-owned copies need the corresponding Copilot CLI
policy enabled. Review [GitHub's setup guidance](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions)
before enabling it. It has no PR or `pull_request_target` trigger and does not
expose inference credentials to fork checks.

Teams wanting automatic behavioral runs can opt into same-repository PR or
default-branch push triggers after reviewing cost and trust requirements. Keep
fork PRs on model-free validation and never execute their code through
`pull_request_target` with credentials. See
[Vally's CI guide](https://microsoft.github.io/vally/get-started/add-to-ci/)
for the supported trigger guard and token setup. This starter does not silently
enable paid runs for every contribution.

## Validation and compatibility

`npm run verify` validates manifests against a vendored copy of the official
Agent Plugins 1.0 JSON Schema, catalog/version consistency, skill metadata,
Markdown links, repository marketplace settings, hook layout, and JavaScript syntax. Tests exercise board
behavior, the loopback HTTP server, extension lifecycle through an SDK contract
harness, page focus behavior through a minimal DOM harness, and the actual
formatter hook process with runtime-shaped edit events.
CI runs these checks on Node.js 22 and 24 on all three desktop operating systems.
The automatic validation workflow does not invoke a model or require a GitHub
token. The manual behavioral workflow described above is a separate opt-in.

The [bug-report smoke checks](plugins/bug-report/README.md#smoke-checks) are also
encoded in the model-backed evals. Real model execution remains separate from
offline verification and automatic CI.

Before a release, smoke-test **both hosts**:

- Open this trusted checkout and confirm all three plugins are enabled without
  global installation. Confirm both skills are discovered.
- Install from GitHub in a separate test environment and confirm the same plugins.
- Open the canvas; add, edit, move, and delete notes from the UI and agent.
- Reopen the same panel and confirm notes remain. A new session starts empty.
- Keep keyboard focus on a note control while Copilot edits or moves that note.
  Confirm focus remains there, or returns to the input if the note is deleted.
- Edit JSON using single-file edits, multi-file edits, and `apply_patch`.
  Confirm two-space formatting, a final newline, and changed-file reporting.
- Check that failed edits and unrelated files are untouched. Invalid JSON must
  stay unchanged with a visible diagnostic. Already formatted JSON is not rewritten.

Automated contract tests do not substitute for these host checks. Canvas
presentation and full end-to-end VS Code/CLI behavior must be verified in the
versions your team deploys.

## References

- [Agent Plugins standard](https://agent-plugins.org/)
- [GitHub Copilot plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins)
- [Shared runtime hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [VS Code agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)
- [Agent Skills specification](https://agentskills.io/specification)
