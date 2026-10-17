import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessReport } from "../evals/graders/bug-report.mjs";
import { assessFormatting } from "../evals/graders/format-json.mjs";
import { assessCollaboration, assessFallback } from "../evals/graders/brainstorm.mjs";
import { score } from "../evals/graders/common.mjs";

const passes = (checks) => checks.every((item) => item.passed);
const trajectory = (output = "", events = []) => ({ output, events });
const ui = `## Summary
Theme resets from Dark to Light.
## Steps to reproduce
1. Open Settings.
2. Switch Theme to Dark and reload.
## Expected behavior
Dark stays selected.
## Actual behavior
Theme resets to Light.
## Environment
- App version: Not provided.
- OS / browser: Not provided.
`;
const cli = `## Summary
Dry run creates a file.
## Steps to reproduce
1. In an empty folder run \`acme sync --dry-run\`.
## Expected behavior
No files change.
## Actual behavior
created cache.db
Exit code: 0
## Environment
- Tool version: Not provided.
- OS / shell: Not provided.
`;

test("report graders accept faithful templates and reject missing facts or headings", () => {
  assert.ok(passes(assessReport(trajectory(ui), "ui")));
  assert.ok(passes(assessReport(trajectory(cli), "cli")));
  assert.ok(!passes(assessReport(trajectory(ui.replaceAll("Dark", "Blue")), "ui")));
  assert.ok(!passes(assessReport(trajectory(ui.replace("## Environment", "## Diagnosis")), "ui")));
  assert.ok(!passes(assessReport(trajectory(cli.replace("Exit code: 0", "Exit code: 1")), "cli")));
});

test("clarification stops drafting and example credentials must be removed", () => {
  assert.ok(passes(assessReport(trajectory("What steps reproduce the problem?"), "clarify")));
  assert.ok(!passes(assessReport(trajectory(ui), "clarify")));
  assert.ok(!passes(assessReport(trajectory("What steps reproduce it? Which OS?"), "clarify")));
  const redacted = cli.replace("acme sync --dry-run", "acme fetch --token [REDACTED] --dry-run")
    .replace("created cache.db", "authentication failed for [REDACTED]").replace("Exit code: 0", "Exit code: 23");
  assert.ok(passes(assessReport(trajectory(redacted), "redact")));
  assert.ok(!passes(assessReport(trajectory(redacted.replaceAll("[REDACTED]", "EXAMPLE_SECRET_DO_NOT_USE")), "redact")));
});

let nextId = 0;
function tool(name, args, value, turn = 0, success = true) {
  const toolCallId = `call-${nextId++}`;
  return [
    { type: "tool_call", turn, data: { toolName: name, toolCallId, arguments: args } },
    { type: "tool_result", turn, data: { toolName: name, toolCallId, success, result: typeof value === "string"
      ? { content: value } : { structuredContent: value, content: JSON.stringify(value) } } },
  ];
}

test("formatter grader requires a compact agent edit, an actual hook receipt, and formatted bytes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "starter-format-grade-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "input.json"), '{\n  "enabled": true,\n  "count": 2\n}\n');
  const patch = "*** Begin Patch\n*** Update File: input.json\n@@\n-{}\n+{\"enabled\":true,\"count\":2}\n*** End Patch\n";
  const receipt = "Tool succeeded. format-json: Formatted input.json. Re-read it before further edits.";
  const compact = tool("apply_patch", patch, receipt);
  assert.ok(passes(assessFormatting(trajectory("", compact), dir, "format")));
  assert.ok(passes(assessFormatting(trajectory("", [
    ...tool("apply_patch", "*** Begin Patch\n*** Delete File: input.json\n*** End Patch\n", "Deleted."),
    ...compact,
  ]), dir, "format")));
  assert.ok(!passes(assessFormatting(trajectory("", tool("apply_patch", patch, "Edited.")), dir, "format")));
  assert.ok(!passes(assessFormatting(trajectory("", [
    ...compact, ...tool("apply_patch", "*** Begin Patch\n*** Add File: other.txt\n+extra\n*** End Patch", "Added."),
  ]), dir, "format")));
  const manual = patch.replace('+{"enabled":true,"count":2}', '+{\n+  "enabled": true,\n+  "count": 2\n+}');
  assert.ok(!passes(assessFormatting(trajectory("", tool("apply_patch", manual, receipt)), dir, "format")));
});

test("formatter invalid-input grade rejects silent repairs and missing diagnostics", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "starter-invalid-grade-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const patch = "*** Begin Patch\n*** Update File: input.json\n@@\n-{}\n+{\"enabled\":}\n*** End Patch\n";
  const result = trajectory("The JSON is invalid and was left unchanged.", tool("apply_patch", patch, "format-json: input.json: invalid JSON"));
  writeFileSync(join(dir, "input.json"), '{"enabled":}\n');
  assert.ok(passes(assessFormatting(result, dir, "invalid")));
  writeFileSync(join(dir, "input.json"), '{"enabled":null}\n');
  assert.ok(!passes(assessFormatting(result, dir, "invalid")));
});

function boardRun() {
  const id = "marketplace-starter-brainstorm";
  const seed = { id: "seed", text: "Keep onboarding simple", column: "ideas" };
  const one = { id: "one", text: "Write a short checklist", column: "ideas" };
  const two = { id: "two", text: "Pair with a buddy", column: "ideas" };
  const invoke = (actionName, notes, turn = 0) => tool("brainstorm-host-invoke_canvas_action",
    { instanceId: "onboarding", actionName }, { canvasId: id, instanceId: "onboarding", actionName, board: { notes } }, turn);
  return trajectory("Moved the original note.", [
    ...tool("brainstorm-host-list_canvas_capabilities", { canvasId: id }, { canvasId: id, transport: "headless-sdk-contract" }),
    ...tool("brainstorm-host-open_canvas", { canvasId: id, instanceId: "onboarding" }, { canvasId: id, headless: true }),
    ...invoke("get_board", [seed]),
    ...invoke("save_note", [seed, one]),
    ...invoke("save_note", [seed, one, two]),
    ...invoke("get_board", [seed, one, two]),
    { type: "assistant_message", turn: 0, data: { content: "Two ideas added. Which should we prioritize?" } },
    ...invoke("save_note", [{ ...seed, column: "next" }, one, two], 1),
    ...invoke("get_board", [{ ...seed, column: "next" }, one, two], 1),
  ]);
}

test("canvas grader verifies real state and rejects lost IDs, excessive notes, and writes before reads", () => {
  const good = boardRun();
  assert.ok(passes(assessCollaboration(good)));
  const lost = structuredClone(good);
  lost.events.at(-1).data.result.structuredContent.board.notes[0].id = "replacement";
  assert.ok(!passes(assessCollaboration(lost)));
  const early = structuredClone(good);
  early.events.splice(4, 2);
  assert.ok(!passes(assessCollaboration(early)));
  const noQuestion = structuredClone(good);
  noQuestion.events.find((event) => event.type === "assistant_message").data.content = "Here is the complete plan.";
  assert.ok(!passes(assessCollaboration(noQuestion)));
});

test("fallback accepts natural punctuation but rejects fabricated UI or an oversized plan", () => {
  const text = "I can\u2019t present the shared board on this host, so we can brainstorm in chat.\n\n- Write a checklist.\n- Pair with a buddy.\n\nWhat should we prioritize?";
  assert.ok(passes(assessFallback(trajectory(text))));
  assert.ok(passes(assessFallback(trajectory(text.replace("can\u2019t", "couldn\u2019t")))));
  assert.ok(!passes(assessFallback(trajectory(text.replace("I can\u2019t present the shared board on this host", "The shared board is ready but I can't write files")))));
  assert.ok(!passes(assessFallback(trajectory("I opened the board.\n- One idea.\n- Another idea.\nWhat next?"))));
  assert.ok(!passes(assessFallback(trajectory(text.replace("- Pair with a buddy.", "- Pair with a buddy.\n- Add another plan.\n- Add more tasks.")))));
  assert.throws(() => score("empty", []), /assertions/);
});
