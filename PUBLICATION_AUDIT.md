# Publication Audit

Date: 2026-07-13

## Scope and source

- Source repository: `henrikogaard/auroradocs`
- Source checkout: `/Users/henrik/Dev/Repos/auroradocs`
- Source branch: `development`
- Source commit: `fe764b6b69814756ad4c0fc19370c55603b34106`
- Extracted path: `packages/mcp-server`
- Destination repository: `henrikogaard/auroradocs-mcp`
- Tracking issue: `henrikogaard/auroradocs#551`

The source checkout had one pre-existing untracked path, `.opencode/`. It was not
modified or copied. Local `origin/development` was
`1a24c9bc13dec4cd0a10de676b9dd1430134a66e`; the requested canonical local
`development` branch was used for the snapshot.

## Candidate history extraction

The history candidate was produced with:

```text
rtk git clone --no-local --branch development /Users/henrik/Dev/Repos/auroradocs /tmp/auroradocs-mcp-history
rtk git -C /tmp/auroradocs-mcp-history subtree split --prefix=packages/mcp-server -b extracted/main
rtk git clone --branch extracted/main /tmp/auroradocs-mcp-history /Users/henrik/Dev/Repos/auroradocs-mcp
rtk git -C /Users/henrik/Dev/Repos/auroradocs-mcp branch -M main
```

The candidate publication branch ended at
`327a71d9a5e2597e029ca8a800bd60f25535b56b` and contained 17 commits. Its
reachable paths were limited to `README.md`, `package.json`, `tsconfig.json`,
`scripts/**`, and `src/**`.

## Audit commands and results

| Check | Command summary | Result |
| --- | --- | --- |
| Candidate publication history secrets | `gitleaks git --log-opts="main" --redact=100` | Pass: 15 scanned commits, no leaks |
| Candidate directory secrets | `gitleaks dir --redact=100` | Pass: no leaks |
| Candidate authors | `git log main --format='%an %ae'` | Pass: only Henrik Ogaard using the approved `henrik@ogard.no` address |
| Candidate commit subjects | Case-insensitive review for `secret`, `token`, `password`, `credential`, `private`, `internal`, `customer`, and production terms | Reviewed: two security/token-related subjects; neither contained private data |
| Candidate paths | Full reachable path inventory plus secret/private filename patterns | Pass: no secret-like paths |
| MCP token literals | Full history patch review for `aur_mcp_` | Pass: only documented placeholder/redacted examples |
| Live smoke history | Full patch history for `scripts/auroracloudLiveSmoke.ts` | Pass: workspace ID and token are always read from environment variables; no embedded IDs or credentials |
| Credential-shaped literals | Full history regex review plus gitleaks | Pass: no credential values; the local smoke password is the literal redacted fixture value |
| Candidate clone all refs | `gitleaks git --log-opts="--all" --redact=100` | Fail closed: 71 findings in monorepo remote refs unintentionally copied by the local clone, outside candidate `main` |
| Clean snapshot history | `gitleaks git --log-opts="--all" --redact=100` | Pass: one commit, no leaks |
| Clean snapshot directory | `gitleaks dir --redact=100` | Pass: no leaks |
| Clean snapshot authors | `git log --all --format='%ae'` | Pass: only `8872964+henrikogaard@users.noreply.github.com` |
| Clean snapshot paths and token values | Full path inventory and `rg` scans | Pass: intended package paths only; documented placeholders only |

The first all-ref scan was deliberately broader than the intended publication
branch. It exposed a local-clone hazard: remote tracking refs from the source
monorepo were present even though only the subtree branch was intended for
publication. No candidate history ref was pushed.

## History gate decision

**Decision: clean attributed snapshot.**

Although the 17-commit subtree publication branch passed its own audit, the
candidate clone contained unsafe unrelated monorepo refs and its all-ref scan
reported findings. The publication gate therefore failed closed. The complete
candidate was preserved at `/tmp/auroradocs-mcp-quarantine` for local review
and was never configured with or pushed to the GitHub destination.

The clean repository was initialized from:

```text
git archive fe764b6b69814756ad4c0fc19370c55603b34106:packages/mcp-server
```

Its root commit is `7e3fd995cca6f0c2759c9e3df7511d8c67aaa6e3`, with source repository,
source SHA, branch, and path recorded in the commit message. New commits use
Henrik Ogaard's GitHub noreply identity.

## Remote publication state

- GitHub repository: `https://github.com/henrikogaard/auroradocs-mcp`
- Visibility: **private**
- Default branch: `main`
- Remote heads after base push: only
  `7e3fd995cca6f0c2759c9e3df7511d8c67aaa6e3 refs/heads/main`
- Local readiness branch: `feature/public-repository-readiness`
- No tags, releases, npm publication, public visibility change, or additional
  remote branch was created by this task.

GitHub GraphQL quota was exhausted. Repository existence was checked through
REST, and the private repository was created through `POST /user/repos` after
`gh repo create` could not run. Project 4 movement is deferred for the same
quota reason. Issue #551 remains open; its `status:todo` label was removed.

## TDD exception and verification

This task is a repository extraction, history/security audit, and publication
configuration change. It uses the approved documentation/configuration/environment
TDD exception: there is no product behavior change for which a red/green test
would be meaningful. Verification instead covered source/destination status,
full candidate and snapshot history scans, directory scans, authors, commit
messages, paths, credential patterns, live-smoke history, remote visibility,
and remote refs.

No dependency or package behavior changes were made. A build was not treated as
Task 1 evidence: the extracted package has no standalone lockfile or installed
dependencies yet, and package cleanup/versioning belongs to the next task.
The source package version (`0.1.1`) was intentionally preserved; the approved
standalone `0.1.0` line is owned by Task 2.

## Concerns and follow-up boundaries

- The quarantined candidate contains unrelated monorepo refs and must never be
  pushed or reused as a publication remote.
- Project 4 status remains deferred until GitHub GraphQL quota is available.
- Standalone dependency materialization, build/test execution, package name and
  version normalization, licensing, policies, CI, and public visibility are
  explicitly outside Task 1.
