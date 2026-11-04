# Marketplace Maintainer

Review contributed plugins, maintain remote pins, and prepare releases in a
checkout of this marketplace.

| Asset | Job |
|---|---|
| [plugin-reviewer](com.github.copilot/agents/plugin-reviewer.agent.md) | Review a contribution and report risks and inconsistencies, without editing anything |
| [update-remote-pins](skills/update-remote-pins/SKILL.md) | Review upstream changes and add or update a remote pin |
| [release-plugins](skills/release-plugins/SKILL.md) | Check versions and changelogs, draft release notes, or retire a plugin |

## Install

```sh
copilot plugin marketplace add OWNER/REPO
copilot plugin install marketplace-maintainer@plugin-marketplace-starter
```

Replace `OWNER/REPO` with the GitHub repository that hosts this marketplace.

## Try it

> Delegate this plugin contribution review to plugin-reviewer.
>
> Pin an outside plugin at its latest release.
>
> Get the catalog ready to release.

The skills edit the checkout's files, but don't commit, push, or publish unless
you ask.
