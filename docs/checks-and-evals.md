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
[Vally](https://microsoft.github.io/vally/) CLI. A remote-only marketplace can
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

Skill evals use Vally's built-in `skill-invocation` grader: `required` for every
positive and boundary case, and `disallowed` for negative cases. Invocation
credit requires a matching `skill_activation` event. Successful file reads,
searches, path mentions, and completed answers do not count as invocation.
Custom program graders independently check the resulting files, output, and
side effects.

The `plugin-reviewer` eval needs the full Copilot CLI installed by `npm ci`.
Point `COPILOT_CLI_PATH` at that pinned CLI before running the smoke suite.

### Standard model roster

[The native experiment](../evals/standard-models.experiment.yaml) is the single
source for the standard model roster: `claude-sonnet-5.5` and `gpt-6.1-terra`.
When adopting the template, replace `matrix.model.values` with your own model
IDs and set `baseline.model` to one of them. Vally requires at least two variants;
for a single model, use `npm run eval -- --model <model-id>` instead.

After setting `COPILOT_CLI_PATH` as shown below, preview the selected evals,
variants and configuration hashes without running setup, Docker or a model:

```sh
npm run eval:models -- --dry-run
```

`npm run eval:models` executes the planned variants and spends AI credits for
each case under each model. The two-model roster is not a guarantee of account
access or a quality claim. The baseline identifies the experiment's control,
not a preferred winner; the command does not invoke an extra comparison judge.
Only the model varies, preserving the evals, graders, fixtures and shared
marketplace environment. The existing single-model commands and Actions do
not consume this experiment.

Vally 0.19 experiments have a separate output flag rather than reading
`paths.results`. The npm command explicitly writes timestamped per-variant
results under `evals/results/standard-models/`. If you customize the output
location, update the command's `--output-dir` too.

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
