# Checks and evals

Run these commands from the repository root with
[Node.js and npm](../README.md#requirements).

## Model-free checks

```sh
npm ci
npm run lint
```

`npm run lint` checks local catalog consistency, then checks every skill under
`plugins/` and every eval under `evals/` with the pinned
[Vally](https://microsoft.github.io/vally/) CLI. It also checks the shared
environment's local skill coverage and remote pin paths without accessing the
network. Remote skill completeness is checked during preparation below.
A remote-only marketplace can
omit both directories; schema validation also skips when no local manifests
remain. Regression tests for the bundled maintenance plugins run only while
those local plugins remain. Missing files for a retained plugin still fail.
None of these checks calls a model. [Validate](../.github/workflows/validate.yml) runs on pull requests,
pushes to `main`, and manual dispatch. It also:

- Runs deterministic tests for the CI checks, native skill-invocation and
  local-session guidance graders, and optional local-install recipes.
- Validates each `plugins/*/plugin.json` against the
  [Agent Plugins schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json).
- Rejects catalog entries without a non-empty local source path or a remote
  source object.
- Checks that each local entry in `marketplace.json` matches its `plugin.json`.
- Checks that each remote entry pins an existing commit with a `plugin.json`
  whose name matches, and whose version matches when both specify one.
  When `source.ref` is supplied, it must resolve to that exact pinned commit;
  a missing, moved, or mismatched ref fails validation.
  Private remote repositories need a token that can read them.

Vally lint doesn't validate `marketplace.json` or `plugin.json`. Run the same
metadata checks as CI when you change manifests, the catalog, or remote pins:

```sh
node .github/scripts/check-local-catalog.mjs
bash .github/scripts/validate-schema.sh
node .github/scripts/check-remote-pins.mjs
```

The schema check downloads the Agent Plugins schema and runs
`ajv-cli@5.0.0` through `npx --yes`; review that network/tool execution before
running it. The pin check makes read-only GitHub API calls through your
authenticated `gh` CLI. Neither starts a model.

Remote checks prefer a root manifest declaring a supported Agent Plugins schema
(1.0.0 or 1.1.0); unsupported Agent Plugins versions fail. Otherwise they use
Copilot CLI's legacy order: `.plugin/plugin.json`, `plugin.json`,
`.github/plugin/plugin.json`, then `.claude-plugin/plugin.json`.

The CI checks and their tests live in [.github/scripts/](../.github/scripts/).
Run the tests without calling a model:

```sh
node --test .github/scripts/*.test.mjs
```

The recipe tests can take several minutes. They use fake CLI functions and need both Bash and PowerShell
(`pwsh`), available on CI's Ubuntu runner. For an actual install-only check,
follow the skill's
[local-install guide](../plugins/plugin-authoring/skills/try-plugin-locally/references/local-install.md#test-installation-without-publishing),
which uses its bundled Node helper before invoking Copilot. Installing doesn't
call a model or prove how a plugin behaves in a model session.

## Paid evals

**These runs start real Copilot sessions and spend AI credits.**

### Shared marketplace environment

The six skill evals reference `agent_environment: marketplace`. Its definition in
[.vally.yaml](../.vally.yaml) lists all six local skills and the six skills from
the catalog-pinned remote Evals plugin. Vally merges that skill set with each
case's existing fixtures; grading files stay separate. The independent
`plugin-reviewer` delegation eval is unchanged.

`npm run eval` first runs `npm run eval:prepare`. Preparation makes read-only
GitHub API requests through `gh`, checks remote pins and fetches only skill
sources and their supporting files into ignored `.vally/marketplace/` storage.
It calls no model and does not install plugins, change profiles, run fetched
code, or start plugin MCP servers, hooks or extensions. Use a signed-in `gh`
account that can read the remote repositories. Review the pinned skill sources
before approving an eval; an eval agent can follow their instructions and use
tools.

Preparation fails rather than omitting a missing skill, using a moving ref,
accepting a truncated tree, or reusing modified cached sources. Verified files
are reused at their exact commit. If the cache was changed, remove only the
reported `.vally/marketplace/<plugin>/<sha>/` cache and prepare it again.
Preparation alone is model-free:

```sh
npm run eval:prepare
```

Run this before invoking Vally directly instead of through `npm run eval`.
When adding or removing a skill, update the shared environment. When changing a
remote pin, update its paths to the new SHA and list all skills at that commit.
Update the `marketplace-skills-loaded` grader's expected names in the
`pr-description` eval too. Source paths are relative to the eval directory,
not `.vally.yaml`; the six skill evals currently share the same directory depth.

That positive case checks the native Copilot SDK trajectory's
`metadata.skillsLoaded` inventory for every marketplace skill, alongside its
existing exact target-invocation check. Listed paths and model answers cannot
satisfy the loaded-skill check. Model-free tests exercise native Vally staging
with a test executor and synthetic grader inputs, not a live Copilot session.
An approved paid run is still needed to demonstrate actual runtime loading.
The check's result is stored with the existing grader results.

This is a shared **skills** environment, not full plugin-runtime activation.
It does not establish availability of plugin agents, MCP tools, hooks, extensions
or interactive canvases.

### Running an eval

Skill evals use Vally's built-in `skill-invocation` grader: `required` for every
positive and boundary case, and `disallowed` for negative cases. Invocation
credit requires a matching `skill_activation` event. Successful file reads,
searches, path mentions, and completed answers do not count as invocation.
Custom program graders independently check the resulting files, output, and
side effects.

The `plugin-reviewer` eval needs the full Copilot CLI installed by `npm ci`.
Point `COPILOT_CLI_PATH` at that pinned CLI before running the smoke suite.

The `try-plugin-locally` smoke case prepares a fresh-session `--plugin-dir`
command for the selected plugin in a developer's existing checkout. Vally
already stages the candidate skills. The case checks the selected absolute
local path, preserves the checkout, rejects installation and branch mutations,
and requires an honest unverified discovery/behavior report. It doesn't launch
another session or verify actual host discovery or plugin behavior. Its unrelated
pricing question remains a negative trigger case. To run only these two cases:

```sh
npm run eval -- --eval-spec evals/plugin-authoring/skills/try-plugin-locally/eval.yaml --model claude-haiku-5.5 --require-pass
```

That command still spends AI credits for the agent under test. Optional
install-check recipes remain covered by model-free tests. Running a real
installation check still requires the user's exact cleanup confirmation and
host permissions; a headless denial is a blocker, not permission to bypass them.

Bash:

```sh
export COPILOT_CLI_PATH="$PWD/node_modules/@github/copilot/npm-loader.js"
npm run eval -- --suite smoke
```

PowerShell:

```powershell
$env:COPILOT_CLI_PATH = "$PWD\node_modules\@github\copilot\npm-loader.js"
npm run eval -- --suite smoke
```

For these direct Vally runs, results follow `paths.results` in
[.vally.yaml](../.vally.yaml), currently `vally-results/`.

Summarize the newest saved run (verdicts, scores, input/output/total tokens,
and duration) or compare a baseline run against a candidate run without calling
a model:

```sh
npm run eval:report
npm run eval:compare -- --baseline evals/_shared/fixtures/pr-description/baseline-results.jsonl --candidate evals/_shared/fixtures/pr-description/candidate-results.jsonl
```

[Evals](../.github/workflows/evals.yml) runs the smoke suite only when you
explicitly start it with **Run workflow** in GitHub Actions
(`workflow_dispatch`). Pull requests never start paid evals. Review the
selected branch and its eval code before dispatching a run.
