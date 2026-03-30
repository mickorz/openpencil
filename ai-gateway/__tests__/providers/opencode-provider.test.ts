/**
 * OpenCodeProvider 测试
 *
 * 测试覆盖：
 * 1. connect 返回模型列表 (models[0].value === 'openai/gpt-4o')
 * 2. generate 返回 text
 * 3. generate session 失败返回 error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mock 依赖模块 ----

// opencode-client mock
const mockGetOpencodeClient = vi.fn()
const mockReleaseOpencodeServer = vi.fn()

vi.mock('../../src/utils/opencode-client', () => ({
  getOpencodeClient: (...args: unknown[]) => mockGetOpencodeClient(...args),
  releaseOpencodeServer: (...args: unknown[]) => mockReleaseOpencodeServer(...args),
}))

// child_process mock - 默认找到 opencode
vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('/usr/local/bin/opencode\n'),
}))

describe('OpenCodeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---- connect 测试 ----

  it('connect 返回模型列表', async () => {
    // 模拟 providers 返回两个 provider，每个各有模型
    mockGetOpencodeClient.mockResolvedValue({
      client: {
        config: {
          providers: vi.fn().mockResolvedValue({
            data: {
              providers: [
                {
                  id: 'openai',
                  name: 'OpenAI',
                  models: {
                    'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', providerID: 'openai' },
                    'gpt-4o-mini': { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerID: 'openai' },
                  },
                },
                {
                  id: 'anthropic',
                  name: 'Anthropic',
                  models: {
                    'claude-sonnet-4-20250514': { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', providerID: 'anthropic' },
                  },
                },
              ],
              default: { openai: 'gpt-4o', anthropic: 'claude-sonnet-4-20250514' },
            },
            error: undefined,
          }),
        },
      },
      server: undefined,
    })

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(true)
    expect(result.models).toHaveLength(3)
    // 验证第一项是 openai/gpt-4o
    expect(result.models[0].value).toBe('openai/gpt-4o')
    expect(result.models[0].displayName).toBe('GPT-4o')
    expect(result.models[0].provider).toBe('opencode')
    // 验证第二项
    expect(result.models[1].value).toBe('openai/gpt-4o-mini')
    // 验证第三项
    expect(result.models[2].value).toBe('anthropic/claude-sonnet-4-20250514')

    // 应该释放服务
    expect(mockReleaseOpencodeServer).toHaveBeenCalledWith(undefined)
  })

  it('connect CLI 未找到返回 notInstalled', async () => {
    const { execSync } = await import('node:child_process')
    ;(execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('not found')
    })

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.notInstalled).toBe(true)
    expect(result.models).toHaveLength(0)
    expect(result.error).toContain('not found')
  })

  it('connect 无模型时返回友好错误', async () => {
    mockGetOpencodeClient.mockResolvedValue({
      client: {
        config: {
          providers: vi.fn().mockResolvedValue({
            data: {
              providers: [],
              default: {},
            },
            error: undefined,
          }),
        },
      },
      server: undefined,
    })

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.error).toContain('No models found')
  })

  it('connect SDK 错误时返回友好错误', async () => {
    mockGetOpencodeClient.mockRejectedValue(new Error('ECONNREFUSED connection refused'))

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.error).toContain('not reachable')
  })

  // ---- generate 测试 ----

  it('generate 返回 text', async () => {
    const mockPrompt = vi.fn().mockResolvedValue({
      data: {
        info: {},
        parts: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
        ],
      },
      error: undefined,
    })

    mockGetOpencodeClient.mockResolvedValue({
      client: {
        config: { providers: vi.fn() },
        session: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'session-123', title: 'Test' },
            error: undefined,
          }),
          prompt: mockPrompt,
        },
      },
      server: { close: vi.fn() },
    })

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'opencode',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'openai/gpt-4o',
    })

    expect(result.text).toBe('Hello world')
    expect(result.error).toBeUndefined()

    // 应该释放服务
    expect(mockReleaseOpencodeServer).toHaveBeenCalledWith({ close: expect.any(Function) })

    // 应该先注入系统提示 (noReply: true)
    expect(mockPrompt).toHaveBeenCalledTimes(2)
    // 第一次调用: 系统提示注入
    expect(mockPrompt.mock.calls[0][0].body.noReply).toBe(true)
    // 第二次调用: 用户消息
    expect(mockPrompt.mock.calls[1][0].body.parts).toEqual(
      expect.arrayContaining([{ type: 'text', text: 'Hello' }]),
    )
  })

  it('generate session 失败返回 error', async () => {
    mockGetOpencodeClient.mockResolvedValue({
      client: {
        config: { providers: vi.fn() },
        session: {
          create: vi.fn().mockResolvedValue({
            data: undefined,
            error: 'Session creation failed',
          }),
          prompt: vi.fn(),
        },
      },
      server: { close: vi.fn() },
    })

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'opencode',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.error).toBeDefined()
    expect(result.text).toBeUndefined()
  })

  it('generate prompt 返回 error 时传递错误', async () => {
    const mockPrompt = vi.fn()
      // 第一次调用: 系统提示注入成功
      .mockResolvedValueOnce({ data: { info: {}, parts: [] }, error: undefined })
      // 第二次调用: 用户消息失败
      .mockResolvedValueOnce({ data: undefined, error: 'Model not available' })

    mockGetOpencodeClient.mockResolvedValue({
      client: {
        config: { providers: vi.fn() },
        session: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'session-456', title: 'Test' },
            error: undefined,
          }),
          prompt: mockPrompt,
        },
      },
      server: undefined,
    })

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'opencode',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.error).toBeDefined()
    expect(result.text).toBeUndefined()
  })

  // ---- chat 测试 ----

  it('chat 流式输出文本事件', async () => {
    const mockPrompt = vi.fn().mockResolvedValue({
      data: {
        info: {},
        parts: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ' from OpenCode' },
        ],
      },
      error: undefined,
    })

    mockGetOpencodeClient.mockResolvedValue({
      client: {
        config: { providers: vi.fn() },
        session: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'session-chat-1', title: 'Chat' },
            error: undefined,
          }),
          prompt: mockPrompt,
        },
      },
      server: { close: vi.fn() },
    })

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'opencode',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Say hello' }],
    })) {
      events.push(event)
    }

    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0].content).toBe('Hello')
    expect(textEvents[1].content).toBe(' from OpenCode')
    // 最后一个是 done
    expect(events[events.length - 1].type).toBe('done')
  })

  it('chat 异常时 yield error 事件', async () => {
    mockGetOpencodeClient.mockRejectedValue(new Error('Unexpected failure'))

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'opencode',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      events.push(event)
    }

    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].content).toBe('Unexpected failure')
  })
})
