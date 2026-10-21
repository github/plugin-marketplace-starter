## What and why

<!-- Describe the change and link the issue it addresses. -->

## Checklist

- [ ] For each changed plugin, bumped `version` in `plugin.json` and `marketplace.json`, and added a `CHANGELOG.md` entry.
- [ ] Kept the catalog description identical to the manifest, and the plugin enabled in `.github/copilot/settings.json`.
- [ ] Updated `.vally.yaml` `paths.skills` and `params` for added, renamed, or removed plugins.
- [ ] Added or updated evals with invocation and outcome assertions, smoke coverage, and a negative control.
- [ ] Ran `npm run build` if sources of generated files changed, and committed the `dist/` output.
- [ ] `npm run verify` passes.
- [ ] Used only synthetic data; no secrets, tokens, or private code.

## Risk

- [ ] This adds or changes a hook, MCP server, extension, agent tool list, or workflow. Explain what it can do and why it needs that:

## Paid evals

<!-- List the evals you ran, for example `node scripts/evals.mjs eval --eval-spec evals/<name>/eval.yaml`, and their results, or say "None". -->
