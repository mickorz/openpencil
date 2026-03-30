import { describe, it, expect } from 'vitest'
import {
  normalizeClaudeCliPath,
} from '../../src/utils/resolve-claude-cli'

describe('normalizeClaudeCliPath', () => {
  // 创建一个模拟的 existsSync：只在路径匹配给定集合时返回 true
  const makeExistsFn = (existing: Set<string>) => (p: string) => existing.has(p)

  it('空输入返回 undefined', () => {
    expect(normalizeClaudeCliPath(undefined)).toBeUndefined()
    expect(normalizeClaudeCliPath('')).toBeUndefined()
  })

  it('文件不存在返回 undefined', () => {
    const exists = makeExistsFn(new Set())
    expect(normalizeClaudeCliPath('/usr/local/bin/claude', { existsSyncFn: exists }))
      .toBeUndefined()
  })

  it('Unix 平台文件存在则返回路径', () => {
    const path = '/usr/local/bin/claude'
    const exists = makeExistsFn(new Set([path]))
    expect(normalizeClaudeCliPath(path, { existsSyncFn: exists, isWindows: false }))
      .toBe(path)
  })

  it('Windows 平台 .exe 文件直接返回', () => {
    const path = 'C:\\Programs\\claude-code\\claude.exe'
    const exists = makeExistsFn(new Set([path]))
    expect(normalizeClaudeCliPath(path, { existsSyncFn: exists, isWindows: true }))
      .toBe(path)
  })

  it('Windows 平台 .js 文件直接返回', () => {
    const path = 'C:\\AppData\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'
    const exists = makeExistsFn(new Set([path]))
    expect(normalizeClaudeCliPath(path, { existsSyncFn: exists, isWindows: true }))
      .toBe(path)
  })

  it('Windows 平台 npm shim 解析到 cli.js', () => {
    const shimPath = 'C:\\AppData\\npm\\claude'
    const cliJsPath = 'C:\\AppData\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'
    const exists = makeExistsFn(new Set([shimPath, cliJsPath]))

    const result = normalizeClaudeCliPath(shimPath, {
      existsSyncFn: exists,
      isWindows: true,
    })

    expect(result).toBe(cliJsPath)
  })

  it('Windows 平台 npm shim 无法解析时返回 undefined', () => {
    const shimPath = 'C:\\AppData\\npm\\claude'
    // 只存在 shim，不存在对应的 cli.js
    const exists = makeExistsFn(new Set([shimPath]))

    const result = normalizeClaudeCliPath(shimPath, {
      existsSyncFn: exists,
      isWindows: true,
    })

    expect(result).toBeUndefined()
  })

  it('Windows 平台 .cmd 扩展名也尝试解析 cli.js', () => {
    const cmdPath = 'C:\\AppData\\npm\\claude.cmd'
    const cliJsPath = 'C:\\AppData\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'
    const exists = makeExistsFn(new Set([cmdPath, cliJsPath]))

    const result = normalizeClaudeCliPath(cmdPath, {
      existsSyncFn: exists,
      isWindows: true,
    })

    expect(result).toBe(cliJsPath)
  })
})
