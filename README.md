# Plugin marketplace starter

A GitHub template for setting up and maintaining a GitHub Copilot plugin
marketplace: one repository that lists the plugins your team shares. It works
for a team in an organization and for one person with a personal account.

**Status:** active development. GitHub maintains this template; see
[Maintainers](#maintainers) and [Support](#support).

One file makes the repository a marketplace: the **catalog**,
[marketplace.json](marketplace.json), which names the marketplace and lists its
plugins. Local plugins live in their own folders under [plugins/](plugins/). People
add the marketplace and install only the plugins they want.

## What's in the starter

Included local maintenance plugins and optional remote plugins:

| Plugin | What it does |
|---|---|
| [plugin-authoring](plugins/plugin-authoring/) | Scaffold, try locally, and prepare contributions to this plugin marketplace. |
| [marketplace-maintainer](plugins/marketplace-maintainer/) | Review contributed plugins, maintain remote pins, and prepare marketplace releases. |
| [pr-description](plugins/pr-description/) | Draft structured pull request descriptions from supplied change notes or diffs without inventing unshipped work. |
| [GitHub Copilot Evals (Preview)](https://github.com/github/evals/blob/copilot-evals-v0.24.0/README.md) (`eval`, optional remote) | Create, run, review, and compare evals for your Copilot customizations. |

## Background

Teams that share Copilot customizations need a catalog and a simple way to add,
remove, and review plugins. This template sets that up in one repository, so
you can start sharing plugins right away.

Planned work and known gaps are in the
[open issues](https://github.com/github/plugin-marketplace-starter/issues).
Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Requirements

For marketplace development and evals, use this shared setup.

- One supported Copilot harness: **Copilot CLI, GitHub Copilot app, or VS Code
  with agent plugins enabled**, and a **GitHub Copilot plan**.
- **Node.js 24+ and npm** for repository tooling and the bundled
  [local-install validator](plugins/plugin-authoring/skills/try-plugin-locally/references/local-install.md#test-installation-without-publishing).
- **GitHub Copilot CLI 1.0.85+**.
- **Vally ([`@microsoft/vally-cli`](https://www.npmjs.com/package/@microsoft/vally-cli)) 0.21.0**, pinned in `package.json`.
- **Git 2.28.0+**.
- For paid repository evals, **Docker with Compose and a running Linux daemon**.

## Make it yours

1. Click **Use this template** on GitHub and clone your new repository.
2. Name your marketplace. In [marketplace.json](marketplace.json), set `name`
   (unique, lowercase, and hyphenated) and `owner.name`. Use the new name in
   [.github/copilot/settings.json](.github/copilot/settings.json), as the key
   under `extraKnownMarketplaces` and after the `@` in each `enabledPlugins`
   key, and set `name` in [package.json](package.json) too. Sync just the two
   root `name` fields in `package-lock.json` (top-level and `packages[""]`);
   no dependency install is needed.
3. Update the install commands in this README and in each plugin's README: use
   your repository instead of `github/plugin-marketplace-starter` or
   `OWNER/REPO`, and your marketplace name after the `@`. Set `repository` in
   each plugin's `plugin.json` to your repository's URL. Before your first
   release, keep initial plugin versions and add changes to their existing
   changelog entries. For plugins you've already released, use the
   [version rules](#add-a-plugin).
4. Keep the included plugins if they fit your team, or
   [remove them](#remove-a-plugin).
5. [Add your first plugin](#add-a-plugin).
6. Replace what's meant for this template: add your own copyright line to
   [LICENSE](LICENSE) below GitHub's, rewrite this README's title,
   introduction, Background, Maintainers, Support, and Acknowledgement, name
   real owners in [.github/CODEOWNERS](.github/CODEOWNERS), and put your own
   contacts in [SECURITY.md](SECURITY.md), [SUPPORT.md](SUPPORT.md), and the
   enforcement sections of [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Keep
   applicable legal terms. Point the fork and compare links in
   [CONTRIBUTING.md](CONTRIBUTING.md) at your repository.
7. Push, turn on branch protection or a ruleset for your default branch, and
   [add your marketplace in Copilot](#use-the-marketplace) to check that its
   plugins install.

## Use the marketplace

Add the marketplace, browse it, and install only the plugins you want. Nothing
is installed or turned on for you outside the checkout. In supported hosts,
after you trust the checkout, its
[repository settings](.github/copilot/settings.json) enable only the two local
maintenance plugins. Check with `copilot plugin list`. If they're absent, start
CLI with `--plugin-dir` for each local plugin as shown in the
[local bootstrap guide](plugins/plugin-authoring/skills/try-plugin-locally/references/local-install.md#for-one-session).
For installation from GitHub after publication:

```sh
copilot plugin marketplace add github/plugin-marketplace-starter
copilot plugin marketplace browse plugin-marketplace-starter
copilot plugin install plugin-authoring@plugin-marketplace-starter
copilot plugin install marketplace-maintainer@plugin-marketplace-starter
copilot plugin install pr-description@plugin-marketplace-starter
```

For optional GitHub Copilot Evals, install it explicitly:

```sh
copilot plugin install eval@plugin-marketplace-starter
```

See its [upstream setup guidance](https://github.com/github/evals/blob/copilot-evals-v0.24.0/README.md#install),
including experimental mode for Copilot CLI commands and Canvas. For remote-entry
checks and the local-directory install limitation, see
[Remote pin testing](plugins/marketplace-maintainer/skills/update-remote-pins/references/remote-pins.md#testing-a-remote-entry).

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
     "license": "MIT",
     "repository": "https://github.com/OWNER/REPO"
   }
   ```

   Use your repository's license and URL. Add a `README.md` that says what it
   does and how to install it, and a `CHANGELOG.md` with a `## 0.1.0` entry.
2. Add the plugin to the `plugins` list in `marketplace.json` with the same
   `name`, `version`, and `description`, and
   `"source": "./plugins/release-notes"`.
3. Add it to the table and install commands in this README.

Then add the plugin's skills, agents, or other parts to its folder. The
[Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
lists what a plugin can contain. Put any evals for it in `evals/<name>/`.
Eval files that several plugins share live in `evals/_shared/`, which can't
clash with a plugin because plugin names start with a lowercase letter or digit.

For changes since a known released base, bump the plugin's version in
`plugin.json` and `marketplace.json` together and add a `CHANGELOG.md` entry.
An unreleased first version keeps its initial version and changelog heading,
including during template customization. Don't bump twice, lower a version, or
rewrite version history. If the released base or first-release status is
unknown, ask before changing versions.

## Try a local change

Work in your marketplace repo on the branch with your new plugin or edits.
Keep your uncommitted changes. Start a fresh Copilot CLI session with that
plugin's absolute local folder:

```sh
copilot --plugin-dir "/absolute/path/to/your-marketplace/plugins/release-notes"
```

Review the source and approve the host's trust and permission prompts before
testing. This loads your local edits for one session without installing anything
or changing settings. Entering the checkout doesn't load every plugin; its
repository settings enable only the two maintenance plugins. Edits take effect
on `/restart` or in a new session, without `plugin update`.

Use `try-plugin-locally` to prepare the command or check discovery and behavior
in an approved session. A prepared command doesn't verify either. See the
[local testing guide](plugins/plugin-authoring/skills/try-plugin-locally/references/local-install.md)
for host details and a separate, optional installation check.

## Remove a plugin

The `release-plugins` skill can retire a plugin for you. By hand, delete
`plugins/<name>/` and `evals/<name>/`, then remove the plugin's entry from
`marketplace.json` and its row and install command from this README. If it's
one of the two plugins in `.github/copilot/settings.json`, remove its key there
too. If surviving cohort evals under `evals/` list the retired plugin's skills
in `agent_environment.skills` or `disallowed`, remove those entries as well.

You can keep only remote entries by removing both bundled local plugins and
their eval folders. No empty `plugins/` or `evals/` directory is needed.

## Checks

```sh
npm ci
npm run lint
```

`npm run lint` checks local catalog consistency and skill and eval files without calling a model.
[Validate](.github/workflows/validate.yml) also runs script tests, schema
validation, catalog consistency checks, and remote-pin checks on every pull
request.

**Paid evals:** first complete the
[Docker and scoped authentication setup](docs/checks-and-evals.md#native-docker-evals).
Then `npm run eval` runs real Copilot sessions and costs AI credits.
[Evals](.github/workflows/evals.yml) runs only when manually started; pull
requests never trigger paid evals.

Repository evals **default to Vally's native Docker backend** in
[.vally.yaml](.vally.yaml), including `npm run eval` and the manually dispatched
eval workflow. `npm run eval -- --suite full` selects every retained case,
including the independent reviewer agent. These runs still spend AI credits
and require Docker, Compose, network access, and container-compatible
authentication. Missing Docker or image preparation fails the run; it does not
silently fall back to host execution. Vally builds and caches its version-matched
default image locally.
See [Native Docker evals and isolation limits](docs/checks-and-evals.md#native-docker-evals)
before running. The pinned Evals plugin's Run entrypoint cannot read the new
project backend default and currently rejects this configuration; use the native
Vally CLI rather than assuming plugin Run is container-isolated. Paid CI remains
manual-only.

See [Checks and evals](docs/checks-and-evals.md) for CI details, local test
commands, and Bash and PowerShell eval setup.

## License

This template and its local plugins use the [MIT License](LICENSE). Keep its
`Copyright` line for code you kept from the template, and add your own line
below it.

Remote plugins retain their upstream licenses. GitHub Copilot Evals is source
available under the [GitHub Limited Use Source License](https://github.com/github/evals/blob/34ddb5803aeaee8330ab70c19ad1a3f37fb77ded/LICENSE).
It isn't MIT-licensed or open source.

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
