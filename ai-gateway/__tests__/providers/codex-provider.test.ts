/**
 * CodexProvider 测试
 *
 * 测试覆盖：
 * 1. connect 返回 notInstalled (codex 不在 PATH)
 * 2. generate 委托 runCodexExec，返回 text
 * 3. generate runCodexExec 失败返回 error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mock 依赖模块 ----

// mock codex-client 的 runCodexExec
const mockRunCodexExec = vi.fn()
vi.mock('../../src/utils/codex-client', () => ({
  runCodexExec: (...args: unknown[]) => mockRunCodexExec(...args),
  resolveCodexEffort: vi.fn((_thinkingMode?: string, effort?: string) => effort),
  buildPrompt: vi.fn((_system: string, user: string) => user),
  filterCodexEnv: vi.fn(() => ({})),
}))

// mock node:child_process 用于 connect 的 codex CLI 查找
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

// mock node:fs 用于 loadModelsCache
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}))

// mock temp-files
vi.mock('../../src/utils/temp-files', () => ({
  saveAttachmentsToTempFiles: vi.fn().mockResolvedValue({
    tempDir: '/tmp/test-attach',
    files: ['/tmp/test-attach/0.png'],
  }),
  cleanupDir: vi.fn().mockResolvedValue(undefined),
}))

describe('CodexProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---- connect 测试 ----

  it('connect 返回 notInstalled (codex 不在 PATH)', async () => {
    // execSync 模拟 which/where 找不到 codex
    const { execSync } = await import('node:child_process')
    ;(execSync as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && (cmd.includes('which') || cmd.includes('where'))) {
        throw new Error('not found')
      }
      return ''
    })

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.notInstalled).toBe(true)
    expect(result.models).toHaveLength(0)
  })

  it('connect 成功时返回模型列表', async () => {
    const { execSync } = await import('node:child_process')
    const { existsSync } = await import('node:fs')
    const { readFileSync } = await import('node:fs')

    // which 找到 codex
    ;(execSync as ReturnType<typeof vi.fn>).mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('which') || cmdStr.includes('where')) {
        return '/usr/local/bin/codex\n'
      }
      if (cmdStr.includes('--version')) {
        return 'codex 1.0.0\n'
      }
      return ''
    })

    // 模拟 models_cache.json 存在
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify([
        { id: 'o4-mini', name: 'o4-mini', description: 'Fast model' },
        { id: 'o3', name: 'o3', description: 'Powerful model' },
      ]),
    )

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(true)
    expect(result.models).toHaveLength(2)
    expect(result.models[0].value).toBe('o4-mini')
    expect(result.models[0].provider).toBe('openai')
    expect(result.models[1].value).toBe('o3')
  })

  it('connect 版本检查失败返回错误', async () => {
    const { execSync } = await import('node:child_process')

    ;(execSync as ReturnType<typeof vi.fn>).mockImplementation((cmd: string | Buffer) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString()
      if (cmdStr.includes('which') || cmdStr.includes('where')) {
        return '/usr/local/bin/codex\n'
      }
      if (cmdStr.includes('--version')) {
        throw new Error('codex crashed')
      }
      return ''
    })

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.error).toContain('codex crashed')
  })

  // ---- generate 测试 ----

  it('generate 委托 runCodexExec，返回 text', async () => {
    mockRunCodexExec.mockResolvedValue({
      text: 'Generated response from Codex',
      exitCode: 0,
    })

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true, timeoutMs: 60000 })
    const result = await provider.generate({
      provider: 'codex',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.text).toBe('Generated response from Codex')
    expect(result.error).toBeUndefined()
    expect(mockRunCodexExec).toHaveBeenCalledTimes(1)
  })

  it('generate runCodexExec 失败返回 error', async () => {
    mockRunCodexExec.mockResolvedValue({
      error: 'Codex exec failed with exit code 1',
      exitCode: 1,
    })

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'codex',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.error).toContain('Codex exec failed')
    expect(result.text).toBeUndefined()
  })

  it('generate 异常时返回错误', async () => {
    mockRunCodexExec.mockRejectedValue(new Error('Unexpected error'))

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'codex',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.error).toBe('Unexpected error')
  })

  it('generate 处理图片附件', async () => {
    mockRunCodexExec.mockResolvedValue({
      text: 'Image analysis result',
      exitCode: 0,
    })

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'codex',
      system: 'You are helpful',
      messages: [{
        role: 'user',
        content: 'Describe this image',
        attachments: [{
          name: 'test.png',
          mediaType: 'image/png',
          data: Buffer.from('fake').toString('base64'),
        }],
      }],
    })

    expect(result.text).toBe('Image analysis result')

    // 验证调用了 saveAttachmentsToTempFiles
    const { saveAttachmentsToTempFiles } = await import('../../src/utils/temp-files')
    expect(saveAttachmentsToTempFiles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'test.png' })]),
      true,
    )

    // 验证清理了临时文件
    const { cleanupDir } = await import('../../src/utils/temp-files')
    expect(cleanupDir).toHaveBeenCalledWith('/tmp/test-attach')
  })

  // ---- chat 测试 ----

  it('chat 伪流式输出完成后的全部文本', async () => {
    mockRunCodexExec.mockResolvedValue({
      text: 'Full response text',
      exitCode: 0,
    })

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'codex',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      events.push(event)
    }

    const textEvents = events.filter((e) => e.type === 'text')
    expect(textEvents).toHaveLength(1)
    expect(textEvents[0].content).toBe('Full response text')
    expect(events[events.length - 1].type).toBe('done')
  })

  it('chat 错误时 yield error 事件', async () => {
    mockRunCodexExec.mockResolvedValue({
      error: 'Codex error',
      exitCode: 1,
    })

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'codex',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      events.push(event)
    }

    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].content).toBe('Codex error')
  })

  it('chat 异常时 yield error 事件', async () => {
    mockRunCodexExec.mockRejectedValue(new Error('Spawn failed'))

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const events: Array<{ type: string; content: string }> = []
    for await (const event of provider.chat({
      provider: 'codex',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      events.push(event)
    }

    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].content).toBe('Spawn failed')
  })
})
