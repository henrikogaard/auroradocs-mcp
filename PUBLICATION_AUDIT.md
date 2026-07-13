# Publication Audit

Date: 2026-07-13

## Published source

This repository began as a clean attributed snapshot exported on 2026-07-13
from the private AuroraDocs source. The snapshot contains only the standalone
MCP server and its public documentation, policies, tests, and release tooling.

Candidate history was audited before publication. Although the intended MCP
history passed its focused checks, a broader candidate-history check found
unrelated source context. The publication gate failed closed, and none of that
candidate history was published. A fresh snapshot was used instead.

## Verification

- `gitleaks` history and directory scans passed on the published snapshot.
- Credential-pattern and MCP-token scans found only documented placeholders.
- The published snapshot contains no secrets or private data.
- Published commits use the maintainer's GitHub noreply identity.
- Apache-2.0 attribution is preserved in `LICENSE` and `NOTICE`.

The audit is repeated before public release so changes to source, documentation,
packaging, and automation remain inside the same fail-closed boundary.
