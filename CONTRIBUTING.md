# Contributing

Thanks for improving this marketplace. This guide is the checklist for people;
[AGENTS.md](AGENTS.md) adds rules for coding agents, and the [README](README.md)
explains how everything fits together.

## Before you start

- Install Node.js 22.14 or newer and run `npm ci`.
- Open an issue with the **New plugin** form before building a new plugin, so
  reviewers can agree on scope and risk first.
- Use only synthetic data in examples, fixtures, and evals. Never commit secrets,
  tokens, or private organizational code.

## Add or change a plugin

Start a new plugin with `npm run new-plugin -- <name>`, optionally with
`--with agent` or `--with mcp`. It creates the files and registrations below,
including an eval that meets the coverage rules, so you only replace the
scaffolded content. See [Add a plugin](README.md#add-a-plugin).

Change these together in one pull request:

1. **Plugin files** under `plugins/<name>/`: `plugin.json`, its skills, agents,
   hooks, MCP server, commands, rules, or extensions, plus `README.md`,
   `CHANGELOG.md`, and `LICENSE`. Keep it self-contained; never import a sibling
   plugin or this repository's `node_modules` at runtime.
2. **Version**: bump `version` in `plugin.json` and the matching
   [marketplace.json](marketplace.json) entry, and add a `## <version>` heading
   to `CHANGELOG.md`. Any change to a shipped file needs a new version.
3. **Catalog and settings**: keep the catalog `description` identical to the
   manifest, and enable local plugins in
   [.github/copilot/settings.json](.github/copilot/settings.json). Never enable
   a remote plugin there.
4. **[.vally.yaml](.vally.yaml)**: list the plugin's `skills` directory under
   `paths.skills`, and add any path an eval needs under `params`.
5. **Evals** under `evals/<name>/`: a positive case with invocation and outcome
   assertions for every skill, agent, hook, extension, and MCP tool, a smoke
   case, and a negative control. See [Evals](docs/evals.md#write-an-eval).
6. **Tests** under `test/` for code you add, such as servers, hooks, and graders.
7. **Generated files**: if you changed `plugins/*/src/` or `evals/graders/src/`,
   run `npm run build` and commit the regenerated `dist/` files.

Then run:

```sh
npm run build
npm run verify
```

`verify` is model-free and must pass. CI runs it on Linux, Windows, and macOS.
It reports every problem at once as `path: message`, and warns about leftovers
such as mentions of a plugin that no longer exists.

## Remove or rename a plugin

`npm run remove-plugin -- <name>` removes a plugin's directory, evals, catalog
entry, settings entry, and `.vally.yaml` skill path and params, and prunes
Markdown that names it. For a shipped example, `npm run remove-example -- <name>`
also removes the graders, support files, fixtures, and tests that only it uses.
To rename a plugin, change its directory, manifest, catalog entry, settings
key, `.vally.yaml` path, evals, and docs together. `npm run verify` names
anything you missed.

## Remote plugins

A remote catalog entry's `name` must match the upstream `plugin.json` name. Pin
a `ref` and full commit `sha`, and document any access requirement. Local checks
never download or run upstream code.

## Paid evals

`npm run eval:smoke`, `npm run eval`, and the **Behavioral evals** workflow run
real Copilot sessions and spend AI credits. Run the narrowest spec that
covers your change, for example:

```sh
node scripts/evals.mjs eval --eval-spec evals/bug-report/eval.yaml
npm run eval:report -- --eval-spec evals/bug-report/eval.yaml
```

Say in your pull request which evals you ran and what they showed. Inspect a
failed trajectory before changing an assertion, and don't loosen a check just
to get a pass.

## Review

Reviewers look for a clear workflow, honest descriptions, least-privilege tool
lists, hooks that never make permission decisions, MCP servers that start
offline without credentials, and evals that would fail on a wrong outcome.
Report security problems privately as described in [SECURITY.md](SECURITY.md).
