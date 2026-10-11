import type { ToolErrorCode, ToolErrorResult } from './contracts.js'

export class AuroraApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly upstreamMessage: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(upstreamMessage)
    this.name = 'AuroraApiError'
  }
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

export class ToolNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolNotFoundError'
  }
}

const PUBLIC_ERROR_MESSAGES: Record<Exclude<ToolErrorCode, 'rate_limited'>, string> = {
  invalid_input: 'AuroraCloud rejected the request.',
  authentication_failed: 'AuroraCloud authentication failed.',
  permission_denied: 'AuroraCloud denied access to this resource.',
  not_found: 'The requested AuroraCloud resource was not found.',
  network_error: 'AuroraCloud is unavailable due to a network error.',
  server_error: 'AuroraCloud is temporarily unavailable.',
}

/** AuroraCloud `code` on a 403 for an account whose owner has not confirmed their email (sessions and MCP credentials alike). */
export const EMAIL_VERIFICATION_REQUIRED_CODE = 'email_verification_required'
/** AuroraCloud `code` on a 403 that refuses a write the caller's role may read but not change (auroradocs #1519). */
export const WRITE_REFUSED_CODE = 'write_refused'

const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  'Confirm your email address to use AuroraCloud: open the link Aurora emailed you, or request a new one from the Aurora sign-in screen. Then retry.'
const WRITE_REFUSED_MESSAGE =
  'Your role in this workspace does not allow changing this. Ask a workspace owner for edit access.'
const GONE_MESSAGE =
  'This AuroraCloud resource is no longer available. It was retired; update the Aurora MCP server to the latest version.'

/** A fixed public message for AuroraCloud answers that need more than the status family says, else null. */
function specificApiError(error: AuroraApiError): ToolErrorResult | null {
  if (error.status === 403 && error.code === EMAIL_VERIFICATION_REQUIRED_CODE) {
    return { type: 'error', code: 'authentication_failed', message: EMAIL_VERIFICATION_REQUIRED_MESSAGE, retryable: false }
  }
  if (error.status === 403 && error.code === WRITE_REFUSED_CODE) {
    return { type: 'error', code: 'permission_denied', message: WRITE_REFUSED_MESSAGE, retryable: false }
  }
  if (error.status === 410) {
    return { type: 'error', code: 'not_found', message: GONE_MESSAGE, retryable: false }
  }
  return null
}

/**
 * The one line printed when authentication fails at startup. Only an
 * unconfirmed email address gets its own fixed text; anything else stays
 * generic so no upstream detail reaches the log.
 */
export function startupAuthFailureMessage(error: unknown): string {
  if (error instanceof AuroraApiError && error.status === 403 && error.code === EMAIL_VERIFICATION_REQUIRED_CODE) {
    return `Aurora MCP authentication failed. ${EMAIL_VERIFICATION_REQUIRED_MESSAGE}`
  }
  return 'Aurora MCP authentication failed.'
}

function apiErrorCode(error: AuroraApiError): ToolErrorCode {
  if (error.status === 0) return 'network_error'
  if (error.status === 400 || error.status === 422) return 'invalid_input'
  if (error.status === 401) return 'authentication_failed'
  if (error.status === 403) return 'permission_denied'
  if (error.status === 404) return 'not_found'
  if (error.status === 429) return 'rate_limited'
  if (error.status >= 500 && error.status <= 599) return 'server_error'

  switch (error.code) {
    case 'network_error':
    case 'invalid_input':
    case 'authentication_failed':
    case 'permission_denied':
    case 'not_found':
    case 'rate_limited':
    case 'server_error':
      return error.code
    default:
      return 'server_error'
  }
}

export function toSafeToolError(error: unknown): ToolErrorResult {
  if (error instanceof AuroraApiError) {
    const specific = specificApiError(error)
    if (specific) return specific
    const code = apiErrorCode(error)
    if (code === 'rate_limited') {
      return {
        type: 'error',
        code,
        message: error.retryAfterSeconds === null
          ? 'AuroraCloud rate limit exceeded. Please retry later.'
          : `AuroraCloud rate limit exceeded. Retry after ${error.retryAfterSeconds} seconds.`,
        retryable: true,
      }
    }
    return {
      type: 'error',
      code,
      message: PUBLIC_ERROR_MESSAGES[code],
      retryable: code === 'network_error' || code === 'server_error',
    }
  }

  if (error instanceof ToolInputError) {
    return {
      type: 'error',
      code: 'invalid_input',
      message: error.message,
      retryable: false,
    }
  }

  if (error instanceof ToolNotFoundError) {
    return {
      type: 'error',
      code: 'not_found',
      message: error.message,
      retryable: false,
    }
  }

  return {
    type: 'error',
    code: 'server_error',
    message: PUBLIC_ERROR_MESSAGES.server_error,
    retryable: false,
  }
}
