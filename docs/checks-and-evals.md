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

### Customizing evals and marketplace context

The checks and PR selector discover catalog entries rather than assuming the
bundled plugin names. Local skill comparisons use
`plugins/<plugin>/skills/<skill>/SKILL.md` and
`evals/<plugin>/skills/<skill>/eval.yaml`; both source versions must exist.
Other eval names can be discovered by native Vally, but are not automatically
paired by this PR integration. Agents and newly added/deleted skills are not
Before/After pairs under this policy.

The native shared context is explicit, not generated from the catalog. When
adding/removing local skills, update `environments.marketplace.skills` in
`.vally.yaml` and affected `disallowed` lists. Remote context uses the reviewed
pinned staging commands there; update them when changing the remote context.
The comment inventory reads standard `skills/<name>/SKILL.md` folders from exact
pinned GitHub trees, without installing plugins. A remote-pin-only change does
not trigger the local-skill comparison workflow. This is not arbitrary plugin
layout support or automatic activation of hooks, agents or MCP tools.

## Paid evals

**These runs start real Copilot sessions and spend AI credits.**
Complete the [Docker and scoped authentication setup](#native-docker-evals)
before running any example. An existing host login or ambient token is not
container authentication isolation.

Docker execution readiness means every selected case finishes task execution
and grading without execution or grading errors. A completed behavioral
**FAIL** is still a valid graded result, not an infrastructure error; preserve
it for follow-up rather than changing skills, graders, or thresholds to force
a pass. Commands using `--require-pass`, including the manual workflow,
also require passing behavioral verdicts and can therefore exit unsuccessfully
even when Docker execution and grading completed correctly.

Skill evals use Vally's built-in `skill-invocation` grader: `required` for every
positive and boundary case, and `disallowed` for negative cases. Invocation
credit requires a matching `skill_activation` event. Successful file reads,
searches, path mentions, and completed answers do not count as invocation.
Custom program graders independently check the resulting files, output, and
side effects.

Repository evals use the Docker backend selected in
[.vally.yaml](../.vally.yaml). The appliance supplies its own executor runtime;
do not forward a host `COPILOT_CLI_PATH` into a Linux container. The independent
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

### Native Docker evals

**These are real Copilot runs and still spend AI credits.** Use Vally 0.21.0's
native [`docker` backend](https://microsoft.github.io/vally/guides/running-evals-in-docker/)
through the repository's `defaults.backend` configuration. It applies to all
seven saved evals, including explicit `--eval-spec` runs, `--suite full`, and
the manual Actions workflow. The current graders are deterministic, so the
project also defaults grading to `grade-network: none`. Missing Docker, an
inaccessible daemon, or failed appliance preparation is an error, not permission
to use the local backend.

The pinned Evals plugin's full-engine project reader rejects the
`defaults.backend` field before Run can execute. Thus plugin Run is currently
unsupported for this repository configuration, **not** an alternate Docker
launcher or a local fallback. Its Setup writer only covers paths and suites;
this advanced native setting is maintained in `.vally.yaml`. Upstream plugin
support is needed before its Run entrypoint can honor this Docker default.

After `npm ci`, make sure `docker` is on `PATH`, your account can access a
running **Linux** Docker daemon, and `docker compose version` succeeds. The
first uncached run needs network access and enough disk space to build Vally's
default appliance. Vally builds it from the installed core package and caches
it as `vally-task:<content-hash>`. Its image/core versions must match exactly;
let Vally select/build the image after upgrades rather than reusing an older
registry image. No repository Dockerfile or manual image rebuild is needed.
Host npm connectivity does not prove registry connectivity inside Docker's
build environment. Resolve build-network or certificate-trust failures before
running; do not disable TLS verification.

On restricted-registry networks, Vally 0.21.0's default builder does not inherit
host `.npmrc` files or expose an npm-registry build override. A separately
reviewed, version-matched custom image can be selected explicitly with
`--backend docker --backend-args task-image=<immutable-image-id>` and the
intended role-network arguments described below. A successful run with that
image verifies native task/grade execution, **not** the unmodified default-image
bootstrap. Never tag a modified recipe with Vally's canonical default cache tag.

The container uses an isolated Copilot home and cannot reuse the host's
interactive Copilot login. Vally automatically forwards the recognized model
authentication variables (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`)
to the task when using `copilot-sdk`. Use only the credential you intend to
expose. For local evals, use a dedicated
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
authentication. The retained Docker validation used a separately approved broad
`gh` credential; it is not evidence that these narrower credentials were tested.

This uses the eval's declared model and one trial per case. The native image
supplies its own executor runtime, distinct from the host's pinned Copilot CLI.

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

Native precedence is CLI backend, then eval backend, then project backend.
An explicit `--backend` replaces the project backend argument layer. When
using an independently reviewed custom image, repeat the intended role policy,
for example `--backend docker --backend-args task-image=<immutable-image-id>
--backend-args grade-network=none`; do not assume project arguments survive the
explicit override. No existing eval overrides the Docker project default.

Know the boundary before approving a run:

- The host still runs Vally orchestration and trusted build/setup tooling.
  Task execution and grading use separate containers and workspaces, even
  when they share the cached image. Hidden grading files are not staged into
  the task; grading receives captured task evidence. Graders within one trial
  share their grade environment and must treat agent-authored files as untrusted.
- Task and grade roles run as non-root with capabilities dropped and
  `no-new-privileges`. Vally also uses root-running initialization/evidence
  helpers with limited capabilities; Docker is not protection against every
  kernel escape or a substitute for reviewing trusted code.
- Vally's built-in role-network defaults are Docker's normal network, **not offline**.
  The task needs network for Copilot and the shared marketplace environment's
  pinned remote-skill fetch. `task-network=none` is only suitable for a
  self-contained model-free probe. The project sets `grade-network=none`
  because the current repository graders are deterministic; LLM or network-dependent
  graders need their own reviewed networking and credentials.
- The task can read and use its forwarded model credential and reach allowed
  network services. Custom `task-env` and `grade-env` forwards are role-specific;
  never forward judge secrets to the task. Review eval setup commands, network
  effects, and credentials separately from the container boundary.
- Vally exports task workspaces and releases trial resources. Check warnings
  for preserved host paths or `docker-volume://` recovery locations if export
  or cleanup fails. An interrupted host or daemon can leave resources behind;
  do not remove other runs' containers or volumes.

### Standard model roster

[The native experiment](../evals/standard-models.experiment.yaml) is the single
source for the standard model roster: `claude-sonnet-5.5` and `gpt-6.1-terra`.
When adopting the template, replace `matrix.model.values` with your own model
IDs and set `baseline.model` to one of them. Vally requires at least two variants;
for a single model, use `npm run eval -- --model <model-id>` instead.

After `npm ci`, preview the selected evals, variants and configuration hashes
without running setup, Docker or a model:

```sh
npm run eval:models -- --dry-run
```

`npm run eval:models` executes the planned variants and spends AI credits for
each case under each model. Use the same Docker prerequisites and scoped
authentication above; the experiment inherits the project Docker backend and
offline grading default, without forwarding a host `COPILOT_CLI_PATH`.
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
[.vally.yaml](../.vally.yaml), currently `evals/results/`. Native run directories
contain `results.jsonl` and the saved trajectory artifacts. Copilot can help
inspect a selected run or choose the appropriate native command.

View reports in Vally's built-in dashboard without calling a model:

```sh
npm run eval:serve
```

This is just `vally serve evals/results`, using the native
[`serve`](https://microsoft.github.io/vally/reference/cli/serve/) command.
Open `http://127.0.0.1:3200`; keep the default loopback binding because saved
trajectories and grader evidence can contain sensitive data. The pinned
`@microsoft/vally-cli` 0.21.0 includes `@microsoft/vally-server` as a dependency:
`npm ci` installs it, with no separate server package required.
If you change the results directory, update the alias or run
`vally serve <directory>` directly. Experiments use their explicit output
directory, as described above.

For native judged comparison, supply real baseline and treatment run directories
or JSONL files:

```sh
npm run eval:compare -- --baseline path/to/baseline-run --treatment path/to/treatment-run
```

This is `vally compare`, not a custom result parser. It pairs saved trajectories
and calls a comparison judge using their rubrics, so **it spends AI credits**.
You can instead supply a native experiment output directory, or use
`--judge-model` and `--output` as documented in
[`compare`](https://microsoft.github.io/vally/reference/cli/compare/).
Viewing results and PR comment publication do not automatically invoke this
judge. No local Markdown report implementation is maintained here.

[Evals](../.github/workflows/evals.yml) runs the smoke suite only when you
explicitly start it with **Run workflow** in GitHub Actions
(`workflow_dispatch`). Review the selected branch and its eval code before
dispatching a run.

[Skill evals](../.github/workflows/skill-evals.yml) is a read-only PR notification
for plugin skill changes. The
[trusted default-branch workflow](../.github/workflows/skill-eval-comment.yml)
uses the standard
[unprivileged PR / trusted `workflow_run` pattern](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).
It calls the pinned Evals Action `comparison` subaction for authentication,
paired native execution and publication. Repository-specific selection and
approval policy stay here; the generic runner, projection and comment machinery
do not.

### PR comparison comment

All three calls use `github/evals-action/comparison` at
`3c8cdb79a1e55b149950627a21e8723817d0e772`. The
[pinned Action contract](https://github.com/github/evals-action/blob/3c8cdb79a1e55b149950627a21e8723817d0e772/comparison/README.md)
owns source-workflow/run/attempt authentication, verified merge parents,
source switching, native verdict projection, bounded artifact intake and the
bot-owned comment. The existing root Action's event policy is unchanged.
This pin is the accessible implementation from
[github/evals-action#28](https://github.com/github/evals-action/pull/28), addressing
[github/evals-action#26](https://github.com/github/evals-action/issues/26);
it is an **unmerged upstream dependency**, not a released or live-qualified
integration. Review that dependency before deployment. Both workflows and the
trusted selector must reach the default branch before automatic activation.

The [repository selector](../.github/scripts/select-skill-evals.mjs) verifies the
merge checkout, required environment reviewers and changed skill paths without
executing candidate scripts. Before uses the current merge's first parent, not
possibly stale PR base metadata. Eligible pairs require both skill versions and
`evals/<plugin>/skills/<skill>/eval.yaml`. New, deleted and unpaired skills are
explicitly not run. Local skill folders and exact pinned remote GitHub trees
supply the display inventory without installing plugins. Loading neighboring
skill context does not evaluate those skills or enable full plugin hooks/MCP.
Skills, evals, fixtures, graders, catalog, models and native configuration remain
repository-owned. Local results use Vally's native dashboard and comparison
commands above.

The protected job runs native Vally **0.21.0** sequentially with the saved model,
one trial/worker and zero retries. Only the target skill switches between
base/head sources; measurements and neighbors stay at the selected merge.
Before failure does not prevent After, and either failed/incomplete arm keeps
the job failed. The Action's Node 24 runtime acquires native tools outside the
candidate checkout with install scripts disabled and a job-private generated
integrity lock. Both arms share one acquired dependency graph; recorded
CLI/lock/dependency digests are in the job summary. Unlike the previous trusted
committed-lock bootstrap, transitive resolution can differ **across jobs**.
Candidate manifests are not bootstrap inputs. Native backend configuration,
including this repository's Docker defaults, is honored; container bootstrap,
the Copilot Evals plugin's separate Run entrypoint and runtime parity retain the
[earlier documented limits](#native-docker-evals).

Repository policy stays visible in the workflow: same-repository PRs only,
read-only selection, the protected `evals` environment, job permissions,
timeouts, retention and concurrency. Owners must configure required reviewers
and permit CI-token billing. Missing/unprotected environments fail preflight.
The paid job has read-only repository/PR/Actions access and
`copilot-requests: write`, but no PR-write access. The fresh publisher has
PR-write access but no billing permission and performs no checkout or candidate
execution. Approval intentionally allows candidate eval/setup/grader code to
execute with the model credential. Fresh HOME/TMP and a narrow environment are
process hygiene, not credential, network or shared-kernel isolation.
Environment reviewers protect this job, not arbitrary workflows authorized
editors could add; a workflow-token permission is not an environment secret or
an organization-wide billing ceiling. No settings/authentication policy changes
or `pull_request_target` are introduced.

Paid concurrency uses authenticated PR/head/skill outputs. Same-head duplicates
can cancel; a newer head does not immediately cancel an old in-flight arm.
The Action rechecks current PR/head after approval and before each paid arm,
blocking the next stale arm and stale publication, not undoing requests already
billed. Publishers serialize by verified PR without cancellation; producing
run/attempt order prevents older comments overwriting newer results.
**Partial paid retries are unsupported: use Re-run all jobs.** Publisher-only
retries reuse the original selection producing attempt without repeating models.

The approved comment retains per-changed-skill case/model tables showing
Before → After **passing/total graders**, visible After failures, collapsed
Before failures and collapsed marketplace **passing/total recorded cases**.
Missing checks, grading errors and incomplete coverage remain unknown rather
than resolved failures; known failures remain visible. These single-trial
observations do not establish causation or full-cohort/multi-model coverage.
The Action contract documents the complete evidence and rendering rules.

Only selection metadata and the Action's exact Before/After JSON projection
paths are uploaded, with seven-day retention subject to repository policy.
Never upload its private `projection-directory` recursively: it also holds raw
diagnostics. The publisher independently authenticates context and the exact
trusted selection/producing attempt; artifacts remain untrusted data, not
independent attestations of candidate code. Raw trajectories, model output,
grader evidence, exceptions and transcripts are not posted or uploaded.
Displayed eval/model/check names must themselves be suitable for publication.
Model-free checks do not prove live `workflow_run`, token acceptance, protected
approval, Docker execution or billing; those need separately authorized
qualification.
