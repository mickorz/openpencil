/**
 * POST /api/chat 集成测试
 *
 * 测试覆盖：
 * 1. SSE 流式输出包含 text 和 done 事件
 * 2. 缺少 provider 返回 400
 * 3. 缺少 model 返回 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { chatRoute } from '../../src/routes/chat.js'
import type { SSEEvent } from '../../src/providers/base-provider.js'

// ---- Mock providers/index ----

const mockGetProvider = vi.fn()

vi.mock('../../src/providers/index.js', () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
}))

/** 创建异步生成器，模拟 provider.chat() 返回值 */
async function* makeChatGenerator(events: SSEEvent[]): AsyncGenerator<SSEEvent> {
  for (const event of events) {
    yield event
  }
}

describe('POST /api/chat', () => {
  let app: ReturnType<typeof Fastify>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify()
    await app.register(chatRoute)
  })

  it('SSE 流式输出包含 text 和 done 事件', async () => {
    const mockChat = vi.fn().mockReturnValue(
      makeChatGenerator([
        { type: 'text', content: 'Hello' },
        { type: 'text', content: ' world' },
      ]),
    )
    mockGetProvider.mockReturnValue({ chat: mockChat })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        provider: 'claude',
        model: 'claude-sonnet-4',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    })

    expect(res.statusCode).toBe(200)

    const body = res.body
    // 解析 SSE 事件
    const events = body
      .split('\n\n')
      .filter((chunk: string) => chunk.startsWith('data: '))
      .map((chunk: string) => JSON.parse(chunk.slice(6)))

    // 检查 text 事件
    const textEvents = events.filter((e: SSEEvent) => e.type === 'text')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0].content).toBe('Hello')
    expect(textEvents[1].content).toBe(' world')

    // 检查 done 事件
    const doneEvents = events.filter((e: SSEEvent) => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
  })

  it('缺少 provider 返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        model: 'claude-sonnet-4',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toContain('provider')
  })

  it('缺少 model 返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        provider: 'claude',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toContain('model')
  })
})
