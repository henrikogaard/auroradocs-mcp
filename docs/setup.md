# Setup

This guide connects a local MCP client to owner-approved AuroraCloud workspace
grants with `@henrikogard/auroradocs-mcp@0.2.0`. The server runs locally over
stdio; it is not a hosted MCP endpoint.

## Requirements

- Node.js 20 or newer, with `npx` available to the MCP client
- an AuroraDocs account and an AuroraCloud-backed workspace
- workspace owner or admin permission to create an MCP key
- Claude Desktop, Claude Code, Codex, or another stdio-capable MCP client

Browser-only and Local folders workspaces are not supported.

## Create a client credential and workspace grants

New installations should use one client identity. Its `aur_mcp_client_`
credential authenticates the installation but grants no workspace access by
itself. Each workspace owner approves access independently.

1. In AuroraDocs, open **Settings → Workspace → MCP Access** as the workspace
   owner and select **Enable MCP access**. New workspaces deny MCP access by
   default until an owner enables the policy.
2. Select **Register client**, enter a client and device label such as
   `Personal server — Hermes`, and create the identity.
3. Copy the `aur_mcp_client_` credential immediately. It is **shown only once**
   and cannot be recovered later.
4. In each workspace that should be visible, choose that registered client and
   grant each workspace independently. This is an owner-approved grant; adding
   a second workspace never expands the first workspace's grant.
5. Start with `read:objects`. Add optional read scopes such as `read:content`
   and `search` only for workflows that need them. For read-only task access, add `read:tasks`.
   A read-only resume client should not receive
   `write:tasks`, `write:objects`, or `write:content`. The legacy `tasks` scope
   is compatibility-only and cannot be selected for new grants.
6. Configure the local stdio process with `AURORA_API_URL` and
   `AURORA_API_TOKEN`. Client credentials do not use `AURORA_WORKSPACE_ID`.
7. Restart the agent and call `list_workspaces`. Confirm that it returns only
   the independently granted workspaces.
8. Select one returned `workspace_id` and call `get_project_context` with an
   explicit project ID and bounded limits. Do not guess a project across
   workspaces.

Every client-mode workspace data tool accepts exactly one explicit
`workspace_id` or unambiguous `workspace_alias`. `list_project_changes` also
requires the project ID and a saved change cursor. Legacy credentials remain
pinned to `AURORA_WORKSPACE_ID` and cannot select another workspace.

Workspace grants have independent scopes, expiry, and revocation. To rotate a
grant, create its replacement, verify read-only access, then revoke the
workspace grant it replaces. This leaves the client's other workspace grants
active. If an installation or device is lost, revoke the client identity to
invalidate all of its grants.

### Client credential configuration

Every new client entry provides these values:

| Variable | Value |
| --- | --- |
| `AURORA_API_URL` | `https://api.auroradocs.eu` |
| `AURORA_API_TOKEN` | the one-time `aur_mcp_client_` credential |

For the `0.2.1` source Obsidian importer, add these only after backing up the
source vault and choosing a test destination. It is not in the published
`0.2.0` package:

| Variable | Value |
| --- | --- |
| `AURORA_OBSIDIAN_VAULT_ROOT` | Absolute path to the single vault authorized for read-only analysis |
| `AURORA_MCP_STATE_DIR` | Optional absolute private plan/journal directory outside the vault; defaults to the current user's `.auroradocs-mcp` directory |

The vault-root variable does not authorize AuroraDocs writes. The later import
tool has a separate review and acceptance gate. Removing the variable disables
Obsidian tools without affecting normal AuroraCloud tools. See
[Obsidian import](obsidian-import.md).

Generic stdio configuration:

```json
{
  "command": "npx",
  "args": ["-y", "@henrikogard/auroradocs-mcp@0.2.0"],
  "env": {
    "AURORA_API_URL": "https://api.auroradocs.eu",
    "AURORA_API_TOKEN": "REDACTED"
  }
}
```

For Hermes and OpenClaw, restrict exposed tools to the read-only profile in
[Agent profiles](agent-profiles.md). Never expose the credential to an agent
prompt, logs, or committed configuration.

## Legacy workspace token migration window

The existing one-workspace `aur_mcp_` setup remains supported during the
migration window. It is separate from client identities and requires an
explicit `AURORA_WORKSPACE_ID`.

### Create an MCP key

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

### Configure the legacy server

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
      "args": ["-y", "@henrikogard/auroradocs-mcp@0.2.0"],
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
  auroradocs -- npx -y @henrikogard/auroradocs-mcp@0.2.0
```

Run `claude mcp get auroradocs` to inspect the saved entry.

### Codex

```bash
codex mcp add \
  --env AURORA_API_URL=https://api.auroradocs.eu \
  --env AURORA_WORKSPACE_ID=WORKSPACE_ID \
  --env AURORA_API_TOKEN=REDACTED \
  auroradocs -- npx -y @henrikogard/auroradocs-mcp@0.2.0
```

Run `codex mcp get auroradocs` to inspect the saved entry.

## Verify the connection

1. Start with a token that has only `read:objects`.
2. Restart the MCP client.
3. Ask it to call `list_objects` with a small limit and return only titles and
   IDs.
4. Confirm the results belong to the intended workspace.
5. Add broader scopes only when a specific workflow requires them.

For a client credential, call `list_workspaces` first and then test one bounded
`get_project_context` request in an explicit workspace. For a legacy token,
keep using its configured `AURORA_WORKSPACE_ID`.

The optional development smoke test accepts either mode. Set
`AURORA_SMOKE_PROJECT_ID` to test one explicit project; omit it to prove
workspace discovery without guessing a project. If a client has multiple
grants, also set `AURORA_SMOKE_WORKSPACE_ID` when testing a project.

If the process does not start or no tools appear, use
[Troubleshooting](troubleshooting.md). Do not paste the token into logs.

## Renew or revoke access

For client identities, rotate or revoke the workspace grant independently when
only one workspace should change. Revoke the client when the installation is
lost or retired; that invalidates every grant attached to that installation.

For legacy tokens, use the token controls described below.

Return to **Settings → Workspace → MCP Access** to review token fingerprints,
scopes, expiry, last-used time, activity, and denials.

- To renew access, create a replacement token, update the client, verify a
  read-only request, and then revoke the old token.
- Revoke a token immediately when a client is retired or a device is lost.
- Only workspace owners can use **Revoke all active tokens**. Admins can revoke
  individual tokens and should contact an owner for emergency bulk revocation.

Revocation is immediate. Tokens cannot be extended or recovered.
