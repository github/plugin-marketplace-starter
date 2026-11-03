---
name: try-plugin-locally
description: "Try a marketplace plugin from a local checkout before publishing or opening a pull request. Use for local installation, Copilot CLI or VS Code discovery checks, and cleaning up a test install. Don't use to publish a plugin or test a remote catalog pin."
---

# Try a plugin locally

Find the user's marketplace checkout, not this installed plugin's directory.
Read its `AGENTS.md`, this skill's [local install guide](references/local-install.md),
and the selected plugin's README and manifest. If the checkout, plugin, or
requested host is missing, ask for it before changing settings. Don't promise
host support that official documentation doesn't state.

1. Choose the least invasive path:
   - For an interactive CLI session, in the checkout or another project, use
     `copilot --plugin-dir "<absolute-plugin-directory>"`. Nothing is installed.
   - For an installation check, follow **Test installation without publishing**
     in the local install guide. Use the Copilot CLI on PATH, a fresh isolated
     `COPILOT_HOME`, and a working directory outside the checkout. Read the actual marketplace name from its catalog.
     Run `plugin marketplace add "<absolute-checkout>"`,
     `plugin install <plugin>@<marketplace>`, `plugin list --json`, and
     `skill list --json` to check the actual enabled skill names.
   - In VS Code, add only this plugin's absolute folder to the experimental
     `chat.pluginLocations` setting, enable `chat.plugins.enabled` if needed,
     and start a new chat. Preserve unrelated settings and record prior values.
     If settings tools aren't available, give these steps to the user rather
     than claiming to have performed them.
2. Confirm discovery: CLI install/list results, or the VS Code skills and agents
   lists. An installation message counts skills, not proof that a hook, MCP
   server, or other part works. The CLI's plugin list doesn't expose agent names;
   verify agent discovery in the interactive host and mark it unverified if
   that can't be done here. Use the plugin README's **Host checks** to try one
   intended task and one non-trigger task. Starting a model session or a paid
   eval needs the user's approval; an install-only check doesn't call a model.
   If the host can't be exercised here, explicitly leave its behavior unverified.
3. Clean up after the check, including a failed check. Uninstall only the copy
   installed for this test with `plugin uninstall <plugin>@<marketplace>` in
   that same isolated home, and confirm the test entry is no longer enabled.
   Remove the isolated marketplace registration if one was added. Restore
   environment variables, working directory, and any VS Code settings changed
   for the test. Delete only the fresh, explicitly resolved test directory.
   For `--plugin-dir`, end the test session; there is no installed copy to remove.
   Never uninstall a pre-existing plugin or delete the user's real Copilot home.
   Report any cleanup failure rather than hiding it.

Return the method, plugin and host, observed discovery and behavior, unverified
checks, and cleanup result. A local-directory marketplace is live, not a copied
published package. Local installation doesn't test a remote pin.
