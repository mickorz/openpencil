import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatSSE, createKeepAlive, ALLOWED_MEDIA_TYPES, resolveMediaExtension } from '../../src/utils/sse'

describe('formatSSE', () => {
  it('serializes text event', () => {
    const result = formatSSE({ type: 'text', content: 'hello' })
    expect(result).toBe('data: {"type":"text","content":"hello"}\n\n')
  })

  it('serializes ping event', () => {
    const result = formatSSE({ type: 'ping', content: '' })
    expect(result).toBe('data: {"type":"ping","content":""}\n\n')
  })

  it('serializes done event', () => {
    const result = formatSSE({ type: 'done', content: '' })
    expect(result).toBe('data: {"type":"done","content":""}\n\n')
  })

  it('escapes JSON special characters in content', () => {
    const result = formatSSE({ type: 'text', content: 'line1\nline2' })
    expect(result).toContain('"line1\\nline2"')
  })
})

describe('createKeepAlive', () => {
  afterEach(() => { vi.useRealTimers() })

  it('calls tick at intervals', () => {
    vi.useFakeTimers()
    const tick = vi.fn()
    const ka = createKeepAlive(tick, 1000)

    vi.advanceTimersByTime(3500)
    expect(tick).toHaveBeenCalledTimes(3)

    ka.stop()
  })

  it('stops after calling stop()', () => {
    vi.useFakeTimers()
    const tick = vi.fn()
    const ka = createKeepAlive(tick, 1000)

    vi.advanceTimersByTime(1000)
    ka.stop()
    vi.advanceTimersByTime(5000)
    expect(tick).toHaveBeenCalledTimes(1)
  })
})

describe('resolveMediaExtension', () => {
  it('returns extension for allowed types', () => {
    expect(resolveMediaExtension('image/png')).toBe('png')
    expect(resolveMediaExtension('image/jpeg')).toBe('jpeg')
    expect(resolveMediaExtension('image/webp')).toBe('webp')
  })

  it('returns png for disallowed types', () => {
    expect(resolveMediaExtension('image/svg+xml')).toBe('png')
    expect(resolveMediaExtension('application/pdf')).toBe('png')
  })
})

describe('ALLOWED_MEDIA_TYPES', () => {
  it('contains expected types', () => {
    expect(ALLOWED_MEDIA_TYPES.has('image/png')).toBe(true)
    expect(ALLOWED_MEDIA_TYPES.has('image/jpeg')).toBe(true)
    expect(ALLOWED_MEDIA_TYPES.has('image/gif')).toBe(true)
    expect(ALLOWED_MEDIA_TYPES.has('image/webp')).toBe(true)
  })
})
