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

[Skill evals](../.github/workflows/skill-evals.yml) compares each changed existing
plugin skill with its version on current `main`. It uses the same PR merge
revision's evals, graders, fixtures and shared marketplace context for both runs;
only the selected skill comes from the exact base-parent or PR-head commit.
Both Action invocations run sequentially in one job, reusing the Action's verified
Vally installation. They use one trial per case and no trial retries. A failed
before verdict does not prevent the after run; failures remain visible, without
a new regression-only gate or statistical claim.

The workflow uses Vally 0.21, so native project Docker defaults are honored
when configured. It does not configure or bypass the Copilot Evals plugin's
separate Run entrypoint. The Action manages its runtime dependencies; parity
with the locally pinned Copilot CLI is not assumed.

A maintainer must first configure the `evals` environment with required
reviewers and review the PR's workflow, eval code and billing effects before
approval. The read-only selection job refuses missing or unprotected
environments, rather than automatically creating an unprotected environment.
Same-repository PRs are trusted code with model-billing permission, not an
OS/network sandbox; fork PRs are excluded and `pull_request_target` is not used.
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
A missing counterpart is unknown, not a resolved failure. Partial failed-check
evidence stays visible without claiming an improvement or regression.

The small presentation helper reads the pinned Action's local native JSONL logs
and uploads only case/model identities, verdicts and safe check explanations.
Raw trajectories, outputs, grader evidence, exceptions and transcripts are not
uploaded or copied into comments. Failure reasons describe the check that
failed, not a generated diagnosis; the evidence link leads to this workflow's
native summaries and derived artifacts. Structured/derived artifacts use seven-day
retention, subject to repository policy.

Publication follows GitHub's standard
[unprivileged PR / trusted `workflow_run` pattern](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/).
The PR's selection/collection code has no comment-write permission. The separate
[publisher](../.github/workflows/skill-eval-comment.yml) runs its workflow and
helper from its exact default-branch `GITHUB_SHA`, with `contents: read`,
`actions: read`, and `pull-requests: write`, but no model-billing permission.
It never checks out the PR, installs PR dependencies, runs its grader/setup code,
or executes downloaded artifacts. This workflow and helper must first be merged
into the default branch before automatic publication can run.

Artifacts are untrusted data, not trusted because `workflow_run` downloaded
them. Downloads select the triggering run and its producing attempt, into
temporary storage outside the executable checkout. The trusted helper verifies
the source workflow path, repository, completed PR event, run/attempt, PR
association, current PR head, and merge parents against GitHub's API. It reads
only bounded regular JSON files at expected names, validates case/check shapes,
escapes labels, and derives failure explanations instead of trusting arbitrary
artifact messages. Mixed, malformed, oversized, or ambiguous data fails closed.
These checks do not make results supplied by PR-controlled code an independent
attestation of that code's correctness.

Publishing updates only its own bot comment. Per-PR serialization and the
**source** run/attempt order prevent older results replacing newer comments;
the publisher's own run number is not used as measurement provenance.
Workflow-level per-PR concurrency cancels stale producing runs, but cannot undo
already billed model requests. No custom Run button, GitHub App, billing setting,
or branch-protection change is introduced.

**Partial producing-job reruns are unsupported.** Use **Re-run all jobs** so selection and
both paid arms share an attempt and approval. A retry reusing a successful
selection from a previous attempt is rejected before either paid arm, rather
than spending credits and then failing to collect its artifacts. Retrying the
separate publication workflow reuses the original source run/attempt and never
repeats paid evals.

**Approval boundary:** required environment reviewers protect jobs that reference
that environment, not every job an authorized workflow editor could add.
`copilot-requests: write` is a workflow-token permission, not an environment
secret. These declarations are not an immutable organization-wide billing
policy. The publication split fixes comment-write privilege separation, not the
paid job's independent approval boundary.

**Remaining paid-entrypoint gap:** the pinned native Action supports
`pull_request`, `push`, and `workflow_dispatch`, but rejects `workflow_run`
([source](https://github.com/github/evals-action/blob/6e4c077e92194c7e75663d8d782426841047e887/src/policy.ts#L9-L27)).
Paid execution therefore still uses the existing PR-event route and must not be
treated as secure against untrusted workflow editors. Moving that job behind a
trusted `workflow_run` approval gate needs supported Action functionality or the
existing native Vally CLI directly. Do not spoof a PR event or imply that moving
the publisher has also solved billing authorization. No authentication or
organization policy was changed by this publication implementation.
