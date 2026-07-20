# Troubleshooting

Never include an `aur_mcp_client_` or `aur_mcp_` token, workspace content, or production user data in
logs, screenshots, issues, or support messages. Use the token fingerprint from
**Settings → Workspace → MCP Access** when you need to identify a token.

## Process and configuration errors

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| Client reports `spawn npx ENOENT` | Node.js/npm is missing from the client's PATH. | Install Node.js 20 or newer, confirm `node --version` and `npx --version`, then restart the client. |
| Server exits with `AURORA_WORKSPACE_ID environment variable is required` | A legacy `aur_mcp_` token is missing its pinned workspace ID. | Copy it again from MCP Access. Client credentials must use `aur_mcp_client_` and omit this variable. |
| Server exits with `AURORA_API_URL environment variable is required` | The API URL is missing. | Set it to `https://api.auroradocs.eu`. Do not add `/mcp`. |
| Authentication is missing | `AURORA_API_TOKEN` was not passed to the child process. | Add the MCP token environment variable to the server entry. Do not use email/password authentication. |
| Client shows no tools | The stdio process failed, is still connecting, or the client has stale configuration. | Inspect the client's MCP status, confirm the command is `npx -y @henrikogard/auroradocs-mcp@0.2.1`, then restart the client. |
| JSON configuration will not load | Invalid JSON, usually a missing comma or an overwritten outer `mcpServers` object. | Validate the file as JSON and merge the server entry with existing entries. JSON cannot contain comments. |
| Works in a terminal but not the desktop client | Desktop apps often use a different PATH and environment. | For client mode, pass the API URL and token; for legacy mode, also pass `AURORA_WORKSPACE_ID`. Restart the desktop app. |
| Client credential reports an ambiguous workspace | The data call omitted a selector or an alias matches more than one grant. | Call `list_workspaces`, then pass one exact `workspace_id` or unambiguous `workspace_alias`. |
| Obsidian tools say `AURORA_OBSIDIAN_VAULT_ROOT` is required | Local vault access is intentionally disabled. | Add one absolute vault path to the local MCP process only after backing it up, then restart the client. Normal AuroraCloud tools do not need this variable. |
| Vault or state path is rejected | The root is relative/symlinked, changed identity, or the plan/journal directory is inside the vault. | Use a real absolute vault directory and a separate private `AURORA_MCP_STATE_DIR`; never weaken the path checks. |
| Vault analysis exceeds its source limit | Eligible Markdown, Canvas, and Templates configuration files total more than 256 MiB. | Split or archive the vault before analysis; ignored plugin/cache/Git data does not count and cannot be imported as attachments. |
| Import returns `confirmation_required` | The client does not advertise MCP form elicitation. | Present the exact plan to the user, wait for a later explicit acceptance, then call import with the same plan ID/hash and `confirmed: true`. |
| Import is blocked before writes | The plan expired or changed, the vault changed, scopes/role are insufficient, E2EE is enabled, or attachment storage/quota is unavailable. | Read the bounded warning code, resolve that exact condition, re-analyze when required, and do not retry unchanged input repeatedly. |
| Import is partial or interrupted | A bounded batch stopped after some additive writes. | Keep the vault unchanged and call status, then retry the same current plan ID/hash. Do not delete successful destination objects as compensation. |

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

Obsidian plaintext import into an E2EE workspace is blocked even when the local
client can read the source vault. Use a non-E2EE test destination or wait for an
importer that can encrypt every write; do not disable E2EE merely to work around
the importer.

## Verify each client

- Claude Desktop: restart the app after editing its local MCP configuration.
- Claude Code: run `claude mcp get auroradocs`, then inspect `/mcp`.
- Codex: run `codex mcp get auroradocs`.
- Generic clients: confirm they support local stdio processes and pass the
  `env` object to the child process.

After the server connects, call `list_objects` with a small limit using a
`read:objects`-only token. Verify the workspace before granting more access.
For `aur_mcp_client_`, call `list_workspaces` first and select the intended
grant explicitly. Use `get_project_context` for an initial resume packet and
`list_project_changes` with its required saved cursor for later refreshes.
New task grants use `read:tasks` and `write:tasks`; the legacy `tasks` scope is
compatibility-only and cannot be selected for new grants.

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
