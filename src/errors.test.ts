import test from 'node:test'
import assert from 'node:assert/strict'
import { AuroraApiError, toSafeToolError } from './errors.js'

test('429 preserves a retryable MCP error without leaking the response body', () => {
  const result = toSafeToolError(new AuroraApiError(429, 'rate_limited', 'private upstream body', 12))

  assert.deepEqual(result, {
    type: 'error',
    code: 'rate_limited',
    message: 'AuroraCloud rate limit exceeded. Retry after 12 seconds.',
    retryable: true,
  })
  assert.doesNotMatch(result.message, /private upstream body/)
})

test('network failures become retryable MCP errors with fixed public text', () => {
  const result = toSafeToolError(new AuroraApiError(0, 'network_error', 'fetch failed: api-token-secret'))

  assert.deepEqual(result, {
    type: 'error',
    code: 'network_error',
    message: 'AuroraCloud is unavailable due to a network error.',
    retryable: true,
  })
})

test('HTTP status families override incompatible upstream codes', () => {
  const cases = [
    {
      error: new AuroraApiError(401, 'rate_limited', 'private', 12),
      expected: { type: 'error', code: 'authentication_failed', message: 'AuroraCloud authentication failed.', retryable: false },
    },
    {
      error: new AuroraApiError(403, 'not_found', 'private'),
      expected: { type: 'error', code: 'permission_denied', message: 'AuroraCloud denied access to this resource.', retryable: false },
    },
    {
      error: new AuroraApiError(404, 'permission_denied', 'private'),
      expected: { type: 'error', code: 'not_found', message: 'The requested AuroraCloud resource was not found.', retryable: false },
    },
    {
      error: new AuroraApiError(429, 'invalid_input', 'private', 12),
      expected: { type: 'error', code: 'rate_limited', message: 'AuroraCloud rate limit exceeded. Retry after 12 seconds.', retryable: true },
    },
    {
      error: new AuroraApiError(503, 'permission_denied', 'private'),
      expected: { type: 'error', code: 'server_error', message: 'AuroraCloud is temporarily unavailable.', retryable: true },
    },
  ] as const

  for (const { error, expected } of cases) {
    assert.deepEqual(toSafeToolError(error), expected)
  }
})

test('unexpected TypeError uses a safe non-network fallback', () => {
  const result = toSafeToolError(new TypeError('private type detail'))

  assert.deepEqual(result, {
    type: 'error',
    code: 'server_error',
    message: 'AuroraCloud is temporarily unavailable.',
    retryable: false,
  })
})

test('unexpected exceptions use fixed public text', () => {
  const privateFixture = 'private-content-fragment'
  const result = toSafeToolError(new SyntaxError(`Unexpected token near ${privateFixture}`))

  assert.deepEqual(result, {
    type: 'error',
    code: 'server_error',
    message: 'AuroraCloud is temporarily unavailable.',
    retryable: false,
  })
  assert.doesNotMatch(result.message, new RegExp(privateFixture))
})

test('upstream invalid-input failures use fixed public text', () => {
  const result = toSafeToolError(new AuroraApiError(400, 'invalid_input', 'private validation detail'))

  assert.deepEqual(result, {
    type: 'error',
    code: 'invalid_input',
    message: 'AuroraCloud rejected the request.',
    retryable: false,
  })
})
