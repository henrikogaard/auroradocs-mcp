# Agent Planning and Knowledge Roadmap

Date: 2026-07-14
Status: Phase 0 runtime and Phase 1 Resume work implemented; AuroraCloud activation pending

## Implementation plans

- [MCP runtime reliability and Resume work](superpowers/plans/2026-07-14-mcp-runtime-resume-work.md) — tracked in [issue #9](https://github.com/henrikogaard/auroradocs-mcp/issues/9)
- [AuroraCloud workspace policy, multi-workspace grants, and project context](https://github.com/henrikogaard/auroradocs/blob/development/docs/superpowers/plans/2026-07-14-mcp-policy-multi-workspace.md)

## Delivery status

The public MCP runtime work is implemented on the branch tracked by
[issue #9](https://github.com/henrikogaard/auroradocs-mcp/issues/9). This
includes the delivered Phase 0 runtime reliability work and the Phase 1 Resume
surfaces: granted-workspace discovery, explicit workspace selection,
`get_project_context`, `list_project_changes`, the `resume_project` prompt, the
project-context resource template, and bounded Hermes and OpenClaw profiles.

Production activation is not complete. The companion AuroraCloud policy,
client/grant, migration, and project-context API work remains tracked by
[AuroraDocs issue #557](https://github.com/henrikogaard/auroradocs/issues/557);
there is no companion implementation pull request to link yet. Its database
migration, service deployment, and live end-to-end integration must be
completed and verified before the new client-credential and Resume workflows
can be described as available in production. The documented legacy
workspace-token path remains the compatibility path until that activation is
complete.

## Purpose

AuroraDocs MCP should make Aurora the durable, human-visible project brain for
agents such as Hermes and OpenClaw. Agent runtimes keep their own private,
short-lived session memory. Aurora owns the project state people need to review,
edit, share, resume, and audit:

- goals and project briefs
- plans, milestones, tasks, blockers, and next actions
- decisions and their supporting sources
- research and citation-backed syntheses
- explicit progress checkpoints between agent runs

This roadmap starts with **Resume work**, then adds **Plan and execute**, and
then **Research and synthesize**. Multi-workspace access and owner-controlled
MCP policy are requirements from the first production design, not later
add-ons.

## Product boundary

AuroraDocs is the canonical system of record for project knowledge and
planning. It does not replace an agent runtime's conversation memory, personal
profile, scratchpad, skill learning, execution sandbox, scheduler, or subagent
orchestration.

The roadmap therefore favors a small workflow-oriented MCP surface over a
second agent runtime or a large collection of vendor-specific tools.

## Design principles

1. **One project truth.** Reuse Aurora projects, project briefs, task
   properties, relationships, and normalized knowledge sources.
2. **Explicit workspace on every operation.** Never depend on mutable active
   workspace state.
3. **Independent owner grants.** Multi-workspace access is the union of
   separately approved workspace grants, never silent account-wide access.
4. **Disabled by default.** New workspaces do not expose MCP until an owner
   enables it.
5. **Least privilege.** Read, content, search, task-read, task-write, and other
   write permissions remain independently controllable.
6. **Human-visible writes.** Plans, checkpoints, decisions, and research saved
   by an agent remain ordinary Aurora content with provenance.
7. **Bounded context.** Every list, context, and search response has explicit
   size limits, pagination or cursors, freshness metadata, and citations.
8. **Truthful availability.** Empty, locked, not indexed, permission denied,
   missing, rate limited, and failed are different outcomes.
9. **Lean agent catalogs.** Prefer a few high-value workflow tools, structured
   responses, resources, and prompts over dozens of overlapping tool schemas.
10. **No vendor fork.** Hermes, OpenClaw, Codex, Claude, and other MCP clients
    share the same server contracts. Client-specific work stays in setup and
    tool-filter guidance.

## Recommended architecture

### Workflow facade

Add high-level project workflows over the current object, task, property, and
knowledge APIs. Keep the existing atomic tools for advanced clients, but make
the workflow tools the recommended surface for autonomous and long-running
agents.

MCP resources and prompts complement the workflow tools; they do not replace
server-side validation, authorization, pagination, or result shaping.

### Multi-workspace client identity

The target model is one user-owned MCP client identity with independent
owner-approved workspace grants. Registering a client identity grants no
workspace access by itself.

Examples of client identities:

- `Henrik - OpenClaw`
- `Personal server - Hermes`
- `Work laptop - Codex`

Each grant records:

- client identity
- workspace ID and display alias
- member identity and current workspace role
- granted scopes and policy ceiling
- issuing owner
- creation, expiry, last-used, and revocation timestamps
- audit metadata and safe fingerprint

The client credential authenticates the installation. Authorization still
comes from the effective grant for the workspace named in each request. Users
who want a smaller compromise radius can register a separate client identity
for each workspace instead of attaching several grants to one identity.

One owner can revoke their workspace grant without affecting grants issued by
other workspace owners. Removing or downgrading a member automatically
re-evaluates or revokes affected grants.

`list_workspaces` exposes only workspaces granted to the client. Every other
multi-workspace tool accepts `workspace_id` or an unambiguous configured alias.
Responses repeat the workspace identity so objects, cursors, and citations
cannot be confused across workspaces.

There is no process-global `switch_workspace` state. Mutable active state is
unsafe when an agent or client can issue parallel calls.

### Transitional compatibility

Until client identities and grants ship, users can configure one stdio server
entry per workspace. This remains a supported fallback, but it is not the
preferred long-term experience because it duplicates the tool catalog in agent
prompts.

A local multi-token configuration bundle may be evaluated as a bridge only if
it can keep each credential independently scoped and protected. It must not
become a plaintext account-token file format that bypasses owner grants.

## Default workspace MCP policy

New AuroraCloud workspaces use these defaults:

| Policy | Default |
| --- | --- |
| MCP access | Disabled until enabled by the owner |
| MCP policy management | Owner only |
| Client identity registration | Allowed, but grants no workspace access |
| Workspace grant approval/creation | Owner only |
| Member access | Denied unless explicitly allowed |
| Admin access | Denied unless enabled by the owner |
| Editor access | Denied unless enabled by role or member |
| Viewer access | Denied |
| Initial grant | `read:objects` only |
| Content access | Disabled |
| Knowledge search | Disabled |
| Task reads | Disabled |
| Task writes | Disabled |
| Object/content writes | Disabled workspace-wide |
| No-expiry grants | Disabled |
| Default expiry | 30 days |
| Maximum expiry | 90 days |
| Audit history | Always enabled |

Owners can configure:

- role defaults and individual member overrides
- whether selected members can request or create grants within policy limits
- maximum scopes and expiry
- whether content, search, task reads, or any writes are permitted
- allowed client identities
- per-client and per-member revocation
- emergency revoke-all

Policy is enforced by AuroraCloud on every request. Client-side filtering and
hidden UI controls are usability measures, not security boundaries.

### Existing workspace migration

Do not silently revoke existing active tokens during policy rollout.

- Workspaces with no active MCP tokens adopt the new disabled default.
- Workspaces with active tokens enter a visible **Review required** state.
- Existing tokens continue temporarily under their current scopes and expiry.
- Owners see which tokens exceed the proposed policy.
- Applying the new policy can explicitly revoke or narrow non-compliant tokens.
- Owners receive a 30-day review window with reminders at 14, 7, and 1 day
  before enforcement.
- At the published enforcement time, legacy tokens that were not explicitly
  approved or replaced are revoked with a `policy_migration` audit event.

## Scope evolution

The current `tasks` scope permits both task reads and writes. Replace it with
separate scopes suitable for owner policy:

- `read:tasks`
- `write:tasks`

Keep object metadata, object content, knowledge search, object writes, and
content writes independent. A compatibility period may recognize legacy
`tasks` grants, but new grants and documentation should use the split scopes.

The default token/grant scope changes from `read:objects` plus `read:content`
to `read:objects` only.

## Phase 0 - Reliability and policy foundation

**Status:** Runtime reliability, AuroraCloud policy, client/grant enforcement,
legacy-token migration, and deployment are implemented. The production grant
lifecycle has passed live end-to-end verification.

### Deliverables

- Validate numeric inputs as bounded integers at both schema and runtime layers.
- Move bounded object listing and title search to server-side pagination.
- Preserve permission, rate-limit, network, and server failures instead of
  converting them into empty results.
- Return normalized availability states for readable, empty, locked,
  unavailable, and denied content.
- Add `outputSchema`, `structuredContent`, and MCP annotations including
  read-only, destructive, idempotent, and open-world hints.
- Redact user and workspace identifiers from normal stderr diagnostics.
- Introduce workspace MCP policy storage, routes, audit events, and owner UI.
- Introduce the multi-workspace client/grant model and legacy-token migration.
- Split task read/write scopes.

### Acceptance criteria

- Invalid limits cannot expand a result or force an unbounded fetch.
- A missing content scope returns `permission_denied`, not successful empty
  content.
- New workspaces expose no MCP access before owner enablement.
- A non-owner cannot relax workspace policy.
- Revoking one workspace grant leaves other client grants intact.
- Parallel calls cannot leak or confuse workspace context.

## Phase 1 - Resume work

Phase 1 is the first user-facing workflow milestone.

**Status:** The public MCP tools, prompt, resource template, and agent profiles
are implemented. The companion AuroraCloud multi-workspace, policy, grant, and
project-context APIs are deployed, and the production grant lifecycle has been
verified end to end. Package release `0.2.0` makes this workflow publicly
installable.

### `get_project_context`

Resolve a project by ID or bounded name query inside an explicit workspace and
return a compact, structured resume packet.

Inputs include:

- `workspace_id`
- `project_id` or `query`
- recent-activity window
- bounded task and source limits

The response includes:

- workspace and project identity
- goal, status, priority, owner, progress, dates, and project brief
- open tasks grouped by status
- blockers, risks, and unresolved decisions
- recent decisions and project activity
- next actions
- citation-ready normalized sources and deep links
- per-source availability
- `as_of` timestamp and an initial change cursor for `list_project_changes`

If a query is ambiguous, return bounded candidates and require the client to
choose. Never silently select a similarly named project in another workspace.

### Supporting surfaces

- `list_workspaces`: list granted workspaces and effective capabilities.
- `list_project_changes`: incrementally refresh a project since a cursor.
- `resume_project` prompt: guide an agent through a grounded resume workflow.
- `aurora://workspaces/{workspaceId}/projects/{projectId}/context` resource
  template: expose the same normalized context contract to resource-aware
  clients.
- Lean Hermes and OpenClaw tool-filter recipes for read-only project work.

### Acceptance criteria

- A fresh agent session can resume a named project without prior conversation
  history.
- The response names current blockers and next actions with source citations.
- Repeated refreshes use the required `list_project_changes` cursor instead of
  passing a cursor back to `get_project_context`.
- Locked or denied content remains distinguishable and is never emitted as
  readable text.
- A client with two granted workspaces cannot resolve a project without an
  explicit or unambiguous workspace.

## Phase 2 - Plan and execute

### Deliverables

- Read and create project plans using Aurora project briefs and properties.
- Propose task creation and task updates without mutating by default.
- Apply an explicitly approved, bounded set of changes.
- Add idempotency keys to retryable writes.
- Record progress checkpoints containing completed work, blockers, decisions,
  next actions, agent/client identity, timestamps, and source references.
- Keep writes visible as ordinary Aurora project content, tasks, properties, or
  linked notes.
- Serialize writes even when the client allows parallel read tools.

### Safety contract

- Dry-run is the default for batch planning changes.
- Each mutation response states exactly what changed.
- Write scopes must remain within the workspace owner's policy ceiling.
- Destructive actions are not part of the recommended planning profile.
- Agent provenance is visible but does not expose raw credentials or private
  runtime transcripts.

### Acceptance criteria

- An agent can create a plan, propose tasks, obtain approval, apply the
  approved subset, and resume from the resulting checkpoint.
- Retrying a checkpoint or approved batch does not duplicate records.
- Owners can disable writes without disabling read-only project context.

## Phase 3 - Research and synthesize

### Deliverables

- Project-scoped knowledge search and related-source traversal.
- Bounded source hydration with stable source IDs and freshness metadata.
- Citation-backed synthesis with a separate uncertainty section.
- Save research findings, source links, and resulting decisions to the project.
- Preserve the distinction between raw research, synthesis, and decisions.
- Reuse Aurora research projects and artifacts when the workflow needs a
  dedicated research surface.

### Acceptance criteria

- Agents can answer project questions using traceable Aurora sources.
- Saved synthesis retains source IDs and deep links.
- Permission-denied sources are omitted; locked sources use explicit
  availability states.
- A decision can point to its supporting synthesis without copying an entire
  agent transcript into Aurora.

## Phase 4 - Agent compatibility and evaluation

### Client guidance

Document tested configurations for:

- Hermes local stdio MCP with per-server tool filters
- OpenClaw's MCP registry, probe/doctor flow, tool filters, and read parallelism
- Codex, Claude Code, Claude Desktop, and generic stdio clients

Provide at least two recommended profiles:

1. **Project reader**: workspace discovery, project context, incremental
   changes, and citation-backed knowledge reads.
2. **Project planner**: reader profile plus approved plan, task, checkpoint, and
   research writes.

### Evaluation matrix

Evaluate the real packaged server against synthetic and explicitly authorized
test workspaces:

- fresh-session project resume
- ambiguous project names
- same project name in two workspaces
- large projects and pagination
- incremental refresh after changes
- expired, revoked, and policy-narrowed grants
- member downgrade or removal
- read-only task access
- denied writes
- E2EE locked content
- partial indexing and unsupported source types
- retry/idempotency behavior
- tool filtering and prompt-size impact in Hermes and OpenClaw

## Documentation and release expectations

Each phase updates the public README, setup guide, tools/scopes reference,
security boundaries, troubleshooting guide, and package tests in the same
change. Public examples use synthetic workspace IDs and redacted credentials.

Behavior changes require focused red/green tests plus the full package check.
Live verification remains read-only unless the test workspace and exact write
workflow were explicitly authorized.

Release notes must distinguish:

- compatibility fixes
- new read-only workflow capabilities
- new write capabilities
- scope or policy migration requirements

## Out of scope

- Replacing Hermes, OpenClaw, or another agent's private session memory
- Storing raw agent conversations by default
- Running agent queues, subagents, sandboxes, or model inference in Aurora
- Automatically granting every workspace belonging to an account
- Hosted remote MCP transport without a separate approved threat model
- Silent policy weakening or silent revocation of existing grants

## Success measures

- An agent can resume a project accurately from Aurora after losing all local
  conversation context.
- Owners can see and control which members, clients, workspaces, and scopes are
  exposed.
- Multi-workspace clients use one lean tool catalog without ambiguous context.
- Project updates remain reviewable by people who never use the agent.
- Citation and availability contracts remain consistent across MCP and other
  Aurora knowledge surfaces.
- Agent-specific setup is configuration, not a fork of the Aurora MCP server.
