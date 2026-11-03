# Remote pins

The catalog can list plugins that live in another repository. Like every plugin
in the marketplace, people install them only if they choose to.

## The entry

```json
{
  "name": "anarlog",
  "source": {
    "source": "github",
    "repo": "fastrepl/anarlog",
    "path": "agent-plugins/anarlog",
    "ref": "main",
    "sha": "259b68866a7d6c331cd428aaa33a33300a700c5d"
  },
  "version": "1.3.0",
  "description": "Search local Anarlog meetings or connect to Cloud with OAuth.",
  "homepage": "https://docs.anarlog.so/agents/overview"
}
```

| Field | Rule |
|---|---|
| `name` | Required. Must equal the `name` in the upstream plugin's `plugin.json`, not the repository or upstream marketplace name. |
| `source.source` | Required. Only `github` is supported. |
| `source.repo` | Required. `OWNER/REPO`, not a URL. |
| `source.path` | The directory that holds `plugin.json`, relative to the repository root, such as `packages/plugin`. No leading `./` or `/`, no `..`, and no backslashes. Omit it when `plugin.json` is at the root. |
| `source.sha` | Required. The full 40-character commit SHA you reviewed. A tag or branch can move; a commit can't. |
| `source.ref` | Recommended. The release tag or branch the SHA came from, so reviewers can tell what's pinned. |
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
a later commit; pin the commit their own catalog uses.

## Check a pin

Before and after an update, confirm with `gh api` that the SHA exists, that
`plugin.json` is at `path` at that SHA, and that its `name` and `version`
match the catalog entry. Note when `ref` has moved away from the pin, and
when upstream has a newer release.

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
