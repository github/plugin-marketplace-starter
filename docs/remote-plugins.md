# Remote plugins

The catalog can list plugins that live in another repository. They're opt-in:
the repository overlay never enables a remote plugin, and `npm run verify`
rejects an overlay that does, because checking out this repository must not
activate code fetched from somewhere else. Each developer installs remote
plugins themselves. Local checks validate a remote entry's metadata only; they
never download or run upstream code, and the local evals don't cover remote
assets.

## The GitHub Copilot Evals plugin

[marketplace.json](../marketplace.json) includes a `github-copilot` entry that
points at the published GitHub Copilot Evals plugin in
[github/evals](https://github.com/github/evals). It mirrors the stable entry in
upstream's own catalog, pinned to a release tag and its full commit SHA:

```json
{
  "name": "github-copilot",
  "source": {
    "source": "github",
    "repo": "github/evals",
    "ref": "copilot-evals-v0.16.0",
    "sha": "dd4c5015b5e8fdfcbd17b261d996c85aa92fde5b",
    "path": "packages/plugin"
  },
  "version": "0.16.0"
}
```

After adding this marketplace, install it explicitly with
`copilot plugin install github-copilot@MARKETPLACE`, where `MARKETPLACE` is the
`name` in `marketplace.json`. Or skip this catalog and install it from
upstream, which follows upstream's reviewed stable releases:

```sh
copilot plugin marketplace add github/evals
copilot plugin install github-copilot@evals
```

Pick one route. Don't install the same plugin from both marketplaces.

The pinned release is the built plugin. It provides the native `/eval` command
(`/eval setup`, `create`, `review`, `improve`, `run`, and `compare`) in the CLI
and Copilot App, a canvas, and six model-invocable skills. Running an eval
needs a compatible runner and its own approval, and it spends AI credits. See
the [upstream install guide](https://github.com/github/evals/blob/main/website/src/content/guides/install/plugin.md)
for VS Code and Copilot App setup. This repository's eval tooling works without
it.

The `github/evals` repository is currently private, so each installer needs a
GitHub account with access. This catalog entry doesn't grant access or copy
upstream code. If your team doesn't have access, delete the entry from
`marketplace.json`.

## Reference your own remote plugin

Add a GitHub source object like the `github-copilot` entry:

- The catalog `name` must equal the `name` in the upstream plugin's
  `plugin.json`, not the upstream marketplace's name. Upstream publishes a
  plugin called `github-copilot` in a marketplace called `evals`, so its
  install name here is `github-copilot@<this marketplace>`, and upstream's is
  `github-copilot@evals`.
- `path` is repository-relative, without traversal or backslashes. Confirm it
  and the name against the upstream manifest.
- Pin a `ref` and a full 40-character commit `sha` so installs are reproducible
  and immune to tag or branch moves. Refresh them deliberately when upstream
  releases. `npm run verify` warns about a remote entry without them.
- Document any private-repository access requirement.
- Don't add remote plugins to the repository overlay.
