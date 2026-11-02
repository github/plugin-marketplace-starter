# Marketplace Maintainer

Review contributed plugins, maintain remote pins, and prepare marketplace releases.

For owners of a checkout of this marketplace starter or a renamed copy. Its
workflows use that checkout's guides, catalog, and maintenance scripts.

| Asset | Job |
|---|---|
| [plugin-reviewer](com.github.copilot/agents/plugin-reviewer.agent.md) | Read-only contribution review: runtime/data risks, layout, versions, registrations, and evals (O2) |
| [update-remote-pins](skills/update-remote-pins/SKILL.md) | Review upstream changes and deliberately add/update an opt-in remote pin (O3) |
| [release-plugins](skills/release-plugins/SKILL.md) | Validate versions/changelogs, draft release notes, fix catalog health, or retire a plugin (O4, O5) |

Review is an agent only, with `read` and `search` tools and no matching skill.
It returns findings in chat, never posts comments or runs `verify`; the Validate
workflow provides that evidence. Custom-agent support in the Copilot app is
not verified. Skills work in hosts that support Agent Skills.

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

The skills can edit the catalog/workspace and run maintenance commands.
Remote-pin checks read GitHub using host authentication, but don't install or
execute upstream code. Pinning isn't proof of safety, and remote plugins remain
opt-in. Retirement needs explicit approval. Commits, pushes, publishing, and
paid evals need a separate request. There are no automatic hooks or servers.

## Host checks

Before a release, try these by hand in each host you support. Automated tests
and evals don't prove that a host loads or shows everything.

- In Copilot CLI and VS Code, confirm the two skills and `plugin-reviewer` agent
  are discovered.
- Delegate a contribution with a known catalog/version mismatch; confirm the
  agent cites the evidence, edits nothing, and states its validation limit.
- Review a clean contribution; a clean finding is accepted.
- In a disposable checkout, update a reviewed remote pin and confirm full
  SHA/ref/version, upstream-change summary, and no overlay enablement.
- Prepare release notes; confirm `verify` runs and no tag/release is published.
- Retire a disposable plugin only after approval and confirm registrations and
  owned files are removed without deleting shared tooling.
- Ask an unrelated question; neither the skills nor the agent should run.
