# Try a plugin locally

## For one session

Opening the marketplace checkout turns on only its own maintenance plugins,
listed in `.github/copilot/settings.json`. To try any other plugin in a Copilot
CLI session, in the checkout or another project, pass it with an absolute path. Nothing is installed, and edits take effect in the next
session:

```sh
copilot --plugin-dir /absolute/path/to/plugins/<name>
```

## In VS Code

Register the plugin's folder with the experimental `chat.pluginLocations`
setting, make sure `chat.plugins.enabled` is on, and start a new chat:

```json
"chat.pluginLocations": {
  "/absolute/path/to/your-marketplace/plugins/release-notes": true
}
```

Confirm the plugin's skills appear in **Chat: Configure Skills**. See
[use local plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins#_use-local-plugins).

## Test installation without publishing

This checks what a teammate's `copilot plugin install` does, without starting a
session or calling a model. It uses an isolated Copilot home and runs from
outside the checkout. Replace `MARKETPLACE` with the `name` in `marketplace.json` and
`PLUGIN` with the plugin to install.

PowerShell:

```powershell
$repo = "C:\path\to\your-marketplace"          # the checkout
$env:COPILOT_HOME = "$env:TEMP\copilot-install-check"
Push-Location $env:TEMP                       # outside the checkout
copilot plugin marketplace add $repo
copilot plugin install PLUGIN@MARKETPLACE
copilot plugin list --json
copilot skill list --json
copilot plugin uninstall PLUGIN@MARKETPLACE
Pop-Location
Remove-Item -Recurse -Force $env:COPILOT_HOME
Remove-Item Env:COPILOT_HOME
```

bash or zsh:

```sh
repo=/path/to/your-marketplace                 # the checkout
export COPILOT_HOME="$(mktemp -d)"
cd "$COPILOT_HOME"                            # outside the checkout
copilot plugin marketplace add "$repo"
copilot plugin install PLUGIN@MARKETPLACE
copilot plugin list --json
copilot skill list --json
copilot plugin uninstall PLUGIN@MARKETPLACE
cd - >/dev/null; rm -rf "$COPILOT_HOME"; unset COPILOT_HOME
```

`.copilot-home/` inside the checkout is gitignored if you'd rather keep the
isolated home there; still run the commands from another directory.

Expect `Plugin "PLUGIN" installed successfully` and, in the JSON list, an entry
for it with `"enabled": true` and `"source": "live"`. The other plugins in a
local-directory marketplace appear with `"enabled": false`.
`skill list --json` should list the plugin's skills with `"source": "plugin"`
and `"enabled": true`. The plugin list doesn't show agent names; confirm agents
in the interactive host.

What this does and doesn't prove:

- A local path is registered live: Copilot reads the plugin from the checkout,
  and nothing is copied. Only an install from the GitHub repository proves the
  published layout.
- Installing doesn't run anything, so it doesn't prove that a hook fires or an
  MCP server starts. Try one intended task by hand in each host you support.
- Remote plugins can't be tested this way. Copilot removes a downloaded remote
  plugin from a local-directory marketplace on the next command.
