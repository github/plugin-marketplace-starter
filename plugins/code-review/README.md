# Code review

A read-only review workflow: one portable skill plus one Copilot custom agent.
The skill frames the review and delegates an evidence-backed pass to the agent.
The agent also works on its own.

| Asset | Path | Use when |
|---|---|---|
| `adversarial-review` skill | [SKILL.md](skills/adversarial-review/SKILL.md) | Asking for an adversarial or defect-focused review of code, a diff, or a plan |
| `code-reviewer` agent | [code-reviewer.agent.md](com.github.copilot/agents/code-reviewer.agent.md) | Delegating a read-only specialist pass directly |

## What this teaches

- **Skill plus agent:** a skill can delegate to a bundled agent by its advertised
  identifier. Copilot CLI names the installed agent `code-review:code-reviewer`.
  A workspace-staged profile appears as `code-reviewer`.
- **Read-only tools:** the agent only gets `read` and `search`. It never edits,
  runs code, commits, or posts comments.
- **No quota:** a clean result is valid. The agent returns
  `No actionable findings.` rather than inventing defects.

## Try it

> Use adversarial-review to review this diff without changing it.

Or select the agent directly with `--agent code-review:code-reviewer` or the
agent picker.

## Customize

Tune the agent's checklist for your stack, and keep the skill's delegation step
pointed at the agent's identifier. If you rename the agent, update the skill,
evals, and this README together.
