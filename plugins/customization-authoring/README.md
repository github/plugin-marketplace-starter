# Customization authoring

One portable skill that turns a repeatable task into a focused `SKILL.md` and a
Vally eval with a real task case and a non-trigger case. No hooks, agents, MCP
servers, or runtime dependencies.

| Skill | Use when |
|---|---|
| `skill-authoring` | Creating or improving a reusable skill together with its evals |

## Install

```sh
copilot plugin marketplace add OWNER/REPO
copilot plugin install customization-authoring@MARKETPLACE
```

In this starter, `OWNER/REPO` is `github/plugin-marketplace-starter` and
`MARKETPLACE` is `plugin-marketplace-starter`. Both change when you create
your own repository with **Use this template**; see
[Make it yours](../../README.md#make-it-yours) and
[Install the examples](../../README.md#install-the-examples) for VS Code.

## What this teaches

- **Discovery:** the description names the authoring task and excludes ordinary
  coding and factual questions.
- **Progressive disclosure:** the skill reads its [eval reference](skills/skill-authoring/references/evals.md)
  only when it writes the eval.
- **Workspace boundaries:** generated files go under the active workspace root,
  never inside the installed skill directory.
- **Honest results:** the skill distinguishes static inspection from an eval
  that actually ran, and it doesn't run paid evals unless asked.

## Try it

> Create a skill and evals for summarizing a changelog.

The skill asks only for details that change the result, then writes the skill and
an `eval.yaml` that loads it, checks an outcome, and includes an unrelated prompt
that must not trigger it.

## Customize

Point the eval reference at your team's conventions, such as required tags or a
suite name. Keep this skill's own evaluation data out of the skill directory.
