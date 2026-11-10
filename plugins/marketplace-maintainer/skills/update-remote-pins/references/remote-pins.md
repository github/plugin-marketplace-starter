# Remote pins

The catalog can list plugins that live in another repository. Like every plugin
in the marketplace, people install them only if they choose to.

## The entry

```json
{
  "name": "example-plugin",
  "source": {
    "source": "github",
    "repo": "OWNER/REPO",
    "path": "plugins/example-plugin",
    "ref": "v1.2.0",
    "sha": "<full 40-character commit SHA>"
  },
  "version": "1.2.0",
  "description": "What the plugin does, in one sentence.",
  "homepage": "https://github.com/OWNER/REPO"
}
```

| Field | Rule |
|---|---|
| `name` | Required. Must equal the `name` in the upstream plugin's `plugin.json`, not the repository or upstream marketplace name. |
| `source.source` | Required. Only `github` is supported. |
| `source.repo` | Required. `OWNER/REPO`, not a URL. |
| `source.path` | The directory that holds `plugin.json`, relative to the repository root, such as `packages/plugin`. No leading `./` or `/`, no `..`, and no backslashes. Omit it when `plugin.json` is at the root. |
| `source.sha` | Required. The full 40-character commit SHA you reviewed. A tag or branch can move; a commit can't. |
| `source.ref` | Recommended. A release tag or branch that resolves to the pinned SHA. Validation fails if it resolves elsewhere, including after a ref moves. |
| `version` | Optional. The upstream `plugin.json` version at that SHA. |
| `description`, `homepage` | Optional, but they help people choose. |

No other `source` fields are allowed, and credentials never go in the catalog.
Installers authenticate with their own GitHub account; document any
private-repository access requirement.

## Find the SHA and the upstream manifest

```sh
gh api repos/OWNER/REPO/commits/REF --jq .sha
git ls-remote https://github.com/OWNER/REPO REF
gh api "repos/OWNER/REPO/contents/PATH/plugin.json?ref=SHA" -H "Accept: application/vnd.github.raw"
```

For an annotated tag, `git ls-remote` also lists a `REF^{}` line; that's the
commit to pin.

`commits/REF` returns the commit a tag points at, even for an annotated tag,
whose own object ID differs. Some projects tag a release and then build it in
a later commit. If their own catalog pins that build commit, use a matching
build ref or omit the optional `ref`; don't label it with a different tag's SHA.

For "latest stable", `gh api repos/OWNER/REPO/releases/latest` excludes
prereleases and drafts. If it returns 404, first confirm repository access with
`gh api repos/OWNER/REPO`, then inspect
`gh api --paginate 'repos/OWNER/REPO/releases?per_page=100'`. Only a successful
listing establishes whether accessible non-draft releases are prerelease-only
or absent. Don't turn auth, network, or server failures into "no releases".
Preserve the user's channel and named ref. The starter's `eval` pin is in the
`copilot-evals` prerelease channel; a stable-only request mustn't select it.
If the channel isn't established, ask before selecting a prerelease.

For a successfully confirmed tag-only repo, inspect
`gh api --paginate 'repos/OWNER/REPO/tags?per_page=100'` (or `git ls-remote --tags`).
Tags aren't necessarily ordered by plugin version, and monorepos can mix
products. Use the requested product/ref, or ask for an explicit candidate;
don't guess the newest plugin from the first tag. Resolve and review that
candidate as above before editing the pin.

## Check a pin

Before and after an update, confirm with `gh api` that the SHA exists, that
`plugin.json` is at `path` at that SHA, and that its `name` and `version`
match the catalog entry. When `ref` is supplied, resolve it in the named
upstream repository and require that its commit matches `sha`. A moved or
mismatched ref fails validation. Review upstream changes before updating the
pin; don't change the SHA just to make the check pass.

## Keep pins current

Nothing updates remote pins automatically. On a regular cadence, or when
upstream announces a release:

1. Check each pin as described above.
2. Review what changed upstream between the pinned SHA and the new one.
3. Update `sha`, `ref`, and `version` together.
4. Say in the pull request what you reviewed.

After a pin changes, users pick it up with `copilot plugin marketplace update`,
then `copilot plugin update <plugin>@<marketplace>`.

## Testing a remote entry

A remote entry can't be fully tested from a local checkout: when a marketplace
is added from a local directory, Copilot CLI removes a downloaded remote plugin
on the next command. Check the pin with `gh api`, or push the change to a
repository you control and add that repository as the marketplace. Installing
from upstream's own marketplace tests upstream's current version, not the pin.

## Policy

Pinning names the code you reviewed; it doesn't make it safe. Review a remote
plugin as you'd review any dependency: what it runs, the files and network
destinations it uses, its credentials, the data it keeps or sends to the model,
and its dependencies and licenses. Removing an entry doesn't stop people
installing the same plugin from another marketplace.
