---
name: pr-description
description: "Draft a structured pull request description in chat from supplied change notes, commit summaries, or a diff. Use when asked to write or format a general PR description or summary. Don't use for marketplace plugin submission or version/changelog bumps (use submit-plugin), scaffolding plugins, reviewing code for defects, or unrelated questions."
---

# Draft a pull request description

Draft a concise, factual pull request description in chat using only the supplied change notes, commit list, or diff.

1. Use these exact Markdown headings in order:
   - `## Summary` — one or two sentences stating what changed and why.
   - `## Changes` — flat bullet list of shipped changes naming the affected files, flags, or behavior.
   - `## Verification` — exact test or check commands and outcomes supplied by the user, or `Not provided.` if no verification evidence was supplied. Never invent test runs.
   - `## Risks / Rollback` — concrete operational risk or compatibility note and how to revert, or `Low risk; revert the commit if needed.` when none is supplied.
2. Keep `## Changes` strictly limited to work included in this pull request. Exclude unshipped, deferred, or open backlog items from `## Changes`; if the notes mention deferred work, state in `## Summary` or `## Risks / Rollback` that it remains out of scope.
3. Don't inspect unrelated files, edit the workspace, run commands, commit, push, or create a pull request unless separately requested.
