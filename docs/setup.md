# Setup

This guide connects a local MCP client to one AuroraCloud workspace with
`@henrikogaard/auroradocs-mcp@0.1.1`. The server runs locally over stdio; it is
not a hosted MCP endpoint.

## Requirements

- Node.js 20 or newer, with `npx` available to the MCP client
- an AuroraDocs account and an AuroraCloud-backed workspace
- workspace owner or admin permission to create an MCP key
- Claude Desktop, Claude Code, Codex, or another stdio-capable MCP client

Browser-only and Local folders workspaces are not supported.

## Create an MCP key

1. Sign in to AuroraDocs and open the workspace you want the client to use.
2. Open **Settings → Workspace → MCP Access**.
3. Enter a label that identifies the client and device.
4. Select the minimum scopes required for the intended workflow.
5. Choose a bounded expiry. The default is 90 days.
6. Select **Create token**.
7. Copy the `aur_mcp_` token immediately. It is **shown only once** and cannot
   be recovered later.
8. Copy the Workspace ID from the configuration snippet on the same page.

The examples below place the token in saved client configuration. Treat that
file as sensitive and limit access to your user account. If your client
supports a secret manager, follow that client's documentation instead of
storing the token directly. Never put it in a repository, issue, screenshot,
chat, or shell history.

### Choose least-privilege scopes

| Workflow | Minimum starting scopes |
| --- | --- |
| Confirm the connection and list titles | `read:objects` |
| Read page or Canvas content | `read:objects`, `read:content` |
| Search and read workspace knowledge | `read:objects`, `read:content`, `search` |
| Review or update tasks | `read:objects`, `tasks` |
| Create or rename objects | `read:objects`, `write:objects` |
| Replace or append content | `read:objects`, `read:content`, `write:content` |

Scopes are independent. A write scope does not imply its read counterpart. See
[Tools and scopes](tools.md) before granting write access.

The `tasks` scope permits both reading and writing task metadata. Do not grant
it to a client that should have strictly read-only access.

## Configure the server

Every client entry must provide these values:

| Variable | Value |
| --- | --- |
| `AURORA_API_URL` | `https://api.auroradocs.eu` |
| `AURORA_WORKSPACE_ID` | the Workspace ID copied from MCP Access |
| `AURORA_API_TOKEN` | the one-time `aur_mcp_` token |

Do not configure an AuroraDocs email or password.

### Claude Desktop

Open Claude Desktop's developer settings and edit its MCP configuration. Merge
this entry into the existing `mcpServers` object, preserving any configured
servers, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "auroradocs": {
      "command": "npx",
      "args": ["-y", "@henrikogaard/auroradocs-mcp@0.1.1"],
      "env": {
        "AURORA_API_URL": "https://api.auroradocs.eu",
        "AURORA_WORKSPACE_ID": "WORKSPACE_ID",
        "AURORA_API_TOKEN": "REDACTED"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport stdio --scope user \
  --env AURORA_API_URL=https://api.auroradocs.eu \
  --env AURORA_WORKSPACE_ID=WORKSPACE_ID \
  --env AURORA_API_TOKEN=REDACTED \
  auroradocs -- npx -y @henrikogaard/auroradocs-mcp@0.1.1
```

Run `claude mcp get auroradocs` to inspect the saved entry.

### Codex

```bash
codex mcp add \
  --env AURORA_API_URL=https://api.auroradocs.eu \
  --env AURORA_WORKSPACE_ID=WORKSPACE_ID \
  --env AURORA_API_TOKEN=REDACTED \
  auroradocs -- npx -y @henrikogaard/auroradocs-mcp@0.1.1
```

Run `codex mcp get auroradocs` to inspect the saved entry.

## Verify the connection

1. Start with a token that has only `read:objects`.
2. Restart the MCP client.
3. Ask it to call `list_objects` with a small limit and return only titles and
   IDs.
4. Confirm the results belong to the intended workspace.
5. Add broader scopes only when a specific workflow requires them.

If the process does not start or no tools appear, use
[Troubleshooting](troubleshooting.md). Do not paste the token into logs.

## Renew or revoke access

Return to **Settings → Workspace → MCP Access** to review token fingerprints,
scopes, expiry, last-used time, activity, and denials.

- To renew access, create a replacement token, update the client, verify a
  read-only request, and then revoke the old token.
- Revoke a token immediately when a client is retired or a device is lost.
- Only workspace owners can use **Revoke all active tokens**. Admins can revoke
  individual tokens and should contact an owner for emergency bulk revocation.

Revocation is immediate. Tokens cannot be extended or recovered.
