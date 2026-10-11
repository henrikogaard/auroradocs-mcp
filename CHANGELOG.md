# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.3.1] - 2026-10-11

Brings the server in line with AuroraCloud changes since 0.3.0. The legacy
`task_lists` collection is due to be removed from AuroraCloud; 0.3.0 depends
on it, so update before then.

### Fixed

- Task lists are read from Aurora's `task_list` objects instead of the frozen
  legacy `task_lists` table, so lists created or renamed in the app since the
  switch are listed and can be used by `create_task` and `update_task`. Lists
  not yet converted are still read from the legacy table while it exists.
  `task_list_id` is written as text, as the app reads it. End-to-end encrypted
  list names are counted and explained instead of shown (#35).
- Task statuses come from the workspace's synced status settings, falling back
  to Aurora's built-ins `Backlog`, `Todo`, `In Progress` and `Done`. The wrong
  `To Do`, `In Review` and `Cancelled` are gone. `list_task_statuses` reports
  each status's group (`todo`, `inProgress`, `done`), a task counts as complete
  when its status is in the done group, and unknown statuses are rejected
  (#36).
- Completing a recurring task with `update_task` creates its next occurrence
  the same way the app does, with the same occurrence id, so the series no
  longer stops and nothing is created twice (#39).
- Aurora's hidden `workspace_config` and `task_list` objects no longer appear
  in `list_objects`, `list_recent`, search or `get_object`, and cannot be
  edited or deleted by id (#37).
- `create_object` refuses `task_list`, `workspace_config` and the retired
  Research Studio types (`research_*`), which are also no longer offered as
  custom-database relation targets (#38).
- Clear errors for an unconfirmed email address
  (`email_verification_required`), for a role that may read but not change an
  object (`write_refused`), and for retired AuroraCloud resources (410 Gone,
  no longer retried) (#40).
- Task assignees and labels are written the way the app stores them: assignees
  as comma-separated user ids in `assignee`, labels comma-separated in `tags`.
  Earlier versions wrote JSON under `assignees` and `labels`, which the app did
  not show. Values in the app's format are now read, and empty lists clear the
  field. Labels written by earlier versions are moved to `tags` the next time
  the task is changed. Assignees written by earlier versions are shown until
  assignees are next set, and are then replaced (#47).

### Changed

- `list_task_statuses` is now workspace-scoped and adds `status_definitions`
  and `source` to its result; `update_task` may return `next_occurrence`.
- Renamed the product to Aurora in descriptions, diagnostics, the desktop
  extension display name and the docs. Connection examples and the desktop
  extension default now use `https://api.aurora.ink`; configurations using
  `https://api.auroradocs.eu` keep working. The npm package, `aurora-mcp`
  executable, extension name, server identity and state directory are unchanged.
- The security and conduct contact is now `contact@aurora.ink`.

## [0.3.0] - 2026-09-05

### Added

- Speak MCP revision 2026-07-28 on stdio while still serving 2025-era clients
  from the same process.
- Persist custom-database plans in `AURORA_MCP_STATE_DIR` so apply survives an
  MCP process restart. Malformed apply `plan_id` values are non-retryable
  `invalid_input`, not internal failures.
- Re-fetch client workspace grants on `list_workspaces` and when a selector
  misses the in-process snapshot.
- Report Obsidian import progress on the originating tool call when the client
  sends a progress token.
- Ship a Claude Desktop `.mcpb` manifest and `pnpm pack:mcpb` packager.

### Changed

- Replaced `@modelcontextprotocol/sdk` 1.x with the v2 `@modelcontextprotocol/server`
  package and `serveStdio`.
- Obsidian import consent now uses Multi Round-Trip Requests (`input_required`)
  on 2026 clients. 2025 form elicitation is served by the SDK shim. Clients
  that advertise no elicitation still use `confirmed: true`.

## [0.2.1] - 2026-08-17

### Added

- Added additive custom object-type and reusable-template tools, including
  starter recipes for contacts, interests, equipment, subscriptions, and
  expenses plus arbitrary reviewable schemas.
- Added a local, analyze-first Obsidian vault importer with safe YAML/Markdown
  and JSON Canvas conversion, wiki-link and attachment mapping, bounded plans,
  explicit MCP elicitation or two-turn compatibility consent, resumable batches
  with stable destination IDs and idempotent attachment uploads, and content-free
  private journals.
- Added `custom_database_design` and `obsidian_import` prompts plus coverage and
  workflow-recipe guidance for agents.
- Added MCP prompt/resource argument completions for authorized workspaces,
  projects, custom-database recipes/object types, and templates, plus the
  approval-gated `template_instantiation` prompt.
- Added idempotent `restore_object` support for recovering soft-deleted objects
  with an explicit changed/already-active result.

### Changed

- Added MCP initialization instructions and a packaged agent guide covering
  capability discovery, explicit workspace selection, structured results,
  citations, read-before-write behavior, exact-plan approval, and untrusted
  workspace/vault content.
- Enriched machine-readable workflow recipes with approval mode, allowed write
  tools/rules, stop conditions, expected structured result types, and current
  split task scopes.
- Documented and contract-tested the release gate that requires a package/tag
  version match and creates the npm package and GitHub Release from the same
  tag.
- Updated the MCP SDK to 1.30.0 and refreshed its patched production
  transitive dependencies so the Node 20/22 CI audit is clean.
- `get_object` no longer returns legacy stored formula/rollup display strings,
  including scalar-mislabeled shadows whose keys are known-computed from the
  custom-type schema. Known computed fields are reported as unavailable because
  the remote MCP server cannot run AuroraDocs' trusted local evaluator;
  freeform database rows also expose an explicit incomplete computed-schema
  status.

### Fixed

- Kept client-grant object, content, and property operations workspace-scoped,
  treated the API's missing-record workspace response as a safe absent object,
  and made resumable Obsidian content upserts work with the documented
  least-privilege import scopes.
- Hardened Obsidian import prerequisites and recovery: failed custom types or
  parent containers no longer downgrade or flatten entries, failed entries no
  longer strand later batches, attachment failures remain retryable and prevent
  false completion, quota preflight counts only pending uploads, and approved
  plans resume from private persisted metadata after an MCP restart.
- Made `unsupported_policy: skip` omit dynamic Markdown fallbacks and unsupported
  Canvas nodes, preserved Canvas-only folder hierarchy and merged-group schemas,
  stripped Markdown image titles before attachment lookup, and marked each
  batch-advancing import call non-idempotent at the MCP tool boundary.
- Filtered templates before pagination, copied all 64 bounded template defaults,
  normalized null optional fields for stable retries, and preserved existing
  requiredness during additive schema updates.
- Skipped unimportable frontmatter keys while preserving template identity,
  bounded aggregate vault source memory, blocked ignored-path attachments,
  keyed duplicate-byte attachments by path, verified live bytes, persisted the
  canonical upload URL, stored Canvas dimensions compatibly, resolved local
  Markdown links, rejected unsupported template default types before writes,
  cleared obsolete property columns, and paged through all object types.
- Kept inferred frontmatter values out of persisted schemas, validated merged
  schemas before approval, held Canvas content until every referenced attachment
  completed, and returned an actionable stale-plan error after restart drift.
- Paged task properties and planning tasks across bounded collection pages,
  filtered templates before applying list limits, and cleared legacy property
  fallback columns when task fields are reset.
- Allowed knowledge results with unknown timestamps to satisfy their published
  output schema and kept the production live-smoke command usable outside tests.

### Security

- Resolved audited transitive `fast-uri` host-confusion and Hono static-server
  path-traversal advisories in the production dependency graph.
- Obsidian access requires one explicit absolute root, stays read-only, rejects
  symlinks/traversal/root replacement, performs no external fetches, and fails
  closed before AuroraCloud writes on stale plans, missing scopes, viewer role,
  E2EE, quota, or storage failures.

## [0.2.0] - 2026-07-16

### Added

- Added independently granted workspace discovery with explicit workspace
  selection for every multi-workspace operation.
- Added bounded `get_project_context` and `list_project_changes` Resume tools,
  the `resume_project` prompt, and the project-context resource template.
- Added read-only Hermes and OpenClaw agent profiles and packaged public setup
  documentation.

### Changed

- Added bounded integer validation and server-side pagination for list and
  search requests.
- Added structured MCP output schemas, `structuredContent`, and accurate tool
  effect annotations.
- Preserved permission, rate-limit, network, and server failures and exposed
  truthful content availability states instead of returning misleading empty
  results.
- Redacted user, workspace, credential, and upstream response details from
  normal lifecycle diagnostics.

### Upgrade notes

- Multi-workspace mode uses an `aur_mcp_client_...` credential plus explicit
  owner-approved workspace grants. Existing legacy workspace tokens remain a
  separate compatibility path; follow the migration guidance in `docs/setup.md`.
- The companion AuroraCloud policy, client/grant, migration, and
  project-context APIs are deployed, and the production grant lifecycle has
  passed end-to-end verification.
