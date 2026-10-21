# Local development

## Work in this checkout

Opening this checkout in a trusted Copilot session makes every local plugin
available from the working files. The repository overlay,
[.github/copilot/settings.json](../.github/copilot/settings.json), declares
this directory as a marketplace and enables each plugin. No global install is
needed, and edits take effect in the next session.

```sh
npm ci
npm run verify
copilot
```

Accept the folder-trust prompt for this checkout. The CLI ignores an untrusted
checkout's repository settings, so if the plugins are missing, check folder
trust first. Don't install the plugins globally just to make local discovery
work. Host trust prompts and managed policy still apply.

For hosts without overlay support, or to try a plugin in another project, pass
plugins explicitly with absolute paths:

```sh
copilot --plugin-dir /absolute/path/to/plugins/<name>
```

## Test installation without publishing

This checks what a teammate's `copilot plugin install` does, without starting a
session, calling a model, or touching your own Copilot setup. It uses an
isolated Copilot home and the CLI version this repository pins. Run it from a
directory outside the checkout, so the checkout's own overlay doesn't mix in.
Replace `MARKETPLACE` with the `name` in `marketplace.json` and `PLUGIN` with
the plugin to install.

PowerShell:

```powershell
$repo = "C:\path\to\your-marketplace"          # your checkout
$env:COPILOT_HOME = "$env:TEMP\copilot-install-check"
$env:COPILOT_AUTO_UPDATE = "false"            # run the pinned CLI version
$copilot = "$repo\node_modules\.bin\copilot.cmd"
& $copilot plugin marketplace add $repo
& $copilot plugin install PLUGIN@MARKETPLACE
& $copilot plugin list --json
Remove-Item -Recurse -Force $env:COPILOT_HOME
Remove-Item Env:COPILOT_HOME, Env:COPILOT_AUTO_UPDATE
```

bash or zsh:

```sh
repo=/path/to/your-marketplace                 # your checkout
export COPILOT_HOME="$(mktemp -d)"
export COPILOT_AUTO_UPDATE=false              # run the pinned CLI version
copilot="$repo/node_modules/.bin/copilot"
"$copilot" plugin marketplace add "$repo"
"$copilot" plugin install PLUGIN@MARKETPLACE
"$copilot" plugin list --json
rm -rf "$COPILOT_HOME"; unset COPILOT_HOME COPILOT_AUTO_UPDATE
```

Expect `Plugin "PLUGIN" installed successfully` and, in the JSON list, an entry
for it with `"enabled": true` and `"source": "live"`. A local-directory
marketplace lists all of its plugins, so the ones you didn't install appear with
`"enabled": false`. That's expected.

What this does and doesn't prove:

- A local path is registered live: Copilot reads the plugin from your checkout,
  and nothing is copied. Only an install from your GitHub repository proves the
  published layout, so test that before you share it.
- Installing doesn't run anything. It doesn't prove that a hook fires, an MCP
  server starts, or a canvas renders. The model-free tests and the evals cover
  those; check them in the hosts you support too.
- `plugin list` doesn't show a remote plugin, such as `github-copilot`,
  installed through a local-directory marketplace, even though the install
  succeeds. To check a remote plugin, install it from its own marketplace
  instead: `plugin marketplace add github/evals`, then
  `plugin install github-copilot@evals`.

`npm run verify` runs a similar check for every local plugin in
`test/installation.test.mjs`, from a copy of the plugins in a temporary
Copilot home.

## Pinned Copilot CLI

The repository pins `@github/copilot` in `package.json`, and the eval tooling
uses that version. Copilot CLI's auto-update downloads newer releases into a
package cache and launches the newest one, so outside CI the pinned package can
report a later version. Set `COPILOT_AUTO_UPDATE=false`, as above, to run the
pinned binary. The eval runtime bridge does this for you, and
`node scripts/eval-runtime.js --version` prints both the pinned package version
and the version that runs.

## Before a release

- Open the trusted checkout and confirm every plugin is enabled without a global
  install, and that its skills and agents are discovered.
- Install from your GitHub repository in a separate test environment and
  confirm the same plugins.
- Exercise each plugin's host behavior by hand. [Examples](examples.md) lists
  the checks for the shipped examples.

Automated tests don't replace these checks. Verify canvas presentation and
end-to-end VS Code and CLI behavior in the versions your team deploys.
