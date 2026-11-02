# Plugin marketplace starter

A GitHub template for setting up and maintaining a GitHub Copilot plugin
marketplace: one repository that lists the plugins your team shares. It works
for a team in an organization and for one person with a personal account.

<!-- template-only -->
**Status:** active development. GitHub maintains this template; see
[Maintainers](#maintainers) and [Support](#support).
<!-- /template-only -->

Two files make the repository a marketplace:

- The **catalog**, [marketplace.json](marketplace.json), names the marketplace
  and lists its plugins.
- The **repository overlay**,
  [.github/copilot/settings.json](.github/copilot/settings.json), makes Copilot
  load this checkout's plugins while you work in it, without a global install.

## What's in the starter

Two plugins that help you run the marketplace, and commands that add a plugin,
remove one, and rename the marketplace.

<!-- plugin-table -->
| Plugin | What it does |
|---|---|
| [plugin-authoring](plugins/plugin-authoring/) | Scaffold, try locally, and prepare contributions to this plugin marketplace. |
| [marketplace-maintainer](plugins/marketplace-maintainer/) | Review contributed plugins, maintain remote pins, and prepare marketplace releases. |

<!-- plugin:plugin-authoring -->
`plugin-authoring`, for people who add plugins:

- `add-plugin` skill: scaffolds a new plugin with `npm run new-plugin` and checks it with `npm run verify`.
- `try-plugin-locally` skill: installs a plugin from your checkout to try it before you open a pull request, then cleans up.
- `submit-plugin` skill: bumps the version and changelog, runs `npm run verify`, and drafts the pull request.
<!-- /plugin:plugin-authoring -->

<!-- plugin:marketplace-maintainer -->
`marketplace-maintainer`, for people who own the marketplace:

- `plugin-reviewer` agent: reviews a plugin pull request without changing anything: what it runs, what it reaches, and whether it's registered correctly.
- `update-remote-pins` skill: adds a plugin from another repository, or moves its pin, to a commit you've reviewed.
- `release-plugins` skill: checks versions and changelogs, runs `npm run verify`, drafts release notes, and retires a plugin.
<!-- /plugin:marketplace-maintainer -->

<!-- template-only -->
## Background

Teams that share Copilot customizations need a catalog, a way to add and
remove plugins, and checks that keep it consistent. This template sets that up
in one repository, so you can start sharing plugins right away.

Planned work and known gaps are in the
[open issues](https://github.com/github/plugin-marketplace-starter/issues).
Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.
<!-- /template-only -->

## Requirements

- To use the plugins: a current Copilot CLI, the GitHub Copilot app, or VS Code
  with agent plugins turned on, and a GitHub Copilot plan.
- To change the marketplace: Node.js 22.14 or newer and npm. `npm ci` installs
  everything else.

## Make it yours

1. Click **Use this template** on GitHub, clone your new repository, and run
   `npm ci`.
2. Rename the marketplace. This changes the catalog, the repository overlay,
   `package.json`, and the install commands in every README at once:

   ```sh
   npm run rename-marketplace -- --name my-team-plugins --owner "My Team" --repo my-org/my-team-plugins
   ```

   The name must be unique, lowercase, and hyphenated. Add `--dry-run` to see
   which files would change.
3. Keep the included plugins if they fit your team, or remove them. See
   [Remove a plugin](#remove-a-plugin).
4. Add your first plugin. See [Add a plugin](#add-a-plugin).
5. Replace what's meant for you: your own copyright line in [LICENSE](LICENSE),
   the title and introduction of this README, real owners in
   [.github/CODEOWNERS](.github/CODEOWNERS), and your reporting channel in
   [SECURITY.md](SECURITY.md).
6. Run `npm run verify`. It fails on anything inconsistent and warns while the
   template's names are still in place.
7. Push, turn on branch protection or a ruleset for your default branch, and
   [add your marketplace in Copilot](#use-the-marketplace) to check that its
   plugins install.

## Use the marketplace

In Copilot CLI:

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
Remote plugins, which live in another repository, are never enabled for you.

## Add a plugin

```sh
npm run new-plugin -- release-notes --description "Draft release notes from merged pull requests."
npm run verify
```

`new-plugin` creates `plugins/<name>/` with `plugin.json`, a README, and a
CHANGELOG, adds the plugin to the catalog and the repository overlay, and lists
it in this README. Then add the plugin's skills, agents, or other parts to that
folder. The
[Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
lists what a plugin can contain.

When you change a plugin, bump its version in `plugin.json` and
`marketplace.json` and add a `CHANGELOG.md` entry; `npm run verify` checks
that they match.

## Remove a plugin

```sh
npm run remove-plugin -- release-notes
npm run verify
```

`remove-plugin` deletes `plugins/<name>/`, `evals/<name>/`, and the plugin's
tests, removes it from the catalog and the repository overlay, and removes its
install commands, table rows, and marked sections from Markdown files. Add
`--dry-run` to see what would go.

## Checks

`npm run verify` checks the catalog, each plugin's `plugin.json`, versions and
changelogs, the repository overlay, and Markdown links, runs the tests, and
lints the eval files. It never calls a model.
[validate.yml](.github/workflows/validate.yml) runs it on every pull request.

The included plugins have behavioral evals in `evals/`. They run real Copilot
sessions and cost AI credits. Run them with `npm run eval -- --suite smoke`,
then `npm run eval:report -- --suite smoke`.
[evals.yml](.github/workflows/evals.yml) runs them when you start it by hand,
or on pull requests once you set the repository variable `ENABLE_EVALS` to
`true`. Add required reviewers to the `evals` environment to approve each run.

## License

This project is licensed under the terms of the MIT open source license. Please
refer to [LICENSE](LICENSE) for the full terms. That one file covers every
plugin here. Keep its `Copyright` line for the code you kept from the template,
and add your own line below it. The vendored Agent Plugins schema keeps its
Apache-2.0 [license](schemas/LICENSE-APACHE-2.0.txt) and [notice](schemas/NOTICE).

<!-- template-only -->
## Maintainers

GitHub's Copilot Evals team, `@github/code-ai-evals`, maintains this template.
[.github/CODEOWNERS](.github/CODEOWNERS) lists the code owners who review
changes.

## Support

See [SUPPORT.md](SUPPORT.md) for how to ask questions and report bugs, and
[SECURITY.md](SECURITY.md) for how to report a vulnerability privately.

## Acknowledgement

This template builds on the [Agent Plugins](https://agent-plugins.org/)
standard and its schemas, and runs its evals with
[Vally](https://microsoft.github.io/vally/). Thanks to
[@digitarald](https://github.com/digitarald), who wrote its first version, and
to everyone who's contributed since.
<!-- /template-only -->
