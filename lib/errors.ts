/**
 * Typed error taxonomy for the whole pipeline.
 *
 * Every failure that can reach the browser is one of these codes. The code is stable
 * (clients may switch on it); the message is human-facing; `retryable` decides whether
 * the UI offers a Retry action. Nothing else is allowed to escape to the client as a
 * raw string — see `toClientError`.
 */

export const ERROR_CODES = [
  'INPUT_INVALID',
  'LLM_TIMEOUT',
  'LLM_RATE_LIMITED',
  'LLM_TRUNCATED',
  'LLM_INVALID_JSON',
  'LLM_SCHEMA_MISMATCH',
  'LLM_UPSTREAM',
  'PART_SEARCH_UNAVAILABLE',
  'LLM_MISCONFIGURED',
  'COMPILE_FAILED',
  'CHECKS_FAILED',
  'RATE_LIMITED',
  'INTERNAL',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const FRIENDLY: Record<ErrorCode, { message: string; retryable: boolean }> = {
  INPUT_INVALID: {
    message: 'That brief could not be used. Check the length and try again.',
    retryable: false,
  },
  LLM_TIMEOUT: {
    message: 'The model took too long to answer. Try again, or simplify the brief.',
    retryable: true,
  },
  LLM_RATE_LIMITED: {
    message: 'The model provider is rate limiting requests right now. Try again shortly.',
    retryable: true,
  },
  LLM_TRUNCATED: {
    message:
      'The model ran out of output tokens before it finished the answer. Try a smaller or simpler board.',
    retryable: true,
  },
  LLM_INVALID_JSON: {
    message: 'The model did not return a usable JSON design brief. Try again.',
    retryable: true,
  },
  LLM_SCHEMA_MISMATCH: {
    message: 'The design brief did not match the required schema after one repair attempt.',
    retryable: true,
  },
  LLM_UPSTREAM: {
    message: 'The model provider returned an error. Try again in a moment.',
    retryable: true,
  },
  PART_SEARCH_UNAVAILABLE: {
    message:
      'Part lookup is temporarily unavailable, so the design was made without one. The parts named are standard, not verified against a distributor.',
    retryable: true,
  },
  LLM_MISCONFIGURED: {
    message: 'The server is missing model configuration. An administrator needs to check the environment.',
    retryable: false,
  },
  COMPILE_FAILED: {
    message: 'The generated tscircuit source did not compile. Try again with a simpler board.',
    retryable: true,
  },
  CHECKS_FAILED: {
    message: 'The design still has blocking checks that must be fixed before manufacturing.',
    retryable: true,
  },
  RATE_LIMITED: {
    message: 'Too many designs from this address. Wait a few minutes and try again.',
    retryable: true,
  },
  INTERNAL: { message: 'Something went wrong on our side. Try again.', retryable: true },
}

export type ClientError = {
  code: ErrorCode
  message: string
  retryable: boolean
  requestId?: string
  details?: string[]
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: string[]
  readonly retryAfterSeconds?: number

  constructor(
    code: ErrorCode,
    options: {
      status?: number
      details?: string[]
      retryAfterSeconds?: number
      cause?: unknown
      /** Internal detail that is logged but never sent to the client. */
      internal?: string
    } = {},
  ) {
    super(FRIENDLY[code].message, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.status = options.status ?? defaultStatus(code)
    this.details = options.details ?? []
    this.retryAfterSeconds = options.retryAfterSeconds
    if (options.internal) this.internal = options.internal
  }

  /** Server-only detail. Never serialised into a response body. */
  internal?: string
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'INPUT_INVALID':
      return 400
    case 'RATE_LIMITED':
    case 'LLM_RATE_LIMITED':
      return 429
    case 'LLM_MISCONFIGURED':
      return 500
    case 'PART_SEARCH_UNAVAILABLE':
      return 503
    case 'LLM_TIMEOUT':
      return 504
    case 'LLM_TRUNCATED':
    case 'LLM_INVALID_JSON':
    case 'LLM_SCHEMA_MISMATCH':
    case 'LLM_UPSTREAM':
    case 'COMPILE_FAILED':
    case 'CHECKS_FAILED':
    case 'INTERNAL':
      return 502
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

/** Wrap anything thrown into a typed error without losing the original. */
export function toAppError(error: unknown, fallback: ErrorCode = 'INTERNAL'): AppError {
  if (isAppError(error)) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new AppError('LLM_TIMEOUT', { cause: error, internal: error.message })
  }
  const message = error instanceof Error ? error.message : String(error)
  return new AppError(fallback, { cause: error, internal: message })
}

export function toClientError(error: unknown, requestId?: string): ClientError {
  const appError = toAppError(error)
  return {
    code: appError.code,
    message: appError.message,
    retryable: FRIENDLY[appError.code].retryable,
    ...(requestId ? { requestId } : {}),
    ...(appError.details.length ? { details: appError.details } : {}),
  }
}

export function statusForCode(code: ErrorCode): number {
  return defaultStatus(code)
}
