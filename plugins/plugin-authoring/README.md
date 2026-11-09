# Plugin Authoring

Scaffold, try locally, and prepare contributions to this plugin marketplace.

| Asset | Job |
|---|---|
| [add-plugin](skills/add-plugin/SKILL.md) | Create a new plugin's shell and add it to the catalog |
| [try-plugin-locally](skills/try-plugin-locally/SKILL.md) | Try a new or edited plugin from your checkout in a fresh session; optionally check installation |
| [submit-plugin](skills/submit-plugin/SKILL.md) | Bump versions and changelogs and write the pull request description |

## Install

```sh
copilot plugin marketplace add github/plugin-marketplace-starter
copilot plugin install plugin-authoring@plugin-marketplace-starter
```

## Try it

> Add a plugin named release-notes to this marketplace.
>
> I'm on the branch with my plugin edits. Prepare the local Copilot CLI session command before I open a PR.
>
> Get my plugin ready for a pull request.

The skills edit the checkout's files, but don't commit, push, or open a pull
request unless you ask.

Local testing uses `copilot --plugin-dir "<absolute-local-plugin-folder>"` in a
fresh session, keeping your branch and uncommitted changes. Preparing the command
doesn't start a model session or verify discovery or behavior. For an explicit
installation check instead, use the separate
[install-check procedure](skills/try-plugin-locally/references/local-install.md#test-installation-without-publishing).
