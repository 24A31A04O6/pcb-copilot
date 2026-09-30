import { describe, expect, it } from 'vitest'

import { AppError, ERROR_CODES, isAppError, statusForCode, toAppError, toClientError } from '@/lib/errors'

describe('AppError', () => {
  it('gives every code a status, a friendly message and a retryable flag', () => {
    for (const code of ERROR_CODES) {
      const error = new AppError(code)
      expect(error.code).toBe(code)
      expect(error.message.length).toBeGreaterThan(10)
      expect(statusForCode(code)).toBeGreaterThanOrEqual(400)
      expect(statusForCode(code)).toBeLessThan(600)
    }
  })

  it('maps the codes a client branches on to the right HTTP status', () => {
    expect(statusForCode('INPUT_INVALID')).toBe(400)
    expect(statusForCode('RATE_LIMITED')).toBe(429)
    expect(statusForCode('LLM_RATE_LIMITED')).toBe(429)
    expect(statusForCode('LLM_TIMEOUT')).toBe(504)
    expect(statusForCode('COMPILE_FAILED')).toBe(502)
    expect(statusForCode('LLM_MISCONFIGURED')).toBe(500)
  })

  it('never puts the internal detail in the message sent to the browser', () => {
    const error = new AppError('LLM_UPSTREAM', {
      internal: 'POST https://api.fireworks.ai/v1/chat/completions failed: 502 from 10.0.0.4',
    })
    expect(error.message).not.toContain('fireworks.ai')
    expect(error.message).not.toContain('10.0.0.4')
    expect(error.internal).toContain('10.0.0.4')
    expect(toClientError(error).message).toBe(error.message)
    expect(JSON.stringify(toClientError(error))).not.toContain('10.0.0.4')
  })

  it('keeps a user-facing details list separate from the internal detail', () => {
    const error = new AppError('CHECKS_FAILED', {
      details: ['unconnected_port: R1.2 has no trace'],
      internal: 'stack trace with secrets',
    })
    expect(toClientError(error).details).toEqual(['unconnected_port: R1.2 has no trace'])
    expect(JSON.stringify(toClientError(error))).not.toContain('secrets')
  })

  it('carries a request id when one is supplied', () => {
    expect(toClientError(new AppError('INTERNAL'), 'req-123').requestId).toBe('req-123')
    expect(toClientError(new AppError('INTERNAL')).requestId).toBeUndefined()
  })

  it('marks client-correctable failures as not retryable', () => {
    expect(toClientError(new AppError('INPUT_INVALID')).retryable).toBe(false)
    expect(toClientError(new AppError('LLM_MISCONFIGURED')).retryable).toBe(false)
    expect(toClientError(new AppError('LLM_TIMEOUT')).retryable).toBe(true)
  })
})

describe('toAppError', () => {
  it('passes an AppError through untouched', () => {
    const original = new AppError('COMPILE_FAILED')
    expect(toAppError(original)).toBe(original)
  })

  it('wraps an unknown throw and keeps the original message server-side', () => {
    const wrapped = toAppError(new TypeError('cannot read x of undefined'))
    expect(wrapped.code).toBe('INTERNAL')
    expect(wrapped.internal).toContain('cannot read x of undefined')
    expect(wrapped.message).not.toContain('undefined')
  })

  it('turns an AbortError into a timeout rather than a generic 500', () => {
    const abort = new DOMException('The operation was aborted', 'AbortError')
    const wrapped = toAppError(abort)
    expect(wrapped.code).toBe('LLM_TIMEOUT')
    expect(wrapped.status).toBe(504)
  })

  it('honours a caller-supplied fallback code', () => {
    expect(toAppError(new Error('nope'), 'COMPILE_FAILED').code).toBe('COMPILE_FAILED')
  })

  it('wraps non-Error throws without losing the text', () => {
    expect(toAppError('just a string').internal).toBe('just a string')
    expect(isAppError(toAppError('just a string'))).toBe(true)
  })
})
