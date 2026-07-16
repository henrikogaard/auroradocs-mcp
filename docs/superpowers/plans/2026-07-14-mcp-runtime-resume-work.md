# MCP Runtime Reliability and Resume Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public AuroraDocs MCP server reliable under agent use and add a lean, multi-workspace “Resume work” surface for Hermes, OpenClaw, Codex, Claude, and other MCP clients.

**Architecture:** The server keeps atomic tools for compatibility, but normalizes validation, availability, errors, and MCP result metadata in one runtime layer. A client credential discovers independently granted workspaces from AuroraCloud; every multi-workspace tool call resolves an explicit workspace and the first workflow facade consumes AuroraCloud’s bounded project-context and change endpoints.

**Tech Stack:** TypeScript 5.9, Node.js 20+, `@modelcontextprotocol/sdk` 1.29, stdio transport, Node test runner through `tsx`, pnpm 10.

**Tracking issue:** [#9 — Harden MCP runtime and add multi-workspace Resume work](https://github.com/henrikogaard/auroradocs-mcp/issues/9)

**Companion architecture:** [Public workspace policy and multi-workspace design](../../agent-planning-knowledge-roadmap.md#default-workspace-mcp-policy)

## Global Constraints

- The public repository remains the canonical MCP source.
- Keep package name `@henrikogard/auroradocs-mcp` and executable `aurora-mcp`.
- Do not bump `0.1.1` or publish npm/GitHub releases in this implementation plan; release/version work requires a separate explicit instruction.
- Support the transitional one-server-entry-per-workspace configuration using `AURORA_WORKSPACE_ID`.
- Prefer `AURORA_API_TOKEN=aur_mcp_client_...` for new multi-workspace setup; do not create a plaintext multi-token bundle.
- Every multi-workspace operation resolves `workspace_id` or an unambiguous granted alias. Do not add process-global workspace switching.
- Invalid numeric inputs must fail before network access; list calls must remain bounded server-side.
- Permission, authentication, rate-limit, network, and server failures must never become successful empty results.
- Results distinguish `available`, `empty`, `encrypted_locked`, `permission_denied`, `not_found`, and `unavailable`.
- All tool definitions include `outputSchema`, `structuredContent`, and accurate MCP annotations.
- Ordinary stderr diagnostics must not include user IDs, workspace IDs, credentials, object content, or API response bodies.
- Write tools remain outside the recommended Hermes/OpenClaw resume profile.
- The AuroraCloud dependency is `docs/superpowers/plans/2026-07-14-mcp-policy-multi-workspace.md` in the AuroraDocs repository; runtime-hardening tasks 1-2 can merge before that dependency.

## File Map

- Create `src/input.ts`: bounded integer, string, date, and workspace-selector validation.
- Create `src/input.test.ts`: invalid-number and workspace-selection tests with no network calls.
- Create `src/errors.ts`: typed Aurora HTTP/network errors and safe MCP error mapping.
- Create `src/errors.test.ts`: truthful error classification and redaction tests.
- Create `src/contracts.ts`: shared availability, pagination, workspace, project-context, and tool result types.
- Create `src/projectContext.ts`: public-client calls and normalization for project context and changes.
- Create `src/projectContext.test.ts`: ambiguity, cursors, citations, locked/denied content, and limits.
- Create `src/mcpSurfaces.ts`: prompt and resource-template registration data.
- Create `src/mcpSurfaces.test.ts`: prompt/resource contract tests.
- Create `src/server.ts`: construct the MCP server so stdio and unit tests exercise identical handlers.
- Modify `src/auroraClient.ts`: one-page bounded calls, client-workspace discovery, truthful content results, and typed errors.
- Modify `src/auroraClientPlanning.test.ts`: bounded request and failure tests.
- Modify `src/toolCatalog.ts`: schemas, annotations, workspace inputs, and the three resume tools.
- Modify `src/toolCatalog.test.ts`: every tool’s input/output/annotation contract.
- Modify `src/tools.ts`: validated dispatch, explicit workspace resolution, normalized structured results.
- Modify `src/index.ts`: configuration mode detection, safe diagnostics, and server startup.
- Modify `test/stdio.integration.test.ts`: tools, prompts, resources, structured output, and redacted stderr.
- Modify `scripts/auroracloudLiveSmoke.ts` and `scripts/auroracloudLiveSmoke.test.mjs`: bounded explicit-workspace smoke coverage.
- Create `docs/agent-profiles.md`: lean Hermes and OpenClaw profiles and scheduling/concurrency guidance.
- Modify `README.md`, `docs/setup.md`, `docs/agent-planning-knowledge-roadmap.md`, `scripts/docsContract.test.mjs`, and `CHANGELOG.md`: setup, token/grant lifecycle, workflows, roadmap status, and unreleased change notes.

---

### Task 1: Reject invalid numeric inputs and stop unbounded collection fetches

**Files:**
- Create: `src/input.ts`
- Create: `src/input.test.ts`
- Modify: `src/auroraClient.ts`
- Modify: `src/auroraClientPlanning.test.ts`
- Modify: `src/tools.ts`
- Modify: `src/toolCatalog.ts`
- Modify: `src/toolCatalog.test.ts`

**Interfaces:**
- Produces: `readBoundedInteger()`, `readWorkspaceSelector()`, `listObjectsPage()`, `searchObjectsPage()`.
- `readBoundedInteger(input, key, { defaultValue, min, max })` returns `{ ok: true, value } | { ok: false, message }`.

- [ ] **Step 1: Write failing validation tests**

```ts
test('bounded integer rejects negative, fractional, NaN, infinite, and oversized values', () => {
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 51]) {
    assert.deepEqual(
      readBoundedInteger({ limit: value }, 'limit', { defaultValue: 20, min: 1, max: 50 }),
      { ok: false, message: 'limit must be an integer between 1 and 50' },
    )
  }
})

test('list_objects rejects an invalid limit before network access', async () => {
  const result = await executeToolCall('list_objects', { workspace_id: 'workspace-1', limit: -1 }, context)
  assert.equal(result.type, 'error')
  assert.equal(requestCount, 0)
})
```

- [ ] **Step 2: Run validation tests and verify red**

Run: `pnpm exec tsx --test src/input.test.ts src/toolCatalog.test.ts`

Expected: FAIL because `input.ts` does not exist and numeric schemas have no integer bounds.

- [ ] **Step 3: Implement exact input helpers**

```ts
export type BoundedIntegerResult = { ok: true; value: number } | { ok: false; message: string }

export function readBoundedInteger(
  input: Record<string, unknown>,
  key: string,
  bounds: { defaultValue: number; min: number; max: number },
): BoundedIntegerResult {
  const raw = input[key]
  if (raw === undefined) return { ok: true, value: bounds.defaultValue }
  if (!Number.isInteger(raw) || (raw as number) < bounds.min || (raw as number) > bounds.max) {
    return { ok: false, message: `${key} must be an integer between ${bounds.min} and ${bounds.max}` }
  }
  return { ok: true, value: raw as number }
}
```

`readWorkspaceSelector()` accepts a non-empty `workspace_id` or `workspace_alias`; reject both present together.

- [ ] **Step 4: Tighten every numeric input schema**

Use JSON Schema `type: 'integer'`, `minimum`, and `maximum`. Exact bounds: normal list/search 1-50; related/recent sources 1-10; unscheduled tasks 1-50; activity days 1-90; project sources 1-25; project changes 1-100.

- [ ] **Step 5: Replace all-pages collection listing with bounded page requests**

Replace `BackendCollection.list()` with:

```ts
type CollectionPage<T> = { items: T[]; page: number; perPage: number; totalPages: number; totalItems: number }
type BackendCollection = {
  listPage(options: { filter?: string; sort?: string; expand?: string; page: number; perPage: number }): Promise<CollectionPage<Record<string, unknown>>>
  get(id: string): Promise<Record<string, unknown>>
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>
  update(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>>
}
```

`listObjectsPage()` and `searchObjectsPage()` issue exactly one server request with validated `page` and `perPage`; callers never fetch subsequent pages implicitly. For title search, use AuroraCloud knowledge search rather than downloading all objects and filtering locally.

- [ ] **Step 6: Add request-shape tests**

Assert `list_objects(limit: 20)` produces one request containing `page=1&perPage=20`; a search uses `/api/knowledge/workspaces/{workspaceId}/search?q=...&limit=...`; and neither path loops over `totalPages`.

- [ ] **Step 7: Run focused tests and verify green**

Run: `pnpm exec tsx --test src/input.test.ts src/auroraClientPlanning.test.ts src/toolCatalog.test.ts`

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/input.ts src/input.test.ts src/auroraClient.ts src/auroraClientPlanning.test.ts src/tools.ts src/toolCatalog.ts src/toolCatalog.test.ts
git commit -m "fix: bound MCP inputs and pagination"
```

### Task 2: Preserve failures and return truthful availability

**Files:**
- Create: `src/errors.ts`
- Create: `src/errors.test.ts`
- Create: `src/contracts.ts`
- Modify: `src/auroraClient.ts`
- Modify: `src/auroraClientPlanning.test.ts`
- Modify: `src/tools.ts`
- Modify: `src/toolCatalog.test.ts`

**Interfaces:**
- Produces: `AuroraApiError`, `toSafeToolError()`, `ContentReadResult`, `Availability`.

- [ ] **Step 1: Write failing error and availability tests**

```ts
test('403 content read becomes permission_denied, not empty content', async () => {
  const result = await getContent('object-1', 'workspace-1')
  assert.deepEqual(result, { availability: 'permission_denied', text: null })
})

test('429 preserves a retryable MCP error without leaking the response body', () => {
  const result = toSafeToolError(new AuroraApiError(429, 'rate_limited', 'private upstream body', 12))
  assert.deepEqual(result, {
    type: 'error',
    code: 'rate_limited',
    message: 'AuroraCloud rate limit exceeded. Retry after 12 seconds.',
    retryable: true,
  })
})
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm exec tsx --test src/errors.test.ts src/auroraClientPlanning.test.ts`

Expected: FAIL because failures are still caught as `null` and typed errors do not exist.

- [ ] **Step 3: Add the normalized contracts**

```ts
export type Availability =
  | 'available'
  | 'empty'
  | 'encrypted_locked'
  | 'permission_denied'
  | 'not_found'
  | 'unavailable'

export type ContentReadResult = { availability: Availability; text: string | null }

export type ToolErrorResult = {
  type: 'error'
  code: 'invalid_input' | 'authentication_failed' | 'permission_denied' | 'not_found' | 'rate_limited' | 'network_error' | 'server_error'
  message: string
  retryable: boolean
}
```

- [ ] **Step 4: Throw typed API errors**

`request()` reads the status, a stable JSON `code` when present, and `Retry-After`; it throws `AuroraApiError`. It may retain the upstream message internally, but `toSafeToolError()` maps only the status/code to fixed public text. Network exceptions become `network_error`, and 5xx becomes `server_error`.

- [ ] **Step 5: Return truthful content availability**

`getContent()` returns: no content record or an empty document -> `empty`; encrypted `v1:`/`v2:` payload -> `encrypted_locked`; 403 -> `permission_denied`; missing object -> `not_found`; successful readable text -> `available`. Network/5xx must throw for the dispatcher to return an error, not `unavailable` success.

- [ ] **Step 6: Centralize dispatcher error mapping**

Wrap the dispatcher once at its exported boundary. Input-validation failures remain `invalid_input`; client/API failures go through `toSafeToolError()`. Remove local `catch { return null }` blocks from reads.

- [ ] **Step 7: Run focused tests and verify green**

Run: `pnpm exec tsx --test src/errors.test.ts src/auroraClientPlanning.test.ts src/toolCatalog.test.ts`

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/errors.ts src/errors.test.ts src/contracts.ts src/auroraClient.ts src/auroraClientPlanning.test.ts src/tools.ts src/toolCatalog.test.ts
git commit -m "fix: preserve MCP errors and availability"
```

### Task 3: Add schemas, structured results, annotations, and safe diagnostics

**Files:**
- Create: `src/server.ts`
- Modify: `src/toolCatalog.ts`
- Modify: `src/toolCatalog.test.ts`
- Modify: `src/tools.ts`
- Modify: `src/index.ts`
- Modify: `test/stdio.integration.test.ts`

**Interfaces:**
- Produces: `createAuroraMcpServer(context)` and complete MCP `Tool` definitions with `outputSchema` and `annotations`.

- [ ] **Step 1: Write failing catalog and stdio tests**

```ts
test('every tool declares output schema and accurate effect annotations', () => {
  for (const tool of getToolDefinitions()) {
    assert.equal(tool.outputSchema.type, 'object')
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean')
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean')
    assert.equal(typeof tool.annotations.idempotentHint, 'boolean')
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean')
  }
})

test('stdio tool result includes structuredContent matching its output schema', async () => {
  const result = await client.callTool({ name: 'get_mcp_tool_coverage', arguments: {} })
  assert.equal(typeof result.structuredContent, 'object')
  assert.equal(result.isError, false)
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm exec tsx --test src/toolCatalog.test.ts test/stdio.integration.test.ts`

Expected: FAIL because tool definitions and results are text-only.

- [ ] **Step 3: Extend `McpToolDefinition`**

```ts
export type McpToolDefinition = {
  name: string
  title: string
  description: string
  inputSchema: JsonObjectSchema
  outputSchema: JsonObjectSchema
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}
```

Read tools use `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`; external AuroraCloud calls use `openWorldHint: true`. Create/update tools are non-read-only; delete is destructive; retry-unsafe create/append tools are non-idempotent.

- [ ] **Step 4: Return both human text and structured content**

For successful calls return `{ content: [{ type: 'text', text: formatToolResult(result) }], structuredContent: result, isError: false }`. For errors, return the structured safe error and `isError: true`. Ensure every discriminated result variant is accepted by its tool output schema.

- [ ] **Step 5: Extract server construction**

Move server handler registration into `createAuroraMcpServer(context)`. `index.ts` only loads configuration, authenticates, connects stdio, and emits fixed lifecycle diagnostics.

- [ ] **Step 6: Redact diagnostics**

Replace messages containing authenticated user/workspace IDs with fixed strings: `AuroraDocs MCP authenticated.` and `AuroraDocs MCP server running.` Tests must assert stderr does not contain fixture user IDs, workspace IDs, raw tokens, or record titles.

- [ ] **Step 7: Run focused tests and verify green**

Run: `pnpm exec tsx --test src/toolCatalog.test.ts test/stdio.integration.test.ts`

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/server.ts src/toolCatalog.ts src/toolCatalog.test.ts src/tools.ts src/index.ts test/stdio.integration.test.ts
git commit -m "feat: add structured MCP tool contracts"
```

### Task 4: Discover independently granted workspaces

**Files:**
- Modify: `src/contracts.ts`
- Modify: `src/auroraClient.ts`
- Modify: `src/auroraClientPlanning.test.ts`
- Modify: `src/toolCatalog.ts`
- Modify: `src/toolCatalog.test.ts`
- Modify: `src/tools.ts`
- Modify: `src/index.ts`
- Modify: `test/stdio.integration.test.ts`

**Interfaces:**
- Consumes AuroraCloud `GET /api/mcp/workspaces` from the companion AuroraDocs plan.
- Produces: `AuroraConnectionContext`, `listGrantedWorkspaces()`, `resolveWorkspace()`, and tool `list_workspaces`.

- [ ] **Step 1: Write failing connection-mode tests**

```ts
test('client credential starts without AURORA_WORKSPACE_ID and discovers only granted workspaces', async () => {
  const context = await authenticate({ token: 'aur_mcp_client_fixture', workspaceId: undefined })
  assert.equal(context.kind, 'client')
  assert.deepEqual(context.workspaces.map((item) => item.alias), ['henrik-pkm-a1b2', 'aurora-work-c3d4'])
})

test('ambiguous or missing workspace selector fails before a data request', async () => {
  const result = await executeToolCall('list_objects', { limit: 10 }, multiWorkspaceContext)
  assert.deepEqual(result, { type: 'error', code: 'invalid_input', message: 'workspace_id or workspace_alias is required', retryable: false })
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm exec tsx --test src/auroraClientPlanning.test.ts src/toolCatalog.test.ts test/stdio.integration.test.ts`

Expected: FAIL because startup requires `AURORA_WORKSPACE_ID` and no discovery tool exists.

- [ ] **Step 3: Add connection context types**

```ts
export type GrantedWorkspace = {
  workspaceId: string
  alias: string
  name: string
  role: string
  scopes: string[]
  grantId: string
  expiresAt: string | null
}

export type AuroraConnectionContext =
  | { kind: 'legacy_workspace'; defaultWorkspaceId: string; workspaces: GrantedWorkspace[] }
  | { kind: 'client'; workspaces: GrantedWorkspace[] }
```

- [ ] **Step 4: Detect credential mode at startup**

`aur_mcp_client_` tokens call `/api/mcp/workspaces` and do not require `AURORA_WORKSPACE_ID`. Legacy `aur_mcp_` tokens retain the current membership verification and require `AURORA_WORKSPACE_ID`. Email/password remains local-development-only and uses legacy workspace mode.

- [ ] **Step 5: Implement `list_workspaces` and explicit resolution**

The tool has no input and returns only `workspaceId`, alias, name, role, scopes, and expiry supplied by AuroraCloud. All data tools accept optional `workspace_id` and `workspace_alias`: client mode requires one; legacy mode may use the configured default but rejects a different selector.

- [ ] **Step 6: Run focused tests and verify green**

Run: `pnpm exec tsx --test src/auroraClientPlanning.test.ts src/toolCatalog.test.ts test/stdio.integration.test.ts`

Expected: all tests PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/contracts.ts src/auroraClient.ts src/auroraClientPlanning.test.ts src/toolCatalog.ts src/toolCatalog.test.ts src/tools.ts src/index.ts test/stdio.integration.test.ts
git commit -m "feat: discover granted Aurora workspaces"
```

### Task 5: Add `get_project_context` and `list_project_changes`

**Files:**
- Create: `src/projectContext.ts`
- Create: `src/projectContext.test.ts`
- Modify: `src/contracts.ts`
- Modify: `src/toolCatalog.ts`
- Modify: `src/toolCatalog.test.ts`
- Modify: `src/tools.ts`

**Interfaces:**
- Consumes AuroraCloud project-context routes from Task 6 of the companion plan.
- Produces tools `get_project_context` and `list_project_changes`.

- [ ] **Step 1: Write failing workflow tests**

```ts
test('get_project_context returns a citation-ready resume packet', async () => {
  const result = await executeToolCall('get_project_context', {
    workspace_id: 'workspace-1', project_id: 'project-1', activity_days: 14, task_limit: 20, source_limit: 10,
  }, context)
  assert.equal(result.type, 'project_context')
  assert.equal(result.status, 'ok')
  assert.equal(result.project.tasks.groups.blocked[0].title, 'Waiting for legal review')
  assert.equal(result.project.sources[0].sourceId, 'object:decision-1')
  assert.equal(result.asOf, '2026-07-14T12:00:00.000Z')
})

test('ambiguous name query returns candidates and never picks one', async () => {
  const result = await executeToolCall('get_project_context', { workspace_id: 'workspace-1', query: 'launch' }, context)
  assert.equal(result.status, 'ambiguous')
  assert.equal(result.candidates.length, 2)
})
```

- [ ] **Step 2: Run workflow tests and verify red**

Run: `pnpm exec tsx --test src/projectContext.test.ts src/toolCatalog.test.ts`

Expected: FAIL because workflow tools do not exist.

- [ ] **Step 3: Add exact input schemas**

`get_project_context` requires a workspace selector and exactly one of `project_id` or `query`; accepts `activity_days` 1-90, `task_limit` 1-50, and `source_limit` 1-25. Its returned cursor seeds later refreshes. `list_project_changes` requires workspace selector, `project_id`, `cursor`, and optional `limit` 1-100.

- [ ] **Step 4: Implement API calls and strict normalization**

Build query strings only from validated inputs. Validate response status unions, workspace identity, project identity, availability values, citation source IDs/deep links, timestamps, and cursor strings. If AuroraCloud returns malformed data, throw a safe `server_error`; do not pass unknown payloads to the agent.

- [ ] **Step 5: Register dispatch and output schemas**

Return `{ type: 'project_context', ...apiResult }` and `{ type: 'project_changes', ...apiResult }` with read-only, idempotent, open-world annotations. Text formatting starts with workspace, project, `as_of`, blockers, next actions, and source citations; structured content retains the complete normalized response.

- [ ] **Step 6: Run workflow tests and verify green**

Run: `pnpm exec tsx --test src/projectContext.test.ts src/toolCatalog.test.ts`

Expected: all tests PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/projectContext.ts src/projectContext.test.ts src/contracts.ts src/toolCatalog.ts src/toolCatalog.test.ts src/tools.ts
git commit -m "feat: add project resume workflow tools"
```

### Task 6: Add the resume prompt and project-context resource template

**Files:**
- Create: `src/mcpSurfaces.ts`
- Create: `src/mcpSurfaces.test.ts`
- Modify: `src/server.ts`
- Modify: `test/stdio.integration.test.ts`

**Interfaces:**
- Produces prompt `resume_project` and resource template `aurora://workspaces/{workspaceId}/projects/{projectId}/context`.

- [ ] **Step 1: Write failing prompt/resource tests**

```ts
test('resume_project prompt grounds the agent in workspace and citations', () => {
  const prompt = getResumeProjectPrompt({ workspace_id: 'workspace-1', project_id: 'project-1' })
  assert.match(prompt.messages[0].content.text, /get_project_context/)
  assert.match(prompt.messages[0].content.text, /cite sourceId and deepLink/)
  assert.doesNotMatch(prompt.messages[0].content.text, /create_task|update_task|delete_object/i)
})

test('project context resource delegates to the same normalized service contract', async () => {
  const resource = await readAuroraResource('aurora://workspaces/workspace-1/projects/project-1/context', context)
  assert.equal(resource.contents[0].mimeType, 'application/json')
  assert.equal(JSON.parse(resource.contents[0].text).project.identity.id, 'project-1')
})
```

- [ ] **Step 2: Run surface tests and verify red**

Run: `pnpm exec tsx --test src/mcpSurfaces.test.ts test/stdio.integration.test.ts`

Expected: FAIL because prompts and resources are not registered.

- [ ] **Step 3: Register prompt handlers**

Use `ListPromptsRequestSchema` and `GetPromptRequestSchema`. The prompt requires `workspace_id` and either `project_id` or `query`; it instructs the agent to fetch context, distinguish unavailable sections, cite source IDs/deep links, summarize blockers/next actions, and avoid writes.

- [ ] **Step 4: Register resource-template handlers**

Use `ListResourceTemplatesRequestSchema` and `ReadResourceRequestSchema`. Parse the URI with an anchored expression that accepts only non-empty URL-encoded workspace/project IDs, resolve the workspace grant, call the same project-context function as the tool, and return normalized JSON.

- [ ] **Step 5: Run prompt/resource and stdio tests and verify green**

Run: `pnpm exec tsx --test src/mcpSurfaces.test.ts test/stdio.integration.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/mcpSurfaces.ts src/mcpSurfaces.test.ts src/server.ts test/stdio.integration.test.ts
git commit -m "feat: add project resume prompt and resource"
```

### Task 7: Add Hermes/OpenClaw profiles and evaluation coverage

**Files:**
- Create: `docs/agent-profiles.md`
- Modify: `README.md`
- Modify: `docs/setup.md`
- Modify: `scripts/auroracloudLiveSmoke.ts`
- Modify: `scripts/auroracloudLiveSmoke.test.mjs`
- Modify: `scripts/docsContract.test.mjs`

**Interfaces:**
- Documents one vendor-neutral server contract and lean per-client tool-filter guidance.

- [ ] **Step 1: Add failing docs and smoke contracts**

Require docs to contain `list_workspaces`, `get_project_context`, `list_project_changes`, `resume_project`, the resource URI, `aur_mcp_client_`, owner-approved grants, independent revocation, Hermes, OpenClaw, and an explicit warning against enabling write tools in the resume profile.

Extend the live-smoke dispatcher contract to call only `list_workspaces` and one bounded `get_project_context` request; assert no write-effect tool can be selected dynamically.

- [ ] **Step 2: Run contracts and verify red**

Run: `pnpm test:docs && pnpm test:live-smoke-contract`

Expected: FAIL because the new profile and workflow documentation is absent.

- [ ] **Step 3: Write the client profiles**

For both Hermes and OpenClaw, recommend only `list_workspaces`, `get_project_context`, `list_project_changes`, `wiki_search`, `wiki_get_page`, and `wiki_related` for read-only planning/knowledge. State: parallel reads are safe because workspace is explicit; serialize future writes; use the resume prompt at session start; use change cursors for scheduled refresh; never expose the raw credential to prompts, logs, or committed config.

- [ ] **Step 4: Update setup flows**

Document the owner flow: enable MCP policy, register the client, copy its credential once, grant each workspace independently, choose `read:objects` plus optional read scopes, configure stdio, call `list_workspaces`, test one project context, rotate/revoke a workspace grant, and revoke the client when the installation is lost.

Keep a separate legacy section for `AURORA_WORKSPACE_ID` plus `aur_mcp_...` during the migration window.

- [ ] **Step 5: Update the bounded live smoke**

The smoke accepts either client mode or legacy mode. Client mode discovers a workspace then calls `get_project_context` only when an explicit smoke project ID is supplied; otherwise it proves discovery and exits without guessing a project.

- [ ] **Step 6: Run docs and smoke contracts and verify green**

Run: `pnpm test:docs && pnpm test:live-smoke-contract`

Expected: all tests PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add docs/agent-profiles.md README.md docs/setup.md scripts/auroracloudLiveSmoke.ts scripts/auroracloudLiveSmoke.test.mjs scripts/docsContract.test.mjs
git commit -m "docs: add Hermes and OpenClaw resume profiles"
```

### Task 8: Update roadmap status, changelog, and full package verification

**Files:**
- Modify: `docs/agent-planning-knowledge-roadmap.md`
- Modify: `CHANGELOG.md`
- Modify: `scripts/packageContentsCore.test.mjs`

**Interfaces:**
- Records Phase 0 reliability and Phase 1 Resume work as implemented without changing package version.

- [ ] **Step 1: Update durable status docs**

Mark only delivered items complete. Link the AuroraCloud policy/grant implementation PR and state any still-pending deployment/migration activation. Add an `[Unreleased]` changelog entry for validation, truthful availability, structured MCP contracts, multi-workspace discovery, resume tools, prompt/resource, and agent profiles.

- [ ] **Step 2: Ensure packaged docs include the new agent guide**

Update the package-contents contract so `docs/setup.md` and `docs/agent-profiles.md` are either intentionally packaged and listed in `package.json#files`, or the README contains all required public onboarding. Choose the packaged-doc approach and add `docs/**/*.md` to `files`.

- [ ] **Step 3: Run complete verification**

Run:

```bash
pnpm check
pnpm audit --prod
npm pack --dry-run --ignore-scripts --json
```

Expected: full tests/build/typecheck/stdio/package checks PASS; production audit reports zero vulnerabilities; pack output contains only intended runtime files and public docs under package version `0.1.1`.

- [ ] **Step 4: Commit Task 8**

```bash
git add docs/agent-planning-knowledge-roadmap.md CHANGELOG.md package.json scripts/packageContentsCore.test.mjs
git commit -m "docs: record MCP resume workflow delivery"
```

### Task 9: Publish the implementation PR without merging

**Files:**
- No source changes expected.

- [ ] **Step 1: Verify final repository state**

Run:

```bash
git status --short
git branch --show-current
git log --oneline origin/main..HEAD
```

Expected: clean status, a `feature/` branch, and only scoped commits.

- [ ] **Step 2: Push and create a ready-for-review PR to `main`**

The PR body must link the tracking issue and AuroraCloud companion PR, summarize the runtime/workflow contract, list exact verification results, state that version remains `0.1.1`, state that npm was not published, and identify deployment-dependent live checks. Do not merge the PR.
