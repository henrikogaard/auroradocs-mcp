# Tools and scopes

The current AuroraDocs MCP `0.2.1` source exposes the tools below to a connected
client. The latest published package remains `0.2.0`; custom-database and
Obsidian tools require a local source build until `0.2.1` is released. An
`aur_mcp_client_` credential can discover its independently granted workspaces
with `list_workspaces`; every workspace data call then selects one grant with
`workspace_id` or an unambiguous `workspace_alias`. A legacy `aur_mcp_` token
is pinned to its configured `AURORA_WORKSPACE_ID`.

Agents should start with the [Agent guide](agent-guide.md) for capability
selection, read/write boundaries, structured-result handling, citations, and
the approval-gated custom-database and Obsidian workflows.

## Prompts, resources, and completions

The server advertises MCP argument completions for prompt and resource-template
arguments. Supported suggestions include granted workspace IDs/aliases,
project IDs/titles, custom-database recipe IDs, existing object-type IDs/names,
and template IDs/titles. Dynamic suggestions require a previously resolved
workspace argument in completion context and never cross workspace grants.
Results are filtered and capped at 100 values.
When a bounded backend page is not exhaustive, the completion sets `hasMore`
and omits an unknowable exact total so the client can ask the user to narrow the
typed fragment.

The protocol does not define completion requests for raw tool input schemas.
Direct tool callers should use `list_workspaces`, `list_object_types`,
`list_templates`, and bounded project discovery instead.

## Scope catalog

| Scope | Permission |
| --- | --- |
| `read:objects` | Read object metadata, properties, types, and the token workspace's member records. This is the startup baseline. |
| `read:content` | Read object content and content-backed Canvas data. It does not grant object metadata access. |
| `search` | Use workspace knowledge search and related-source discovery. Combine it with the read scopes needed for returned data. |
| `read:tasks` | Read task lists, task metadata, week planning, and project task context. |
| `write:tasks` | Create or update task metadata and scheduling. It does not imply `read:tasks`. |
| `tasks` | Legacy compatibility scope that combines task reads and writes. It is not offered for new client grants. |
| `write:objects` | Create, rename, update properties on, or soft-delete objects. It does not grant reads. |
| `write:content` | Create or modify object content. It does not grant content reads. |

Scopes do not imply one another. AuroraCloud also enforces current workspace
membership and role. A viewer cannot write even if a token carries a write
scope.

The legacy `tasks` scope is compatibility-only and cannot be selected for new grants.
New grants use `read:tasks` and `write:tasks` so read-only agents never receive
task mutation permission accidentally.

`search_objects` and its `search` alias search object titles with `read:objects` only.
`wiki_search` searches workspace knowledge and requires `read:objects` plus `search`.
Use `read:content` as well when the workflow will open matching pages or read
their full text.

## Tool reference

The scope column lists the practical minimum for the tool's complete operation,
including object lookup and startup membership verification.

| Tool | What it does | Scopes |
| --- | --- | --- |
| `list_workspaces` | List only the workspaces independently granted to a client credential. | Client credential; no workspace selector |
| `search_objects` | Search object titles, optionally by type. | `read:objects` |
| `search` | Alias for `search_objects`. | `read:objects` |
| `list_objects` | List object metadata, optionally by type. | `read:objects` |
| `list_recent` | List recently updated objects. | `read:objects` |
| `wiki_search` | Search workspace knowledge and return source records. | `read:objects`, `search` |
| `wiki_get_page` | Read one source; the client can omit full text from its result. | `read:objects`, `read:content` |
| `wiki_related` | Find sources related to an object. | `read:objects`, `search` |
| `wiki_recent` | List recently updated readable sources. | `read:objects` |
| `get_object` | Return one object's metadata, properties, and readable content. | `read:objects`, `read:content` |
| `list_workspace_members` | List members and roles in the token workspace. | `read:objects` |
| `list_task_lists` | List task lists. | `read:objects`, `read:tasks` |
| `list_task_statuses` | Return supported task status names. | `read:objects`, `read:tasks` |
| `get_mcp_tool_coverage` | Describe implemented tool coverage and known gaps. | `read:objects` startup baseline |
| `get_mcp_workflow_recipes` | Return built-in workflow recipes and their scopes. | `read:objects` startup baseline |
| `list_object_types` | List custom object types and bounded schemas. | `read:objects` |
| `get_custom_database_recipes` | Return starter recipes for contacts, interests, equipment, subscriptions, and expenses. | `read:objects` startup baseline |
| `plan_custom_database` | Build a write-free, expiring, exact-hash plan for a recipe or arbitrary schema. | `read:objects` |
| `apply_custom_database_plan` | Apply the exact approved additive plan, reusing an exact type when possible. | `read:objects`, `write:objects`; add `write:content` when creating template content |
| `update_object_type` | Apply a validated additive object-type update. | `read:objects`, `write:objects` |
| `list_templates` | List reusable templates, optionally by object type. | `read:objects` |
| `create_template` | Create a reusable template with validated defaults and optional content. | `read:objects`, `write:objects`; add `write:content` for body content |
| `create_from_template` | Create an object and copy approved template content/defaults. | `read:objects`, `write:objects`, `write:content` |
| `analyze_obsidian_vault` | Read only the configured vault and create a reviewable import plan; no AuroraCloud writes. | `read:objects` plus local vault-root authorization |
| `get_obsidian_import_plan` | Read one bounded plan section; after restart, revalidate the authorized vault against private persisted plan metadata without writing. | `read:objects` plus local vault-root authorization |
| `import_obsidian_vault` | After explicit acceptance, advance one additive batch and never modify the source. Destination writes use stable IDs, but the batch-advancing tool call is non-idempotent. | `read:objects`, `write:objects`, `write:content` plus local vault-root authorization |
| `get_obsidian_import_status` | Read content-free journal progress, warning codes, and the next action. | `read:objects` plus local vault-root authorization |
| `list_week_plan` | Read the Monday-start planning week and optional unscheduled tasks. | `read:objects`, `read:tasks` |
| `read_canvas` | Read Canvas cards, edges, references, frames, and warnings. | `read:objects`, `read:content` |
| `get_project_context` | Load a bounded, citation-ready project resume packet. | `read:objects`; add `read:content`, `read:tasks`, and `search` for all optional sections |
| `list_project_changes` | Read bounded project changes after a required cursor. | `read:objects` |
| `schedule_task_block` | Schedule a task or create a task-backed time block. | `read:objects`, `read:tasks`, `write:tasks`, `write:objects` |
| `create_object` | Create a non-task object. | `read:objects`, `write:objects` |
| `create_task` | Create a task and its task properties. | `read:objects`, `write:tasks`, `write:objects` |
| `update_task` | Update fields on an existing task. | `read:objects`, `read:tasks`, `write:tasks`, `write:objects` |
| `update_object_title` | Rename an object. | `read:objects`, `write:objects` |
| `update_object` | Rename an object and/or replace its plain-text content. | `read:objects`, `write:objects`; also `read:content`, `write:content` when replacing content |
| `set_content` | Replace an object's content with plain text. | `read:objects`, `read:content`, `write:content` |
| `append_block` | Append plain-text paragraphs to an object. | `read:objects`, `read:content`, `write:content` |
| `set_property` | Set a generic object property. | `read:objects`, `write:objects` |
| `delete_object` | Soft-delete an object to trash. | `read:objects`, `write:objects` |
| `restore_object` | Restore a soft-deleted object; reports whether the state changed. | `read:objects`, `write:objects` |

## Safer workflow recipes

Start read-only and ask the client to show its proposed changes before granting
write access.

`get_mcp_workflow_recipes` returns machine-readable `approvalMode`,
`writeBoundary`, `stopConditions`, and `expectedResultTypes` fields alongside
scopes, ordered tools, goals, and prompt text. Agents should treat those fields
as execution constraints, not suggestions.

| Workflow | Scopes | Suggested first request |
| --- | --- | --- |
| Connection check | `read:objects` | "List five object titles and IDs; do not modify anything." |
| Research synthesis | `read:objects`, `read:content`, `search` | "Find relevant sources, cite their object IDs, and list uncertainty." |
| Weekly review | `read:objects`, `read:content`, `search`, `read:tasks` | "Summarize recent sources and outstanding tasks without making changes." |
| Task triage | `read:objects`, `read:tasks` | "Propose task field updates but do not apply them." |
| Confirmed task edits | `read:objects`, `read:tasks`, `write:tasks`, `write:objects` | "Apply only the task changes I explicitly approve." |
| Custom database design | `read:objects` first; add `write:objects` / `write:content` for apply | "Use the closest recipe, show the exact additive plan, and wait for my approval before applying it." |
| Template instantiation | `read:objects`; add `write:objects`, `write:content` for creation | "Resolve one template, show its exact ID and optional planned object ID, and wait for approval before creating." |
| Obsidian dry run | `read:objects` plus local vault authorization | "Analyze the configured vault, show the plan and warnings, and do not import." |
| Approved Obsidian import | `read:objects`, `write:objects`, `write:content` | "After my later acceptance, import bounded batches with this exact plan ID/hash and report status." |

`delete_object` is a write operation even though AuroraDocs uses reversible
soft deletion. Treat it as destructive from the client's point of view.
Use `restore_object` for an explicitly identified trashed object; repeated calls
are safe and report `changed: false` when the object is already active.

The Obsidian compatibility `confirmed: true` field is a two-turn signal for
clients without MCP form elicitation, not cryptographic proof. Native client
confirmation UI remains authoritative when available. See
[Obsidian import](obsidian-import.md) before enabling the local root.
