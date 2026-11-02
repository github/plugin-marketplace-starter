# Remote pins

The catalog can list plugins that live in another repository. They're opt-in:
the repository overlay never enables a remote plugin, and `npm run verify`
rejects an overlay that does, because checking out the marketplace must not
activate code fetched from somewhere else. Each developer installs remote
plugins themselves. Local checks validate a remote entry's metadata only; they
never download or run upstream code.

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
| `source.ref` | Recommended. The release tag or branch the SHA came from. `verify` warns without it. |
| `version` | Optional. The upstream `plugin.json` version at that SHA. |
| `description`, `homepage` | Optional, but they help people choose. |

No other `source` fields are allowed, and credentials never go in the catalog.
Installers authenticate with their own GitHub account; document any
private-repository access requirement.

## Find the SHA and the upstream manifest

```sh
gh api repos/OWNER/REPO/commits/REF --jq .sha
gh api "repos/OWNER/REPO/contents/PATH/plugin.json?ref=SHA" -H "Accept: application/vnd.github.raw"
```

`commits/REF` returns the commit a tag points at, even for an annotated tag,
whose own object ID differs. Some projects tag a release and then build it in
a later commit; pin the commit their own catalog uses.

## Check pins against GitHub

```sh
npm run check-remotes
npm run check-remotes -- anarlog
```

This uses the network, so `npm run verify` doesn't run it. For each remote
entry it confirms that the repository and SHA exist, that `plugin.json` is at
`path` at that SHA, and that its `name` and `version` match the catalog. It
notes a legacy manifest location, a `ref` that has moved away from the pin,
and a newer upstream release. It authenticates with `GH_TOKEN` or
`GITHUB_TOKEN`, or the GitHub CLI login.

## Keep pins current

Nothing updates remote pins automatically. On a regular cadence, or when
upstream announces a release:

1. Run `npm run check-remotes` and read its notes.
2. Review what changed upstream between the pinned SHA and the new one.
3. Update `sha`, `ref`, and `version` together, and run `npm run verify` and
   `npm run check-remotes`.
4. Say in the pull request what you reviewed.

After a pin changes, users pick it up with `copilot plugin marketplace update`,
then `copilot plugin update <plugin>@<marketplace>`.

## Testing a remote entry

A remote entry can't be fully tested from a local checkout: when a marketplace
is added from a local directory, Copilot CLI removes a downloaded remote plugin
on the next command. Use `npm run check-remotes`, or push the change to a
repository you control and add that repository as the marketplace. Installing
from upstream's own marketplace tests upstream's current version, not the pin.

## Policy

Pinning names the code you reviewed; it doesn't make it safe. Review a remote
plugin as you'd review any dependency: what it runs, the files and network
destinations it uses, its credentials, the data it keeps or sends to the model,
and its dependencies and licenses. Removing an entry doesn't stop people
installing the same plugin from another marketplace.
