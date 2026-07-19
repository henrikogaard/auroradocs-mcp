import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getAuroraImportCapabilities, resetAuroraClientForTests, uploadAuroraMcpAttachment } from './auroraClient.js'

test('import preflight and attachment upload use the narrow MCP routes and stable idempotency key', async () => {
  const previous = process.env['AURORA_API_URL']
  const requests: Array<{ method: string; url: string; idempotency: string | undefined; contentType: string | undefined; bytes: number }> = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({
      method: request.method ?? 'GET', url: request.url ?? '',
      idempotency: request.headers['idempotency-key'] as string | undefined,
      contentType: request.headers['content-type'], bytes: Buffer.concat(chunks).length,
    })
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET') {
      response.end(JSON.stringify({
        workspaceId: 'workspace-1', role: 'editor', scopes: ['read:objects', 'write:objects', 'write:content'],
        e2ee: { enabled: false, importBlocked: false, reason: null },
        upload: { maxBytes: 67108864, mimePolicy: null, limitBytes: 1000, usedBytes: 0, remainingBytes: 1000 },
        storage: { available: true, backend: 'server-local' },
      }))
      return
    }
    response.end(JSON.stringify({
      id: 'attachment-1', workspaceId: 'workspace-1', objectId: 'object-1', fileName: 'manual.pdf',
      mimeType: 'application/pdf', sizeBytes: 3, url: '/api/files/attachments/attachment-1/manual.pdf',
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    process.env['AURORA_API_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    resetAuroraClientForTests()
    const capability = await getAuroraImportCapabilities('workspace-1')
    assert.equal(capability.upload.maxBytes, 67108864)
    const attachment = await uploadAuroraMcpAttachment({
      workspaceId: 'workspace-1', objectId: 'object-1', fileName: '../manual.pdf', mimeType: 'application/pdf',
      bytes: Buffer.from('pdf'), idempotencyKey: 'obsidian:stable-hash',
    })
    assert.equal(attachment.fileName, 'manual.pdf')
    assert.deepEqual(requests.map((request) => [request.method, request.url]), [
      ['GET', '/api/mcp/workspaces/workspace-1/import-capabilities'],
      ['POST', '/api/mcp/workspaces/workspace-1/objects/object-1/attachments'],
    ])
    assert.equal(requests[1]?.idempotency, 'obsidian:stable-hash')
    assert.match(requests[1]?.contentType ?? '', /^multipart\/form-data; boundary=/)
    assert.ok((requests[1]?.bytes ?? 0) > 3)
  } finally {
    if (previous === undefined) delete process.env['AURORA_API_URL']; else process.env['AURORA_API_URL'] = previous
    resetAuroraClientForTests()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
