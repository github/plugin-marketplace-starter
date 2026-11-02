# Evals

Evals check what Copilot actually does with a plugin: that it loads the right
skill, calls the right tool or agent, and produces the right outcome.
[Vally](https://microsoft.github.io/vally/) runs them. It's a development
dependency pinned in `package.json`; installed plugins never need it.

```sh
npm ci
npm run verify                         # model-free, free
npm run eval:list -- --suite smoke     # free: lists the cases a run would select
npm run eval:smoke                     # real Copilot sessions, costs AI credits
npm run eval:report -- --suite smoke
npm run eval                           # every case, costs more
npm run eval:report -- --suite full
```

`verify` runs source checks, the generated-file freshness check, tests, the
eval coverage check, and strict Vally linting. It never calls a model.
`eval:smoke` and `eval` run real Copilot sessions. Authenticate using the
[Vally runtime setup](https://microsoft.github.io/vally/get-started/runtime-setup/).
The baseline model is `gpt-5.4-mini`; override it with `--model MODEL_ID`.
Local runs use one worker, per-case timeouts, and one bounded retry for a
timeout or rate limit. A valid failed verdict isn't retried to get a pass.

## Layout

`evals/` mirrors `plugins/`. Each plugin has a folder of the same name, and
each asset has one eval file in a folder that mirrors where the asset lives:

| Asset | Eval |
|---|---|
| `plugins/<plugin>/skills/<skill>/SKILL.md` | `evals/<plugin>/skills/<skill>/eval.yaml` |
| `plugins/<plugin>/com.github.copilot/agents/<agent>.agent.md` | `evals/<plugin>/agents/<agent>/eval.yaml` |
| `plugins/<plugin>/com.github.copilot/hooks/hooks.json` | `evals/<plugin>/hooks/eval.yaml` |
| `plugins/<plugin>/mcp.json` | `evals/<plugin>/mcp/eval.yaml` |
| `plugins/<plugin>/com.github.copilot/extensions/<name>/` | `evals/<plugin>/extensions/<name>/eval.yaml` |

Each eval file has its own positive cases, at least one `suite: smoke` case,
and its own negative control. `npm run eval:check` fails when an asset has no
positive and negative case in its mirrored folder. A `<name>.eval.yaml` file
in that folder counts too.

Put every other file at the narrowest level that uses it:

- Used by one asset's eval: in that asset's folder, such as
  `evals/<plugin>/agents/<agent>/fixtures/`.
- Used by several assets in one plugin: in `evals/<plugin>/`, such as
  `evals/<plugin>/graders.mjs`.
- Used by more than one plugin: in `evals/graders/` (shared grader helpers like
  `common.mjs`) or `evals/support/` (shared hosts and workspaces).

So `evals/graders/` and `evals/support/` hold only shared files, and
`new-plugin` won't create a plugin named `graders` or `support`. Removing a
plugin removes `evals/<plugin>/`, which takes all of its evals, graders, and
fixtures with it.

A grader that imports `./common.mjs` works wherever it lives, as long as the
eval's `grading_environment.files` copies both into the same grading folder:

```yaml
grading_environment:
  files:
    - src: ../../graders.mjs
      dest: .grading/my-plugin.mjs
    - src: ../../../graders/common.mjs
      dest: .grading/common.mjs
```

`npm run new-plugin` creates the mirrored folders with a placeholder eval for
each asset. Replace the placeholder cases with real ones.

### Other layouts

Vally finds eval files anywhere under `paths.evals`, so this layout is a
convention, not a requirement. Some teams keep each eval next to its asset
inside the plugin instead. The trade-off is that the eval files then ship to
everyone who installs the plugin, because installing copies the whole plugin
folder and there's no way to exclude files. If you do this, keep large
fixtures and graders outside the plugin anyway. You'd also need to update
`paths.evals` in `.vally.yaml` and this repository's eval scripts, which look
for evals in `evals/` and check the mirrored paths.

## Run only the plugins you changed

A plugin has one spec per asset, such as
`evals/<name>/skills/<skill>/eval.yaml` and
`evals/<name>/agents/<agent>/eval.yaml`, so running one spec alone can miss
cases. `--plugin` selects every spec under `evals/<name>/`, at any depth,
plus any spec with a case that tags one of the plugin's assets. Check the selection for free first:

```sh
npm run eval:list -- --plugin <name>
```

That prints each spec and case it would run and the exact commands. Then run
and report on the same selection. Repeat `--plugin` for several plugins:

```sh
node scripts/evals.mjs eval --plugin <name> --plugin <other-name>
npm run eval:report -- --plugin <name> --plugin <other-name>
```

`--eval-spec <path>` still selects one spec, and you can repeat it.
`--plugin` and `--eval-spec` work with `npm run eval` and `npm run eval:smoke`
too, which narrows those suites to the plugins you name:

```sh
npm run eval:smoke -- --plugin <name>
```

Vally doesn't accept a suite together with specific specs, so the launcher
turns the suite into what Vally does accept: the specs its `evals` patterns
match, and `--tag` for its tag filter.

`--tag key=value` selects cases by tag, as in Vally, and `--tag key!=value`
leaves them out. Repeat it to combine filters. A case inherits its eval's
top-level `tags`, and its own value wins for the same key. For example, this
lists every negative control:

```sh
npm run eval:list -- --tag control=negative
```

The list, the run, and the report all apply the same rules, and `--list`
prints the matching report command. With no `--suite`, `--plugin`,
`--eval-spec`, or `--tag`, the launcher runs the full suite.
`npm run eval:report -- --help` lists the report's options.

## Cost

Each case runs at least one Copilot session, and a retried case runs again.
`npm run eval:check` prints how many cases each suite has, and
`npm run eval:list` names them. Copilot bills model usage in AI credits based
on the model and the tokens used, so the cost of a case depends on how much
work it does. A one-turn chat case costs less than a case that delegates to a
custom agent or edits files. See
[usage-based billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/billing)
and [for individuals](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing),
and check your billing dashboard after a run to learn what your suite costs.

## Write an eval

1. Create the asset's eval at its mirrored path (see [Layout](#layout)), such
   as `evals/<plugin>/skills/<skill>/eval.yaml`, with realistic tasks,
   expected outcomes, and at least one negative or non-trigger case.
   `eval.yaml` is
   [Vally's default file name](https://microsoft.github.io/vally/reference/eval-spec/).
   `<name>.eval.yaml` works too, so one folder can hold several specs;
   `evalFilenames` in `.vally.yaml` lists both.
   Keep private production data out of fixtures and expected answers out of
   agent-visible inputs. Put grader programs and answer keys in
   `grading_environment`.
2. Load the actual asset, rather than pasting its instructions into the task:
   - Skill: list its directory in `agent_environment.skills`, relative to the
     eval file, such as `../../../../plugins/<plugin>/skills/<skill>`.
   - Custom agent: copy its real `.agent.md` file to
     `.github/agents/<name>.agent.md` with `agent_environment.files`, where
     `<name>` is the agent's `name`. Stage it at the top of the spec so the
     negative control runs with the agent available, too.
   - MCP server: configure it in `agent_environment.mcpServers`, and pass its
     path through a `.vally.yaml` param so the launcher can make it absolute.
   - Hook: set `agent_environment.env.STARTER_PLUGIN_DIRS` to the plugin
     directory, such as `plugins/<plugin>`. Separate several with commas.
3. Assert both invocation and outcome:
   - Skills use `skill-invocation` with `required`, plus an outcome grader.
   - Agents need a `tool-calls` assertion for `^task$` with the exact
     `agent_type`, then a subagent-scoped outcome grader. The default agent's
     answer isn't proof that the custom agent ran.
   - MCP tools need a `tool-calls` rule with the tool name and its actual
     `result`.
   - Hooks need evidence that the hook itself ran. See [Hooks](#hooks).
   - Extensions need an MCP transport that drives the real extension code, a
     `program` grader, and a `tags.boundary` saying what the eval does and
     doesn't prove. See [Extensions](#extensions).
4. Tag every case with its assets and `tags.control: positive` or `negative`.
   Put a representative positive case in `tags.suite: smoke`. Prefix stimulus
   names with the plugin or skill name; names must be unique across all specs.
5. Run `npm run verify`, then run the eval, inspect its trajectory, and confirm
   that a wrong outcome would fail the graders.

[Write an eval, step by step](eval-authoring.md) has complete skill evals with
each part explained. `npm run new-plugin` writes a placeholder for each new
asset.

### Outcome graders

These count as outcome coverage for a positive case: `program`,
`output-matches`, `output-contains`, `file-matches`, `file-exists`, `prompt`,
and `panel`. For an MCP tool, a `tool-calls` rule that asserts the tool's
`result` counts too. `skill-invocation`, `tool-calls` without a result,
`completed`, `diff-empty`, and `output-not-matches` are useful, but don't count
on their own.

You don't need a custom `program` grader. Built-in graders are enough for many
skills. Write one when the outcome needs real parsing, such as checking a
generated file's structure.

### Negative controls

A negative case must assert something observable:

- Skill: a `skill-invocation` grader that disallows the skill, or any outcome
  or `tool-calls` grader.
- Agent, hook, or extension: an outcome grader or a `tool-calls` grader.
- MCP tool: a real call with an asserted error or result, or a `tool-calls`
  rule that disallows the tool.

A tag alone isn't coverage.

### Hooks

A hook eval mounts the real plugin with `agent_environment.env.STARTER_PLUGIN_DIRS`
and must show that the hook ran, not only that the model did the task. These
count:

- A `program` grader that checks the hook's real effects.
- A `tool-calls` rule whose `result` pattern includes the hook's
  `<plugin-name>:` prefix. Copilot appends a hook's `additionalContext` to the
  tool result, so only the hook can put it there. For a hook that reports
  rather than changes files, this is the honest evidence.
- An `output-matches`, `output-contains`, or `file-matches` grader whose
  pattern includes that prefix.

A `file-matches` or `file-exists` grader on content the model wrote doesn't
count: it passes even when the hook never ran. [Hooks](hooks.md) explains the
prefix convention.

### Extensions

A canvas extension's eval runs it through
[evals/support/canvas-host.mjs](../evals/support/canvas-host.mjs), a shared
MCP transport that loads the real `extension.mjs`, stands in for the host's
SDK, and exposes `list_canvas_capabilities`, `open_canvas`, and
`invoke_canvas_action`. A new extension needs only configuration: a
`.vally.yaml` param for its `extension.mjs` path, and a server entry like this:

```yaml
agent_environment:
  mcpServers:
    standup-host:
      type: stdio
      command: node
      args:
        - '${CANVAS_HOST}'
        - '${STANDUP_EXTENSION}'
        - --seed
        - '[{"action":"add_item","input":{"text":"Existing item"}}]'
```

`--seed` runs actions before the first call so every session starts the same;
`--canvas <id>` picks a canvas when the extension registers several. Grade the
outcome with a `program` grader that reads the actions' real results, and tag
the case `boundary: headless-sdk-contract`: the host proves the extension's
contract, not that any app renders it. `npm run new-plugin -- <name> --with extension`
sets all of this up, and `npm run verify` starts every canvas host an eval
configures to catch a broken path, canvas ID, or seed before a paid run.

## Asset identities

<!-- examples -->
The included workflows use disposable synthetic workspaces prepared by
[maintenance-workspace.mjs](../evals/support/maintenance-workspace.mjs). It copies
real scaffolding and structural-validation code plus shared canvas transports,
never the checkout's eval specs or grader answer keys. Its fixture `verify`
checks source structure and build freshness only; this deliberately isn't the
full checkout's `verify`. Recorded upstream API responses exercise the real
remote checker without contacting GitHub, and local CLI install checks don't
start a model session. Case boundary tags state these limits.
<!-- /examples -->

| Asset | `tags.assets` identity | Source layout |
|---|---|---|
| Skill | `skill:<plugin>/<skill-name>` | `plugins/<plugin>/skills/<skill-name>/SKILL.md` |
| Custom agent | `agent:<plugin>/<agent-name>` | `plugins/<plugin>/com.github.copilot/agents/<agent-name>.agent.md` |
| Hook | `hook:<plugin>/<event-name>` | `plugins/<plugin>/com.github.copilot/hooks/hooks.json` |
| Canvas extension | `extension:<plugin>/<extension>` | `plugins/<plugin>/com.github.copilot/extensions/<extension>/extension.mjs` |
| MCP tool | `mcp:<plugin>/<server-name>/<tool-name>` | `plugins/<plugin>/mcp.json` |

The coverage check discovers every local skill, agent, hook, extension, and MCP
tool. It starts each local MCP server to read its real tool list. When
something's missing, it names the spec file, the case, and what to add, and it
reports every problem in one run. Live-repository checks test invariants rather
than a fixed plugin list; plugin-specific outcome graders travel with the
included plugin and are removed with it.

Slash commands, rules, and LSP servers aren't invoked by the model the way
skills, agents, and tools are, so the coverage check doesn't require evals for
them. Test them by hand in the hosts you support.

## Suites

Suites are conventions, not fixed names. This repository's `smoke` suite
selects cases tagged `suite: smoke`, and `full` runs every spec. You can
filter on any tag, such as `lane: ci`. A `tags.suite` value must
match a suite filter in `.vally.yaml`, and every asset needs a case in `smoke`
because CI runs it by default.

## How the harness loads assets

The [launcher](../scripts/evals.mjs) runs Vally's `copilot-sdk` executor with the
pinned full Copilot CLI. The SDK's bundled standalone runtime can discover a
custom agent but won't run it, so the launcher sets `COPILOT_CLI_PATH` to a
small [runtime bridge](../scripts/eval-runtime.js) that starts the pinned
`@github/copilot` runtime with auto-update turned off. The bridge mounts each
directory listed in an eval's `STARTER_PLUGIN_DIRS` with `--plugin-dir`, so hook
cases load the real plugin without a global install or a folder-trust prompt.
`node scripts/eval-runtime.js --version` prints the pinned package version and
the version that actually runs.

MCP processes don't necessarily start in this checkout, so the launcher reads
`params` from `.vally.yaml` and passes every value that contains a slash as an
absolute path. Other params pass through unchanged.

## Results

Each local run writes JSONL results, a Markdown report, JUnit, and session
evidence under a timestamped `vally-results/` directory. Report on it with the
same selection you ran: `--suite smoke` after `npm run eval:smoke`,
`--suite full` after `npm run eval`, or `--eval-spec <path>` after one spec.
`--run-dir PATH` selects a saved run. An incomplete run, unexpected skip,
runtime error, or grader infrastructure error fails reporting. Valid failed
verdicts stay visible but don't fail the command; add `--require-pass` to the
eval command when you want them to.

`npm run eval:grade -- --help` shows Vally's options for re-grading saved
evidence. Re-grading code-based assertions doesn't need another model run.

References: [eval schema](https://microsoft.github.io/vally/reference/eval-spec/)
and [grader catalog](https://microsoft.github.io/vally/reference/graders/).
