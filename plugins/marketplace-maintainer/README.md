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
copilot plugin marketplace add github/plugin-marketplace-starter
copilot plugin install marketplace-maintainer@plugin-marketplace-starter
```

## Try it

> Delegate this contribution review to plugin-reviewer using the attached
> diff, its explicit comparison base, and the base catalog/manifests.
>
> Pin an outside plugin at its latest release.
>
> Get the catalog ready to release.

The skills edit the checkout's files, but don't commit, push, or publish unless
you ask.

The reviewer has read/search tools, not Git or shell access. Supply the actual
diff and base files, not just changed paths, or it can only review the current
files. For CLI `--agent` selection, use
`--agent marketplace-maintainer:plugin-reviewer`; the portable agent name
remains `plugin-reviewer`.
