export type Availability =
  | 'available'
  | 'empty'
  | 'encrypted_locked'
  | 'permission_denied'
  | 'not_found'
  | 'unavailable'

export type ContentReadResult = {
  availability: Availability
  text: string | null
}

export type ToolErrorCode =
  | 'invalid_input'
  | 'authentication_failed'
  | 'permission_denied'
  | 'not_found'
  | 'rate_limited'
  | 'network_error'
  | 'server_error'

export type ToolErrorResult = {
  type: 'error'
  code: ToolErrorCode
  message: string
  retryable: boolean
}
