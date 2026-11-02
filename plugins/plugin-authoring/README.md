# Plugin Authoring

Scaffold, try locally, and prepare contributions to this plugin marketplace.

For contributors working in a checkout of this marketplace starter or a renamed
copy. The skills edit that checkout's files; installing this plugin doesn't
turn another repository into a marketplace.

| Asset | Job |
|---|---|
| [add-plugin](skills/add-plugin/SKILL.md) | Create a new plugin's shell and register it in the catalog and overlay |
| [try-plugin-locally](skills/try-plugin-locally/SKILL.md) | Check CLI or VS Code discovery before publishing and clean up the test copy |
| [submit-plugin](skills/submit-plugin/SKILL.md) | Check compatibility, bump versions and changelogs, and write the pull request description |

There are no hooks, servers, or automatic actions.

## Install

```sh
copilot plugin marketplace add OWNER/REPO
copilot plugin install plugin-authoring@plugin-marketplace-starter
```

Replace `OWNER/REPO` with the GitHub repository that hosts this marketplace.

## Try it

> Add a plugin named release-notes to this marketplace.
>
> Let me try my plugin locally before I open a PR.
>
> Get my plugin ready for a pull request.

The skills can write workspace files and run repository commands when invoked.
Local install checks use an isolated Copilot home; VS Code tests may require
temporary settings changes. PR creation, commits, pushes, publishing, and paid
evals need a separate request. Static validation doesn't prove behavior.

## Host checks

Before a release, try these by hand in each host you support. Automated tests
and evals don't prove that a host loads or shows everything.

- Confirm all three skills are discovered in Copilot CLI and VS Code.
- In a disposable marketplace checkout, ask for a new plugin and confirm
  `add-plugin` creates only `plugin.json`, `README.md`, and `CHANGELOG.md`, and
  registers the plugin in `marketplace.json` and the repository overlay.
- Test CLI installation in an isolated home, confirm discovery, then confirm
  the test copy is uninstalled and the real home is unchanged.
- In VS Code, try the local plugin-location route, then restore settings.
- Prepare an existing plugin update; confirm a suitable version/changelog and
  a complete PR draft, with no PR posted.
- Ask an unrelated question; none of these skills should run.
