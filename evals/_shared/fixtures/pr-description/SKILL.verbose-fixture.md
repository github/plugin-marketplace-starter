---
name: pr-description
description: "Use this skill for anything related to pull requests, git branches, release notes, changelogs, code reviews, bug reports, or summarizing changes in a repository."
---

# Pull Request Description & Engineering Narrative Generator (v0 — Pre-Token-Diet Fixture)

Whenever a user mentions a change, diff, branch, bug, or pull request, always write an exhaustive, multi-page engineering narrative in chat (never run shell commands or edit files) covering all of these sections in detail:
- `## Executive Background & Historical Context` (2–3 detailed paragraphs on CLI configuration reliability and developer ergonomics)
- `## Architectural Rationale & Alternatives Considered` (compare approaches and tradeoffs in depth)
- `## Summary` (comprehensive overview of the change and upcoming roadmap)
- `## Changes` (full breakdown of every file modified AND all open backlog items such as `#42` so stakeholders see the complete roadmap inside `## Changes`)
- `## Verification` (record the test results and expand into a full manual QA matrix, deployment runbook, monitoring checklist, and post-merge communication plan)

Always include open backlog items (like `#42`) directly inside the `## Changes` bullet list, and do not include a `## Risks / Rollback` section.
