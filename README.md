# Plugin marketplace starter

A GitHub template for teams that want to build, evaluate, and distribute AI
customizations as an Agent Plugins 1.0 marketplace. Start with the example
workflows, replace them with your team's skills, agents, hooks, and tools, and
keep their evals alongside the source.

The starter contains six self-contained example plugins and an optional remote
reference to GitHub Copilot Evals. Together they show five skills, a custom
agent, a hook, a canvas extension, and a local MCP server. Installed examples
need no dependency installation. Contributor-only tooling provides model-free
checks, behavioral evals for every local asset, and a GitHub Actions eval
workflow built on the [Evals Action](https://github.com/github/evals-action).

| Plugin | Try it | Teaches |
|---|---|---|
| [bug-report](plugins/bug-report/) | "Turn these notes into a bug report" | A basic skill that loads the right template on demand |
| [format-json](plugins/format-json/) | Ask Copilot to edit a JSON file | CLI-compatible post-tool hooks, affected-file formatting |
| [team-brainstorm](plugins/team-brainstorm/) | "Let's brainstorm a release plan together" | Skills, canvas actions, a shared session-only UI |
| [customization-authoring](plugins/customization-authoring/) | "Create a skill and evals for summarizing a changelog" | A skill that writes a skill and its evals |
| [code-review](plugins/code-review/) | "Use adversarial-review to review this diff without changing it" | A skill that delegates to a read-only custom agent |
| [json-configuration](plugins/json-configuration/) | 'Use json-configuration to validate {"port":8443} and look up /port' | A skill backed by a bundled local MCP server |
| [`github-copilot`](#optional-github-copilot-evals-plugin) (remote, optional) | "Create evals for this skill" | Referencing a plugin that lives in another repository |

## Make it yours

1. Click **Use this template** on GitHub to create your team's repository.
2. Edit the marketplace `name` and `owner` in [marketplace.json](marketplace.json).
   Replace the repository reference in the install commands below with your own
   `OWNER/REPO`. Keep the marketplace name unique. Update the same marketplace
   name and plugin keys in [.github/copilot/settings.json](.github/copilot/settings.json).
3. Keep, rename, or delete the local examples. Update each plugin's manifest, catalog
   entry, any skill or agent metadata, README, changelog, evals, and repository
   settings together. Also update [.vally.yaml](.vally.yaml): `paths.skills` lists
   every plugin's `skills` directory, and `params` holds the paths evals use, such
   as an MCP server bundle. `npm run verify` names any stale entry. Review the
   optional remote plugin separately; remove its catalog entry if your team
   doesn't have upstream access. The repository overlay never enables remote
   plugins.
4. If you rename the canvas, update both its ID in the extension and the
   companion skill's reference to it. If you rename the reviewer agent, update
   the review skill that delegates to it.
5. Review the copyright notices in [LICENSE](LICENSE) and each plugin's `LICENSE`.
6. Run `npm ci` and `npm run verify`, then push your changes.
7. Test installation from your new GitHub repository before sharing it.

For agent-assisted setup and maintenance, see [AGENTS.md](AGENTS.md). It links
the plugin and marketplace specifications and adds agent-specific rules.

Only marketplace contributors need `npm ci` and Node.js 22.14 or newer for the
development tools. Installed examples use the SDK supplied by Copilot; the
canvas needs Node.js 22.12 or newer and the MCP server needs Node.js 22.14 or
newer on the machine running Copilot. Review plugins before trusting them. The
formatter rewrites JSON files after agent edits.

## Install the examples

Use a current Copilot CLI or a VS Code Copilot host using the shared runtime.
VS Code users don't need a separate global Copilot CLI installation merely to
consume the plugins. The eval tooling uses its own pinned development dependency.
The canvas additionally needs a host that presents SDK canvases. Don't assume
every VS Code chat provider or CLI version supports that UI.

The portable skills and MCP server can be used by other clients that support
Agent Plugins, Agent Skills, and MCP. Copilot-specific hooks, agents, and canvas
extensions still require those host capabilities; plugin portability doesn't
imply every component runs in every harness.

### Copilot CLI

```sh
copilot plugin marketplace add github/plugin-marketplace-starter
copilot plugin marketplace browse plugin-marketplace-starter
copilot plugin install bug-report@plugin-marketplace-starter
copilot plugin install team-brainstorm@plugin-marketplace-starter
copilot plugin install format-json@plugin-marketplace-starter
copilot plugin install customization-authoring@plugin-marketplace-starter
copilot plugin install code-review@plugin-marketplace-starter
copilot plugin install json-configuration@plugin-marketplace-starter
```

Choose only the plugins you need; each one installs on its own. Start a new
session in a project you trust. The formatting hook runs automatically after
successful supported edit tools; it doesn't add a skill or command.

Copilot CLI names the installed reviewer agent `code-review:code-reviewer`.
Select it with `--agent` or the agent picker. The companion review skill
resolves the advertised identifier itself.

This repository is currently private, so installers need a GitHub account with
access to it.

### VS Code

Run **Chat: Install Plugin from Source**, enter
`github/plugin-marketplace-starter`, and select an example. You can also add the
repository to `chat.plugins.marketplaces`. Use a Copilot session backed by the
shared runtime, and enable agent plugins if they're disabled. Start a new session
if the host requests it after installation.

If the canvas is unavailable, the brainstorm skill explains the limitation and
continues in chat. The CLI-compatible hook has no separate VS Code variant.

### Optional GitHub Copilot Evals plugin

The root [marketplace.json](marketplace.json) includes a `github-copilot` entry
that points at the published GitHub Copilot Evals plugin in
[github/evals](https://github.com/github/evals). It mirrors the stable entry in
upstream's own catalog, pinned to a release tag and its full commit SHA:

```json
{
  "name": "github-copilot",
  "source": {
    "source": "github",
    "repo": "github/evals",
    "ref": "copilot-evals-v0.16.0",
    "sha": "dd4c5015b5e8fdfcbd17b261d996c85aa92fde5b",
    "path": "packages/plugin"
  },
  "version": "0.16.0"
}
```

After adding this marketplace, install it explicitly:

```sh
copilot plugin install github-copilot@plugin-marketplace-starter
```

You can also skip this catalog and install it straight from upstream, which
follows upstream's reviewed stable releases:

```sh
copilot plugin marketplace add github/evals
copilot plugin install github-copilot@evals
```

Pick one route. Don't install the same plugin from both marketplaces.

The pinned release is the built plugin. It provides the native `/eval` command
(`/eval setup`, `create`, `review`, `improve`, `run`, and `compare`) in the CLI
and Copilot App, a canvas, and six model-invocable skills: setup, create,
review, improve, run, and compare. Running an eval needs a compatible runner
and its own approval, and it spends inference credits. See the
[upstream install guide](https://github.com/github/evals/blob/main/website/src/content/guides/install/plugin.md) for VS Code and
Copilot App setup.

The `github/evals` repository is currently private, so each installer needs a
GitHub account with access. This catalog entry doesn't grant access or copy
upstream code.

A remote entry's `name` must equal the `name` in the upstream plugin's
`plugin.json`, not the upstream marketplace's name. Upstream publishes a plugin
called `github-copilot` in a marketplace called `evals`, so its install name
here is `github-copilot@plugin-marketplace-starter`, and upstream's is
`github-copilot@evals`.

The repository settings overlay never enables a remote plugin. That's a
deliberate security rule enforced by `npm run verify`: checking out this
repository must not activate code fetched from another repository. Each
developer installs remote plugins themselves.

The local eval tooling works without this optional plugin. Catalog validation
checks remote metadata only; checks and eval runs don't download or execute
`github/evals`, and don't claim to evaluate its assets.

## Develop without publishing

Opening this checkout in a trusted shared-runtime Copilot session makes all six
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

In a runtime with live repository marketplaces, the list shows all six examples
as enabled with `source: "live"`. Changes are read from this checkout on session
startup rather than a globally installed copy.

If the plugins and marketplace are missing from the lists, first check folder
trust. The CLI omits an untrusted checkout's repository settings from these
listings. Trust the folder through an interactive session, then retry. Don't
install the plugins globally just to make local discovery work.

Listing verifies discovery only. It doesn't prove that the formatting hook
executes, that the host can present the canvas, or that the MCP server starts.
Use the host checks below to verify those behaviors.

For hosts without repository-overlay support, or to test in a different project,
pass plugins explicitly with absolute paths:

```sh
copilot --plugin-dir /absolute/path/to/plugins/bug-report \
  --plugin-dir /absolute/path/to/plugins/json-configuration
```

No plugin code depends on this repository's development dependencies. The MCP
server ships as a committed, self-contained bundle.

## How the marketplace fits together

```text
marketplace.json
plugins/
  bug-report/
    plugin.json
    skills/bug-report/SKILL.md
    skills/bug-report/templates/{ui,cli}.md
  team-brainstorm/
    plugin.json
    skills/team-brainstorm/SKILL.md
    com.github.copilot/extensions/brainstorm/
      extension.mjs, board.mjs, server.mjs, index.html
  format-json/
    plugin.json
    com.github.copilot/hooks/{hooks.json,format.mjs}
  customization-authoring/
    plugin.json
    skills/skill-authoring/SKILL.md
    skills/skill-authoring/references/evals.md
  code-review/
    plugin.json
    skills/adversarial-review/SKILL.md
    com.github.copilot/agents/code-reviewer.agent.md
  json-configuration/
    plugin.json
    mcp.json                 # Local stdio server definition
    skills/json-configuration/SKILL.md
    src/server.ts            # MCP server source
    dist/server.mjs          # Generated, committed, self-contained bundle
schemas/                   # Vendored Agent Plugins schemas (Apache-2.0)
scripts/                   # Validation, build, eval launcher, and reporting
test/                      # Model-free behavior, protocol, and contract tests
evals/                     # Model-backed specs, synthetic fixtures, and graders
.vally.yaml                # smoke and full evaluation suites
.github/copilot/           # Enables this checkout's marketplace in Copilot
.github/workflows/         # Automatic validation and Evals Action workflow
```

Each plugin also has a README and changelog, and the three newer examples carry
their own `LICENSE`. Agent Plugins 1.0 discovers portable skills from `skills/`
and MCP servers from a root `mcp.json`. Copilot-specific hooks, agents, and SDK
extensions belong in `com.github.copilot/`.

## Add a plugin

1. Copy the closest example into `plugins/<name>/`. `bug-report` is the smallest.
   Group assets by workflow, not by asset type: a plugin can pair a skill with an
   agent, a skill with an MCP server, or ship only what it needs.
2. Give it a unique name and update its manifest and any skill or agent metadata.
   Skills go in `skills/<name>/SKILL.md` with a matching `name`. Agents go in
   `com.github.copilot/agents/<name>.agent.md` with a matching `name`. MCP servers
   go in a root `mcp.json` as local stdio servers using `${PLUGIN_ROOT}` paths.
3. Add a relative source entry to the catalog and enable it in the repository
   settings. If it has skills, add its `skills` directory to `paths.skills` in
   [.vally.yaml](.vally.yaml) so Vally lints them.
4. Keep the plugin self-contained. Never import a sibling plugin or root
   development dependency at runtime. If an MCP server needs dependencies, write
   it as `src/server.ts` in the plugin. [scripts/build.mjs](scripts/build.mjs)
   finds every `plugins/*/src/server.ts` and bundles it into `dist/server.mjs` with
   its license notices; eval graders in `evals/graders/src/` are bundled the same way.
5. In-repo MCP servers must start offline, without credentials, network access,
   or a database. `npm run verify` launches each one to read its real tool list
   for eval coverage. Put anything that needs a secret behind a tool call, not
   server startup.
6. Add evals under `evals/<name>/` (see below), focused tests under `test/`, and a
   short README explaining prerequisites and risks. If an eval needs a path, such
   as your server bundle, add it to `params` in `.vally.yaml`.
7. Change its version in the manifest, catalog, and changelog for every release.
8. Run `npm run build` if you changed generated files, then `npm run verify`.

The root catalog lists both local examples and optional remote references.
Deleting a local example also means removing its catalog entry, repository
enablement, `.vally.yaml` skill path and params, tests, and evals. Example-only
tests skip when their example is gone; the rest check whatever plugins you have.
Remote references stay opt-in and aren't subject to local asset coverage checks.

To reference a plugin that lives in another repository, add a GitHub source
object like the `github-copilot` entry. Its catalog `name` must match the `name`
in the upstream `plugin.json`; confirm it and the plugin directory against the
upstream manifest. Paths must be repository-relative without traversal or
backslashes. Pin a `ref` and a full 40-character commit `sha` so installs are
reproducible and immune to tag or branch moves, and refresh them deliberately
when upstream releases. `npm run verify` warns about remote entries without a
`sha`. Document any private-repository access requirement. Don't add remote
plugins to the repository settings overlay; verification rejects that.

## Evaluate the plugin assets

The development-only [Vally](https://microsoft.github.io/vally/) setup adds
model-backed evals without installing runtime dependencies into plugins.

```sh
npm ci
npm run verify
npm run eval:smoke
npm run eval:report -- --suite smoke
npm run eval
npm run eval:report -- --suite full
```

`verify` stays model-free: source checks, the generated-file freshness check,
tests, eval coverage checks, and strict Vally linting. `eval:smoke` and `eval`
run real Copilot sessions and consume inference credits. Authenticate using the
[Vally runtime setup](https://microsoft.github.io/vally/get-started/runtime-setup/).
The baseline is `gpt-5.4-mini`; override it with `--model MODEL_ID`.
Local runs use one worker, per-case timeouts, and one bounded retry for a timeout
or rate limit. Valid failed behavioral verdicts aren't retried to obtain a pass.

| Asset | Model-backed coverage | Boundary |
|---|---|---|
| Bug-report skill and templates | UI versus CLI template selection, supplied facts, missing reproduction details, example-credential redaction, non-trigger requests | Drafts stay in chat; no issue creation or command execution |
| JSON formatter hook | A real compact agent edit triggers the packaged hook; malformed JSON remains unchanged with a diagnostic | The grader requires the actual hook receipt and file effects, not a model's claim that it formatted the file |
| Team-brainstorm skill | Preserve existing notes, add two ideas, move a note by its real ID across turns, fall back to chat without a canvas, and don't trigger for arithmetic | Canvas interaction uses the headless SDK contract below |
| Brainstorm extension | Real registered actions and session state through an MCP test transport, and no canvas calls for unrelated requests | The original HTTP, SSE, and lifecycle code executes; native UI rendering isn't tested |
| Skill-authoring skill | Actual activation, generated skill and eval files, strict validation of those files, and a non-trigger question | Generated files are graded in a disposable workspace |
| Adversarial-review skill and code-reviewer agent | Actual named-agent delegation, findings from that subagent for a seeded bug, a clean case, the agent without its skill, and no workspace edits | The default agent's answer isn't accepted as the reviewer's |
| JSON configuration skill and MCP tools | Actual MCP calls and returned values or errors, including null versus missing values and pointer escaping | The real bundled server runs over stdio |

These fixtures establish their stated contracts, not universal bug-report
quality, review accuracy, or brainstorming creativity.

### Add evals for your team's skills and agents

1. Create `evals/<workflow>/eval.yaml` with realistic tasks, expected outcomes,
   and at least one negative or non-trigger case. The upstream
   [github/evals](https://github.com/github/evals) convention,
   `<name>.eval.yaml`, works too; `evalFilenames` in `.vally.yaml` lists both.
   Keep private production data out of fixtures and expected answers out of
   agent-visible inputs. Put grader programs and answer keys in
   `grading_environment`.
2. Load the actual asset, rather than pasting its instructions into the task.
   Skill paths in `agent_environment.skills` are relative to the eval file.
   Stage a custom agent with `agent_environment.files`, copying its real
   `.agent.md` file to `.github/agents/<name>.agent.md` in the disposable workspace.
   Configure an MCP server in `agent_environment.mcpServers` and pass its path
   through a `.vally.yaml` param so the launcher can make it absolute. Mount a
   hook plugin by setting `agent_environment.env.STARTER_PLUGIN_DIRS` to its
   directory, such as `plugins/format-json`. Separate several with commas.
3. Assert both invocation and outcome. Skills use `skill-invocation`. Agents
   require a `tool-calls` assertion for `^task$` and the exact `agent_type`, then
   a subagent-scoped outcome assertion. MCP tools require a `tool-calls` rule
   with the tool name and its actual `result`. Hooks need a `program` or
   `file-*` grader that checks their real effects. Extensions need an MCP
   transport that drives the real extension code, a `program` grader, and a
   `tags.boundary` saying what the eval does and doesn't prove. The default
   agent's answer isn't proof that the intended custom agent ran.
4. Tag every case with its asset identities and `tags.control: positive` or
   `negative`. Tag a representative positive case with `suite: smoke`. Run
   `npm run verify`, then run the relevant eval, inspect its trajectory, and
   confirm a wrong outcome would fail the graders.

| Asset | `tags.assets` identity | Source layout |
|---|---|---|
| Skill | `skill:<plugin>/<skill-name>` | `plugins/<plugin>/skills/<skill-name>/SKILL.md` |
| Custom agent | `agent:<plugin>/<agent-name>` | `plugins/<plugin>/com.github.copilot/agents/<agent-name>.agent.md` |
| Hook | `hook:<plugin>/<event-name>` | `plugins/<plugin>/com.github.copilot/hooks/hooks.json` |
| Canvas extension | `extension:<plugin>/<extension>` | `plugins/<plugin>/com.github.copilot/extensions/<extension>/extension.mjs` |
| MCP tool | `mcp:<plugin>/<server-name>/<tool-name>` | `plugins/<plugin>/mcp.json` |

The coverage checker discovers every local skill, agent, hook, extension, and
MCP tool. It starts each local MCP server to read its real tool list. Each asset
needs a positive case with invocation and outcome assertions, smoke coverage,
and a negative control with an observable assertion. For an MCP tool, that's a
real call with an asserted error or result, or a `tool-calls` rule that
disallows the tool. A tag alone isn't coverage. Stimulus names must be unique
across all specs so saved results map to one case. The shipped examples carry a
few extra checks tied to their exact asset IDs; they disappear when you rename
or remove the example.

Suites are conventions, not fixed names. This repository's `smoke` suite
selects cases tagged `suite: smoke`, and `full` runs every spec. Upstream
github/evals examples filter on `lane: ci` instead. A `tags.suite` value must
match a suite filter in `.vally.yaml`, and every asset needs a case in `smoke`
because CI runs it by default.

Slash commands, rules, and LSP servers aren't model-invoked the way skills,
agents, and tools are, so the coverage checker doesn't require evals for them.
Test them by hand in the hosts you support.

Run one spec without launching the full suite:

```sh
node scripts/evals.mjs eval --eval-spec evals/bug-report/eval.yaml
```

Use the [Vally eval schema](https://microsoft.github.io/vally/reference/eval-spec/)
for fields and [grader catalog](https://microsoft.github.io/vally/reference/graders/)
for assertions. Existing specs show template routing, output checks, hook
effects, agent delegation, MCP results, and negative controls.

### How the harness loads assets

The [launcher](scripts/evals.mjs) runs Vally's `copilot-sdk` executor with the
pinned full Copilot CLI. The SDK's bundled standalone runtime can discover a
custom agent but rejects running it, so the launcher sets `COPILOT_CLI_PATH` to a
small [runtime bridge](scripts/eval-runtime.js) that starts the pinned
`@github/copilot` runtime. The bridge mounts each directory listed in an eval's
`STARTER_PLUGIN_DIRS` with the documented `--plugin-dir` option, so hook cases
load the real plugin. It doesn't depend on an interactive folder-trust prompt or
a global plugin installation.

MCP processes don't necessarily start in this checkout, so the launcher reads
`params` from `.vally.yaml` and passes every value that contains a slash as an
absolute path. Other params pass through unchanged. The `MARKETPLACE_VALLY_CLI`
param gives the authoring grader the pinned Vally CLI's absolute path as an
argument rather than relying on npm having changed `PATH`.

### MCP-based canvas evaluation

The [brainstorm fixture](evals/support/brainstorm-host.mjs) uses MCP only as an
evaluation transport. It follows the existing SDK contract-test approach:
three transport exports stand in for the host, while the actual extension,
board logic, HTTP server, and lifecycle callbacks run unchanged. It starts with
one synthetic note, keeps state only for that eval session, and closes its
servers on completion. It exposes no native window and returns no localhost URL
to the model. It isn't an installable MCP plugin or a vendored runtime SDK.

Only the canvas cases connect to it. The separate no-canvas case still checks
the skill's honest chat fallback. Neither the headless fixture nor the
model-free contract tests certify native Copilot App or VS Code rendering.

### Results

Each local run writes JSONL results, a Markdown report, JUnit, and session
evidence under a timestamped `vally-results/` directory. Report on it with the
same selection you ran: `npm run eval:report -- --suite smoke` after
`npm run eval:smoke`, `--suite full` after `npm run eval`, or
`--eval-spec evals/bug-report/eval.yaml` after running one spec. `--suite`
accepts any suite in `.vally.yaml`. `--run-dir PATH` selects a saved run
explicitly. An incomplete run, unexpected skip, runtime error, or grader
infrastructure error fails reporting. Valid failed behavioral verdicts remain
visible but don't fail the command by default. Add `--require-pass` to the eval
command when you want those verdicts to fail too.

Use `npm run eval:grade -- --help` to see Vally's saved-evidence grading options.
Re-grading code-based assertions doesn't require another model run.

## Continuous integration

### Deterministic checks

[validate.yml](.github/workflows/validate.yml) runs `npm ci` and `npm run verify`
on Linux, Windows, and macOS with Node.js 22 and 24 for every push and pull
request. It never invokes a model or needs a token beyond read access.

### Behavioral evals with the Evals Action

[evals.yml](.github/workflows/evals.yml) runs the `smoke` suite on
same-repository pull requests that touch plugins, evals, schemas, scripts, or
dependencies. You can also run it manually and choose `smoke` or `full`. Fork
pull requests never get credentialed eval runs, and there's no
`pull_request_target` trigger.

The workflow uses [`github/evals-action`](https://github.com/github/evals-action)
v0.1.0, pinned to its full commit SHA like every other action here. In its
default mode the Action lints the project, runs the selected suite if lint
passes, uploads a structured report, and updates one sticky pull request
comment. The Action installs only Vally, pinned to the same version as
`package.json`. Its lint isn't `--strict` and doesn't lint skill directories, so
`npm run verify` stays the authoritative gate. Before it runs, the workflow:

1. Sets up Node.js 24, the newest major that `validate.yml` tests, and runs
   `npm ci` so graders, the brainstorm MCP host, and the pinned full Copilot
   runtime are available.
2. Runs `node scripts/evals.mjs action-params`. The Action can't pass `--param`,
   so this writes gitignored eval-level params files (`eval.params.yaml`, or
   `<name>.eval.params.yaml` beside a `<name>.eval.yaml`) with this runner's
   absolute paths. Vally merges them over the relative `.vally.yaml` defaults.
   Generated files start with a header comment. A params file you wrote yourself
   has no header, so action-params stops with an error instead of overwriting it;
   commit such a file with `git add -f`, and keep path params in `.vally.yaml`.
3. Checks that the runtime bridge starts the pinned runtime, so a broken install
   fails fast with a clear error.
4. Sets `COPILOT_CLI_PATH` to the runtime bridge and names it in
   `credential-env`. That's a workaround: the Action forwards only an allowlist
   of variables to Vally, and `credential-env` is its only way to pass another
   one. It forwards those names to the run phase only, not to lint. The value is
   a non-secret path. Every other path, including the pinned Vally CLI for the
   authoring grader, travels through `.vally.yaml` params instead. If a future
   Action release adds a way to pass non-secret variables, switch to it.

Because `credential-env` is set, the workflow passes `copilot-token` explicitly.
The job token needs `copilot-requests: write` for inference and
`pull-requests: write` for the comment. In this all-in-one mode, eval tools can
reach a token that can also comment on pull requests; see the Action's README for
the separate lint, run, and report jobs if you need narrower permissions. Keep
the job's `concurrency` block as shown; the Action requires it.

Under the Action, any failed behavioral verdict fails the job, unlike the
report-only default of `npm run eval:report`. The workflow keeps one bounded
retry and one worker. `upload-transcripts` stays `false` because raw transcripts
can contain prompts, model output, and code. Set it to `true` temporarily when
you need to debug a run, and review who can read workflow artifacts.

Before enabling the workflow, check these requirements:

- `github/evals-action` is private and shared with the GitHub organization. Your
  repository's Actions policy must allow it.
- Organization-owned repositories need **Allow use of Copilot CLI billed to the
  organization** enabled. Usage is billed to the organization or, for a personal
  repository, the owner's Copilot seat. Opening or updating a pull request can
  start a paid run.
- The Action supports Linux x64 GitHub-hosted runners only.

See the [Copilot CLI in Actions guidance](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions)
and [Vally's CI guide](https://microsoft.github.io/vally/get-started/add-to-ci/).

## Validation and compatibility

`npm run verify` validates manifests and `mcp.json` files against vendored copies
of the official Agent Plugins 1.0 JSON Schemas, catalog/version consistency,
skill and agent metadata and locations, MCP server containment, Markdown links,
repository marketplace settings, hook layout, TypeScript types, and JavaScript
syntax. It checks that the committed MCP bundle and authoring grader match a
fresh build. Tests exercise board behavior, the loopback HTTP server, extension
lifecycle through an SDK contract harness, page focus behavior through a minimal
DOM harness, the formatter hook process, the MCP server over real stdio from a
relocated copy, isolated installation of each plugin with a temporary Copilot
home, eval coverage rules, graders, and result reporting.

The [bug-report smoke checks](plugins/bug-report/README.md#smoke-checks) are also
encoded in the model-backed evals. Real model execution stays separate from
offline verification.

Before a release, smoke-test **both hosts**:

- Open this trusted checkout and confirm all six plugins are enabled without
  global installation. Confirm the skills and the reviewer agent are discovered.
- Install from GitHub in a separate test environment and confirm the same plugins.
- Open the canvas; add, edit, move, and delete notes from the UI and agent.
- Reopen the same panel and confirm notes remain. A new session starts empty.
- Keep keyboard focus on a note control while Copilot edits or moves that note.
  Confirm focus remains there, or returns to the input if the note is deleted.
- Edit JSON using single-file edits, multi-file edits, and `apply_patch`.
  Confirm two-space formatting, a final newline, and changed-file reporting.
- Check that failed edits and unrelated files are untouched. Invalid JSON must
  stay unchanged with a visible diagnostic. Already formatted JSON isn't rewritten.
- Ask the JSON configuration skill to validate and look up a value, and confirm
  the MCP tools run.

Automated contract tests don't substitute for these host checks. Canvas
presentation and full end-to-end VS Code and CLI behavior must be verified in the
versions your team deploys.

## Licensing

The starter is [MIT licensed](LICENSE). The `customization-authoring`,
`code-review`, and `json-configuration` plugins each carry their own MIT
`LICENSE`. The vendored Agent Plugins schemas keep their Apache-2.0
[license](schemas/LICENSE-APACHE-2.0.txt) and [notice](schemas/NOTICE). Bundled
dependencies keep their notices beside the generated files.

## References

- [Agent Plugins standard](https://agent-plugins.org/)
- [GitHub Copilot plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins)
- [Shared runtime hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [VS Code agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)
- [Agent Skills specification](https://agentskills.io/specification)
- [Evals Action](https://github.com/github/evals-action)
