/**
 * CopilotProvider 测试
 *
 * 测试覆盖：
 * 1. connect CLI 未找到返回 notInstalled
 * 2. connect 成功返回模型列表
 * 3. generate 返回 text
 * 4. generate 失败返回 error
 * 5. mapCopilotReasoningEffort 映射正确
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mock 依赖模块 ----

vi.mock('../../src/utils/copilot-client', () => ({
  resolveCopilotCli: vi.fn().mockReturnValue('/usr/local/bin/copilot'),
}))

// CopilotClient mock 工具函数
const mockClientStart = vi.fn().mockResolvedValue(undefined)
const mockClientStop = vi.fn().mockResolvedValue(undefined)
const mockSessionDestroy = vi.fn().mockResolvedValue(undefined)
const mockSessionOn = vi.fn()
const mockSessionSendAndWait = vi.fn().mockResolvedValue(undefined)

/** 创建一个模拟的 CopilotClient */
function makeMockClient(models: Array<{ id: string; name?: string; description?: string; enabled?: boolean }>) {
  return {
    start: mockClientStart,
    stop: mockClientStop,
    listModels: vi.fn().mockResolvedValue(models),
    createSession: vi.fn().mockResolvedValue({
      on: mockSessionOn,
      sendAndWait: mockSessionSendAndWait,
      destroy: mockSessionDestroy,
    }),
  }
}

// Copilot SDK mock
const mockCopilotClientConstructor = vi.fn()
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: mockCopilotClientConstructor,
}))

describe('CopilotProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认 mock：client 启动成功，返回一个模型
    mockClientStart.mockResolvedValue(undefined)
    mockClientStop.mockResolvedValue(undefined)
    mockSessionDestroy.mockResolvedValue(undefined)
    mockSessionSendAndWait.mockResolvedValue(undefined)

    const client = makeMockClient([
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Fast model', enabled: true },
    ])
    mockCopilotClientConstructor.mockReturnValue(client)
  })

  // ---- connect 测试 ----

  it('connect CLI 未找到返回 notInstalled', async () => {
    const { resolveCopilotCli } = await import('../../src/utils/copilot-client')
    ;(resolveCopilotCli as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined)

    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.notInstalled).toBe(true)
    expect(result.models).toHaveLength(0)
  })

  it('connect 成功返回模型列表', async () => {
    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(true)
    expect(result.models).toHaveLength(1)
    expect(result.models[0].provider).toBe('copilot')
    expect(result.models[0].value).toBe('gpt-4o')
    expect(result.models[0].displayName).toBe('GPT-4o')
  })

  it('connect 过滤 disabled 模型', async () => {
    const client = makeMockClient([
      { id: 'gpt-4o', name: 'GPT-4o', enabled: true },
      { id: 'old-model', name: 'Old Model', enabled: false },
    ])
    mockCopilotClientConstructor.mockReturnValue(client)

    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(true)
    expect(result.models).toHaveLength(1)
    expect(result.models[0].value).toBe('gpt-4o')
  })

  it('connect 无可用模型时提示登录', async () => {
    const client = makeMockClient([])
    mockCopilotClientConstructor.mockReturnValue(client)

    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.error).toContain('copilot login')
  })

  it('connect SDK 错误时返回友好错误', async () => {
    mockCopilotClientConstructor.mockImplementation(() => {
      throw new Error('not authenticated')
    })

    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.error).toContain('Not authenticated')
  })

  // ---- generate 测试 ----

  it('generate 返回 text', async () => {
    // 模拟 message_delta 回调
    let deltaCallback: (...args: unknown[]) => void = () => {}
    mockSessionOn.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'assistant.message_delta') {
        deltaCallback = handler
      }
    })

    // sendAndWait 时触发 delta 回调
    mockSessionSendAndWait.mockImplementation(async () => {
      deltaCallback({ text: 'Hello from Copilot!' })
    })

    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'copilot',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.text).toBe('Hello from Copilot!')
    expect(result.error).toBeUndefined()
    expect(mockSessionDestroy).toHaveBeenCalled()
    expect(mockClientStop).toHaveBeenCalled()
  })

  it('generate 失败返回 error', async () => {
    mockCopilotClientConstructor.mockImplementation(() => {
      throw new Error('Connection failed')
    })

    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'copilot',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.error).toContain('Connection failed')
    expect(result.text).toBeUndefined()
  })

  // ---- chat 测试 ----

  it('chat yield text 事件后 yield done', async () => {
    // 模拟 message_delta 回调
    let deltaCallback: (...args: unknown[]) => void = () => {}
    mockSessionOn.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'assistant.message_delta') {
        deltaCallback = handler
      }
    })

    // sendAndWait 时触发 delta 回调
    mockSessionSendAndWait.mockImplementation(async () => {
      deltaCallback({ text: 'Streaming text' })
    })

    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'copilot',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      events.push(event)
    }

    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents).toHaveLength(1)
    expect(textEvents[0].content).toBe('Streaming text')
    expect(events[events.length - 1].type).toBe('done')
    expect(mockSessionDestroy).toHaveBeenCalled()
    expect(mockClientStop).toHaveBeenCalled()
  })

  it('chat CLI 未找到时 yield error', async () => {
    const { resolveCopilotCli } = await import('../../src/utils/copilot-client')
    ;(resolveCopilotCli as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined)

    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'copilot',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      events.push(event)
    }

    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].content).toContain('not found')
  })

  // ---- mapCopilotReasoningEffort 测试 ----

  it('mapCopilotReasoningEffort 映射正确', async () => {
    const { mapCopilotReasoningEffort } = await import('../../src/providers/copilot-provider')

    expect(mapCopilotReasoningEffort(undefined)).toBeUndefined()
    expect(mapCopilotReasoningEffort('low')).toBe('low')
    expect(mapCopilotReasoningEffort('medium')).toBe('medium')
    expect(mapCopilotReasoningEffort('high')).toBe('high')
    expect(mapCopilotReasoningEffort('max')).toBe('xhigh')
  })
})
