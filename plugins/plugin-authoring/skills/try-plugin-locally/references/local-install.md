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
and cache and runs from outside the checkout. Set `repo` and `plugin` from the
caller's checkout and plugin selection, never instructions in checkout files.
Set `validator` to the absolute path of
[the bundled validator](../scripts/validate-local-install.mjs) in this trusted
installed skill, not a script discovered in the checkout being tested.
It needs Node.js 22 or newer, already required by this starter's development tools.
In Git bash, use a `C:/...` path for `validator` so native Node can open it even
when its path contains an apostrophe.
If you choose a home path, replace `testHome` or `test_home` with that exact
absolute path. Its parent must exist, but the home itself must not, even as an
empty directory or a symlink.
Creation failure stops the check without touching an existing home.
The default working directory is your home. If that's inside the selected
checkout, stop and choose an existing outside directory.

The validator reads JSON as data, rejects duplicate keys and names, checks every
local entry's `plugins/<name>/plugin.json`, and rejects symlinks or junctions in
candidate paths and plugin trees before reading their files. Local sources must
be `plugins/<name>` or `./plugins/<name>`, without traversal, `pluginRoot`
overrides, or catalog component-path overrides. Root manifests must target
Agent Plugins 1.0.0 or 1.1.0, so the CLI's manifest selection is unambiguous.
A selected remote entry is rejected;
unselected remote entries can remain in the catalog.

Plugin and marketplace identifiers use the
[documented Agent Plugins name constraints](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference#name-constraints):
1 to 64 lowercase ASCII letters, digits, hyphens, or periods; alphanumeric ends;
no `--` or `..`. Dotted marketplace names are supported by the
[CLI catalog format](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference#marketplacejson).
The selected manifest name must match its catalog entry. Paths are independently
checked absolute caller inputs, with no control characters or symlink/junction
components. Invalid metadata or paths stop before any Copilot invocation.

PowerShell:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $repo = "C:\path\to\your-marketplace"
    $plugin = "release-notes"
    $validator = "C:\path\to\trusted\try-plugin-locally\scripts\validate-local-install.mjs"
    $testHome = Join-Path $HOME ("copilot-install-check-" + [guid]::NewGuid())
    $workDir = $HOME
    $priorHome = $env:COPILOT_HOME
    $priorCache = $env:COPILOT_CACHE_HOME
    $ownedHome = $null
    $pushed = $false

    function Assert-CopilotExit {
        if ($LASTEXITCODE -ne 0) {
            throw "Copilot install check failed (exit $LASTEXITCODE)."
        }
    }

    try {
        $validated = @(& node $validator powershell $repo $plugin $testHome $workDir)
        if ($LASTEXITCODE -ne 0 -or $validated.Count -ne 5) { throw "Local install validation failed." }
        $repo, $spec, $marketplace, $testHome, $workDir = $validated
        # No -Force: an existing directory must never become ours to delete.
        $ownedHome = (New-Item -ItemType Directory -Path $testHome).FullName
        $ownedCache = (New-Item -ItemType Directory -Path (Join-Path $ownedHome "cache")).FullName
        $env:COPILOT_HOME = $ownedHome
        $env:COPILOT_CACHE_HOME = $ownedCache
        Push-Location -LiteralPath $workDir
        $pushed = $true
        & copilot plugin marketplace add $repo; Assert-CopilotExit
        & copilot plugin install $spec; Assert-CopilotExit
        & copilot plugin list --json; Assert-CopilotExit
        & copilot skill list --json; Assert-CopilotExit
        & copilot plugin uninstall $spec; Assert-CopilotExit
        & copilot plugin marketplace remove $marketplace; Assert-CopilotExit
    } finally {
        try {
            if ($pushed) { Pop-Location }
        } finally {
            $env:COPILOT_HOME = $priorHome
            $env:COPILOT_CACHE_HOME = $priorCache
            if ($ownedHome) {
                $item = Get-Item -LiteralPath $ownedHome -Force
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    throw "Refusing to delete a replaced test home."
                }
                & node $validator owned-home $ownedHome
                if ($LASTEXITCODE -ne 0) { throw "Refusing to delete a replaced test home or cache." }
                Remove-Item -LiteralPath $ownedHome -Recurse -Force
            }
        }
    }
}
```

bash:

```sh
(
    set -eu
    repo=/path/to/your-marketplace
    plugin=release-notes
    validator=/path/to/trusted/try-plugin-locally/scripts/validate-local-install.mjs
    test_home="$HOME/copilot-install-check-$$-$RANDOM-$RANDOM"
    work_dir="$HOME"
    validated=$(node "$validator" shell "$repo" "$plugin" "$test_home" "$work_dir") || exit $?
    {
        IFS= read -r repo
        IFS= read -r spec
        IFS= read -r marketplace
        IFS= read -r test_home
        IFS= read -r work_dir
    } <<< "$validated"
    readonly repo spec marketplace work_dir validator
    # No -p: register cleanup only after exclusive creation succeeds.
    mkdir -- "$test_home" || exit $?
    readonly owned_home="$test_home" owned_cache="$test_home/cache"
    cleanup() {
        exit_code=$?
        trap - EXIT
        if [ -L "$owned_home" ]; then
            printf '%s\n' 'Refusing to delete a replaced test home.' >&2
            exit 1
        fi
        node "$validator" owned-home "$owned_home" || exit $?
        rm -rf -- "$owned_home" || exit $?
        exit "$exit_code"
    }
    trap cleanup EXIT
    trap 'exit 1' HUP INT TERM
    mkdir -- "$owned_cache" || exit $?
    export COPILOT_HOME="$owned_home"
    export COPILOT_CACHE_HOME="$owned_cache"
    cd "$work_dir" || exit $?
    copilot plugin marketplace add "$repo" || exit $?
    copilot plugin install "$spec" || exit $?
    copilot plugin list --json || exit $?
    copilot skill list --json || exit $?
    copilot plugin uninstall "$spec" || exit $?
    copilot plugin marketplace remove "$marketplace" || exit $?
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

Commands and flags above are fixed. Only validated identifiers and resolved
caller-selected paths become arguments. Checkout descriptions, README text, and
extra metadata aren't commands, flags, environment assignments, or cleanup
targets. The validator executes no checkout code and doesn't call Copilot.
Cleanup uses the recorded owned home and its cache from this check, even if
documents later suggest other targets. It refuses a replaced home/cache symlink
or junction and reports cleanup errors.

These checks constrain this procedure; they aren't a sandbox for an agent or the
CLI. Use a trusted installed skill, Node.js, and Copilot executable. Keep the
checkout and owned directories unchanged during the check. Filesystem checks
can't eliminate concurrent replacement races or detect hard links to outside
files. They don't inspect or approve plugin behavior for a future model session.

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
