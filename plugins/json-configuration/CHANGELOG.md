# Changelog

## 0.1.2

- Report the `plugin.json` version in the MCP handshake instead of a stale
  hardcoded `0.1.0`.
- Regenerate the bundled license notices with a per-bundle header.
- Add an Install section.

## 0.1.1

- Start the MCP server when it is launched through a symlinked path, such as
  macOS temporary folders.

## 0.1.0

- Initial skill and self-contained stdio MCP server with `validate_json` and
  `get_json_value` tools.
