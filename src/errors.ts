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

const PUBLIC_ERROR_MESSAGES: Record<Exclude<ToolErrorCode, 'rate_limited'>, string> = {
  invalid_input: 'AuroraCloud rejected the request.',
  authentication_failed: 'AuroraCloud authentication failed.',
  permission_denied: 'AuroraCloud denied access to this resource.',
  not_found: 'The requested AuroraCloud resource was not found.',
  network_error: 'AuroraCloud is unavailable due to a network error.',
  server_error: 'AuroraCloud is temporarily unavailable.',
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

  return {
    type: 'error',
    code: 'server_error',
    message: PUBLIC_ERROR_MESSAGES.server_error,
    retryable: false,
  }
}
