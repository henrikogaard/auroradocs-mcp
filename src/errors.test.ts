import test from 'node:test'
import assert from 'node:assert/strict'
import { AuroraApiError, startupAuthFailureMessage, toSafeToolError } from './errors.js'

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

test('403 email_verification_required tells the user to confirm their email', () => {
  const result = toSafeToolError(new AuroraApiError(403, 'email_verification_required', 'private person@example.com'))

  assert.equal(result.code, 'authentication_failed')
  assert.equal(result.retryable, false)
  assert.match(result.message, /confirm your email/i)
  assert.doesNotMatch(result.message, /person@example\.com/)
})

test('403 write_refused says the role does not allow writing', () => {
  const result = toSafeToolError(new AuroraApiError(403, 'write_refused', 'Viewer role cannot modify objects.'))

  assert.equal(result.code, 'permission_denied')
  assert.equal(result.retryable, false)
  assert.match(result.message, /role in this workspace does not allow/i)
})

test('a plain 403 keeps the generic permission message', () => {
  assert.deepEqual(toSafeToolError(new AuroraApiError(403, null, 'private')), {
    type: 'error',
    code: 'permission_denied',
    message: 'AuroraCloud denied access to this resource.',
    retryable: false,
  })
})

test('410 Gone is a non-retryable retired-resource error', () => {
  const result = toSafeToolError(new AuroraApiError(410, null, 'Task lists are now stored as workspace objects.'))

  assert.equal(result.code, 'not_found')
  assert.equal(result.retryable, false)
  assert.match(result.message, /no longer available/i)
  assert.doesNotMatch(result.message, /Task lists are now stored/)
})

test('startup explains an unconfirmed email and stays generic otherwise', () => {
  assert.match(
    startupAuthFailureMessage(new AuroraApiError(403, 'email_verification_required', 'private person@example.com')),
    /^Aurora MCP authentication failed\. Confirm your email address/,
  )
  assert.equal(startupAuthFailureMessage(new AuroraApiError(401, null, 'private')), 'Aurora MCP authentication failed.')
  assert.equal(startupAuthFailureMessage(new Error('private detail')), 'Aurora MCP authentication failed.')
})
