## What and why

<!-- Describe the change. Link the issue it addresses, if there is one; a new plugin should have one. -->

## Checklist

<!-- Check each item, or mark it N/A with a short reason. -->

- [ ] For each changed plugin, bumped `version` in `plugin.json` and `marketplace.json`, and added a `CHANGELOG.md` entry. Any change under `plugins/<name>/` needs one.
- [ ] Kept the catalog description identical to the manifest, and the plugin enabled in `.github/copilot/settings.json`.
- [ ] Updated the plugin's README.
- [ ] `npm run verify` passes.
- [ ] Used only synthetic data; no secrets, tokens, or private code.

## Risk

<!-- For a new plugin, or one that changes what it can run, read, write, or reach, fill in this table. Write "none" where it doesn't apply. -->

| Question | Answer |
|---|---|
| What runs, and when: hooks and their events, MCP servers, extensions, scripts | |
| Files it reads or writes, and how it limits them | |
| Network destinations | |
| Credentials or tokens it uses, and where they come from | |
| Data it keeps, where, and for how long | |
| Data it sends to the model | |
| New dependencies, their licenses, and install scripts | |
| Remote sources: repository, path, and pinned sha | |
| Who owns it, and who approved it | |

## Paid evals

<!-- List the evals you ran, for example `npm run eval -- --suite smoke`, and their results, or say "None". -->
