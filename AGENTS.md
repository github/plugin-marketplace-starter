# Maintaining this marketplace

This repository is a GitHub Copilot plugin marketplace, maintained by editing
its files directly. [README.md](README.md) shows the steps.

- Each local plugin lives in `plugins/<name>/` with `plugin.json`,
  `README.md`, and `CHANGELOG.md`. It's listed in `marketplace.json` with the
  same `name`, `version`, and `description`. Keep each plugin self-contained
  and installable on its own. Don't add repository settings that install or
  turn on plugins; people install only the plugins they want.
- Any change under `plugins/<name>/` needs a new version in `plugin.json` and
  `marketplace.json`, and a matching `## <version>` heading in `CHANGELOG.md`.
- When you add or remove a plugin, update the catalog and the README's plugin
  table and install commands together.
- Remote plugins pin a full 40-character commit `sha` and name their `ref`.
- A plugin's evals, graders, and fixtures live in `evals/<name>/`, outside the
  plugin. Files several plugins share live in `evals/_shared/`, which can't
  collide with a plugin because plugin names start with a lowercase letter or
  digit. Use only synthetic data.
- `npm run lint` checks skills and eval files and never calls a model. CI also
  validates each `plugin.json` against the Agent Plugins schema, matches local
  catalog entries to their `plugin.json`, and checks remote pins.
  `npm run eval` and the evals workflow run real Copilot sessions and spend AI
  credits; don't run them unless the user asks.
- Use the `plugin-authoring` and `marketplace-maintainer` skills and the
  read-only `plugin-reviewer` agent when they fit the task.
- Keep secrets and token-bearing URLs out of files. Don't commit, push, publish,
  change visibility, or change GitHub permissions unless the user asks.
