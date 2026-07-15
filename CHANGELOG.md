# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

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
