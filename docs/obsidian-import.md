# Obsidian import

> **0.2.1 source:** this guide describes the current source branch. The latest
> published npm package remains 0.2.0 and does not include these tools yet.

The importer converts one explicitly authorized local Obsidian vault into an
AuroraCloud-backed AuroraDocs workspace. It is analyze-first, consent-gated,
additive, bounded, and resumable. It never modifies the source vault.

## Before you start

1. Back up the Obsidian vault and the destination workspace.
2. Start with a small non-E2EE test workspace.
3. Grant only `read:objects`, `write:objects`, and `write:content`; add no
   unrelated scopes.
4. Review how your MCP client stores prompts, elicitation forms, tool calls, and
   results. The package adds no telemetry, but the client is separate software.
5. Close or pause heavy vault automation while approving and running batches so
   the analyzed inventory remains stable.

Plaintext import into E2EE workspaces is blocked. The local MCP process has no
AuroraDocs encryption keys and cannot make those writes safe.

## Authorize one source root

Configure the local MCP child process with:

```json
{
  "AURORA_OBSIDIAN_VAULT_ROOT": "/absolute/path/to/My Vault",
  "AURORA_MCP_STATE_DIR": "/absolute/private/path/auroradocs-mcp-state"
}
```

`AURORA_OBSIDIAN_VAULT_ROOT` is required and must be an absolute real
directory. `AURORA_MCP_STATE_DIR` is optional and must remain outside the
vault; by default the server uses a private `.auroradocs-mcp` directory for the
current user. Removing the root variable disables all Obsidian tools while
ordinary AuroraCloud tools keep working.

This environment setting authorizes read-only analysis only. The reader never
scans parents or siblings, follows symlinks, runs plugins, reads `.git`, trash,
caches, or environment files, or fetches a URL found in a note. It reads
bounded Markdown, JSON Canvas, referenced attachments, and the allowlisted
Templates configuration.

## Analyze and review

Call `analyze_obsidian_vault` with one destination workspace and optional
policies:

- hierarchy: Aurora spaces, parent pages, or flattened objects;
- object-type collision: rename, skip, or fail;
- attachments: referenced files only, or skip;
- unsupported items: preserve readable fallbacks, or skip;
- group adjustments: accept, rename, reject, merge, or split existing inferred
  group IDs without supplying new filesystem paths.

Analysis performs no AuroraCloud writes. The plan includes an opaque ID, exact
behavior hash, expiry, vault/root/inventory fingerprints, counts, warnings,
conservative type inference, planned destination IDs, and bounded sample
evidence. Use `get_obsidian_import_plan` to page through groups, entries, or
warnings. Low-confidence notes remain normal pages.

Title, explicit `type`/`kind`, folder, and stable property-shape evidence guide
inference. Templates use Obsidian's configured template folder when present.
Frontmatter is parsed with safe YAML core types, bounded size/depth/aliases, and
no custom-tag execution.

## Give separate import consent

The analysis result always requires confirmation.

- If the client advertises MCP form elicitation, `import_obsidian_vault` shows
  the exact plan, destination, counts, policies, and read-only source promise.
  The server proceeds only when the protocol response is `accept`,
  `confirmed` is true, and every displayed choice still matches the plan.
- Without form elicitation, the first import call returns
  `confirmation_required`. The assistant must present the plan, wait for a
  later user message, then call the tool with the exact `plan_id`, `plan_hash`,
  and `confirmed: true`.

The compatibility field is a two-turn signal, not cryptographic proof. A native
client confirmation UI remains authoritative. Decline, cancel, missing or
malformed confirmation, changed choices, wrong hash, foreign workspace, or
expired plan is a write-free result.

## Mapping behavior

- Markdown headings, paragraphs, emphasis, code, links, lists, task lists,
  quotes, fenced code, and tables map to AuroraDocs structured content.
- Wiki links, aliases, headings, and block references resolve against the
  analyzed vault. Under `preserve`, ambiguous, broken, or unsupported links
  remain readable text with warnings; under `skip`, their unresolved fallback
  content is omitted and reported instead of silently targeting an object.
- Referenced attachments are hashed, deduplicated, uploaded only after their
  parent object exists, and reused by stable idempotency key.
- JSON Canvas text, file, web, and group nodes plus edges are mapped; duplicate
  IDs are remapped. Unresolved or unsupported nodes remain readable under
  `preserve` and are omitted with warnings under `skip`.
- Folders can become spaces or parent pages. Object types are created or reused
  under the approved collision policy. Objects are created before links and
  content so cross-note references can resolve in a second pass.

Conversion is intentionally conservative. Obsidian plugins, Dataview queries,
scripts, CSS, theme behavior, transclusion edge cases, and plugin-specific
metadata are preserved only as readable text/warnings or omitted by the
approved `skip` policy. Always compare a
sample of complex notes and canvases in the test workspace.

## Batches, status, and recovery

One import call processes 50 entries by default and never more than 100. Call
`get_obsidian_import_status` for cumulative complete, failed, and remaining
counts, bounded warning codes, cursor, and next action. Repeat
`import_obsidian_vault` with the same current plan ID/hash until status is
complete or blocked.

Each call intentionally advances the cursor and is therefore non-idempotent at
the MCP protocol boundary. The destination operations inside a batch use stable
planned IDs and attachment idempotency keys, so a lost response can be retried
without creating duplicate destination records.

The private state directory uses mode 0700 and its plan/journal files use mode
0600 with atomic replacement. Persisted plan metadata contains workspace-bound
hashes, policies, inferred schemas, planned IDs, warnings, and relative source
paths needed to revalidate the vault after restart. It never contains note
bodies, frontmatter values, attachment bytes, tokens, credentials, or absolute
paths. The separate progress journal contains hashes, Aurora destination IDs,
cursor/status, bounded warning and
error codes, package/format versions, and timestamps. It never stores note
bodies, frontmatter values, attachment bytes, tokens, credentials, or absolute
paths.

Successful writes are not deleted if a later operation fails. Failed custom
types, parent containers, or attachments keep dependent entries retryable
instead of silently downgrading, flattening, or declaring completion. A server
restart reloads the approved plan metadata, re-analyzes the authorized vault,
and resumes only when workspace, root, inventory, plan hash, and expiry still
match. If the source inventory changed, the old plan is stale and cannot be
silently resumed.

## Preflight failures

Before every batch the importer re-analyzes the root and asks AuroraCloud for a
narrow import-capabilities result. It stops before writes when:

- the root identity or inventory differs from the approved plan;
- the grant lacks `read:objects`, `write:objects`, or `write:content`;
- the current member is not owner, admin, or editor;
- E2EE is enabled or indicated by member keys;
- attachment storage is unavailable, a file exceeds 64 MiB, or quota is
  insufficient;
- the plan/journal belongs to a different workspace or no longer matches.

Resolve only the reported condition. Re-analyze after source or plan changes,
and never weaken path, E2EE, or authorization checks to force an import.
