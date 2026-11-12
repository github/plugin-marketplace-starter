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
pricing question remains a negative trigger case. To run only these two cases:

```sh
npm run eval -- --eval-spec evals/plugin-authoring/skills/try-plugin-locally/eval.yaml --model claude-haiku-5.5 --require-pass
```

That command still spends AI credits for the agent under test. Optional
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
expose. For example, with an existing authenticated `gh` account, run this
complete two-case eval (positive and negative), without printing or saving the
token:

Bash:

```sh
export GH_TOKEN="$(gh auth token)"
npm run eval -- --eval-spec evals/pr-description/skills/pr-description/eval.yaml --max-retries 0
unset GH_TOKEN
```

PowerShell:

```powershell
$env:GH_TOKEN = gh auth token
npm run eval -- --eval-spec evals/pr-description/skills/pr-description/eval.yaml --max-retries 0
Remove-Item Env:GH_TOKEN
```

This uses the eval's declared model and one trial per case. The native image
supplies its own executor runtime, distinct from the host's pinned Copilot CLI.

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
