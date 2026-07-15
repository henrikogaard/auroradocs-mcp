# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

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

### Deployment notes

- The companion AuroraCloud policy, client/grant, migration, and
  project-context API work remains pending in
  [AuroraDocs issue #557](https://github.com/henrikogaard/auroradocs/issues/557),
  along with its migration, deployment, and live end-to-end verification.
- Package version remains `0.1.1`; this unreleased work has not been published.
