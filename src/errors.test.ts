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
  const result = toSafeToolError(new TypeError('fetch failed: api-token-secret'))

  assert.deepEqual(result, {
    type: 'error',
    code: 'network_error',
    message: 'AuroraCloud is unavailable due to a network error.',
    retryable: true,
  })
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
