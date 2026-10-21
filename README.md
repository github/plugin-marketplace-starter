# Plugin marketplace starter

A GitHub template for teams that want to build, evaluate, and share AI
customizations (skills, custom agents, hooks, MCP servers, and more) as an
[Agent Plugins](https://agent-plugins.org/) marketplace for GitHub Copilot.

It gives you:

- Six small example plugins to learn from, copy, or delete.
- Commands that scaffold a new plugin and remove the examples.
- `npm run verify`, a model-free check of manifests, the catalog, tests, and
  eval coverage, which CI runs on every push.
- Behavioral evals for every skill, agent, hook, extension, and MCP tool, run
  with [Vally](https://microsoft.github.io/vally/), the eval runner and linter
  pinned in `package.json`. Evals run real Copilot sessions and cost AI
  credits, so they're opt-in in CI.

Two terms come up a lot:

- The **catalog** is [marketplace.json](marketplace.json). It names the
  marketplace and lists its plugins.
- The **repository overlay** is
  [.github/copilot/settings.json](.github/copilot/settings.json). It makes
  Copilot load this checkout's plugins while you work in it, without a global
  install.

| Plugin | Try it | Teaches |
|---|---|---|
| [bug-report](plugins/bug-report/) | "Turn these notes into a bug report" | A basic skill that loads the right template on demand |
| [format-json](plugins/format-json/) | Ask Copilot to edit a JSON file | A post-tool hook that formats the files an edit touched |
| [team-brainstorm](plugins/team-brainstorm/) | "Let's brainstorm a release plan together" | A skill with a canvas extension and a shared session-only UI |
| [customization-authoring](plugins/customization-authoring/) | "Create a skill and evals for summarizing a changelog" | A skill that writes a skill and its evals |
| [code-review](plugins/code-review/) | "Use adversarial-review to review this diff without changing it" | A skill that delegates to a read-only custom agent |
| [json-configuration](plugins/json-configuration/) | 'Use json-configuration to validate {"port":8443} and look up /port' | A skill backed by a bundled local MCP server |

The catalog also has an optional reference to the GitHub Copilot Evals plugin,
which lives in another repository. See [Remote plugins](docs/remote-plugins.md).
[Examples](docs/examples.md) explains what each example shows and which files
it owns.

## Make it yours

You need Node.js 22.14 or newer.

1. Click **Use this template** on GitHub, clone your new repository, and run
   `npm ci`.
2. Rename the marketplace. Change these together:
   - `name` and `owner.name` in [marketplace.json](marketplace.json). The name
     must be unique, lowercase, and hyphenated.
   - The marketplace key and every `<plugin>@<marketplace>` key in
     [.github/copilot/settings.json](.github/copilot/settings.json).
   - `name` in [package.json](package.json). Run `npm install` afterward so
     `package-lock.json` matches.
   - In this README's [Install plugins](#install-plugins) commands, replace
     `github/plugin-marketplace-starter` with your `OWNER/REPO` and every
     `@plugin-marketplace-starter` with `@<your-marketplace-name>`. Delete the
     note that this repository is private if yours isn't.
3. Remove the examples you don't want, for example
   `npm run remove-example -- team-brainstorm format-json`. See
   [Remove a plugin or example](#remove-a-plugin-or-example).
4. Add your first plugin with `npm run new-plugin -- <name>`. See
   [Add a plugin](#add-a-plugin).
5. Decide whether to keep the `github-copilot` remote entry in the catalog.
   Installing it needs access to the private `github/evals` repository. See
   [Remote plugins](docs/remote-plugins.md).
6. Replace what's meant for you before you ship:
   - The copyright holder in [LICENSE](LICENSE) and in each plugin's `LICENSE`.
     `new-plugin` uses your catalog owner for new plugins.
   - Real owners in [.github/CODEOWNERS](.github/CODEOWNERS).
   - Your reporting channel in [SECURITY.md](SECURITY.md).
   - Your process in [CONTRIBUTING.md](CONTRIBUTING.md), the
     [pull request template](.github/PULL_REQUEST_TEMPLATE.md), and the
     [new plugin issue form](.github/ISSUE_TEMPLATE/new-plugin.yml).
   - Your maintenance rules in
     [.github/copilot-instructions.md](.github/copilot-instructions.md) and
     [AGENTS.md](AGENTS.md).
7. Run `npm run verify`. It fails on anything inconsistent and warns about
   leftovers, such as a template name or a mention of a plugin you removed.
8. Push, then turn on branch protection or a ruleset for your default branch.
   Behavioral evals stay off in CI until you turn them on; see
   [Continuous integration](#continuous-integration).
9. [Test installation](docs/local-development.md#test-installation-without-publishing)
   locally, then from your GitHub repository, before you share it.

For agent-assisted setup and maintenance, see [AGENTS.md](AGENTS.md).

## Install plugins

Use a current Copilot CLI, or VS Code with a Copilot session that uses the
shared runtime. Installed plugins don't need `npm` or this repository's
dependencies. Review a plugin before you trust it: hooks and MCP servers run
code on your machine.

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
session after installing.

This repository is currently private, so installers need a GitHub account with
access to it.

### VS Code

Run **Chat: Install Plugin from Source**, enter `OWNER/REPO` (here,
`github/plugin-marketplace-starter`), and select a plugin. You can also add the
repository to `chat.plugins.marketplaces`. Enable agent plugins if they're
turned off, and start a new session if the host asks.

Skills and MCP servers also work in other clients that support Agent Plugins.
Hooks, custom agents, and extensions need Copilot.

## Add a plugin

```sh
npm run new-plugin -- release-notes
npm run new-plugin -- sql-helper --with mcp --with agent --description "Review SQL migrations."
npm run verify
```

`new-plugin` creates `plugins/<name>/` with `plugin.json`, a skill, a README
with an Install section, a CHANGELOG, and a LICENSE, plus
`evals/<name>/eval.yaml` with a positive smoke case and a negative case that
already meet the coverage rules. It adds the plugin to the catalog, the
repository overlay, and `.vally.yaml`. `--with agent` adds a read-only custom
agent and a delegation eval. `--with mcp` adds a local MCP server in
`src/server.ts` with one example tool, and builds it.

Then replace the scaffolded instructions, README, and eval prompts with your
real ones, and run `npm run verify`. Group a plugin by workflow, not by asset
type: a skill and the agent or MCP server it uses belong together.

To add other types, such as hooks or slash commands, or to set a plugin up by
hand, see [Customization types](docs/customization-types.md). Run
`npm run build` only when you change a plugin's `src/` or `evals/graders/src/`;
it regenerates the committed bundles.

## Remove a plugin or example

```sh
npm run remove-example -- team-brainstorm format-json
npm run remove-plugin -- release-notes
npm run verify
```

`remove-plugin` deletes `plugins/<name>/` and `evals/<name>/`, its catalog
entry, its repository overlay key, and its `.vally.yaml` skill path and params.
For a shipped example, `remove-example` also deletes the graders, eval support
files, fixtures, and tests that only that example uses. Both commands remove
install commands, example table rows, and marked sections in Markdown that
name the plugin, and turn other links to its files into plain text. Use
`--dry-run` to see what would go. `npm run verify` warns about any prose that
still mentions a removed plugin.

## Evals

`npm run verify` is model-free. It also checks eval coverage: every local
skill, agent, hook, extension, and MCP tool needs a positive case that asserts
it ran and what it did, a case in the `smoke` suite, and a negative case with an
observable assertion.

This is a complete eval for a skill that answers in chat. It passes the
coverage check without a custom grader:

```yaml
name: release-notes
description: Drafts grouped release notes and ignores unrelated questions.
type: capability
defaults:
  executor: copilot-sdk
  model: gpt-5.4-mini
  timeout: 2m
  runs: 1
agent_environment:
  skills:
    - ../../plugins/release-notes/skills/release-notes
stimuli:
  - name: release-notes-groups-changes
    prompt: "Draft release notes for: added CSV export, fixed login timeout."
    tags:
      assets: skill:release-notes/release-notes
      control: positive
      suite: smoke
    graders:
      - type: skill-invocation
        config:
          required: [release-notes]
      - type: output-matches
        config:
          pattern: '[Ff]ixed[\s\S]*login timeout'
  - name: release-notes-ignores-arithmetic
    prompt: What is two plus two? Reply with only the digit.
    tags:
      assets: skill:release-notes/release-notes
      control: negative
    graders:
      - type: skill-invocation
        config:
          disallowed: [release-notes]
      - type: output-contains
        config:
          substring: "4"
scoring:
  threshold: 1
```

These graders count as outcome checks: `program`, `output-matches`,
`output-contains`, `file-matches`, `file-exists`, `prompt`, and `panel`.
Custom grader programs are optional. The
[authoring reference](plugins/customization-authoring/skills/skill-authoring/references/evals.md)
explains each part, and [Evals](docs/evals.md) covers agents, MCP tools, hooks,
extensions, suites, and results.

Running evals costs AI credits:

```sh
npm run eval:smoke
npm run eval:report -- --suite smoke
```

## Continuous integration

[validate.yml](.github/workflows/validate.yml) runs `npm run verify` on Linux,
Windows, and macOS with Node.js 22 and 24 for every push and pull request. It
never calls a model.

[evals.yml](.github/workflows/evals.yml) runs behavioral evals. It's off for
pull requests until you set the repository variable `ENABLE_EVALS` to `true`,
and you can always run it by hand. It uses the private
[`github/evals-action`](https://github.com/github/evals-action), which only
repositories in the GitHub organization can use. Anywhere else, set the
repository variable `EVALS_RUNNER` to `npm` to run the same evals with the
pinned Vally CLI. [Continuous integration](docs/ci.md) covers setup, the
organization billing policy, cost, and security.

## Repository layout

```text
marketplace.json           # The catalog: marketplace name, owner, and plugins
plugins/<name>/            # One self-contained plugin per workflow
  plugin.json, README.md, CHANGELOG.md, LICENSE
  skills/<skill>/SKILL.md
  com.github.copilot/      # Copilot-only parts: agents, hooks, extensions, and more
  mcp.json, src/, dist/    # A local MCP server, its source, and its bundle
evals/<name>/eval.yaml     # Behavioral evals, kept outside the plugins
evals/graders/, support/, fixtures/
.vally.yaml                # Skill paths, eval file names, params, and suites
scripts/                   # verify, build, new-plugin, remove-plugin, eval launcher
test/                      # Model-free tests
schemas/                   # Vendored Agent Plugins schemas (Apache-2.0)
docs/                      # Reference guides
.github/copilot/           # The repository overlay
.github/workflows/         # validate.yml and evals.yml
```

## Licensing

The starter is [MIT licensed](LICENSE). Each plugin carries its own MIT
`LICENSE` so it stays licensed when installed or copied on its own. The
vendored Agent Plugins schemas keep their Apache-2.0
[license](schemas/LICENSE-APACHE-2.0.txt) and [notice](schemas/NOTICE). Bundled
dependencies keep their notices beside the generated files.

## References

- [Customization types](docs/customization-types.md),
  [Evals](docs/evals.md), [Continuous integration](docs/ci.md),
  [Local development](docs/local-development.md),
  [Examples](docs/examples.md), and [Remote plugins](docs/remote-plugins.md)
- [Agent Plugins standard](https://agent-plugins.org/)
- [GitHub Copilot plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins)
- [Creating a team marketplace](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [VS Code agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)
- [Agent Skills specification](https://agentskills.io/specification)
- [Vally](https://microsoft.github.io/vally/) and the
  [Evals Action](https://github.com/github/evals-action)
