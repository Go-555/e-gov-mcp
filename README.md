# E-Gov MCP

The Universal MCP Server exposes tools for accessing the Japanese e-Gov law database API, enabling you to search and retrieve legal documents and provisions. Designed for prompt-first usage in MCP-compatible clients.

## Installation

### Prerequisites
- Node.js 18+
- No API key required (e-Gov API is publicly accessible)

### Get an API key
No API key is required. The e-Gov API is publicly accessible for retrieving Japanese legal information.

### Build locally
```bash
cd /path/to/e-gov-mcp
npm i
npm run build
```

## Setup: Claude Code (CLI)

Use this one-liner:

```bash
claude mcp add "E-Gov MCP" -s user -- npx @gonuts555/e-gov-mcp
```

To remove:

```bash
claude mcp remove "E-Gov MCP"
```

## Setup: Cursor

Create `.cursor/mcp.json` in your client (do not commit it here):

```json
{
  "mcpServers": {
    "e-gov-mcp": {
      "command": "npx",
      "args": ["@gonuts555/e-gov-mcp"],
      "autoStart": true
    }
  }
}
```

## Other Clients and Agents

<details>
<summary>VS Code</summary>

Install via URI or CLI:

```bash
code --add-mcp '{"name":"e-gov-mcp","command":"npx","args":["@gonuts555/e-gov-mcp"]}'
```

</details>

<details>
<summary>VS Code Insiders</summary>

Same as VS Code, use `code-insiders` command instead.

</details>

<details>
<summary>Claude Desktop</summary>

Follow the MCP install guide and reuse the standard config above.

</details>

<details>
<summary>LM Studio</summary>

- Command: `npx`
- Args: `["@gonuts555/e-gov-mcp"]`
- Enabled: true

</details>

<details>
<summary>Goose</summary>

- Type: STDIO
- Command: `npx`
- Args: `@gonuts555/e-gov-mcp`
- Enabled: true

</details>

<details>
<summary>opencode</summary>

Example `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "e-gov-mcp": {
      "type": "local",
      "command": ["npx", "@gonuts555/e-gov-mcp"],
      "enabled": true
    }
  }
}
```

</details>

<details>
<summary>Qodo Gen</summary>

Add a new MCP and paste the standard JSON config.

</details>

<details>
<summary>Windsurf</summary>

See docs and reuse the standard config above.

</details>

## Setup: Codex (TOML)

Example (Serena reference):

```toml
[mcp_servers.serena]
command = "uvx"
args = ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server", "--context", "codex"]
```

This server (minimal):

```toml
[mcp_servers.e-gov-mcp]
command = "npx"
args = ["@gonuts555/e-gov-mcp"]
# Optional:
# MCP_NAME = "e-gov-mcp"
```

## Configuration (Env)

- `MCP_NAME`: Server name override (default: `e-gov-mcp`)

If your tools are purely local or use public APIs, no API keys are required. The e-Gov API is publicly accessible.

## Available Tools

### search_laws
Search for Japanese laws in the e-Gov database.

- **inputs**:
  - `keyword` (string, optional): Keyword to search in law names (e.g., '消費税', '法人税', '所得税')
  - `lawNum` (string, optional): Law number to search for (e.g., '363AC0000000108' for 消費税法)
  - `lawType` (string, optional): Type of law: '1' for Constitution, '2' for Laws, '3' for Cabinet Orders, '4' for Imperial Ordinances, '5' for Ministerial Ordinances
  - `limit` (number, optional): Maximum number of results to return (default: 10, max: 50)

- **outputs**: JSON object containing:
  - `count`: Number of laws found
  - `laws`: Array of law objects with lawId, lawNo, lawName, and promulgationDate

### get_law_data
Get the full text and articles of a specific Japanese law by its Law ID.

- **inputs**:
  - `lawId` (string, **required**): The Law ID obtained from search_laws (e.g., '363AC0000000108')

- **outputs**: JSON object containing:
  - `lawNum`: Law number
  - `lawTitle`: Law title
  - `articleCount`: Total number of articles
  - `articles`: Array of article objects (limited to first 20) with articleNum, caption, title, and paragraphs
  - `note`: Message if results were truncated

## Example invocation (MCP tool call)

Search for consumption tax law:

```json
{
  "name": "search_laws",
  "arguments": {
    "keyword": "消費税",
    "limit": 5
  }
}
```

Get detailed law content:

```json
{
  "name": "get_law_data",
  "arguments": {
    "lawId": "363AC0000000108"
  }
}
```

## Troubleshooting

- **Network errors**: Ensure you have internet access to reach the e-Gov API at `https://laws.e-gov.go.jp/`
- **Ensure Node 18+**: Check your Node.js version with `node -v`
- **Local runs**: Run `npx @gonuts555/e-gov-mcp` after publishing, or `node build/index.js` for local testing
- **Inspect publish artifacts**: Use `npm pack --dry-run` to verify package contents

## References

- [MCP SDK Documentation](https://modelcontextprotocol.io/docs/sdks)
- [MCP Architecture](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP Server Concepts](https://modelcontextprotocol.io/docs/learn/server-concepts)
- [MCP Server Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/index)
- [e-Gov Law API Documentation](https://laws.e-gov.go.jp/api/2/swagger-ui)
- [e-Gov API Redoc](https://laws.e-gov.go.jp/api/2/redoc/)

## Name Consistency & Troubleshooting

- Always use CANONICAL_ID (`e-gov-mcp`) for identifiers and keys.
- Use CANONICAL_DISPLAY (`E-Gov MCP`) only for UI labels.
- Do not mix different names across clients.

### Consistency Matrix:
- npm package name → `e-gov-mcp`
- Binary name → `e-gov-mcp`
- MCP server name (SDK metadata) → `e-gov-mcp`
- Env default MCP_NAME → `e-gov-mcp`
- Client registry key → `e-gov-mcp`
- UI label → `E-Gov MCP`

### Conflict Cleanup:
- Remove any old entries like "EGov" or "e-gov" and re-add with "e-gov-mcp".
- Ensure global `.mcp.json` or client registries only use "e-gov-mcp" for keys.
- Cursor: configure in the UI only. This project does not include `.cursor/mcp.json`.

### Example:
- **Correct**: `"mcpServers": { "e-gov-mcp": { "command": "npx", "args": ["e-gov-mcp"] } }`
- **Incorrect**: `"EGov"` as key (will conflict with "e-gov-mcp").

