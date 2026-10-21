# A small Vally eval

Use the project's pinned Vally release and its supported schema. The following is a pattern, not an expected answer: replace its task and outcome assertions with the new skill's actual contract.

```yaml
name: example-skill
agent_environment:
  skills:
    - ../../skills/example-skill
defaults:
  executor: copilot-sdk
  timeout: 2m
stimuli:
  - name: performs-the-task
    prompt: A realistic request that should use the skill.
    graders:
      - type: completed
      - type: skill-invocation
        config:
          required: [example-skill]
      - type: file-exists
        config:
          path: result.json
      - type: file-matches
        config:
          path: result.json
          pattern: '"status"\\s*:\\s*"ready"'
  - name: unrelated-question
    prompt: What is the capital of France?
    graders:
      - type: completed
      - type: skill-invocation
        config:
          disallowed: [example-skill]
scoring:
  threshold: 1
```

The task case must check something beyond invocation, such as a parsed output file, actual tool arguments/results, or a narrowly defined rubric. Use synthetic fixtures. Keep answer keys in grader-only inputs, not in the skill.

`vally lint --eval-spec <path> --strict` checks the spec without an agent. `vally eval --eval-spec <path>` runs a real agent and costs inference credits. By default, valid failing verdicts are reported; `--require-pass` makes those verdicts fail the command too. Operational errors always fail.

References: [eval schema](https://microsoft.github.io/vally/reference/eval-spec/), [CI guidance](https://microsoft.github.io/vally/get-started/add-to-ci/).
