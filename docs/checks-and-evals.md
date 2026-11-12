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
(`workflow_dispatch`). Review the selected branch and its eval code before
dispatching a run.

[Skill evals](../.github/workflows/skill-evals.yml) is a read-only PR notification
for plugin skill changes. A
[trusted default-branch `workflow_run`](../.github/workflows/skill-eval-comment.yml)
authenticates that source request and the still-current same-repository PR head,
then selects the current PR merge revision and verifies its exact base/head
parents. That selected revision, not the notifier's checkout or the trusted
workflow's own SHA, supplies both arms' evals, graders, fixtures and shared
marketplace context. Only the target skill switches between its exact base/head
sources. The selected revisions are recorded before paid-job approval.
After approval, trusted code rechecks that the PR is still open at the selected
same-repository head immediately before each paid arm. A later closure or push
can still race an already-started request; the check cannot undo billed work.

Both native Vally CLI invocations run sequentially with the saved model, one
trial/worker and zero retries. A failed Before verdict does not prevent After;
failures stay visible without adding a regression-only gate or statistical claim.

The workflow uses Vally 0.21, so native project Docker defaults are honored
when configured. It does not configure or bypass the Copilot Evals plugin's
separate Run entrypoint. The workflow uses Node 24 and copies only the trusted
default-branch revision's `package.json`/lockfile into a separate temporary tool
directory, then uses `npm ci --ignore-scripts`. That locks native CLI `0.21.0`
and its dependency graph without bootstrapping from candidate dependency files
or running install hooks. The lock revision is recorded in the job summary.
This pins dependency integrity, not a guarantee of harmless dependency behavior.
It honors the candidate project's native backend
configuration, including the Docker defaults when present. It does not impose
Docker on projects without those defaults. Container bootstrap, Plugin Run and
host-runtime parity are separate limitations, not proved by these workflow edits.

A maintainer must first configure the `evals` environment with required
reviewers and review the PR's workflow, eval code and billing effects before
approval. The read-only selection job refuses missing or unprotected
environments, rather than automatically creating an unprotected environment.
The paid job intentionally executes candidate eval/setup/grader code with its
model credential after approval. Each arm's Vally process has a separate fresh
home and temporary directory, plus a narrow
environment rather than inherited reporting/Actions credentials. That is process
hygiene, not isolation from other same-user processes or a network/kernel sandbox.
Fork PRs are excluded; `pull_request_target` is not used.
The organization's Copilot billing policy must also permit workflow-token usage.
The workflow changes none of these repository or organization settings.

New or deleted skills and skills without their corresponding
`evals/<plugin>/skills/<skill>/eval.yaml` cannot form a before/after pair. They are
reported as not run, not counted as passing, and do not make evals mandatory for
every catalog skill.

### PR comparison comment

The comment shows one visible table per changed skill. Rows are eval/case
identities; columns are models actually observed in native results. Cells show
Before → After **passing/total graders**. After failures stay visible; Before
failures are collapsed. A separate collapsed marketplace table shows
**passing/total recorded cases**, with nested failure details.

The current workflow evaluates each eligible changed skill separately using its
saved model, not a new model roster or all marketplace evals. Other skill
sources stay fixed at the merge revision in each comparison. Unchanged skills
and remote skills without repo evals remain explicitly not evaluated; loading
their context does not measure regressions. Local `skills/<name>/SKILL.md`
folders and equivalent folders in each remote plugin's exact pinned GitHub tree
provide the inventory, without installing those plugins. Nonstandard remote
skill layouts need an inventory adaptation.

One scenario can pass under its native scoring rule even if some individual
graders fail. New, resolved and persistent failures are distinguished, including
equal totals with changed failure identities. Errors, skipped cases and missing
arms never become passing counts. These single-trial observations do not prove
causation.
Transition labels require two complete arms and the same individual checks.
A complete native arm also requires every declared summary group/count to match
its recorded case/model rows. Missing cases, mismatched totals and grading errors
keep the arm incomplete while preserving any known failed-check details.
A missing counterpart is unknown, not a resolved failure. Partial failed-check
evidence stays visible without claiming an improvement or regression.

The small presentation helper reads the CLI's local native JSONL results
and uploads only case/model identities, verdicts and safe check explanations.
Raw trajectories, outputs, grader evidence, exceptions and transcripts are not
uploaded or copied into comments. Failure reasons describe the check that
failed, not a generated diagnosis; the evidence link leads to this workflow's
attempt and derived artifacts. Structured/derived artifacts use seven-day
retention, subject to repository policy.

Publication follows GitHub's standard
[unprivileged PR / trusted `workflow_run` pattern](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).
The PR workflow grants no model-billing or comment-write permission. Trusted
selection reads candidate files without executing them. The protected paid job
has `contents: read` and `copilot-requests: write`, but no PR-write permission.
A fresh publisher job uses `contents: read`, `actions: read` and
`pull-requests: write`, but no model-billing permission. Its workflow/helper come
from the exact trusted default-branch `GITHUB_SHA`; that job never checks out the
PR, installs its dependencies, runs graders, or executes artifacts. Both workflow
files and the helper must be on the default branch before this automatic path
can run. Model-free checks do not prove live paid execution or publication.

Artifacts are untrusted data, not trusted because `workflow_run` downloaded
them. Downloads select this trusted eval run's actual producing attempt, into
temporary storage outside the executable checkout. The trusted helper verifies
the notifier's source workflow/repository/completed PR event/association against
GitHub's API, separately binds the paid run/attempt/trusted SHA, and checks the
current PR head and selected merge parents. It reads
the selection's coverage only when it exactly matches the trusted pre-execution
job output, so a paid-job artifact cannot silently change the selected skill or
inventory lists. It reads
only bounded regular JSON files at expected names, validates case/check shapes,
escapes labels, and derives failure explanations instead of trusting arbitrary
artifact messages. Mixed, malformed, oversized, or ambiguous data fails closed.
These checks do not make results supplied by PR-controlled code an independent
attestation of that code's correctness.

Publishing updates only its own bot comment. Per-PR serialization and the
**paid producing run/attempt** order prevent older results replacing newer
comments. The notifier run is separately retained, not confused with the run
that measured results. Paid-job concurrency starts only after authenticated
selection and is scoped to the verified PR/head/skill, so a rejected or delayed
old-head notification cannot cancel another head's approved comparison.
Same-head duplicates can be cancelled; a newer PR head does not automatically
cancel an already-running old-head arm. The pre-arm check prevents its next paid
arm, but cannot undo already billed requests. Publisher jobs serialize by
verified PR without cancelling each other. No custom Run button, GitHub App, billing setting,
or branch-protection change is introduced.

**Partial paid-job reruns are unsupported.** Use **Re-run all jobs** so selection and
both paid arms share an attempt and approval. A retry reusing a successful
selection from a previous attempt is rejected before either paid arm, rather
than spending credits and then failing to collect its artifacts. Retrying the
publisher job alone reuses `needs.select.outputs.attempt`, the original selection
and paid evidence, without repeating models. The evidence link includes that
producing attempt; no GitHub event variables are overwritten.

**Approval boundary:** required environment reviewers protect jobs that reference
that environment, not every job an authorized workflow editor could add.
`copilot-requests: write` is a workflow-token permission, not an environment
secret. These declarations are not an immutable organization-wide billing
policy. This template's paid entrypoint and approval declaration now come from
the trusted default branch, not the PR. Owner-controlled Actions/Copilot policy
still determines who can author other workflows and obtain billing permissions;
this template cannot impose an organization-wide permission ceiling. No such
settings or authentication policy is changed here.

**Temporary native CLI entrypoint:** the pinned Evals Action supports
`pull_request`, `push`, and `workflow_dispatch`, but rejects `workflow_run`
([source](https://github.com/github/evals-action/blob/6e4c077e92194c7e75663d8d782426841047e887/src/policy.ts#L9-L27)).
We use the existing Vally CLI directly in the trusted paid job rather than
spoofing a PR event or disabling checkout guards.
[github/evals-action#26](https://github.com/github/evals-action/issues/26) tracks
supported `workflow_run` source-PR/attempt and separate evaluated-revision
handling. Once supported, replace only the native invocation/projection adapter
with the Action, retaining approval, provenance and privilege separation.
