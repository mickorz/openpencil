/**
 * ClaudeProvider 测试
 *
 * 测试覆盖：
 * 1. connect 返回模型列表
 * 2. connect CLI 未找到返回 notInstalled
 * 3. generate 返回 text
 * 4. generate 失败返回 error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mock 依赖模块 ----

vi.mock('../../src/utils/resolve-claude-cli', () => ({
  resolveClaudeCli: vi.fn().mockReturnValue('/usr/local/bin/claude'),
}))

vi.mock('../../src/utils/resolve-claude-agent-env', () => ({
  buildClaudeAgentEnv: vi.fn().mockReturnValue({}),
  getClaudeAgentDebugFilePath: vi.fn().mockReturnValue(undefined),
}))

vi.mock('../../src/utils/temp-files', () => ({
  saveAttachmentsToTempFiles: vi.fn().mockResolvedValue({
    tempDir: '/tmp/test-attach',
    files: ['/tmp/test-attach/0.png'],
  }),
  cleanupDir: vi.fn().mockResolvedValue(undefined),
}))

// Agent SDK mock 工具函数
const mockClose = vi.fn()

/** 创建一个模拟的 async iterator */
function makeAsyncIterator<T>(items: T[]): AsyncIterable<T> & { close: ReturnType<typeof vi.fn> } {
  return {
    close: mockClose,
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        async next() {
          if (index < items.length) {
            return { value: items[index++], done: false }
          }
          return { value: undefined, done: true }
        },
      }
    },
  }
}

/** 创建一个模拟的 query 返回对象（带 supportedModels） */
function makeQueryResult(models: Array<{ value: string; displayName: string; description: string }>) {
  return {
    supportedModels: vi.fn().mockResolvedValue(models),
    close: mockClose,
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { value: undefined, done: true }
        },
      }
    },
  }
}

// Agent SDK mock
const mockQuery = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

describe('ClaudeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认 mock：connect 成功，返回一个模型
    mockQuery.mockReturnValue(makeQueryResult([
      { value: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', description: 'Fast' },
    ]))
  })

  // ---- connect 测试 ----

  it('connect 返回模型列表', async () => {
    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true, timeoutMs: 120000 })
    const result = await provider.connect()

    expect(result.connected).toBe(true)
    expect(result.models).toHaveLength(1)
    expect(result.models[0].provider).toBe('anthropic')
    expect(result.models[0].value).toBe('claude-sonnet-4-20250514')
    expect(result.models[0].displayName).toBe('Claude Sonnet 4')
  })

  it('connect CLI 未找到返回 notInstalled', async () => {
    const { resolveClaudeCli } = await import('../../src/utils/resolve-claude-cli')
    ;(resolveClaudeCli as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined)

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.notInstalled).toBe(true)
    expect(result.models).toHaveLength(0)
  })

  it('connect SDK 错误时返回友好错误', async () => {
    mockQuery.mockImplementation(() => {
      throw new Error('process exited with code 1')
    })

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.error).toContain('exited with code 1')
  })

  // ---- generate 测试 ----

  it('generate 返回 text', async () => {
    const iter = makeAsyncIterator([
      { type: 'result', subtype: 'success', result: 'Generated text' },
    ])
    mockQuery.mockReturnValueOnce(iter)

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'claude',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.text).toBe('Generated text')
    expect(result.error).toBeUndefined()
    expect(mockClose).toHaveBeenCalled()
  })

  it('generate 失败返回 error', async () => {
    const iter = makeAsyncIterator([
      { type: 'result', subtype: 'error', errors: ['Something went wrong'] },
    ])
    mockQuery.mockReturnValueOnce(iter)

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'claude',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.error).toContain('Something went wrong')
    expect(result.text).toBeUndefined()
    expect(mockClose).toHaveBeenCalled()
  })

  it('generate 无 result 事件返回错误', async () => {
    // 空迭代器，没有 result 事件
    const iter = makeAsyncIterator([])
    mockQuery.mockReturnValueOnce(iter)

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'claude',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.error).toContain('No result received')
    expect(mockClose).toHaveBeenCalled()
  })

  // ---- chat 测试 ----

  it('chat 文本模式流式输出 content_block_delta', async () => {
    const iter = makeAsyncIterator([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ' world' },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Hello world',
      },
    ])
    mockQuery.mockReturnValueOnce(iter)

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'claude',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      events.push(event)
    }

    // 应有 2 个 text 事件 + 1 个 done
    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0].content).toBe('Hello')
    expect(textEvents[1].content).toBe(' world')
    expect(events[events.length - 1].type).toBe('done')
    expect(mockClose).toHaveBeenCalled()
  })

  it('chat 文本模式输出 thinking_delta', async () => {
    const iter = makeAsyncIterator([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'Let me think...' },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: '',
      },
    ])
    mockQuery.mockReturnValueOnce(iter)

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'claude',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Think' }],
    })) {
      events.push(event)
    }

    const thinkingEvents = events.filter((e) => e.type === 'thinking')
    expect(thinkingEvents).toHaveLength(1)
    expect(thinkingEvents[0].content).toBe('Let me think...')
  })

  it('chat 图片模式使用 result-based 等待完整结果', async () => {
    const iter = makeAsyncIterator([
      { type: 'result', subtype: 'success', result: 'This is an image of a cat.' },
    ])
    mockQuery.mockReturnValueOnce(iter)

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'claude',
      system: 'You are helpful. NEVER use tools.',
      messages: [{
        role: 'user',
        content: 'What is this image?',
        attachments: [{
          name: 'test.png',
          mediaType: 'image/png',
          data: Buffer.from('fake').toString('base64'),
        }],
      }],
    })) {
      events.push(event)
    }

    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents).toHaveLength(1)
    expect(textEvents[0].content).toBe('This is an image of a cat.')

    // 应该调用了 saveAttachmentsToTempFiles
    const { saveAttachmentsToTempFiles } = await import('../../src/utils/temp-files')
    expect(saveAttachmentsToTempFiles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'test.png' })]),
      true,
    )

    // 应该清理了临时文件
    const { cleanupDir } = await import('../../src/utils/temp-files')
    expect(cleanupDir).toHaveBeenCalledWith('/tmp/test-attach')
  })

  it('chat 图片模式错误时返回 error 事件', async () => {
    const iter = makeAsyncIterator([
      { type: 'result', subtype: 'error', errors: ['Failed to read image'] },
    ])
    mockQuery.mockReturnValueOnce(iter)

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'claude',
      system: 'You are helpful',
      messages: [{
        role: 'user',
        content: 'What is this?',
        attachments: [{
          name: 'test.png',
          mediaType: 'image/png',
          data: Buffer.from('fake').toString('base64'),
        }],
      }],
    })) {
      events.push(event)
    }

    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].content).toContain('Failed to read image')
  })

  it('chat 异常时 yield error 事件并清理资源', async () => {
    mockQuery.mockImplementation(() => {
      throw new Error('Unexpected failure')
    })

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'claude',
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
