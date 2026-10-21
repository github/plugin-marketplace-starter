# JSON configuration

A portable skill and a self-contained local MCP server for checking JSON and
looking up values by JSON Pointer.

| Asset | Use when |
|---|---|
| `json-configuration` skill | Validating supplied JSON or finding a specific configuration value |
| `validate_json` tool | Checking syntax and reporting the JSON type or `INVALID_JSON` |
| `get_json_value` tool | Reading a value by RFC 6901 JSON Pointer, with `NOT_FOUND` and `INVALID_POINTER` errors |

## Install

```sh
copilot plugin marketplace add OWNER/REPO
copilot plugin install json-configuration@MARKETPLACE
```

Replace `OWNER/REPO` with the GitHub repository that hosts this marketplace
and `MARKETPLACE` with the `name` in its `marketplace.json`. See
[Install plugins](../../README.md#install-plugins) for VS Code.

## How it works

[mcp.json](mcp.json) starts `node ${PLUGIN_ROOT}/dist/server.mjs` over stdio.
The committed bundle includes its dependencies, so installed copies don't run
`npm install`. Its third-party licenses are in
[dist/THIRD_PARTY_NOTICES.txt](dist/THIRD_PARTY_NOTICES.txt).

The tools are read-only. They have no network, filesystem, or credential access
and don't persist the JSON you send. Input is limited to 1,048,576 characters.
Numbers follow finite JavaScript number rules; overflowing values are rejected
instead of becoming `null`. Represent exact large integers or decimals as JSON
strings.

## Requirements

Node.js 22.14 or newer on the machine that runs Copilot.

## Try it

> Use json-configuration to validate {"port":8443} and look up /port.

## Develop

Edit [src/server.ts](src/server.ts), then run `npm run build` at the repository
root to regenerate `dist/server.mjs` and its notices. `npm run verify` fails if
the committed bundle is stale. Commit the source and generated files together.
