# PR Description

Draft structured pull request descriptions from supplied change notes or diffs without inventing unshipped work.

| Asset | Job |
|---|---|
| [pr-description](skills/pr-description/SKILL.md) | Draft a factual pull request description with Summary, Changes, Verification, and Risks / Rollback sections |

## Install

```sh
copilot plugin marketplace add github/plugin-marketplace-starter
copilot plugin install pr-description@plugin-marketplace-starter
```

## Try it

> Draft a pull request description for these changes: added `--timeout` validation in `cli.mjs` and unit tests in `test/cli.test.mjs` (`npm test` passed). Retry backoff (#42) is still open in the backlog.

The skill drafts the description in chat without modifying files, running commands, or opening a pull request unless you ask.
