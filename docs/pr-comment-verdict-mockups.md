# Skill Eval PR Comment Mock-ups: Ship / No-Ship Verdicts & Collapsible Telemetry

> **Status:** Draft mock-ups for PM & engineering review  
> **Reference:** [`@rwoll` Gist — Mock-up: skill eval PR comment with a ship / no ship verdict per skill](https://gist.github.com/rwoll/5dafeff236e21fca14a71a7301ebc385)  
> **Live comments on this PR:** See the 3 rendered PR comments on this pull request timeline to experience the exact collapsed vs. expanded GitHub UI behavior.

## Goals

1. **Clear Ship / No-Ship decision at the top:** Reviewers immediately see `✅ Ship`, `🛑 No ship`, or `⚠️ Re-run` per skill without scrolling through large telemetry tables.
2. **Progressive disclosure via `<details>`:** Keep the default comment view compact while preserving all real Vally `0.21.0` metrics (`Score`, `Turns`, `Agent Wall Time`, `Total Duration`, `Input / Output Tokens`, `%` deltas, `Skills Invoked`, and artifact `[Evidence]` links) one click away.
3. **Distinguish modified skills from unrelated flakes:** Surface `⚠️ Re-run` when a skill not touched by the PR fails a single-trial scenario.

---

## Mock-up 1: Single-Skill PR (`✅ Ship` — Real `pr-description` Vally `0.21.0` Run)

This shows how a single-skill PR (such as [`#21`](https://github.com/github/plugin-marketplace-starter/pull/21)) renders with real Vally `0.21.0` (`claude-haiku-5.5`) baseline (`63a64377`) and candidate (`ab6a6e4d`) runs.

---

## Evals: ✅ Ship

| Skill | Verdict | Why |
| --- | --- | --- |
| **pr-description** | ✅ **Ship** | 1 scenario fixed (`1/2` → `2/2` passing) · score `93.8%` → `100.0%` · `-31.5%` output tokens · `-6.6%` agent wall time |

<details>
<summary>✅ <strong>pr-description</strong>: 1 fixed (1/2 → 2/2 on <code>claude-haiku-5.5</code>)</summary>

| | Scenario | Model | Score | Turns | Wall Time | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| 📈 Fixed | `drafts-structured-pr-body` | `claude-haiku-5.5` | 87.5% → 100.0% | 2 → 2 | 11.1s → 7.1s (-36.2%) | 918 → 402 (-56.2%) | 3/4 → 4/4 checks passed (fixed `program` check: includes `## Risks / Rollback`, excludes `#42` from `## Changes`) | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |
| ✅ Passed | `ignores-bug-and-review-question` | `claude-haiku-5.5` | 100.0% → 100.0% | 1 → 1 | 6.5s → 9.3s (+44.2%) | 529 → 589 (+11.3%) | Unchanged and passing (4/4 checks passed) | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |

Scenarios passing, before → after: `claude-haiku-5.5` 1/2 → 2/2.

</details>

<details>
<summary>📊 <strong>Full comparison metrics, token usage &amp; run evidence</strong></summary>

### Baseline vs. Candidate comparison

| Metric | Baseline | Candidate | Delta |
| --- | --- | --- | --- |
| Outcome | failed | passed | fixed |
| Passed | 1 | 2 | +1 |
| Failed | 1 | 0 | -1 |
| Avg Score | 93.8% | 100.0% | +6.3% |
| Turns | 3 | 3 | 0 |
| Agent Wall Time | 17.5s | 16.4s | -1.1s (-6.6%) |
| Total Duration | 38.5s | 34.1s | -4.4s (-11.4%) |
| Total Tokens | 73,199 (71,752 in / 1,447 out) | 73,008 (72,017 in / 991 out) | -191 (-0.3%) |
| Output Tokens | 1,447 | 991 | -456 (-31.5%) |

### Quality & token summary (Candidate)

| Eval | Model | Verdict | Score | Skills Invoked | Turns | Wall Time | Tokens |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| `pr-description` | `claude-haiku-5.5` | passed | 1.00 (threshold 1.00) | `pr-description` | 3 | 16.4s | 73,008 (72,017 in / 991 out) |

**Selection:** Native eval paths or tags  
**Candidate:** passed · 2 trials · [Evidence](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970)  
**Baseline:** failed · 2 trials · [Evidence](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208576029)  
**Revisions:** Before [`0b6bf97`](https://github.com/github/plugin-marketplace-starter/commit/0b6bf97) → After [`bd250bf`](https://github.com/github/plugin-marketplace-starter/commit/bd250bf6a15f1478dbf0520852088d3cfa8fe31b) · [Workflow run](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109)

</details>

---

## Mock-up 2: Multi-Skill Suite PR (`🛑 No ship` — Mixed Verdicts + `Everything else & full telemetry`)

This combines `@rwoll`'s multi-skill gist scenario (`✅ Ship`, `🛑 No ship`, `⚠️ Re-run`, and `Everything else`) with per-scenario and aggregate telemetry inside `<details>`.

---

## Evals: 🛑 No ship

| Skill | Verdict | Why |
| --- | --- | --- |
| **pr-description** | ✅ **Ship** | 1 scenario fixed (`1/2` → `2/2` passing) · `-31.5%` output tokens |
| **release-plugins** | 🛑 **No ship** | 1 scenario broke, 1 fixed (`4/5` → `4/5` passing) |
| try-plugin-locally *(not changed)* | ⚠️ **Re-run** | 1 scenario broke, but this PR does not change this skill |

<details>
<summary>✅ <strong>pr-description</strong>: 1 fixed</summary>

| | Scenario | Model | Score | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| 📈 Fixed | `drafts-structured-pr-body` | `claude-haiku-5.5` | 87.5% → 100.0% | 918 → 402 (-56.2%) | 3/4 → 4/4 checks passed (`program` check fixed: includes `## Risks / Rollback`, excludes `#42` from `## Changes`) | [artifact](#) |

Scenarios passing, before → after: `claude-haiku-5.5` 1/2 → 2/2.

</details>

<details>
<summary>🛑 <strong>release-plugins</strong>: 1 broke, 1 fixed</summary>

| | Scenario | Model | Score | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| 📉 Broke | `preserves-unreleased-initial-version` | `claude-haiku-5.5` | 100.0% → 75.0% | 410 → 390 (-4.9%) | Check failed: `skill-invocation` (skill was not invoked) | [artifact](#) |
| 📈 Fixed | `asks-for-unknown-release-base` | `claude-haiku-5.5` | 50.0% → 100.0% | 620 → 310 (-50.0%) | 2/4 → 4/4 checks passed (`output-matches` fixed) | [artifact](#) |

Scenarios passing, before → after: `claude-haiku-5.5` 4/5 → 4/5.

</details>

<details>
<summary>⚠️ <strong>try-plugin-locally</strong> (not changed): 1 broke</summary>

| | Scenario | Model | Score | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| 📉 Broke | `prepares-current-checkout-session` | `claude-haiku-5.5` | 100.0% → 75.0% | 512 → 488 (-4.7%) | Check failed: `program` (command omitted local plugin path) | [artifact](#) |

This PR does not change this skill, so re-run to rule out single-trial noise.

</details>

<details>
<summary>Everything else &amp; full telemetry</summary>

Unchanged and passing: `update-remote-pins` (3/3), `add-plugin` (2/2), `submit-plugin` (2/2).

Not checked: 6 skills have no evals (`eval/compare`, `eval/create`, `eval/improve`, `eval/review`, `eval/run`, `eval/setup`).

16 scenarios on 1 model (`claude-haiku-5.5`), 1 run each, no retries. A single flip can be noise.

### Baseline vs. Candidate comparison

| Eval | Baseline | Candidate | Score Delta | Turns Delta | Duration Delta | Token Delta | Transition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pr-description` | failed (0.94) | passed (1.00) | +0.06 | 0 | -4.4s (-11.4%) | -191 (-0.3%; out: -456 / -31.5%) | fixed |
| `release-plugins` | failed (0.85) | failed (0.85) | 0.00 | 0 | -1.2s (-3.1%) | -310 (-0.4%; out: -330 / -18.2%) | regressed |
| `try-plugin-locally` | passed (1.00) | failed (0.88) | -0.12 | 0 | +0.8s (+4.2%) | -24 (-0.1%) | regressed |
| `update-remote-pins` | passed (1.00) | passed (1.00) | 0.00 | 0 | -0.3s (-1.2%) | -12 (0.0%) | unchanged |
| `add-plugin` | passed (1.00) | passed (1.00) | 0.00 | 0 | +0.2s (+1.0%) | +8 (0.0%) | unchanged |
| `submit-plugin` | passed (1.00) | passed (1.00) | 0.00 | 0 | -0.1s (-0.5%) | 0 (0.0%) | unchanged |

Before is `0b6bf97`, After is `bd250bf`. [Candidate evidence](#) · [Baseline evidence](#) · [Workflow run](#).

</details>

---

## Mock-up 3: Ultra-Minimal Variant (Exact `@rwoll` Gist Tables + Separate Telemetry Collapsible)

This variant keeps the top table and per-skill `<details>` tables **identical** to `@rwoll`'s 5-column gist (zero token/duration columns in the scenario tables), and places all numeric score, token, turn, and duration tables in a single bottom `<details>` block.

---

| Skill | Verdict | Why |
| --- | --- | --- |
| **pr-description** | ✅ Ship | 1 scenario fixed |
| **release-plugins** | 🛑 No ship | 1 scenario broke, 1 fixed |
| try-plugin-locally (not changed) | ⚠️ Re-run | 1 scenario broke, but this PR does not change this skill |

<details>
<summary>✅ pr-description: 1 fixed</summary>

| | Scenario | Model | What happened | Evidence |
| --- | --- | --- | --- | --- |
| 📈 Fixed | drafts-structured-pr-body | Claude Haiku 5.5 | Now includes the `## Risks / Rollback` section and excludes `#42` from `## Changes`. | [log](#) |

Scenarios passing, before → after: Claude Haiku 5.5 1/2 → 2/2.

</details>

<details>
<summary>🛑 release-plugins: 1 broke, 1 fixed</summary>

| | Scenario | Model | What happened | Evidence |
| --- | --- | --- | --- | --- |
| 📉 Broke | preserves-unreleased-initial-version | Claude Haiku 5.5 | The skill was not used when it should have been (`skill-invocation`). | [log](#) |
| 📈 Fixed | asks-for-unknown-release-base | Claude Haiku 5.5 | Now asks for the missing release base. | [log](#) |

Scenarios passing, before → after: Claude Haiku 5.5 4/5 → 4/5.

</details>

<details>
<summary>⚠️ try-plugin-locally (not changed): 1 broke</summary>

| | Scenario | Model | What happened | Evidence |
| --- | --- | --- | --- | --- |
| 📉 Broke | prepares-current-checkout-session | Claude Haiku 5.5 | The command left out the plugin's local path. | [log](#) |

This PR does not change this skill, so re-run to rule out noise.

</details>

<details>
<summary>Everything else</summary>

Unchanged and passing: `update-remote-pins` (3/3), `add-plugin` (2/2), `submit-plugin` (2/2).

Not checked: 6 skills have no evals (`eval/compare`, `eval/create`, `eval/improve`, `eval/review`, `eval/run`, `eval/setup`).

16 scenarios on 1 model, 1 run each, no retries. A single flip can be noise.

Before is `0b6bf97`, After is `bd250bf`. [Workflow run](#).

</details>

<details>
<summary>📊 Quality, token &amp; duration telemetry (Baseline vs. Candidate)</summary>

| Metric | Baseline | Candidate | Delta |
| --- | --- | --- | --- |
| Outcome | failed | passed | fixed |
| Passed | 1 | 2 | +1 |
| Failed | 1 | 0 | -1 |
| Avg Score | 93.8% | 100.0% | +6.3% |
| Turns | 3 | 3 | 0 |
| Agent Wall Time | 17.5s | 16.4s | -1.1s (-6.6%) |
| Total Duration | 38.5s | 34.1s | -4.4s (-11.4%) |
| Total Tokens | 73,199 (71,752 in / 1,447 out) | 73,008 (72,017 in / 991 out) | -191 (-0.3%) |
| Output Tokens | 1,447 | 991 | -456 (-31.5%) |

| Case | Baseline | Candidate | Score Delta | Turns | Output Tokens | Wall Time | Transition |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| `pr-description / drafts-structured-pr-body` | FAIL (87.5%) | PASS (100.0%) | +12.5% | 2 → 2 | 918 → 402 (-56.2%) | 11.1s → 7.1s (-36.2%) | Fixed |
| `pr-description / ignores-bug-and-review-question` | PASS (100.0%) | PASS (100.0%) | 0.0% | 1 → 1 | 529 → 589 (+11.3%) | 6.5s → 9.3s (+44.2%) | Passed |

**Candidate artifact:** [Evidence](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) · **Baseline artifact:** [Evidence](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208576029)

</details>
