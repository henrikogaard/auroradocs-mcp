# AuroraDocs MCP Server

Exposes your AuroraCloud workspace to Claude Desktop and other MCP-compatible AI clients.

## Security

- On startup, the server verifies that the authenticated user is a **member** of the target workspace. If not, it refuses to start.
- Every read and write operation is scoped to `AURORA_WORKSPACE_ID` — no cross-workspace or cross-user data leakage.
- Object lookups verify `workspace_id` before returning data.
- E2EE-encrypted content is detected and flagged rather than exposing ciphertext.

### Token requirements (#220)

`AURORA_API_TOKEN` must be a workspace MCP token minted via **Settings →
Workspace → MCP Access** in the AuroraDocs web app. The server hardens these
tokens as service credentials:

- **Scopes.** Tokens carry an explicit scope set drawn from six values:
  `read:objects`, `read:content`, `write:objects`, `write:content`, `tasks`,
  `search`. There is **no implicit nesting** — a `read:objects` token cannot
  read content; you need `read:content` separately. New tokens default to
  read-only.
- **Expiry.** Tokens default to a 90-day expiry. Only workspace owners and
  admins can mint a no-expiry token. After expiry, every request returns
  `401 Invalid MCP token`. Renew by minting a new token and updating
  `AURORA_API_TOKEN`.
- **Rate limits.** 300 read requests and 30 write requests per minute per
  token. Exceeding either bucket returns `429` with a `retry-after` header.
  Retry after the indicated number of seconds.
- **Scope errors.** Operations the token's scope set cannot satisfy return
  `403 MCP token is missing scope <scope-name>`. Add the missing scope by
  minting a new token with a broader scope set.
- **Role gating.** A `viewer`-role member's token can never perform write
  operations even if it carries a write scope; the server returns `403 MCP
  token role cannot perform write operations`.
- **Revocation.** Tokens can be revoked individually, in workspace-wide bulk,
  or automatically when the minting user is removed from the workspace.
  Revoked tokens fail with `401 Invalid MCP token` immediately.
- **Audit.** Every authenticated request and every denial is recorded in the
  workspace's MCP Access activity drawer, including IP, user-agent, route,
  scope checked, and denial reason. Raw token values are never logged.

### Transport decision (#491)

AuroraDocs currently supports MCP through the local stdio server only. There is
no hosted HTTP, SSE, or OAuth MCP endpoint. Keep `aur_mcp_...` tokens in a local
MCP client configuration and do not expose the stdio server as a network
service.

Remote MCP transport is deferred by
[`ADR 37`](../../docs/decisions/adr-37-mcp-remote-transport.md) until
AuroraDocs has a separate threat model, client trust model,
consent/revocation UX, distributed rate limits, per-client audit semantics, and
operator kill switch for that surface.

### Recommended renewal workflow

1. Watch the activity drawer for an `expired_denied` event or check the
   expiry date in **Settings → Workspace → MCP Access** at least a week
   before expiry.
2. Mint a new token with the same label and scopes (the UI prefills neither;
   re-pick the scopes intentionally).
3. Update the `AURORA_API_TOKEN` env var in your client config (for Claude
   Desktop, edit `claude_desktop_config.json` and restart).
4. Revoke the old token from the MCP Access UI once the new one is verified
   working.

## Setup

### 1. Install dependencies

```bash
pnpm install
pnpm build
```

### 2. Configure Claude Desktop

The MCP server runs against AuroraCloud.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aurora": {
      "command": "node",
      "args": ["/path/to/AuroraDocs/packages/mcp-server/dist/index.js"],
      "env": {
        "AURORA_API_URL": "http://127.0.0.1:3000",
        "AURORA_WORKSPACE_ID": "your-workspace-id",
        "AURORA_API_TOKEN": "aur_mcp_your_workspace_token"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Authentication

- Recommended:
  - `AURORA_API_TOKEN` using a workspace MCP token (`aur_mcp_...`) minted from Workspace Settings.
- Legacy/dev fallback:
  - `AURORA_API_EMAIL` + `AURORA_API_PASSWORD`
- `AURORA_API_URL` must point at the AuroraCloud API.

### Local AuroraCloud smoke

With the local AuroraCloud API available, run:

```bash
pnpm --filter @aurora/mcp-server auroracloud-smoke
```

This verifies:
- authentication against AuroraCloud
- workspace membership validation
- object creation
- content updates
- property updates
- object reload/list behavior through the MCP tool layer

### Live AuroraCloud smoke

With a real AuroraCloud workspace and credentials available, run:

```bash
AURORA_API_URL=https://api.auroradocs.eu \
AURORA_WORKSPACE_ID=your-workspace-id \
AURORA_API_TOKEN=aur_mcp_your_workspace_token \
pnpm --filter @aurora/mcp-server auroracloud-live-smoke
```

This verifies the production MCP path against AuroraCloud by:
- authenticating with the live backend token
- validating workspace membership
- listing task lists and members
- creating a temporary page
- writing and reloading content
- deleting the temporary page again

## Available Tools

| Tool | Description |
|------|-------------|
| `search_objects` | Search for pages, notes, tasks by title keyword |
| `search` | Alias for `search_objects` |
| `list_objects` | List objects, optionally filtered by type |
| `list_recent` | List recently updated objects, optionally filtered by type |
| `wiki_search` | Search workspace knowledge and return citation-ready sources |
| `wiki_get_page` | Read a wiki source directly, with optional full text |
| `wiki_related` | Find related workspace sources for an object |
| `wiki_recent` | List recently updated readable workspace sources |
| `get_object` | Get full content, details, and properties of an object |
| `list_workspace_members` | List workspace members with roles |
| `list_task_lists` | List available task lists |
| `list_task_statuses` | List available task statuses |
| `get_mcp_tool_coverage` | Return implemented MCP coverage areas plus prioritized gaps |
| `get_mcp_workflow_recipes` | Return documented agent workflow recipes and the tools/scopes they use |
| `list_week_plan` | Return the Monday-start Week Planning view for an anchor date |
| `read_canvas` | Read Canvas cards, edges, references, frames, and warnings without modifying the canvas |
| `schedule_task_block` | Schedule an existing task or create a task-backed time block |
| `create_object` | Create a new page, note, etc. |
| `create_task` | Create a task with status, priority, assignees, labels, etc. |
| `update_task` | Update task fields (status, priority, assignees, etc.) |
| `update_object_title` | Rename an object |
| `update_object` | Rename an object and/or replace its plain-text content |
| `set_content` | Set the text content of an object |
| `append_block` | Append plain-text paragraphs to an object |
| `set_property` | Set a generic property value on an object |
| `delete_object` | Soft-delete an object (reversible) |

### Week Planning

Use `list_week_plan` to inspect the current planning week:

```json
{ "anchor_date": "2026-07-09", "include_unscheduled": true, "unscheduled_limit": 12 }
```

### Canvas

Use `read_canvas` to inspect cards and links in a Canvas object:

```json
{ "id": "canvas_object_id", "include_text": true }
```

### Scheduling

Use `schedule_task_block` only when the user has explicitly asked the agent to schedule work:

```json
{ "mode": "schedule_existing_task", "task_id": "task_object_id", "date": "2026-07-10", "start_time": "09:00" }
```

## Notes

- **E2EE workspaces**: Objects with end-to-end encryption are detected — the server indicates content is encrypted rather than exposing ciphertext.
- **Workspace modes**: The MCP server only connects to AuroraCloud-backed workspaces. Browser-only and folder-backed local workspaces are outside the server's scope because they do not expose the same AuroraCloud membership and token model.
- **Wiki tools**: See [`docs/reference/wiki-mcp-tools.md`](../../docs/reference/wiki-mcp-tools.md) for the implemented `wiki_search`, `wiki_get_page`, `wiki_related`, and `wiki_recent` read-only tool set and its normalized `knowledge_sources` result shape.
- **Coverage and workflows**: `get_mcp_tool_coverage` lets agents inspect the current MCP coverage/gap audit from the server they are connected to. `get_mcp_workflow_recipes` returns the supported weekly summary, task triage, research synthesis, and source lookup tool recipes with required scopes.
- **Task fields**: Full task support including assignee resolution by name/email, task list matching by name, status validation, priority normalization.
- **Soft delete**: `delete_object` marks objects as deleted (trash) — they are not permanently removed.
- **AuroraCloud task lists**: `list_task_lists` reads live `task_lists` records through AuroraCloud's collection API.
- **Wiki tool scope**: Wiki tools reuse the normalized knowledge routes from `#236`, return citation-ready sources, and never surface permission-denied items or ciphertext as readable text.
