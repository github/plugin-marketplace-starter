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
session or calling a model. It uses a fresh, exclusively created Copilot home
and cache and runs from outside the checkout. Replace `MARKETPLACE` with the
`name` in `marketplace.json` and `PLUGIN` with the plugin to install.
If you choose a home path, replace `testHome` or `test_home` with that exact
absolute path. Its parent must exist, but the home itself must not, even as an
empty directory or a symlink.
Creation failure stops the check without touching an existing home.
Set `workDir` or `work_dir` to a directory outside the checkout.

PowerShell:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $repo = "C:\path\to\your-marketplace"
    $testHome = Join-Path $HOME ("copilot-install-check-" + [guid]::NewGuid())
    $workDir = $HOME                         # outside the checkout
    $priorHome = $env:COPILOT_HOME
    $priorCache = $env:COPILOT_CACHE_HOME
    $ownedHome = $null
    $pushed = $false

    function Invoke-TestCopilot {
        & copilot @args
        if ($LASTEXITCODE -ne 0) {
            throw "Copilot install check failed (exit $LASTEXITCODE)."
        }
    }

    try {
        if (-not [IO.Path]::IsPathFullyQualified($testHome)) {
            throw "The test home must be an absolute, new path."
        }
        if (-not (Test-Path -LiteralPath (Split-Path $testHome -Parent) -PathType Container)) {
            throw "The test home's parent must already exist."
        }
        # No -Force: an existing directory must never become ours to delete.
        $ownedHome = (New-Item -ItemType Directory -Path $testHome).FullName
        $env:COPILOT_HOME = $ownedHome
        $env:COPILOT_CACHE_HOME = Join-Path $ownedHome "cache"
        Push-Location -LiteralPath $workDir
        $pushed = $true
        Invoke-TestCopilot plugin marketplace add $repo
        Invoke-TestCopilot plugin install PLUGIN@MARKETPLACE
        Invoke-TestCopilot plugin list --json
        Invoke-TestCopilot skill list --json
        Invoke-TestCopilot plugin uninstall PLUGIN@MARKETPLACE
        Invoke-TestCopilot plugin marketplace remove MARKETPLACE
    } finally {
        try {
            if ($pushed) { Pop-Location }
        } finally {
            $env:COPILOT_HOME = $priorHome
            $env:COPILOT_CACHE_HOME = $priorCache
            if ($ownedHome -and (Test-Path -LiteralPath $ownedHome)) {
                $item = Get-Item -LiteralPath $ownedHome -Force
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    throw "Refusing to delete a replaced test home."
                }
                Remove-Item -LiteralPath $ownedHome -Recurse -Force
            }
        }
    }
}
```

bash or zsh:

```sh
(
    set -eu
    repo=/path/to/your-marketplace
    test_home="$HOME/copilot-install-check-$$-$RANDOM-$RANDOM"
    work_dir="$HOME"                         # outside the checkout
    case "$test_home" in
        /*) ;;
        *) printf '%s\n' 'The test home must be an absolute, new path.' >&2; exit 1 ;;
    esac
    # No -p: register cleanup only after exclusive creation succeeds.
    mkdir -- "$test_home" || exit $?
    readonly test_home
    cleanup() {
        exit_code=$?
        trap - EXIT
        if [ -L "$test_home" ]; then
            printf '%s\n' 'Refusing to delete a replaced test home.' >&2
            exit 1
        fi
        rm -rf -- "$test_home" || exit $?
        exit "$exit_code"
    }
    trap cleanup EXIT
    trap 'exit 1' HUP INT TERM
    export COPILOT_HOME="$test_home"
    export COPILOT_CACHE_HOME="$test_home/cache"
    cd "$work_dir" || exit $?
    copilot plugin marketplace add "$repo" || exit $?
    copilot plugin install PLUGIN@MARKETPLACE || exit $?
    copilot plugin list --json || exit $?
    copilot skill list --json || exit $?
    copilot plugin uninstall PLUGIN@MARKETPLACE || exit $?
    copilot plugin marketplace remove MARKETPLACE || exit $?
)
```

On success, these recipes uninstall the test plugin and remove its marketplace
registration. On failure, they still delete the owned test home and cache,
discarding the isolated state. Cleanup errors are reported. PowerShell restores
the prior home, cache, and location in `finally`; the shell subshell leaves the
parent's environment and location unchanged.

`.copilot-home/` inside the checkout is gitignored if you'd rather create a new
home beneath it; still run the commands from another directory. Neither recipe
reuses or deletes an existing home.

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
