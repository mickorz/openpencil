/**
 * POST /api/connect 集成测试
 *
 * 测试覆盖：
 * 1. 成功连接返回 models
 * 2. 缺少 agent 返回 400
 * 3. 未知 agent 返回 400 + "not available"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { connectRoute } from '../../src/routes/connect.js'

// ---- Mock providers/index ----

const mockGetProvider = vi.fn()
const mockListProviders = vi.fn()

vi.mock('../../src/providers/index.js', () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  listProviders: () => mockListProviders(),
}))

/** 创建模拟的 provider 对象 */
function makeMockProvider(connectResult: Record<string, unknown>) {
  return { connect: vi.fn().mockResolvedValue(connectResult) }
}

describe('POST /api/connect', () => {
  let app: ReturnType<typeof Fastify>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify()
    await app.register(connectRoute)
    mockListProviders.mockReturnValue(['claude', 'codex'])
  })

  it('成功连接返回 models', async () => {
    const mockProvider = makeMockProvider({
      connected: true,
      models: [
        { value: 'claude-sonnet-4', displayName: 'Sonnet 4', description: 'Fast', provider: 'anthropic' },
      ],
    })
    mockGetProvider.mockReturnValue(mockProvider)

    const res = await app.inject({
      method: 'POST',
      url: '/api/connect',
      payload: { agent: 'claude' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.connected).toBe(true)
    expect(body.models).toHaveLength(1)
    expect(body.models[0].value).toBe('claude-sonnet-4')
    expect(mockGetProvider).toHaveBeenCalledWith('claude')
    expect(mockProvider.connect).toHaveBeenCalledOnce()
  })

  it('缺少 agent 返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/connect',
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toContain('agent')
  })

  it('未知 agent 返回 400 + not available', async () => {
    mockGetProvider.mockReturnValue(undefined)

    const res = await app.inject({
      method: 'POST',
      url: '/api/connect',
      payload: { agent: 'unknown-agent' },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toContain('not available')
    expect(body.error).toContain('unknown-agent')
  })
})
