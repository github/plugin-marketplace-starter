# Changelog

## 1.0.2

- Decode board requests once from their raw bytes, so a character split across
  network chunks isn't corrupted, and apply the 4 KiB limit to bytes.
- Add an Install section and the plugin's own MIT `LICENSE`.

## 1.0.1

- Keep keyboard focus on note controls when incoming board updates replace notes.
- Return focus to the note input if another participant deletes the focused note.

## 1.0.0

- Initial session-only brainstorm canvas and companion skill.
