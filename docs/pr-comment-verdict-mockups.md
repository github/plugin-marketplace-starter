# Skill Eval PR Comment Mock-ups: Ship / No-Ship Verdicts & Collapsible Telemetry

> **Status:** Draft mock-ups for PM & engineering review  
> **Reference:** [`@rwoll` Gist — Mock-up: skill eval PR comment with a ship / no ship verdict per skill](https://gist.github.com/rwoll/5dafeff236e21fca14a71a7301ebc385)  
> **Live comments on this PR:** See the 3 rendered PR comments on this pull request timeline to experience the exact collapsed vs. expanded GitHub UI behavior.

## Goals

1. **Clear Ship / No-Ship decision at the top:** Reviewers immediately see `✅ Ship`, `🛑 No ship`, or `⚠️ Re-run` per skill without scrolling through large telemetry tables.
2. **Progressive disclosure via `<details>`:** Keep the default comment view compact while preserving all real Vally `0.21.0` metrics (`Score`, `Turns`, `Agent Wall Time`, `Total Duration`, `Input / Output Tokens`, `%` deltas, `Skills Invoked`, and artifact `[Evidence]` links) one click away.
3. **Structured, scannable asides:** Replace loose prose in `Everything else` with a structured `📋 Unchanged skills & suite coverage` table and a consistent `📊 Telemetry, token deltas & run evidence` collapsible across all variants.

---

## Mock-up 1: Single-Skill PR (`✅ Ship` — Real `pr-description` Vally `0.21.0` Run)

## Evals: ✅ Ship

| Skill | Verdict | Why |
| --- | --- | --- |
| **pr-description** | ✅ **Ship** | 1 scenario fixed (`1/2` → `2/2` passing) · score `93.8%` → `100.0%` · `-31.5%` output tokens · `-6.6%` agent wall time |

<details>
<summary>✅ <strong>pr-description</strong> — 1 fixed (1/2 → 2/2 passing)</summary>

| | Scenario | Model | Score | Turns | Wall Time | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| 📈 Fixed | `drafts-structured-pr-body` | `claude-haiku-5.5` | 87.5% → 100.0% | 2 → 2 | 11.1s → 7.1s (-36.2%) | 918 → 402 (-56.2%) | 3/4 → 4/4 checks passed (fixed `program` check: includes `## Risks / Rollback`, excludes `#42` from `## Changes`) | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |
| ✅ Passed | `ignores-bug-and-review-question` | `claude-haiku-5.5` | 100.0% → 100.0% | 1 → 1 | 6.5s → 9.3s (+44.2%) | 529 → 589 (+11.3%) | Unchanged and passing (4/4 checks passed) | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 1/2 → 2/2 (1 trial/scenario, 0 retries)</sub>

</details>

<details>
<summary>📊 <strong>Telemetry, token deltas &amp; run evidence</strong> — score 93.8% → 100.0%, -31.5% output tokens</summary>

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

| Scenario | Baseline | Candidate | Score Delta | Turns | Output Tokens | Wall Time | Transition |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| `pr-description / drafts-structured-pr-body` | FAIL (87.5%) | PASS (100.0%) | +12.5% | 2 → 2 | 918 → 402 (-56.2%) | 11.1s → 7.1s (-36.2%) | Fixed |
| `pr-description / ignores-bug-and-review-question` | PASS (100.0%) | PASS (100.0%) | 0.0% | 1 → 1 | 529 → 589 (+11.3%) | 6.5s → 9.3s (+44.2%) | Passed |

<sub><strong>Evidence:</strong> <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970">Candidate artifact</a> · <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208576029">Baseline artifact</a> · Before <a href="https://github.com/github/plugin-marketplace-starter/commit/0b6bf97"><code>0b6bf97</code></a> → After <a href="https://github.com/github/plugin-marketplace-starter/commit/bd250bf6a15f1478dbf0520852088d3cfa8fe31b"><code>bd250bf</code></a> · <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109">Workflow run</a></sub>

</details>

---

## Mock-up 2: Multi-Skill Suite PR (`🛑 No ship` — Inline Score/Tokens in Scenario Tables)

## Evals: 🛑 No ship

| Skill | Verdict | Why |
| --- | --- | --- |
| **pr-description** | ✅ **Ship** | 1 scenario fixed (`1/2` → `2/2` passing) · `-31.5%` output tokens |
| **release-plugins** | 🛑 **No ship** | 1 scenario broke, 1 fixed (`4/5` → `4/5` passing) |
| try-plugin-locally *(not changed)* | ⚠️ **Re-run** | 1 scenario broke, but this PR does not change this skill |

<details>
<summary>✅ <strong>pr-description</strong> — 1 fixed (1/2 → 2/2 passing)</summary>

| | Scenario | Model | Score | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| 📈 Fixed | `drafts-structured-pr-body` | `claude-haiku-5.5` | 87.5% → 100.0% | 918 → 402 (-56.2%) | 3/4 → 4/4 checks passed (fixed `program` check: includes `## Risks / Rollback`, excludes `#42` from `## Changes`) | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 1/2 → 2/2</sub>

</details>

<details>
<summary>🛑 <strong>release-plugins</strong> — 1 broke, 1 fixed (4/5 → 4/5 passing)</summary>

| | Scenario | Model | Score | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| 📉 Broke | `preserves-unreleased-initial-version` | `claude-haiku-5.5` | 100.0% → 75.0% | 410 → 390 (-4.9%) | Check failed: `skill-invocation` (skill was not invoked) | [artifact](#) |
| 📈 Fixed | `asks-for-unknown-release-base` | `claude-haiku-5.5` | 50.0% → 100.0% | 620 → 310 (-50.0%) | 2/4 → 4/4 checks passed (`output-matches` fixed) | [artifact](#) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 4/5 → 4/5</sub>

</details>

<details>
<summary>⚠️ <strong>try-plugin-locally</strong> <em>(not changed in PR)</em> — 1 broke (2/2 → 1/2 passing)</summary>

| | Scenario | Model | Score | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| 📉 Broke | `prepares-current-checkout-session` | `claude-haiku-5.5` | 100.0% → 75.0% | 512 → 488 (-4.7%) | Check failed: `program` (command omitted local plugin path) | [artifact](#) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 2/2 → 1/2 · This PR does not modify <code>try-plugin-locally</code>; re-run to rule out single-trial variance.</sub>

</details>

<details>
<summary>📋 <strong>Unchanged skills &amp; suite coverage</strong> — 3 passing (7/7 scenarios), 6 without evals</summary>

| Skill | Status | Scenarios (Before → After) | Details |
| --- | --- | --- | --- |
| `update-remote-pins` | ✅ Unchanged | 3/3 → 3/3 | All scenarios passing on `claude-haiku-5.5` |
| `add-plugin` | ✅ Unchanged | 2/2 → 2/2 | All scenarios passing on `claude-haiku-5.5` |
| `submit-plugin` | ✅ Unchanged | 2/2 → 2/2 | All scenarios passing on `claude-haiku-5.5` |
| `eval/*` *(6 skills)* | ⚪ Not evaluated | — | No evals configured (`compare`, `create`, `improve`, `review`, `run`, `setup`) |

<sub><strong>Run config:</strong> 16 scenarios · <code>claude-haiku-5.5</code> · 1 trial/scenario · 0 retries (single-trial flips on unmodified skills can reflect model variance)</sub>

</details>

<details>
<summary>📊 <strong>Telemetry, token deltas &amp; run evidence</strong> — 6 skills evaluated (16 scenarios)</summary>

| Skill | Baseline | Candidate | Score Delta | Turns Delta | Duration Delta | Token Delta | Transition |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `pr-description` | failed (0.94) | passed (1.00) | +0.06 | 0 | -4.4s (-11.4%) | -191 (-0.3%; out: -456 / -31.5%) | fixed |
| `release-plugins` | failed (0.85) | failed (0.85) | 0.00 | 0 | -1.2s (-3.1%) | -310 (-0.4%; out: -330 / -18.2%) | regressed |
| `try-plugin-locally` | passed (1.00) | failed (0.88) | -0.12 | 0 | +0.8s (+4.2%) | -24 (-0.1%) | regressed |
| `update-remote-pins` | passed (1.00) | passed (1.00) | 0.00 | 0 | -0.3s (-1.2%) | -12 (0.0%) | unchanged |
| `add-plugin` | passed (1.00) | passed (1.00) | 0.00 | 0 | +0.2s (+1.0%) | +8 (0.0%) | unchanged |
| `submit-plugin` | passed (1.00) | passed (1.00) | 0.00 | 0 | -0.1s (-0.5%) | 0 (0.0%) | unchanged |

<sub><strong>Evidence:</strong> <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970">Candidate artifact</a> · <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208576029">Baseline artifact</a> · Before <a href="https://github.com/github/plugin-marketplace-starter/commit/0b6bf97"><code>0b6bf97</code></a> → After <a href="https://github.com/github/plugin-marketplace-starter/commit/bd250bf6a15f1478dbf0520852088d3cfa8fe31b"><code>bd250bf</code></a> · <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109">Workflow run</a></sub>

</details>

---

## Mock-up 3: Multi-Skill Suite PR (`🛑 No ship` — Minimal 5-Column Scenario Tables + Structured Coverage & Telemetry Asides)

## Evals: 🛑 No ship

| Skill | Verdict | Why |
| --- | --- | --- |
| **pr-description** | ✅ **Ship** | 1 scenario fixed |
| **release-plugins** | 🛑 **No ship** | 1 scenario broke, 1 fixed |
| try-plugin-locally *(not changed)* | ⚠️ **Re-run** | 1 scenario broke, but this PR does not change this skill |

<details>
<summary>✅ <strong>pr-description</strong> — 1 fixed (1/2 → 2/2 passing)</summary>

| | Scenario | Model | What happened | Evidence |
| --- | --- | --- | --- | --- |
| 📈 Fixed | `drafts-structured-pr-body` | `claude-haiku-5.5` | Now includes the `## Risks / Rollback` section and excludes `#42` from `## Changes`. | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 1/2 → 2/2</sub>

</details>

<details>
<summary>🛑 <strong>release-plugins</strong> — 1 broke, 1 fixed (4/5 → 4/5 passing)</summary>

| | Scenario | Model | What happened | Evidence |
| --- | --- | --- | --- | --- |
| 📉 Broke | `preserves-unreleased-initial-version` | `claude-haiku-5.5` | The skill was not used when it should have been (`skill-invocation`). | [artifact](#) |
| 📈 Fixed | `asks-for-unknown-release-base` | `claude-haiku-5.5` | Now asks for the missing release base (`output-matches`). | [artifact](#) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 4/5 → 4/5</sub>

</details>

<details>
<summary>⚠️ <strong>try-plugin-locally</strong> <em>(not changed in PR)</em> — 1 broke (2/2 → 1/2 passing)</summary>

| | Scenario | Model | What happened | Evidence |
| --- | --- | --- | --- | --- |
| 📉 Broke | `prepares-current-checkout-session` | `claude-haiku-5.5` | The command left out the plugin's local path (`program`). | [artifact](#) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 2/2 → 1/2 · This PR does not modify <code>try-plugin-locally</code>; re-run to rule out single-trial variance.</sub>

</details>

<details>
<summary>📋 <strong>Unchanged skills &amp; suite coverage</strong> — 3 passing (7/7 scenarios), 6 without evals</summary>

| Skill | Status | Scenarios (Before → After) | Details |
| --- | --- | --- | --- |
| `update-remote-pins` | ✅ Unchanged | 3/3 → 3/3 | All scenarios passing on `claude-haiku-5.5` |
| `add-plugin` | ✅ Unchanged | 2/2 → 2/2 | All scenarios passing on `claude-haiku-5.5` |
| `submit-plugin` | ✅ Unchanged | 2/2 → 2/2 | All scenarios passing on `claude-haiku-5.5` |
| `eval/*` *(6 skills)* | ⚪ Not evaluated | — | No evals configured (`compare`, `create`, `improve`, `review`, `run`, `setup`) |

<sub><strong>Run config:</strong> 16 scenarios · <code>claude-haiku-5.5</code> · 1 trial/scenario · 0 retries (single-trial flips on unmodified skills can reflect model variance)</sub>

</details>

<details>
<summary>📊 <strong>Telemetry, token deltas &amp; run evidence</strong> — 6 skills evaluated (16 scenarios)</summary>

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

| Skill | Baseline | Candidate | Score Delta | Turns Delta | Duration Delta | Token Delta | Transition |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `pr-description` | failed (0.94) | passed (1.00) | +0.06 | 0 | -4.4s (-11.4%) | -191 (-0.3%; out: -456 / -31.5%) | fixed |
| `release-plugins` | failed (0.85) | failed (0.85) | 0.00 | 0 | -1.2s (-3.1%) | -310 (-0.4%; out: -330 / -18.2%) | regressed |
| `try-plugin-locally` | passed (1.00) | failed (0.88) | -0.12 | 0 | +0.8s (+4.2%) | -24 (-0.1%) | regressed |
| `update-remote-pins` | passed (1.00) | passed (1.00) | 0.00 | 0 | -0.3s (-1.2%) | -12 (0.0%) | unchanged |
| `add-plugin` | passed (1.00) | passed (1.00) | 0.00 | 0 | +0.2s (+1.0%) | +8 (0.0%) | unchanged |
| `submit-plugin` | passed (1.00) | passed (1.00) | 0.00 | 0 | -0.1s (-0.5%) | 0 (0.0%) | unchanged |

<sub><strong>Evidence:</strong> <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970">Candidate artifact</a> · <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208576029">Baseline artifact</a> · Before <a href="https://github.com/github/plugin-marketplace-starter/commit/0b6bf97"><code>0b6bf97</code></a> → After <a href="https://github.com/github/plugin-marketplace-starter/commit/bd250bf6a15f1478dbf0520852088d3cfa8fe31b"><code>bd250bf</code></a> · <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109">Workflow run</a></sub>

</details>
