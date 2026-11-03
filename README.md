# Plugin marketplace starter

A GitHub template for setting up and maintaining a GitHub Copilot plugin
marketplace: one repository that lists the plugins your team shares. It works
for a team in an organization and for one person with a personal account.

**Status:** active development. GitHub maintains this template; see
[Maintainers](#maintainers) and [Support](#support).

One file makes the repository a marketplace: the **catalog**,
[marketplace.json](marketplace.json), which names the marketplace and lists its
plugins. Each plugin lives in its own folder under [plugins/](plugins/).
Nothing is installed or turned on when you clone or open the repository; people
add the marketplace and install only the plugins they want.

## What's in the starter

Two plugins that help you run the marketplace:

| Plugin | What it does |
|---|---|
| [plugin-authoring](plugins/plugin-authoring/) | Scaffold, try locally, and prepare contributions to this plugin marketplace. |
| [marketplace-maintainer](plugins/marketplace-maintainer/) | Review contributed plugins, maintain remote pins, and prepare marketplace releases. |

`plugin-authoring`, for people who add plugins:

- `add-plugin` skill: creates a new plugin's folder and files and registers it in the catalog.
- `try-plugin-locally` skill: installs a plugin from your checkout to try it before you open a pull request, then cleans up.
- `submit-plugin` skill: bumps the version and changelog and writes the pull request description.

`marketplace-maintainer`, for people who own the marketplace:

- `plugin-reviewer` agent: reviews a plugin pull request without changing anything: what it runs, what it reaches, and whether it's registered correctly.
- `update-remote-pins` skill: adds a plugin from another repository, or moves its pin, to a commit you've reviewed.
- `release-plugins` skill: checks versions and changelogs, drafts release notes, and retires a plugin.

## Background

Teams that share Copilot customizations need a catalog and a simple way to add,
remove, and review plugins. This template sets that up in one repository, so
you can start sharing plugins right away.

Planned work and known gaps are in the
[open issues](https://github.com/github/plugin-marketplace-starter/issues).
Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Requirements

- To use the plugins: a current Copilot CLI, the GitHub Copilot app, or VS Code
  with agent plugins turned on, and a GitHub Copilot plan.
- To lint the plugins and run their evals: Node.js 22.14 or newer and npm.

## Make it yours

1. Click **Use this template** on GitHub and clone your new repository.
2. Name your marketplace. In [marketplace.json](marketplace.json), set `name`
   (unique, lowercase, and hyphenated) and `owner.name`. Set `name` in
   [package.json](package.json) too.
3. Update the install commands in this README and in each plugin's README: use
   your repository instead of `github/plugin-marketplace-starter` or
   `OWNER/REPO`, and your marketplace name after the `@`.
4. Keep the included plugins if they fit your team, or
   [remove them](#remove-a-plugin).
5. [Add your first plugin](#add-a-plugin).
6. Replace what's meant for this template: add your own copyright line to
   [LICENSE](LICENSE) below GitHub's, rewrite this README's title,
   introduction, Background, Maintainers, Support, and Acknowledgement, name
   real owners in [.github/CODEOWNERS](.github/CODEOWNERS), and put your own
   contacts in [SECURITY.md](SECURITY.md) and [SUPPORT.md](SUPPORT.md).
7. Push, turn on branch protection or a ruleset for your default branch, and
   [add your marketplace in Copilot](#use-the-marketplace) to check that its
   plugins install.

## Use the marketplace

Add the marketplace, browse it, and install only the plugins you want. Nothing
is installed or turned on for you. In Copilot CLI:

```sh
copilot plugin marketplace add github/plugin-marketplace-starter
copilot plugin marketplace browse plugin-marketplace-starter
copilot plugin install plugin-authoring@plugin-marketplace-starter
copilot plugin install marketplace-maintainer@plugin-marketplace-starter
```

Each plugin installs on its own. Start a new session after installing. In VS
Code, run **Chat: Install Plugin from Source** and enter the repository, and
make sure `chat.plugins.enabled` is on.

Review a plugin before you trust it: plugins can run code on your machine.

## Add a plugin

The `add-plugin` skill does these steps for you. By hand:

1. Create `plugins/<name>/` with a `plugin.json`:

   ```json
   {
     "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
     "name": "release-notes",
     "version": "0.1.0",
     "description": "Draft release notes from merged pull requests.",
     "license": "MIT"
   }
   ```

   Add a `README.md` that says what it does and how to install it, and a
   `CHANGELOG.md` with a `## 0.1.0` entry.
2. Add the plugin to the `plugins` list in `marketplace.json` with the same
   `name`, `version`, and `description`, and
   `"source": "./plugins/release-notes"`.
3. Add it to the table and install commands in this README.

Then add the plugin's skills, agents, or other parts to its folder. The
[Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
lists what a plugin can contain. Put any evals for it in `evals/<name>/`.

When you change a plugin, bump its version in `plugin.json` and
`marketplace.json` together, and add a `CHANGELOG.md` entry.

## Remove a plugin

The `release-plugins` skill can retire a plugin for you. By hand, delete
`plugins/<name>/` and `evals/<name>/`, then remove the plugin's entry from
`marketplace.json` and its row and install command from this README.

## Checks

```sh
npm ci
npm run lint
```

`npm run lint` checks every skill under `plugins/` and every eval under `evals/`
with the pinned [Vally](https://microsoft.github.io/vally/) CLI. It never calls
a model. [validate.yml](.github/workflows/validate.yml) runs it on every pull
request, and also checks that each local entry in `marketplace.json` matches
its `plugin.json`.

The evals in `evals/` run real Copilot sessions and cost AI credits. The
`plugin-reviewer` eval needs the full Copilot CLI that `npm ci` installs, so
point `COPILOT_CLI_PATH` at it:

```sh
export COPILOT_CLI_PATH="$PWD/node_modules/@github/copilot/npm-loader.js"
npm run eval -- --suite smoke
```

In PowerShell, set it with
`$env:COPILOT_CLI_PATH = "$PWD\node_modules\@github\copilot\npm-loader.js"`.
Results go to `vally-results/`. [evals.yml](.github/workflows/evals.yml) runs
the smoke suite when you start it by hand, or on pull requests that change
`plugins/` or `evals/` once you set the repository variable `ENABLE_EVALS` to
`true`.

## License

This project is licensed under the terms of the MIT open source license. Please
refer to [LICENSE](LICENSE) for the full terms. That one file covers every
plugin here. Keep its `Copyright` line for the code you kept from the
template, and add your own line below it.

## Maintainers

GitHub's Copilot Evals team, `@github/code-ai-evals`, maintains this template.
[.github/CODEOWNERS](.github/CODEOWNERS) lists the code owners who review
changes.

## Support

See [SUPPORT.md](SUPPORT.md) for how to ask questions and report bugs, and
[SECURITY.md](SECURITY.md) for how to report a vulnerability privately.

## Acknowledgement

This template builds on the [Agent Plugins](https://agent-plugins.org/)
standard and runs its evals with [Vally](https://microsoft.github.io/vally/).
Thanks to [@digitarald](https://github.com/digitarald), who wrote its first
version, and to everyone who's contributed since.
