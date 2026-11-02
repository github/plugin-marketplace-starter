# Maintaining this marketplace

This repository is a GitHub Copilot plugin marketplace. [README.md](README.md)
explains how it works and its commands, and [CONTRIBUTING.md](CONTRIBUTING.md) explains
how to contribute. Update those in place; don't duplicate them here.

<!-- plugin:plugin-authoring -->
- Use the `plugin-authoring` skills to add a plugin, try one locally, and
  prepare a pull request.
<!-- /plugin:plugin-authoring -->
<!-- plugin:marketplace-maintainer -->
- Use the `marketplace-maintainer` skills for remote pins and releases, and the
  read-only `plugin-reviewer` agent to review a plugin contribution.
<!-- /plugin:marketplace-maintainer -->
- Add a plugin with `npm run new-plugin -- <name>`, remove one with
  `npm run remove-plugin -- <name>`, and rename the marketplace with
  `npm run rename-marketplace`. Don't edit the catalog and the repository
  overlay by hand for these.
- Every local plugin lives in `plugins/<name>/` with `plugin.json`,
  `README.md`, and `CHANGELOG.md`, and is listed in `marketplace.json` and
  enabled in `.github/copilot/settings.json`. Keep each plugin self-contained
  and installable on its own.
- Any change under `plugins/<name>/` needs a new version in `plugin.json` and
  `marketplace.json`, and a matching `## <version>` heading in `CHANGELOG.md`.
- Keep remote plugins opt-in: never enable one in
  `.github/copilot/settings.json`. A remote entry pins a full commit `sha` and
  names its `ref`. `npm run check-remotes` checks pins against GitHub; it uses
  the network, so it isn't part of `verify`.
- A plugin's evals, graders, and fixtures live in `evals/<name>/`, outside the
  plugin. Use only synthetic data in them.
- Run `npm run verify` before you finish. It never calls a model.
  `npm run eval` and the evals workflow run real Copilot sessions and spend AI
  credits; don't run them unless the user asks.
- Keep secrets and token-bearing URLs out of files. Don't commit, push, publish,
  change visibility, or change GitHub permissions unless the user asks.
