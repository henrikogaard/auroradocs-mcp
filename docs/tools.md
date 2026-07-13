# Tools and scopes

AuroraDocs MCP 0.1.0 exposes the tools below to a connected client. Every call
is limited to the workspace in `AURORA_WORKSPACE_ID`.

## Scope catalog

| Scope | Permission |
| --- | --- |
| `read:objects` | Read object metadata, properties, types, and the token workspace's member records. This is the startup baseline. |
| `read:content` | Read object content and content-backed Canvas data. It does not grant object metadata access. |
| `search` | Use workspace knowledge search and related-source discovery. Combine it with the read scopes needed for returned data. |
| `tasks` | Read and write task-list data. Task objects and their properties also need the matching object scopes. |
| `write:objects` | Create, rename, update properties on, or soft-delete objects. It does not grant reads. |
| `write:content` | Create or modify object content. It does not grant content reads. |

Scopes do not imply one another. AuroraCloud also enforces current workspace
membership and role. A viewer cannot write even if a token carries a write
scope.

`search_objects` and its `search` alias search object titles with `read:objects` only.
`wiki_search` searches workspace knowledge and requires `read:objects` plus `search`.
Use `read:content` as well when the workflow will open matching pages or read
their full text.

## Tool reference

The scope column lists the practical minimum for the tool's complete operation,
including object lookup and startup membership verification.

| Tool | What it does | Scopes |
| --- | --- | --- |
| `search_objects` | Search object titles, optionally by type. | `read:objects` |
| `search` | Alias for `search_objects`. | `read:objects` |
| `list_objects` | List object metadata, optionally by type. | `read:objects` |
| `list_recent` | List recently updated objects. | `read:objects` |
| `wiki_search` | Search workspace knowledge and return source records. | `read:objects`, `read:content`, `search` |
| `wiki_get_page` | Read one source; the client can omit full text from its result. | `read:objects`, `read:content` |
| `wiki_related` | Find sources related to an object. | `read:objects`, `search` |
| `wiki_recent` | List recently updated readable sources. | `read:objects` |
| `get_object` | Return one object's metadata, properties, and readable content. | `read:objects`, `read:content` |
| `list_workspace_members` | List members and roles in the token workspace. | `read:objects` |
| `list_task_lists` | List task lists. | `read:objects`, `tasks` |
| `list_task_statuses` | Return supported task status names. | `read:objects`, `tasks` |
| `get_mcp_tool_coverage` | Describe implemented tool coverage and known gaps. | `read:objects` startup baseline |
| `get_mcp_workflow_recipes` | Return built-in workflow recipes and their scopes. | `read:objects` startup baseline |
| `list_week_plan` | Read the Monday-start planning week and optional unscheduled tasks. | `read:objects`, `tasks` |
| `read_canvas` | Read Canvas cards, edges, references, frames, and warnings. | `read:objects`, `read:content` |
| `schedule_task_block` | Schedule a task or create a task-backed time block. | `read:objects`, `tasks`, `write:objects` |
| `create_object` | Create a non-task object. | `read:objects`, `write:objects` |
| `create_task` | Create a task and its task properties. | `read:objects`, `tasks`, `write:objects` |
| `update_task` | Update fields on an existing task. | `read:objects`, `tasks`, `write:objects` |
| `update_object_title` | Rename an object. | `read:objects`, `write:objects` |
| `update_object` | Rename an object and/or replace its plain-text content. | `read:objects`, `write:objects`; also `read:content`, `write:content` when replacing content |
| `set_content` | Replace an object's content with plain text. | `read:objects`, `read:content`, `write:content` |
| `append_block` | Append plain-text paragraphs to an object. | `read:objects`, `read:content`, `write:content` |
| `set_property` | Set a generic object property. | `read:objects`, `write:objects` |
| `delete_object` | Soft-delete an object to trash. | `read:objects`, `write:objects` |

## Safer workflow recipes

Start read-only and ask the client to show its proposed changes before granting
write access.

| Workflow | Scopes | Suggested first request |
| --- | --- | --- |
| Connection check | `read:objects` | "List five object titles and IDs; do not modify anything." |
| Research synthesis | `read:objects`, `read:content`, `search` | "Find relevant sources, cite their object IDs, and list uncertainty." |
| Weekly review | `read:objects`, `read:content`, `search`, `tasks` | "Summarize recent sources and outstanding tasks without making changes." |
| Task triage | `read:objects`, `tasks` | "Propose task field updates but do not apply them." |
| Confirmed task edits | `read:objects`, `tasks`, `write:objects` | "Apply only the task changes I explicitly approve." |

`delete_object` is a write operation even though AuroraDocs uses reversible
soft deletion. Treat it as destructive from the client's point of view.
