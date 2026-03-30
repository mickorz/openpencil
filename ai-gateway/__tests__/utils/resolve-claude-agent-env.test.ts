import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildClaudeAgentEnv, normalizeEnvValue } from '../../src/utils/resolve-claude-agent-env'

// mock node:fs 的 readFileSync，避免依赖真实文件系统
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

import { readFileSync } from 'node:fs'

const mockReadFileSync = vi.mocked(readFileSync)

describe('normalizeEnvValue', () => {
  it('string 类型直接返回', () => {
    expect(normalizeEnvValue('hello')).toBe('hello')
  })

  it('空字符串返回 undefined', () => {
    expect(normalizeEnvValue('')).toBeUndefined()
    expect(normalizeEnvValue('   ')).toBeUndefined()
  })

  it('number 类型转为字符串', () => {
    expect(normalizeEnvValue(42)).toBe('42')
    expect(normalizeEnvValue(0)).toBe('0')
  })

  it('boolean 类型转为字符串', () => {
    expect(normalizeEnvValue(true)).toBe('true')
    expect(normalizeEnvValue(false)).toBe('false')
  })

  it('null 和 undefined 返回 undefined', () => {
    expect(normalizeEnvValue(null)).toBeUndefined()
    expect(normalizeEnvValue(undefined)).toBeUndefined()
  })

  it('object 和 array 等类型跳过', () => {
    expect(normalizeEnvValue({ key: 'val' })).toBeUndefined()
    expect(normalizeEnvValue([1, 2, 3])).toBeUndefined()
  })
})

describe('buildClaudeAgentEnv', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // 隔离 process.env，避免污染真实环境
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('合并 settings.json env 和 process.env', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      env: { MY_SETTING: 'from-settings' },
    }))
    process.env.MY_PROCESS_VAR = 'from-process'

    const env = buildClaudeAgentEnv()

    expect(env.MY_SETTING).toBe('from-settings')
    expect(env.MY_PROCESS_VAR).toBe('from-process')
  })

  it('process.env 覆盖 settings.json 中的同名变量', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      env: { SHARED_KEY: 'from-settings' },
    }))
    process.env.SHARED_KEY = 'from-process'

    const env = buildClaudeAgentEnv()

    expect(env.SHARED_KEY).toBe('from-process')
  })

  it('删除 CLAUDECODE 防止嵌套调用', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      env: { CLAUDECODE: '1' },
    }))
    process.env.CLAUDECODE = '1'

    const env = buildClaudeAgentEnv()

    expect(env.CLAUDECODE).toBeUndefined()
  })

  it('删除无效的 ANTHROPIC_CUSTOM_HEADERS', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_CUSTOM_HEADERS: 'not-valid-json' },
    }))
    process.env.ANTHROPIC_CUSTOM_HEADERS = 'not-valid-json'

    const env = buildClaudeAgentEnv()

    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  })

  it('保留合法的 ANTHROPIC_CUSTOM_HEADERS', () => {
    const validJson = '{"x-custom":"value"}'
    mockReadFileSync.mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_CUSTOM_HEADERS: validJson },
    }))

    const env = buildClaudeAgentEnv()

    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe(validJson)
  })

  it('ANTHROPIC_AUTH_TOKEN 映射到 ANTHROPIC_API_KEY', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: 'my-token-123' },
    }))

    // 确保 process.env 中没有 ANTHROPIC_API_KEY 和 ANTHROPIC_AUTH_TOKEN
    // 避免真实环境变量干扰测试
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN

    const env = buildClaudeAgentEnv()

    expect(env.ANTHROPIC_API_KEY).toBe('my-token-123')
  })

  it('已有 ANTHROPIC_API_KEY 时不覆盖', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: 'token-from-settings' },
    }))
    process.env.ANTHROPIC_API_KEY = 'existing-key'

    const env = buildClaudeAgentEnv()

    expect(env.ANTHROPIC_API_KEY).toBe('existing-key')
  })

  it('settings.json 中非 string 值用 normalizeEnvValue 处理', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      env: {
        NUMBER_VAL: 42,
        BOOL_VAL: true,
        OBJ_VAL: { nested: 'object' },
      },
    }))

    const env = buildClaudeAgentEnv()

    expect(env.NUMBER_VAL).toBe('42')
    expect(env.BOOL_VAL).toBe('true')
    // 对象类型的值应该被跳过
    expect(env.OBJ_VAL).toBeUndefined()
  })

  it('settings.json 不存在时返回 process.env（合并空对象）', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('文件不存在')
    })
    process.env.TEST_VAR = 'test-value'

    const env = buildClaudeAgentEnv()

    expect(env.TEST_VAR).toBe('test-value')
  })
})
