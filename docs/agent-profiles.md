# Agent profiles

AuroraDocs exposes one vendor-neutral MCP server contract. Hermes, OpenClaw,
and other agents should filter that contract to the smallest tool set needed
for each role instead of enabling every available tool.

## Read-only planning and knowledge profile

Use exactly these tools for a project-resume profile:

- `list_workspaces`
- `get_project_context`
- `list_project_changes`
- `wiki_search`
- `wiki_get_page`
- `wiki_related`

Do not enable write tools in the resume profile. In particular, do not add
object, content, task, scheduling, property, or deletion tools merely because
the client can discover them. A separate future write profile should require an
explicit approval boundary and narrower grants.

The same profile applies to both clients:

| Client | Recommended use |
| --- | --- |
| Hermes | Load grounded project context at session start, then retrieve cited knowledge only as needed. |
| OpenClaw | Resume project work, monitor bounded changes, and look up related workspace knowledge without mutation. |

Use the `resume_project` prompt at the start of a new agent session. If the
client supports resources, the matching project packet is also available from
`aurora://workspaces/{workspaceId}/projects/{projectId}/context`.

Every project and knowledge call must include `workspace_id` or an unambiguous
granted workspace alias. Parallel reads are safe because every request selects
an explicit workspace. Serialize future writes so that a later write-enabled
profile cannot race approvals, cursors, or dependent updates.

Save the cursor returned by `get_project_context`. For a scheduled refresh,
pass that change cursor to `list_project_changes`, process the bounded response,
and persist its next cursor. When `nextCursor` is `null`, retain the previous
cursor; do not overwrite it with `null`. A cursor belongs to one project in one workspace;
never reuse it across workspaces.

Never expose the raw credential to prompts, logs, or committed configuration.
Store `AURORA_API_TOKEN` in the agent's local secret facility or protected
runtime environment. Tool output, bug reports, and agent memory must contain
only safe workspace data, never the `aur_mcp_client_...` value.

## Suggested session start

1. Call `list_workspaces` and select the intended grant explicitly.
2. Invoke `resume_project` with that workspace and exactly one project ID or
   bounded title query.
3. Read the returned status, blockers, next actions, availability states, and
   citations before planning.
4. Use `wiki_search`, `wiki_get_page`, or `wiki_related` only when the resume
   packet identifies a knowledge gap.
5. Continue read-only. Do not infer permission to mutate from a planning task.

For a later refresh, use `list_project_changes` with the saved cursor instead
of repeatedly reloading all project context.
