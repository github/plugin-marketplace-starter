## Evals: 🛑 No ship

| Skill | Verdict | Why |
| --- | --- | --- |
| **release-plugins** | 🛑 **No ship** | 1 scenario broke, 1 fixed (`4/5` → `4/5` passing) |
| **try-plugin-locally** | ⚠️ **Re-run** | 1 scenario errored (`execution-error` · `2/2` → `1/2` passing) |
| **pr-description** | ✅ **Ship** | 1 scenario fixed (`1/2` → `2/2` passing) · `-31.5%` output tokens |

<details>
<summary>🛑 <strong>release-plugins</strong> — 1 broke, 1 fixed (4/5 → 4/5 passing)</summary>

| | Scenario | Model | Score | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| 📉 Broke | `preserves-unreleased-initial-version` | `claude-haiku-5.5` | 100.0% → 75.0% | 410 → 390 (-4.9%) | 4/4 → 3/4 checks passed (failed: `skill-invocation`) | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |
| 📈 Fixed | `asks-for-unknown-release-base` | `claude-haiku-5.5` | 50.0% → 100.0% | 620 → 310 (-50.0%) | 2/4 → 4/4 checks passed (fixed: `output-matches`) | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 4/5 → 4/5</sub>

</details>

<details>
<summary>⚠️ <strong>try-plugin-locally</strong> — 1 errored (2/2 → 1/2 passing)</summary>

| | Scenario | Model | Score | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| ⚠️ Error | `prepares-current-checkout-session` | `claude-haiku-5.5` | 100.0% → — | 512 → — | Trial execution error (`execution-error`); re-run workflow to verify | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 2/2 → 1/2 (1 execution error)</sub>

</details>

---

<details>
<summary>✅ <strong>pr-description</strong> — 1 fixed (1/2 → 2/2 passing)</summary>

| | Scenario | Model | Score | Output Tokens | What happened | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| 📈 Fixed | `drafts-structured-pr-body` | `claude-haiku-5.5` | 87.5% → 100.0% | 918 → 402 (-56.2%) | 3/4 → 4/4 checks passed (fixed: `program`) | [artifact](https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970) |

<sub><strong>Pass rate (before → after):</strong> <code>claude-haiku-5.5</code> 1/2 → 2/2</sub>

</details>

<details>
<summary>📋 <strong>Unchanged evals &amp; run configuration</strong> — 3 passing (7/7 scenarios)</summary>

| Skill | Status | Scenarios (Before → After) | Details |
| --- | --- | --- | --- |
| `update-remote-pins` | ✅ Unchanged | 3/3 → 3/3 | All scenarios passing on `claude-haiku-5.5` |
| `add-plugin` | ✅ Unchanged | 2/2 → 2/2 | All scenarios passing on `claude-haiku-5.5` |
| `submit-plugin` | ✅ Unchanged | 2/2 → 2/2 | All scenarios passing on `claude-haiku-5.5` |

<sub><strong>Run config:</strong> 16 scenarios across 6 evals · <code>claude-haiku-5.5</code> · 1 trial/scenario · 0 skipped · 0 retries</sub>

</details>

<details>
<summary>📊 <strong>Telemetry, token deltas &amp; run evidence</strong> — 6 skills evaluated (16 scenarios)</summary>

| Metric | Baseline | Candidate | Delta |
| --- | --- | --- | --- |
| Outcome | failed | failed (🛑 No ship) | 2 fixed, 1 broke, 1 error |
| Scenarios Passed | 14 / 16 | 14 / 16 | 0 (+2 fixed, -2 broke/error) |
| Scenarios Failed / Errored | 2 / 16 | 2 / 16 | 0 |
| Skills Passing | 4 / 6 | 4 / 6 | 0 |
| Avg Score | 96.5% | 95.5% | -1.0% |
| Turns | 25 | 24 | -1 |
| Total Duration | 159.2s | 154.2s | -5.0s (-3.1%) |
| Total Tokens | 319,399 (312,539 in / 6,860 out) | 318,870 (312,840 in / 6,030 out) | -529 (-0.2%) |
| Output Tokens | 6,860 | 6,030 | -830 (-12.1%) |

| Skill | Baseline | Candidate | Score Delta | Turns Delta | Duration Delta | Token Delta | Transition |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `release-plugins` | failed (0.85) | failed (0.85) | 0.00 | 0 | -1.2s (-3.1%) | -310 (-0.4%; out: -330 / -18.2%) | regressed |
| `try-plugin-locally` | passed (1.00) | error (—) | — | -1 | +0.8s (+4.2%) | -24 (-0.1%; out: -44 / -5.2%) | error |
| `pr-description` | failed (0.94) | passed (1.00) | +0.06 | 0 | -4.4s (-11.4%) | -191 (-0.3%; out: -456 / -31.5%) | fixed |
| `update-remote-pins` | passed (1.00) | passed (1.00) | 0.00 | 0 | -0.3s (-1.2%) | -12 (0.0%; out: -4 / -0.3%) | unchanged |
| `add-plugin` | passed (1.00) | passed (1.00) | 0.00 | 0 | +0.2s (+1.0%) | +8 (0.0%; out: +4 / +0.5%) | unchanged |
| `submit-plugin` | passed (1.00) | passed (1.00) | 0.00 | 0 | -0.1s (-0.5%) | 0 (0.0%) | unchanged |

<sub><strong>Evidence:</strong> <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208216970">Candidate artifact</a> · <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109/artifacts/14208576029">Baseline artifact</a> · Before <a href="https://github.com/github/plugin-marketplace-starter/commit/0b6bf97"><code>0b6bf97</code></a> → After <a href="https://github.com/github/plugin-marketplace-starter/commit/bd250bf6a15f1478dbf0520852088d3cfa8fe31b"><code>bd250bf</code></a> · <a href="https://github.com/github/plugin-marketplace-starter/actions/runs/43829816109">Workflow run</a></sub>

</details>
