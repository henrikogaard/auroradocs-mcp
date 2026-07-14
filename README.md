# AuroraDocs MCP Server

`@henrikogard/auroradocs-mcp` connects a local MCP client to independently
granted AuroraCloud workspaces. It runs on your computer over stdio and sends
authenticated requests to `https://api.auroradocs.eu`.

The public package is `@henrikogard/auroradocs-mcp`, the executable is
`aurora-mcp`, and this documentation targets version `0.1.1`.

For an end-to-end installation walkthrough, use the dedicated
[Setup guide](docs/setup.md). Hermes and OpenClaw users should also apply the
bounded [read-only agent profiles](docs/agent-profiles.md).

## Requirements

- Node.js 20 or newer
- an AuroraDocs account with an AuroraCloud-backed workspace
- permission to create an MCP token for that workspace
- a supported local MCP client: Claude Desktop, Claude Code, Codex, or another
  client that can start a stdio server

Browser-only workspaces and Local folders workspaces are not supported. The
server does not read a browser tab or a folder on your computer.

## Create an MCP credential

New multi-workspace installations should use an `aur_mcp_client_` credential
with owner-approved, independently revocable workspace grants. Follow the
[Setup guide](docs/setup.md) for that flow. The workspace-scoped `aur_mcp_`
steps below remain available during the legacy migration window.

### Legacy workspace token

1. Sign in to AuroraDocs and open the AuroraCloud workspace you want to use.
2. Go to **Settings → Workspace → MCP Access**.
3. Enter a label that identifies the client, such as `Personal laptop — Codex`.
4. Select the minimum scopes the client needs. Start with `read:objects`; add
   `read:content` only when the client must read document bodies.
5. Choose a bounded expiry: 30, 60, 90, 180, or 365 days. The default is
   **90 days**. Prefer a bounded expiry even if your role offers a no-expiry
   option.
6. Select **Create token**.
7. Copy the raw `aur_mcp_` token immediately. It is **shown only once** and
   cannot be recovered later. Store it in the local client configuration or a
   trusted secret manager; never paste it into an issue, pull request, chat, or
   screenshot.
8. Copy the workspace ID from the configuration snippet on the same MCP Access
   page. You will use it as `AURORA_WORKSPACE_ID`.

Only workspace owners and admins can create tokens. A token is a
workspace-scoped service credential, not an account-wide API key.

### Choose least-privilege scopes

Scopes are independent: `read:objects` does not include `read:content`, and a
write scope does not imply its read counterpart.

| Goal | Start with these scopes |
| --- | --- |
| Confirm the connection and list titles | `read:objects` |
| Read page or Canvas content | `read:objects`, `read:content` |
| Search and read workspace knowledge | `read:objects`, `read:content`, `search` |
| Review or update tasks and week planning | `read:objects`, `tasks` |
| Update task metadata after confirmation | `read:objects`, `tasks`, `write:objects` |
| Create or rename non-task objects | `read:objects`, `write:objects` |
| Replace or append document content | `read:objects`, `read:content`, `write:content` |

`read:objects` is the practical baseline because the server verifies workspace
membership at startup and most tools operate on object metadata. Add
`write:objects` or `write:content` only when you intend to let the client modify
the workspace. See the complete [scope and tool reference](docs/tools.md).

The `tasks` scope permits both reading and writing task metadata. Do not grant
it to a client that should have strictly read-only access.

`search_objects` and its `search` alias search object titles with `read:objects` only.
`wiki_search` searches workspace knowledge and requires `read:objects` plus `search`.
Add `read:content` when the workflow will open and read the matching pages, as
in the knowledge-search recipe above.

## Configure a client

All examples below use the production AuroraCloud API, a new client credential,
and package version `0.1.1`. Replace `REDACTED` locally. Do not commit the
resulting configuration. The examples store the token in the client's saved
configuration, so protect that file as a credential.

New client credentials require these environment variables:

| Variable | Value |
| --- | --- |
| `AURORA_API_URL` | `https://api.auroradocs.eu` |
| `AURORA_API_TOKEN` | the one-time `aur_mcp_client_` credential |

Do not set `AURORA_WORKSPACE_ID` for a client credential. The server discovers
only its owner-approved grants with `list_workspaces`; each data call then
selects a workspace explicitly. A legacy `aur_mcp_` token still requires
`AURORA_WORKSPACE_ID` during the migration window.

Do not configure an AuroraDocs email or password. Public onboarding supports
MCP-token authentication only.

### Claude Desktop

Open Claude Desktop's developer settings and edit its MCP configuration. Add
this server under `mcpServers`, preserving any servers already present:

```json
{
  "mcpServers": {
    "auroradocs": {
      "command": "npx",
      "args": ["-y", "@henrikogard/auroradocs-mcp@0.1.1"],
      "env": {
        "AURORA_API_URL": "https://api.auroradocs.eu",
        "AURORA_API_TOKEN": "REDACTED"
      }
    }
  }
}
```

Save the file and restart Claude Desktop. Anthropic's current
[local MCP server guide](https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
describes how to reach the configuration screen.

### Claude Code

Current Claude Code accepts local stdio servers through `claude mcp add`.
Options must appear before the server name:

```bash
claude mcp add --transport stdio --scope user \
  --env AURORA_API_URL=https://api.auroradocs.eu \
  --env AURORA_API_TOKEN=REDACTED \
  auroradocs -- npx -y @henrikogard/auroradocs-mcp@0.1.1
```

Run `claude mcp get auroradocs` to inspect the saved entry, then use `/mcp` in
Claude Code to check its connection. See Anthropic's current
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### Codex

The installed Codex CLI accepts `--env` for local stdio servers:

```bash
codex mcp add \
  --env AURORA_API_URL=https://api.auroradocs.eu \
  --env AURORA_API_TOKEN=REDACTED \
  auroradocs -- npx -y @henrikogard/auroradocs-mcp@0.1.1
```

Run `codex mcp get auroradocs` to inspect the saved entry.

### Other stdio clients

Use this valid generic JSON shape when a client accepts an MCP server object:

```json
{
  "command": "npx",
  "args": ["-y", "@henrikogard/auroradocs-mcp@0.1.1"],
  "env": {
    "AURORA_API_URL": "https://api.auroradocs.eu",
    "AURORA_API_TOKEN": "REDACTED"
  }
}
```

The client must launch the process locally and communicate over stdio. Do not
configure `https://api.auroradocs.eu` as an MCP HTTP/SSE URL; it is the API the
local server calls, not a hosted MCP endpoint.

## Verify read-only access first

1. Grant the client one workspace with only `read:objects`.
2. Start or restart the client.
3. Ask the client to call `list_workspaces` and confirm only the expected grant
   is visible.
4. Call `get_project_context` for one explicit workspace and project ID.
5. Only then extend that workspace grant with any optional read scopes the
   workflow genuinely needs.

If the connection fails, see [Troubleshooting](docs/troubleshooting.md). Never
paste the raw token into logs or bug reports.

## Manage and revoke access

Return to **Settings → Workspace → MCP Access** to manage credentials.

- Review each token's fingerprint, scopes, expiry, last-used time, status, and
  activity.
- Open a token's activity view to review allowed requests and denials.
- Revoke one token when a client is retired, a device is lost, or a replacement
  token is working.
- Only workspace owners can use **Revoke all active tokens** in the UI.
- Admins should revoke each affected token individually and contact a workspace owner for emergency bulk revocation.
- After emergency revocation, create fresh least-privilege tokens only for
  trusted clients.

Revocation is immediate. To renew access, create a new token before the old one
expires, update the local client, verify a read-only request, and then revoke
the old token. Tokens cannot be extended or recovered.

## Security model

- The MCP protocol process is local and stdio-only; AuroraDocs does not provide
  a hosted MCP HTTP, SSE, or OAuth endpoint.
- AuroraCloud checks workspace membership, token scopes, the member's current
  role, expiry, revocation, rate limits, and audit events on requests.
- E2EE content that is locked or unavailable is reported that way. The server
  does not return encrypted ciphertext as readable content.
- The package sends no product telemetry. Network requests are the AuroraCloud
  API calls required by the selected tools.

Read [Security boundaries](docs/security.md) before granting write scopes. To
report a vulnerability, follow [SECURITY.md](SECURITY.md).

## Reference

- [Tools and scopes](docs/tools.md)
- [Hermes and OpenClaw agent profiles](docs/agent-profiles.md)
- [Agent planning and knowledge roadmap](docs/agent-planning-knowledge-roadmap.md)
- [Security boundaries](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Development

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm check
```

The live AuroraCloud smoke test is intentionally separate because it requires a
real owner-approved workspace grant. Prefer `AURORA_API_TOKEN=aur_mcp_client_...`
with `AURORA_API_URL`; a legacy `aur_mcp_...` token additionally requires
`AURORA_WORKSPACE_ID`. Grant only `read:objects`; add `read:content` only when
the selected project's readable brief or citations must be included.

The smoke always calls `list_workspaces`. Set `AURORA_SMOKE_PROJECT_ID` to add
one bounded `get_project_context` request; omit it to verify discovery without
guessing a project. When a client credential has multiple grants, also set
`AURORA_SMOKE_WORKSPACE_ID` for that project check. The dispatcher verifies the
catalog's authoritative read-only classification and never dispatches a write
tool. Keep `AURORA_API_TOKEN` out of commands, logs, and committed files by
providing it through your local secret environment. See
[CONTRIBUTING.md](CONTRIBUTING.md) before using the smoke.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
