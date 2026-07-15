# Contributing

Thank you for helping improve AuroraDocs MCP Server.

## Before you start

- Search existing issues before opening a new one.
- Use a public issue for non-sensitive bugs and proposals.
- Follow [SECURITY.md](SECURITY.md) for suspected vulnerabilities.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in all project spaces.

## Development

Requirements: Node.js 20 or newer and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
node --test scripts/docsContract.test.mjs
npm pack --dry-run
```

`pnpm check` runs the unit tests, builds the package, exercises the stdio
integration, and validates package contents. Keep source and declaration output
consistent when a change affects the published package.

Use test-driven development for behavior changes: add a focused failing test,
verify the expected failure, implement the smallest fix, and verify the full
focused suite. Update public documentation when tools, scopes, authentication,
configuration, security boundaries, or troubleshooting behavior changes.

## Live testing and privacy

Unit and integration tests use synthetic data. Never commit or post real MCP
tokens, credentials, workspace IDs, workspace contents, private links, or
production user data.

The `auroracloud-live-smoke` script is optional and intentionally separate. It
requires `AURORA_API_URL` and `AURORA_API_TOKEN`. Prefer an
`aur_mcp_client_...` credential with an owner-approved workspace grant. A legacy
`aur_mcp_...` token remains supported but also requires
`AURORA_WORKSPACE_ID`. Give either credential only `read:objects`; add optional
`read:content` only when the project context needs readable briefs or citations.
Do not grant write or task scopes.

The smoke always calls `list_workspaces`. Set `AURORA_SMOKE_PROJECT_ID` only
when you want one bounded `get_project_context` request. Without it, the smoke
proves discovery and exits without guessing a project. If a client credential
has multiple workspace grants, set `AURORA_SMOKE_WORKSPACE_ID` to select the
grant for that project check. The dispatcher rejects any tool that is not
authoritatively classified as read-only and never dispatches a write tool.

Pass credentials through your protected local environment, never a committed
file or recorded shell command. Do not preserve raw smoke output in the
repository.

## Pull requests

Keep pull requests focused. Explain the user-visible effect, identify the
verification performed, and call out skipped checks or known limitations.
Documentation changes should work for readers who have no access to the
AuroraDocs monorepo or private project context.

By submitting a contribution, you agree that it is licensed under the Apache
License 2.0 according to this repository's [LICENSE](LICENSE).
