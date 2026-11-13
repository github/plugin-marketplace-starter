# Checks and evals

Run these commands from the repository root with
[Node.js and npm](../README.md#requirements).

## Model-free checks

```sh
npm ci
npm run lint
```

The lockfile keeps exact versions and integrity hashes without registry-specific
tarball URLs. Preserve existing SHA-512 integrity values for unchanged package
versions: a registry mirror that omits `dist.integrity` can cause npm to replace
them with weaker SHA-1 values from `dist.shasum` during an upgrade. Removing
`resolved` URLs does not require changing integrity values. After changing
dependencies, preserve that format with npm's
[`omit-lockfile-registry-resolved`](https://docs.npmjs.com/cli/v11/using-npm/config/#omit-lockfile-registry-resolved)
option:

```sh
npm install --package-lock-only --ignore-scripts --omit-lockfile-registry-resolved
```

`npm ci` resolves tarball endpoints through the configured registry. A successful
install through a development mirror does not verify public-registry availability.

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
Review the [execution and scoped authentication setup](#execution-and-authentication)
before running any example. The local backend is not a container sandbox.

Execution readiness means every selected case finishes task execution
and grading without execution or grading errors. A completed behavioral
**FAIL** is still a valid graded result, not an infrastructure error; preserve
it for follow-up rather than changing skills, graders, or thresholds to force
a pass. Commands using `--require-pass`, including the manual workflow,
also require passing behavioral verdicts and can therefore exit unsuccessfully
even when execution and grading completed correctly.

Skill evals use Vally's built-in `skill-invocation` grader: `required` for every
positive and boundary case, and `disallowed` for negative cases. Invocation
credit requires a matching `skill_activation` event. Successful file reads,
searches, path mentions, and completed answers do not count as invocation.
Custom program graders independently check the resulting files, output, and
side effects.

Repository evals use Vally's default local backend, with no project-level
backend override in [.vally.yaml](../.vally.yaml). The independent
`plugin-reviewer` eval stages its actual read-only custom agent and requires
delegation through the runtime's task tool. It is included in both normal
discovery and the full suite, not replaced by a companion skill.

The `try-plugin-locally` smoke case prepares a fresh-session `--plugin-dir`
command for the selected plugin in a developer's existing checkout. Vally
already stages the candidate skills. The case checks the selected absolute
local path, preserves the checkout, rejects installation and branch mutations,
and requires an honest unverified discovery/behavior report. It doesn't launch
another session or verify actual host discovery or plugin behavior. Its unrelated
pricing question remains a negative trigger case. Its two-case selection is
shown after the authentication setup below and still spends AI credits. Optional
install-check recipes remain covered by model-free tests. Running a real
installation check still requires the user's exact cleanup confirmation and
host permissions; a headless denial is a blocker, not permission to bypass them.

### Execution and authentication

The starter leaves the backend unset. Native Vally 0.21.0 selects `local` when
no CLI, eval or project backend is specified. This is an intentional compatible
default, not a Docker failure fallback. Explicit eval selections, suites and the
standard-model experiment inherit it.

This marketplace pins the GitHub Copilot Evals plugin **0.24.0**. Its
[full-engine project reader at the pinned commit](https://github.com/github/evals/blob/34ddb5803aeaee8330ab70c19ad1a3f37fb77ded/packages/plugin/dist/mcp/server.mjs),
and the separately checked locally installed **0.24.6** reader, accept
`environments`, `params`, `metadata`, `paths` and `suites`, but reject the
advanced project `defaults` key. The regression check covers this shared root-key
shape, not an installed-version or end-to-end execution test. No plugin upgrade
is included. Tools still require a compatible runner, authentication and run
approval; these source/schema checks do not prove a live paid execution.

Docker, Compose, image preparation and container network settings are not
prerequisites. The evaluator, task setup, tools and graders run on the host.
Disposable workspaces and a narrowly scoped credential do not isolate host
files, other processes, network access or the credential from evaluated code.
Review all declared effects before starting a run.

After `npm ci`, the manual CI workflow selects the repository-pinned Copilot
launcher using `COPILOT_CLI_PATH`. Local runs use the configured native runner.
Use only the authentication you intend to expose. For local evals, use a dedicated
[fine-grained token with the Copilot Requests account permission](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli#authenticating-with-environment-variables):
choose your personal account as resource owner, **Public repositories** access,
and only **Copilot Requests** under account permissions. The synthetic fixtures
and pinned public `github/evals` skill source need no private-repository access
or repository-write permissions. Do not reuse a broad `gh` login token.

For custom evals needing private GitHub access, use **Only select repositories**
where the personal-account token supports the required calls, and review minimum
read permissions. If it cannot meet a required call, review that requirement
separately rather than automatically broadening permissions.
This local user-token recommendation is separate from the manual Actions
workflow's repository/job-scoped `GITHUB_TOKEN` organization billing.

Enter that dedicated token at the hidden local prompt to run this complete
two-case eval (positive and negative), without putting it in a command, file,
shell history or chat. The selected token is still readable by task processes
and can authorize Copilot usage; a narrower scope does not make it harmless.

Bash:

```sh
(
  unset COPILOT_GITHUB_TOKEN GH_TOKEN GITHUB_TOKEN
  read -r -s -p "Copilot Requests-only token: " COPILOT_GITHUB_TOKEN || exit
  printf '\n'
  test -n "$COPILOT_GITHUB_TOKEN" || exit 1
  export COPILOT_GITHUB_TOKEN
  npm run eval -- --eval-spec evals/pr-description/skills/pr-description/eval.yaml --max-retries 0
)
```

PowerShell:

```powershell
$names = 'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'
$original = @{}
foreach ($name in $names) {
  $original[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
  $secret = Read-Host 'Copilot Requests-only token' -AsSecureString
  $token = [System.Net.NetworkCredential]::new('', $secret).Password
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw 'No dedicated Copilot credential was supplied.'
  }
  $env:COPILOT_GITHUB_TOKEN = $token
  npm run eval -- --eval-spec evals/pr-description/skills/pr-description/eval.yaml --max-retries 0
  if ($LASTEXITCODE -ne 0) { throw "Eval exited with code $LASTEXITCODE; inspect its saved results." }
} finally {
  foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $original[$name], 'Process')
  }
  $token = $null
  $secret = $null
}
```

Both examples clear all recognized tokens before selecting the dedicated token.
Bash confines changes to a subshell; PowerShell restores the original values
even if input or the eval fails. Do not enable shell tracing or print these
variables. Model-free recipe checks do not prove token access or actual model
authentication. Earlier Docker validation used a separately approved broad
`gh` credential; it is historical evidence, not validation of these narrower
credentials or this local-default compatibility update. Its saved results are
not changed by removing the default.

This uses the eval's declared model and one trial per case.

To select the two `try-plugin-locally` cases instead, replace only the
`npm run eval` line **inside the same Bash subshell or PowerShell `try` block**
with this line; do not omit the surrounding authentication scope:

```sh
npm run eval -- --eval-spec evals/plugin-authoring/skills/try-plugin-locally/eval.yaml --model claude-haiku-5.5 --require-pass
```

With the same explicitly selected authentication, `npm run eval -- --suite
smoke` selects the smoke cases and `npm run eval -- --suite full --max-retries
0` selects every case. The full suite includes the independent reviewer's
positive delegations and negative no-delegation case. Review its complete
case/model plan and approve its additional AI-credit exposure before starting.

### Standard model roster

[The native experiment](../evals/standard-models.experiment.yaml) is the single
source for the standard model roster: `claude-sonnet-5.5` and `gpt-6.1-terra`.
When adopting the template, replace `matrix.model.values` with your own model
IDs and set `baseline.model` to one of them. Vally requires at least two variants;
for a single model, use `npm run eval -- --model <model-id>` instead.

After `npm ci`, preview the selected evals, variants and configuration hashes
without running setup or a model:

```sh
npm run eval:models -- --dry-run
```

`npm run eval:models` executes the planned variants and spends AI credits for
each case under each model. Use the same scoped authentication above; the
experiment inherits the supported local-backend configuration.
The two-model roster is not a guarantee of account access or a quality claim.
The baseline identifies the experiment's control, not a preferred winner; the
command does not invoke an extra comparison judge. Only the model varies,
preserving the evals, graders, fixtures and shared marketplace environment.
The existing single-model commands and Actions do not consume this experiment.

Native experiments have a separate output flag rather than reading
`paths.results`. The npm command explicitly writes timestamped per-variant
results under `evals/results/standard-models/`. If you customize the output
location, update the command's `--output-dir` too.

### Saved results

For these direct Vally runs, results follow `paths.results` in
[.vally.yaml](../.vally.yaml), currently `evals/results/`. The report command
uses the same configured directory unless you supply an explicit results path.

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
