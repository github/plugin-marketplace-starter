# Changelog

## 1.1.1

- Add a Host checks section to the README for the manual release checks.

## 1.1.0

- Add `--indent N` (1 to 10) to set the indentation. Unsupported arguments are reported instead of ignored.
- Diagnostics name the file and the line and column of a JSON error, never the file content, tool arguments, or hook input.
- Document the hook event contract and where the hook runs.

## 1.0.2

- Replace the starter-specific install values in the README with generic ones.

## 1.0.1

- Add an Install section and the plugin's own MIT `LICENSE`.

## 1.0.0

- Format JSON files named by successful shared-runtime edit tool calls.
- Report changed files and diagnostics without changing tool permissions.
