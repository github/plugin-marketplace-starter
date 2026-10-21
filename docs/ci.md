# Continuous integration

Two workflows ship with the template.

## Deterministic checks

[validate.yml](../.github/workflows/validate.yml) runs `npm ci` and
`npm run verify` on Linux, Windows, and macOS with Node.js 22 and 24 for every
push and pull request. It never calls a model and needs only read access. On
its own, it's enough to keep the marketplace consistent.

## Behavioral evals

[evals.yml](../.github/workflows/evals.yml) runs the eval suites with real
Copilot sessions, so it costs AI credits. It's off for pull requests until you
turn it on.

### Turn it on

1. Check the [requirements](#requirements) below.
2. Pick a runner (see the next section). If you use the npm runner, create the
   repository variable `EVALS_RUNNER` with the value `npm`.
3. Try a manual run first: **Actions** > **Behavioral evals** > **Run
   workflow**, and choose `smoke`. Manual runs work whether or not evals are
   turned on for pull requests.
4. To run the `smoke` suite on pull requests, create the repository variable
   `ENABLE_EVALS` with the value `true`. Repository variables live in
   **Settings** > **Secrets and variables** > **Actions** > **Variables**.

Pull request runs start only when all of these hold:

- `ENABLE_EVALS` is `true`.
- The branch is in this repository. Fork pull requests never get credentialed
  eval runs, and there's no `pull_request_target` trigger.
- The pull request isn't a draft. Marking it ready for review starts a run.
- It touches plugins, evals, schemas, scripts, `.vally.yaml`, the package
  files, or the workflow itself.

Runs don't cancel each other, because the Evals Action requires that, so each
push to an open pull request queues one more run. Keep work-in-progress pull
requests as drafts.

### Pick a runner

| | `action` (default) | `npm` |
|---|---|---|
| Set `EVALS_RUNNER` to | nothing, or `action` | `npm` |
| Runs | [`github/evals-action`](https://github.com/github/evals-action) v0.1.0 | `node scripts/evals.mjs eval --suite <suite> --require-pass` |
| Who can use it | Repositories in the GitHub organization. The Action is private and shared only there, so other organizations can't use it. | Any repository |
| Report | Structured report and one sticky pull request comment | The job summary |
| Job token permissions | `contents: read`, `copilot-requests: write`, `pull-requests: write` | `contents: read`, `copilot-requests: write` |

The two runners are separate jobs, because a job downloads every action it
names before it starts, even ones in skipped steps. With `EVALS_RUNNER=npm`, the
private Action is never downloaded.

Both fail the job on a failed verdict, an incomplete run, or an infrastructure
error, unlike the report-only default of `npm run eval:report` locally. Both use
one worker and one bounded retry, and both start by printing the pinned Copilot
CLI version and the version that actually runs.

#### The Evals Action

In its default mode the Action lints the project, runs the selected suite if
lint passes, uploads a structured report, and updates one sticky pull request
comment. It installs only Vally, pinned to the same version as `package.json`.
Its lint isn't `--strict` and doesn't lint skill directories, so
`npm run verify` stays the authoritative gate. Before it runs, the job:

1. Sets up Node.js 24 and runs `npm ci`, so graders, eval MCP hosts, and the
   pinned full Copilot runtime are available.
2. Runs `node scripts/evals.mjs action-params`. The Action can't pass
   `--param`, so this writes gitignored eval-level params files
   (`eval.params.yaml`, or `<name>.eval.params.yaml` beside a
   `<name>.eval.yaml`) with the runner's absolute paths. Vally merges them over
   the relative `.vally.yaml` defaults. A params file you wrote yourself has no
   generated header, so `action-params` stops instead of overwriting it.
3. Checks that the runtime bridge starts the pinned runtime.
4. Sets `COPILOT_CLI_PATH` to the runtime bridge and names it in
   `credential-env`. That's a workaround: the Action forwards only an allowlist
   of variables to Vally, and `credential-env` is its only way to pass another
   one, during the run phase. The value is a non-secret path. Because
   `credential-env` is set, the workflow passes `copilot-token` explicitly.

`upload-transcripts` stays `false` because raw transcripts can contain prompts,
model output, and code. Set it to `true` temporarily when you need to debug a
run, and review who can read workflow artifacts. See the Action's README for
separate lint, run, and report jobs if you need narrower permissions.

#### The npm runner

The npm runner uses the same launcher you use locally, with the job's
`GITHUB_TOKEN` passed to the Copilot runtime, as
[Vally's CI guide](https://microsoft.github.io/vally/get-started/add-to-ci/)
describes. It writes the report to the job summary. Its results include
transcripts, so it uploads them as an artifact only when you set the
repository variable `EVALS_UPLOAD_RESULTS` to `true`.

## Requirements

- **Organization billing policy.** In an organization-owned repository, the job
  token's Copilot usage is billed to the organization. An organization owner
  must allow it: **Organization settings** > **Copilot** > **Policies** >
  **Copilot CLI** > **Allow use of Copilot CLI billed to the organization**.
  It's on by default for organizations with Copilot CLI turned on, and an
  enterprise policy can override it. In a personal repository, usage is billed
  to the owner's Copilot plan. See
  [Copilot CLI in GitHub Actions](https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/copilot-cli-in-github-actions)
  and [managing Copilot policies](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-organization/manage-policies).
- **`copilot-requests: write`.** The workflow grants this job permission so the
  token can make Copilot requests. See
  [using Copilot CLI in GitHub Actions with GITHUB_TOKEN](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions).
- **Runners.** The Evals Action supports Linux x64 GitHub-hosted runners only.
  Both jobs use `ubuntu-latest`.
- **Actions policy.** If your organization restricts which actions can run,
  allow the actions the workflow pins: `actions/checkout`, `actions/setup-node`,
  `actions/upload-artifact`, and, for the default runner, `github/evals-action`.

## Cost

Each case runs at least one Copilot session with `gpt-5.4-mini`, and a retried
case runs again. `npm run eval:check` prints how many cases each suite has; in
the starter, `smoke` has 8 and `full` has 21. Copilot bills model usage in AI
credits based on the model and tokens used, so a case that delegates to an
agent or edits files costs more than a one-turn chat case. When usage is billed
to the organization, user-level Copilot budgets don't apply; use cost centers
and the organization's usage dashboards instead. See
[usage-based billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/billing).
After your first manual run, check the dashboard to learn what a run costs.

## Security

Same-repository pull requests run their own versions of plugin hooks, MCP
servers, graders, and scripts with the eval job's token. Before you turn on
`ENABLE_EVALS`:

- Protect the default branch with
  [branch protection or a ruleset](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
  that requires review and the `Validate marketplace` checks.
- Set [code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
  for `.github/workflows/`, `scripts/`, `evals/`, `plugins/`, `marketplace.json`,
  and `.github/copilot/settings.json`, and require their review in the rule. A
  `CODEOWNERS` file alone doesn't enforce anything.
- Every action is pinned to a full commit SHA, and checkout doesn't persist
  credentials. Keep it that way.

## Turn evals off

Leave `ENABLE_EVALS` unset, or delete it, and pull requests won't run evals.
To remove them from CI completely, delete `.github/workflows/evals.yml`;
`validate.yml` still checks everything that doesn't need a model, and you can
still run evals locally.
