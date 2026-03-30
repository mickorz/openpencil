/**
 * POST /api/generate 集成测试
 *
 * 测试覆盖：
 * 1. 成功返回 generated text
 * 2. 缺少 provider 返回 400
 * 3. provider 失败返回 error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { generateRoute } from '../../src/routes/generate.js'

// ---- Mock providers/index ----

const mockGetProvider = vi.fn()

vi.mock('../../src/providers/index.js', () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
}))

describe('POST /api/generate', () => {
  let app: ReturnType<typeof Fastify>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify()
    await app.register(generateRoute)
  })

  it('成功返回 generated text', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: 'Generated response text',
    })
    mockGetProvider.mockReturnValue({ generate: mockGenerate })

    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        provider: 'claude',
        model: 'claude-sonnet-4',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.text).toBe('Generated response text')
    expect(mockGenerate).toHaveBeenCalledOnce()
  })

  it('缺少 provider 返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        model: 'claude-sonnet-4',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toContain('provider')
  })

  it('provider 失败返回 error', async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error('Provider internal error'))
    mockGetProvider.mockReturnValue({ generate: mockGenerate })

    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        provider: 'claude',
        model: 'claude-sonnet-4',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error).toContain('Provider internal error')
  })
})
