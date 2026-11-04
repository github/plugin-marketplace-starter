# Plugin Authoring

Scaffold, try locally, and prepare contributions to this plugin marketplace.

| Asset | Job |
|---|---|
| [add-plugin](skills/add-plugin/SKILL.md) | Create a new plugin's shell and add it to the catalog |
| [try-plugin-locally](skills/try-plugin-locally/SKILL.md) | Install a plugin from your checkout to check it works, then clean up |
| [submit-plugin](skills/submit-plugin/SKILL.md) | Bump versions and changelogs and write the pull request description |

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

The skills edit the checkout's files, but don't commit, push, or open a pull
request unless you ask.
