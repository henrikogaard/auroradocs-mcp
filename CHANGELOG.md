# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Fixed

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

## [0.2.1] - 2026-07-20

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

### Security

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
