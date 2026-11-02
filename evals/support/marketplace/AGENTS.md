# Maintaining this marketplace

This is a synthetic GitHub Copilot plugin marketplace for evals.

- Each local plugin lives in `plugins/<name>/` with `plugin.json`, `README.md`,
  and `CHANGELOG.md`. It's listed in `marketplace.json` and enabled in
  `.github/copilot/settings.json`.
- Any change under `plugins/<name>/` needs a new version in `plugin.json` and
  `marketplace.json`, and a matching `## <version>` heading in `CHANGELOG.md`.
- Remote plugins pin a full commit `sha` and are never enabled in
  `.github/copilot/settings.json`.
- A plugin's evals live in `evals/<name>/`.
