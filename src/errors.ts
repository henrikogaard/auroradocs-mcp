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

const PUBLIC_ERROR_MESSAGES: Record<Exclude<ToolErrorCode, 'rate_limited'>, string> = {
  invalid_input: 'AuroraCloud rejected the request.',
  authentication_failed: 'AuroraCloud authentication failed.',
  permission_denied: 'AuroraCloud denied access to this resource.',
  not_found: 'The requested AuroraCloud resource was not found.',
  network_error: 'AuroraCloud is unavailable due to a network error.',
  server_error: 'AuroraCloud is temporarily unavailable.',
}

function apiErrorCode(error: AuroraApiError): ToolErrorCode {
  if (error.status === 0 || error.code === 'network_error') return 'network_error'
  if (error.status === 400 || error.status === 422 || error.code === 'invalid_input') return 'invalid_input'
  if (error.status === 401 || error.code === 'authentication_failed') return 'authentication_failed'
  if (error.status === 403 || error.code === 'permission_denied') return 'permission_denied'
  if (error.status === 404 || error.code === 'not_found') return 'not_found'
  if (error.status === 429 || error.code === 'rate_limited') return 'rate_limited'
  return 'server_error'
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

  if (error instanceof TypeError) {
    return {
      type: 'error',
      code: 'network_error',
      message: PUBLIC_ERROR_MESSAGES.network_error,
      retryable: true,
    }
  }

  return {
    type: 'error',
    code: 'invalid_input',
    message: error instanceof Error ? error.message : 'Invalid tool input.',
    retryable: false,
  }
}
