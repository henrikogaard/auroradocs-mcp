# Security boundaries

AuroraDocs MCP is a local protocol bridge to AuroraCloud. It does not turn a
workspace into a public or hosted MCP endpoint.

## Credential boundary

An `aur_mcp_` token is a workspace-scoped service credential. It is not a user
session, an account-wide API key, or a substitute for an email and password.
Public setups use only:

- `AURORA_API_URL=https://api.auroradocs.eu`
- `AURORA_WORKSPACE_ID`
- `AURORA_API_TOKEN`

The raw token is shown once when created. AuroraCloud stores a hash and a safe
fingerprint, not a recoverable raw value. Keep the token in a local client
configuration or trusted secret store, restrict access to that file, and do not
reuse one token across unrelated clients.

## Transport boundary

The package runs locally over stdio. It does not listen on a network port and
AuroraDocs does not currently offer a hosted HTTP, SSE, WebSocket, or OAuth MCP
endpoint. `https://api.auroradocs.eu` is the AuroraCloud REST API used by the
local process, not an MCP endpoint.

Do not expose the stdio process through a network proxy or paste its credential
into an arbitrary hosted agent service.

## AuroraCloud enforcement

AuroraCloud re-checks authorization server-side. Client UI or tool descriptions
are not the security boundary. Enforcement includes:

- active membership in the token's workspace
- the token's exact scopes, without implicit nesting
- the member's current role; viewers cannot write
- expiry and revocation on subsequent requests
- workspace pinning for object and content access
- separate read and write rate limits
- per-token request, denial, and lifecycle audit events

Current defaults are 300 read requests and 30 write requests per minute per
token and API process. A `429` response includes `retry-after`.

## E2EE behavior

The local MCP process does not hold AuroraDocs end-to-end encryption keys. When
E2EE content is locked or otherwise unavailable, tools return a locked or
unavailable state. They must not expose stored ciphertext as if it were readable
document content.

## Unsupported workspace modes

Only AuroraCloud-backed workspaces participate in the membership and MCP-token
model. Browser-only workspaces and Local folders workspaces are unsupported.
The server does not scan local AuroraDocs data or silently promote a workspace
to AuroraCloud.

## Data and telemetry

Tool calls send the selected workspace requests to AuroraCloud. The package
does not add product telemetry, analytics, or private repository links. Your
MCP client is separate software and may retain prompts, tool calls, or results;
review that client's data handling before granting access.

## Incident response

For a suspected token leak:

1. Open **Settings → Workspace → MCP Access**.
2. Use **Revoke all active tokens** if the affected credential is uncertain;
   otherwise revoke the identified token.
3. Review token activity and the last-used timestamp.
4. Remove the token from the client configuration.
5. Create a new least-privilege, bounded-expiry token only after the client and
   device are trusted.

Report vulnerabilities privately as described in [SECURITY.md](../SECURITY.md).
