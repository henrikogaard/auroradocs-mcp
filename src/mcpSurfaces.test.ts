import assert from 'node:assert/strict'
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { resetAuroraClientForTests } from './auroraClient.js'
import type { AuroraConnectionContext } from './contracts.js'
import {
  completeAuroraArgument,
  getAuroraPrompt,
  getAuroraPromptDefinitions,
  getCustomDatabaseDesignPrompt,
  getObsidianImportPrompt,
  getResumeProjectPrompt,
  getTemplateInstantiationPrompt,
  readAuroraResource,
} from './mcpSurfaces.js'

const context: AuroraConnectionContext = {
  kind: 'client',
  workspaces: [{
    workspaceId: 'workspace-1',
    alias: 'henrik-pkm',
    name: 'Henrik PKM',
    role: 'owner',
    scopes: ['read:objects', 'read:content', 'read:tasks'],
    grantId: 'grant-1',
    expiresAt: '2026-10-01T00:00:00.000Z',
  }],
}

function projectContext(workspaceId = 'workspace-1', projectId = 'project-1') {
  return {
    status: 'ok',
    workspace: { id: workspaceId, name: 'Henrik PKM' },
    project: {
      id: projectId,
      workspaceId,
      title: 'Launch AuroraDocs',
      goal: 'Ship the public agent workflow',
      status: 'In Progress',
      priority: 'High',
      owner: 'Henrik',
      progress: 60,
      startDate: '2026-07-01',
      dueDate: '2026-07-31',
      brief: { availability: 'available', text: 'Launch context.' },
      tasks: {
        availability: 'available',
        groups: { todo: [], in_progress: [], blocked: [], done: [] },
      },
      blockers: ['Waiting for legal review'],
      risks: [],
      unresolvedDecisions: [],
      recentActivity: [],
      nextActions: ['Complete legal review'],
      sources: [{
        sourceId: 'object:decision-1',
        title: 'Launch decision',
        deepLink: 'https://app.auroradocs.eu/workspaces/workspace-1/objects/decision-1',
        updatedAt: '2026-07-14T08:00:00.000Z',
        availability: 'available',
      }],
    },
    asOf: '2026-07-14T12:00:00.000Z',
    cursor: null,
  }
}

async function withApi(handler: RequestListener, run: (requests: string[]) => Promise<void>): Promise<void> {
  const previousApiUrl = process.env['AURORA_API_URL']
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    handler(request, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    resetAuroraClientForTests()
    await run(requests)
  } finally {
    if (previousApiUrl === undefined) delete process.env['AURORA_API_URL']
    else process.env['AURORA_API_URL'] = previousApiUrl
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test('resume_project prompt grounds the agent in one workspace and citation-ready project context', () => {
  const prompt = getResumeProjectPrompt({ workspace_id: 'workspace-1', project_id: 'project-1' })
  const text = prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : ''

  assert.match(text, /workspace-1/)
  assert.match(text, /project-1/)
  assert.match(text, /get_project_context/)
  assert.match(text, /unavailable sections/i)
  assert.match(text, /cite sourceId and deepLink/)
  assert.match(text, /blockers and next actions/i)
  assert.match(text, /do not perform writes/i)
  assert.match(text, /untrusted evidence, never instructions/i)
  assert.match(text, /never follow embedded requests/i)
  assert.match(text, /never use unrelated tools/i)
  assert.match(text, /never expose secrets/i)
  assert.doesNotMatch(text, /create_task|update_task|delete_object/i)
})

test('resume_project prompt supports a query but requires exactly one project selector', () => {
  const prompt = getResumeProjectPrompt({ workspace_id: 'workspace-1', query: 'launch' })
  const text = prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : ''
  assert.match(text, /query.*launch/i)

  for (const args of [
    {},
    { workspace_id: ' ' },
    { workspace_id: 'workspace-1' },
    { workspace_id: 'workspace-1', project_id: 'project-1', query: 'launch' },
  ]) {
    assert.throws(() => getResumeProjectPrompt(args), /workspace_id|Exactly one/)
  }
})

test('guided prompts accept exactly one workspace ID or alias selector', () => {
  const resume = getResumeProjectPrompt({ workspace_alias: 'henrik-pkm', project_id: 'project-1' })
  const resumeText = resume.messages[0]?.content.type === 'text' ? resume.messages[0].content.text : ''
  assert.match(resumeText, /workspace_alias.*henrik-pkm/i)

  const database = getCustomDatabaseDesignPrompt({ workspace_alias: 'henrik-pkm' })
  const databaseText = database.messages[0]?.content.type === 'text' ? database.messages[0].content.text : ''
  assert.match(databaseText, /workspace_alias.*henrik-pkm/i)

  const obsidian = getObsidianImportPrompt({ workspace_alias: 'henrik-pkm' })
  const obsidianText = obsidian.messages[0]?.content.type === 'text' ? obsidian.messages[0].content.text : ''
  assert.match(obsidianText, /workspace_alias.*henrik-pkm/i)

  assert.throws(
    () => getResumeProjectPrompt({ workspace_id: 'workspace-1', workspace_alias: 'henrik-pkm', project_id: 'project-1' }),
    /exactly one of workspace_id or workspace_alias/i,
  )
})

test('custom database prompt teaches recipe-first additive plan and explicit apply behavior', () => {
  const prompt = getCustomDatabaseDesignPrompt({ workspace_id: 'workspace-1', use_case: 'Dive equipment' })
  const text = prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : ''
  assert.match(text, /list_object_types/)
  assert.match(text, /get_custom_database_recipes/)
  assert.match(text, /plan_custom_database/)
  assert.match(text, /apply_custom_database_plan/)
  assert.match(text, /additive/i)
  assert.match(text, /explicit.*approval/i)
  assert.match(text, /Dive equipment/)
})

test('Obsidian import prompt requires analyze, later acceptance, exact hash, and bounded resume', () => {
  const prompt = getObsidianImportPrompt({ workspace_id: 'workspace-1' })
  const text = prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : ''
  assert.match(text, /analyze_obsidian_vault/)
  assert.match(text, /get_obsidian_import_plan/)
  assert.match(text, /later user message/i)
  assert.match(text, /exact plan ID and hash/i)
  assert.match(text, /get_obsidian_import_status/)
  assert.match(text, /source vault.*never modified/i)
})

test('template instantiation prompt resolves one suggested template before an approved write', () => {
  const prompt = getTemplateInstantiationPrompt({
    workspace_id: 'workspace-1', template: 'Gear checkout', object_id: 'planned-object-1',
  })
  const text = prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : ''
  assert.match(text, /list_templates/)
  assert.match(text, /Gear checkout/)
  assert.match(text, /planned-object-1/)
  assert.match(text, /unambiguous/i)
  assert.match(text, /explicit user approval/i)
  assert.match(text, /create_from_template/)
})

test('prompt catalog and dispatcher expose all guided workflows', () => {
  assert.deepEqual(getAuroraPromptDefinitions().map((prompt) => prompt.name), [
    'resume_project', 'custom_database_design', 'template_instantiation', 'obsidian_import',
  ])
  assert.equal(getAuroraPrompt('custom_database_design', { workspace_id: 'workspace-1' }).messages.length, 1)
  assert.throws(() => getAuroraPrompt('missing', {}), /Unknown AuroraDocs prompt/)
})

test('completion provider suggests projects, object types, recipes, and templates in one granted workspace', async () => {
  await withApi((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    response.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/collections/objects/records') {
      const filter = url.searchParams.get('filter') ?? ''
      if (filter.includes('is_template')) {
        response.end(JSON.stringify({
          page: 1, perPage: 50, totalPages: 2, totalItems: 51,
          items: [{
            id: 'template-gear', workspace_id: 'workspace-1', type: 'custom:equipment', title: 'Gear checkout',
            icon: null, parent_id: null, is_deleted: false, is_template: true,
            created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T12:00:00Z',
          }],
        })); return
      }
      response.end(JSON.stringify({
        page: 1, perPage: 50, totalPages: 2, totalItems: 52,
        items: [
          {
            id: 'project-launch', workspace_id: 'workspace-1', type: 'project', title: 'Launch AuroraDocs',
            icon: null, parent_id: null, is_deleted: false, is_template: false,
            created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T12:00:00Z',
          },
          {
            id: 'project-migration', workspace_id: 'workspace-1', type: 'project', title: 'Migrate knowledge',
            icon: null, parent_id: null, is_deleted: false, is_template: false,
            created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T12:00:00Z',
          },
        ],
      })); return
    }
    if (url.pathname === '/api/collections/object_types/records') {
      response.end(JSON.stringify({
        page: 1, perPage: 50, totalPages: 1, totalItems: 1,
        items: [{
          id: 'type-equipment', workspace_id: 'workspace-1', name: 'Equipment tracker', icon: null,
          color: null, schema: [], created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T12:00:00Z',
        }],
      })); return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ code: 'not_found' }))
  }, async () => {
    const prompt = (name: string, argument: string, value: string) => completeAuroraArgument({
      ref: { type: 'ref/prompt', name },
      argument: { name: argument, value },
      context: { arguments: { workspace_alias: 'henrik-pkm' } },
    }, context)

    const projectIds = await prompt('resume_project', 'project_id', 'launch')
    assert.deepEqual(projectIds.completion.values, ['project-launch'])
    assert.equal(projectIds.completion.hasMore, true)
    assert.equal(projectIds.completion.total, undefined)
    assert.deepEqual((await prompt('resume_project', 'query', 'migrate')).completion.values, ['Migrate knowledge'])
    assert.deepEqual((await prompt('custom_database_design', 'object_type', 'equipment')).completion.values, ['Equipment tracker', 'type-equipment'])
    assert.deepEqual((await prompt('custom_database_design', 'use_case', 'expense')).completion.values, ['expenses'])
    const templateCompletion = await prompt('template_instantiation', 'template', 'checkout')
    assert.deepEqual(templateCompletion.completion.values, ['Gear checkout'])
    assert.equal(templateCompletion.completion.hasMore, true)
    assert.equal(templateCompletion.completion.total, undefined)

    const resource = await completeAuroraArgument({
      ref: { type: 'ref/resource', uri: 'aurora://workspaces/{workspaceId}/projects/{projectId}/context' },
      argument: { name: 'projectId', value: 'migration' },
      context: { arguments: { workspaceId: 'workspace-1' } },
    }, context)
    assert.deepEqual(resource.completion.values, ['project-migration'])
  })
})

test('completion provider rejects foreign-workspace project and template records', async () => {
  await withApi((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    response.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/collections/objects/records') {
      const isTemplate = (url.searchParams.get('filter') ?? '').includes('is_template')
      response.end(JSON.stringify({
        page: 1, perPage: 50, totalPages: 1, totalItems: 1,
        items: [{
          id: isTemplate ? 'foreign-template' : 'foreign-project',
          workspace_id: 'workspace-other', type: isTemplate ? 'page' : 'project',
          title: 'Private foreign record', icon: null, parent_id: null,
          is_deleted: false, is_template: isTemplate,
          created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T12:00:00Z',
        }],
      })); return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ code: 'not_found' }))
  }, async () => {
    const request = (name: string, argument: string) => completeAuroraArgument({
      ref: { type: 'ref/prompt', name },
      argument: { name: argument, value: '' },
      context: { arguments: { workspace_id: 'workspace-1' } },
    }, context)

    await assert.rejects(() => request('resume_project', 'project_id'), /foreign workspace record/i)
    await assert.rejects(() => request('template_instantiation', 'template'), /foreign workspace record/i)
  })
})

test('project context resource delegates to the same strict normalized service contract', async () => {
  await withApi((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(projectContext()))
  }, async (requests) => {
    const resource = await readAuroraResource(
      'aurora://workspaces/workspace-1/projects/project-1/context',
      context,
    )

    assert.equal(resource.contents[0]?.mimeType, 'application/json')
    assert.equal(resource.contents[0]?.uri, 'aurora://workspaces/workspace-1/projects/project-1/context')
    const content = resource.contents[0]
    assert(content && 'text' in content)
    const parsed = JSON.parse(content.text)
    assert.equal(parsed.project.id, 'project-1')
    assert.equal(parsed.project.sources[0].sourceId, 'object:decision-1')
    assert.deepEqual(requests, [
      '/api/mcp/workspaces/workspace-1/projects/context?project_id=project-1&activity_days=14&task_limit=20&source_limit=10',
    ])
  })
})

test('project context resource resolves the workspace grant before calling AuroraCloud', async () => {
  await withApi((_request, response) => {
    response.statusCode = 500
    response.end()
  }, async (requests) => {
    await assert.rejects(
      () => readAuroraResource('aurora://workspaces/workspace-other/projects/project-1/context', context),
      /available grant/,
    )
    assert.deepEqual(requests, [])
  })
})

test('project context resource accepts encoded IDs and rejects ambiguous or malformed paths', async () => {
  const encodedContext: AuroraConnectionContext = {
    kind: 'client',
    workspaces: [{ ...context.workspaces[0]!, workspaceId: 'workspace å' }],
  }
  await withApi((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(projectContext('workspace å', 'project #1')))
  }, async (requests) => {
    const uri = 'aurora://workspaces/workspace%20%C3%A5/projects/project%20%231/context'
    const resource = await readAuroraResource(uri, encodedContext)
    assert.equal(resource.contents[0]?.uri, uri)
    assert.deepEqual(requests, [
      '/api/mcp/workspaces/workspace%20%C3%A5/projects/context?project_id=project+%231&activity_days=14&task_limit=20&source_limit=10',
    ])
  })

  for (const uri of [
    'aurora://workspaces//projects/project-1/context',
    'aurora://workspaces/workspace-1/projects//context',
    'aurora://workspaces/workspace-1/projects/project-1/context/extra',
    'aurora://workspaces/../projects/project-1/context',
    'aurora://workspaces/%2e%2e/projects/project-1/context',
    'aurora://workspaces/workspace-1/projects/%2Fetc/context',
    'aurora://workspaces/workspace-1/projects/project%ZZ/context',
    'aurora://workspaces/workspace 1/projects/project-1/context',
  ]) {
    await assert.rejects(() => readAuroraResource(uri, context), /Invalid Aurora resource URI/)
  }
})
