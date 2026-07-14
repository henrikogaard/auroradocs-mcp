# Troubleshooting

Never include an `aur_mcp_` token, workspace content, or production user data in
logs, screenshots, issues, or support messages. Use the token fingerprint from
**Settings → Workspace → MCP Access** when you need to identify a token.

## Process and configuration errors

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| Client reports `spawn npx ENOENT` | Node.js/npm is missing from the client's PATH. | Install Node.js 20 or newer, confirm `node --version` and `npx --version`, then restart the client. |
| Server exits with `AURORA_WORKSPACE_ID environment variable is required` | The workspace ID is absent or misspelled. | Copy it again from the MCP Access configuration snippet and update the local client entry. |
| Server exits with `AURORA_API_URL environment variable is required` | The API URL is missing. | Set it to `https://api.auroradocs.eu`. Do not add `/mcp`. |
| Authentication is missing | `AURORA_API_TOKEN` was not passed to the child process. | Add the MCP token environment variable to the server entry. Do not use email/password authentication. |
| Client shows no tools | The stdio process failed, is still connecting, or the client has stale configuration. | Inspect the client's MCP status, confirm the command is `npx -y @henrikogard/auroradocs-mcp@0.1.1`, then restart the client. |
| JSON configuration will not load | Invalid JSON, usually a missing comma or an overwritten outer `mcpServers` object. | Validate the file as JSON and merge the server entry with existing entries. JSON cannot contain comments. |
| Works in a terminal but not the desktop client | Desktop apps often use a different PATH and environment. | Keep all three Aurora variables in the MCP server's `env` object and restart the desktop app. |

## AuroraCloud HTTP responses

| Status | Meaning | Action |
| --- | --- | --- |
| `400` | A required value or tool argument is invalid. | Check the workspace ID and the tool's required arguments. Do not retry unchanged input. |
| `401` | The token is invalid, expired, revoked, or copied incorrectly. | Create a replacement token, update the client, verify it, and revoke any superseded token. |
| `403` | Workspace, role, or scope enforcement denied the request. | Confirm the token belongs to this workspace. Review the denial in token activity. Mint a broader token only if the workflow truly needs that scope. |
| `404` | The workspace or record was not found or is not accessible to this credential. | Verify the workspace ID and object ID; do not assume a record exists in another workspace. |
| `429` | The token exceeded a read or write rate limit. | Wait for the `retry-after` interval, reduce repeated calls, and retry once. |
| `5xx` | AuroraCloud or a dependency failed. | Retry later. If it persists, report sanitized timing, status, package version, and token fingerprint only. |

## Content is locked or unavailable

For E2EE workspaces, the MCP server cannot decrypt locked content. A locked or
unavailable response is expected and safer than returning ciphertext. Do not
grant more scopes to work around it; scopes do not provide encryption keys.

## Verify each client

- Claude Desktop: restart the app after editing its local MCP configuration.
- Claude Code: run `claude mcp get auroradocs`, then inspect `/mcp`.
- Codex: run `codex mcp get auroradocs`.
- Generic clients: confirm they support local stdio processes and pass the
  `env` object to the child process.

After the server connects, call `list_objects` with a small limit using a
`read:objects`-only token. Verify the workspace before granting more access.

## Emergency revocation by role

Revoke an identified affected token individually as soon as possible. Only
workspace owners can use **Revoke all active tokens** in the UI. Admins should
revoke each affected token individually and contact a workspace owner for
emergency bulk revocation. Do not wait for a bulk action before removing a
known compromised token from the client configuration.

## Reporting a non-sensitive bug

Use the repository bug template. Include the package version, Node.js version,
client name/version, operating system, sanitized error text, and minimal
reproduction steps. Do not include raw configuration files because they may
contain the token. Suspected vulnerabilities belong in the private channel in
[SECURITY.md](../SECURITY.md).
