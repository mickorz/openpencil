/**
 * codex-client 纯函数测试
 *
 * 测试覆盖：
 * 1. filterCodexEnv 白名单过滤
 * 2. buildPrompt 构建 prompt
 * 3. buildCodexExecArgs 构建参数
 * 4. resolveCodexEffort 映射 effort
 */

import { describe, it, expect } from 'vitest'
import {
  filterCodexEnv,
  buildPrompt,
  buildCodexExecArgs,
  resolveCodexEffort,
  parseCodexJsonLine,
  extractCodexCliError,
} from '../../src/utils/codex-client'

// ---- filterCodexEnv 测试 ----

describe('filterCodexEnv', () => {
  it('保留系统白名单变量', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      TERM: 'xterm',
      LANG: 'en_US.UTF-8',
      UNKNOWN_VAR: 'value',
    }

    const result = filterCodexEnv(env)
    expect(result.PATH).toBe('/usr/bin')
    expect(result.HOME).toBe('/home/user')
    expect(result.TERM).toBe('xterm')
    expect(result.LANG).toBe('en_US.UTF-8')
    expect(result.UNKNOWN_VAR).toBeUndefined()
  })

  it('保留 OPENAI_ 和 CODEX_ 前缀变量', () => {
    const env = {
      OPENAI_API_KEY: 'sk-123',
      OPENAI_BASE_URL: 'https://api.openai.com',
      CODEX_PROFILE: 'test',
      SOME_OTHER: 'value',
    }

    const result = filterCodexEnv(env)
    expect(result.OPENAI_API_KEY).toBe('sk-123')
    expect(result.OPENAI_BASE_URL).toBe('https://api.openai.com')
    expect(result.CODEX_PROFILE).toBe('test')
    expect(result.SOME_OTHER).toBeUndefined()
  })

  it('排除其他提供商密钥', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk-ant',
      AWS_ACCESS_KEY: 'aws-key',
      GITHUB_TOKEN: 'gh-token',
      PATH: '/usr/bin',
    }

    const result = filterCodexEnv(env)
    expect(result.ANTHROPIC_API_KEY).toBeUndefined()
    expect(result.AWS_ACCESS_KEY).toBeUndefined()
    expect(result.GITHUB_TOKEN).toBeUndefined()
    expect(result.PATH).toBe('/usr/bin')
  })

  it('忽略 undefined 值', () => {
    const env = {
      PATH: '/usr/bin',
      UNDEFINED_VAR: undefined,
    }

    const result = filterCodexEnv(env)
    expect(result.PATH).toBe('/usr/bin')
    expect(result.UNDEFINED_VAR).toBeUndefined()
  })

  it('大小写不敏感匹配白名单', () => {
    const env = {
      path: '/usr/bin',
      Home: '/home/user',
    }

    const result = filterCodexEnv(env)
    expect(result.path).toBe('/usr/bin')
    expect(result.Home).toBe('/home/user')
  })

  it('大小写不敏感排除前缀', () => {
    const env = {
      anthropic_api_key: 'sk-ant',
      Aws_Secret_Key: 'aws-secret',
    }

    const result = filterCodexEnv(env)
    expect(result.anthropic_api_key).toBeUndefined()
    expect(result.Aws_Secret_Key).toBeUndefined()
  })

  it('Windows 系统变量保留', () => {
    const env = {
      SYSTEMROOT: 'C:\\Windows',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      USERPROFILE: 'C:\\Users\\test',
      APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
      PATHEXT: '.COM;.EXE',
      SYSTEMDRIVE: 'C:',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Temp',
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\test',
    }

    const result = filterCodexEnv(env)
    for (const key of Object.keys(env)) {
      expect(result[key]).toBe(env[key])
    }
  })
})

// ---- buildPrompt 测试 ----

describe('buildPrompt', () => {
  it('无 system 时直接返回 userPrompt', () => {
    expect(buildPrompt('', 'Hello')).toBe('Hello')
    expect(buildPrompt('', '')).toBe('')
  })

  it('有 system 时拼接格式化提示', () => {
    const result = buildPrompt('You are helpful', 'Hello')
    expect(result).toBe('SYSTEM INSTRUCTIONS:\nYou are helpful\n\nUSER REQUEST:\nHello')
  })
})

// ---- buildCodexExecArgs 测试 ----

describe('buildCodexExecArgs', () => {
  it('基础参数包含必要 flag', () => {
    const args = buildCodexExecArgs('/tmp/output.txt', {})

    expect(args).toContain('exec')
    expect(args).toContain('--json')
    expect(args).toContain('--skip-git-repo-check')
    expect(args).toContain('--sandbox')
    expect(args).toContain('read-only')
    expect(args).toContain('--output-last-message')
    expect(args).toContain('/tmp/output.txt')
    expect(args).toContain('-')
  })

  it('指定 model 时添加 --model 参数', () => {
    const args = buildCodexExecArgs('/tmp/out.txt', { model: 'o4-mini' })
    const modelIdx = args.indexOf('--model')
    expect(modelIdx).toBeGreaterThanOrEqual(0)
    expect(args[modelIdx + 1]).toBe('o4-mini')
  })

  it('指定 effort 时添加 --config 参数', () => {
    const args = buildCodexExecArgs('/tmp/out.txt', { effort: 'high' })
    const configIdx = args.indexOf('--config')
    expect(configIdx).toBeGreaterThanOrEqual(0)
    expect(args[configIdx + 1]).toBe('model_reasoning_effort="high"')
  })

  it('指定 imageFiles 时添加 --image 参数', () => {
    const args = buildCodexExecArgs('/tmp/out.txt', {
      imageFiles: ['/tmp/img1.png', '/tmp/img2.jpg'],
    })

    const imageIndices = args.reduce<number[]>((acc, arg, i) => {
      if (arg === '--image') acc.push(i)
      return acc
    }, [])

    expect(imageIndices).toHaveLength(2)
    expect(args[imageIndices[0] + 1]).toBe('/tmp/img1.png')
    expect(args[imageIndices[1] + 1]).toBe('/tmp/img2.jpg')
  })

  it('无选项时不添加可选参数', () => {
    const args = buildCodexExecArgs('/tmp/out.txt', {})
    expect(args).not.toContain('--model')
    expect(args).not.toContain('--config')
    expect(args).not.toContain('--image')
  })

  it('同时指定所有可选参数', () => {
    const args = buildCodexExecArgs('/tmp/out.txt', {
      model: 'o3',
      effort: 'medium',
      imageFiles: ['/img.png'],
    })

    expect(args).toContain('--model')
    expect(args).toContain('o3')
    expect(args).toContain('--config')
    expect(args).toContain('--image')
  })
})

// ---- resolveCodexEffort 测试 ----

describe('resolveCodexEffort', () => {
  it('disabled 映射为 low', () => {
    expect(resolveCodexEffort('disabled')).toBe('low')
  })

  it('enabled 映射为 medium', () => {
    expect(resolveCodexEffort('enabled')).toBe('medium')
  })

  it('adaptive 返回 undefined', () => {
    expect(resolveCodexEffort('adaptive')).toBeUndefined()
  })

  it('effort=max 映射为 high', () => {
    expect(resolveCodexEffort(undefined, 'max')).toBe('high')
  })

  it('effort=low 直接返回', () => {
    expect(resolveCodexEffort(undefined, 'low')).toBe('low')
  })

  it('effort=medium 直接返回', () => {
    expect(resolveCodexEffort(undefined, 'medium')).toBe('medium')
  })

  it('effort=high 直接返回', () => {
    expect(resolveCodexEffort(undefined, 'high')).toBe('high')
  })

  it('effort 优先于 thinkingMode', () => {
    expect(resolveCodexEffort('disabled', 'high')).toBe('high')
  })

  it('无参数返回 undefined', () => {
    expect(resolveCodexEffort()).toBeUndefined()
  })
})

// ---- parseCodexJsonLine 测试 ----

describe('parseCodexJsonLine', () => {
  it('解析包含 text 的 JSON 行', () => {
    const result = parseCodexJsonLine('{"text": "Hello world"}')
    expect(result.text).toBe('Hello world')
    expect(result.error).toBeUndefined()
  })

  it('解析包含 error 的 JSON 行', () => {
    const result = parseCodexJsonLine('{"error": "Something failed"}')
    expect(result.error).toBe('Something failed')
    expect(result.text).toBeUndefined()
  })

  it('空行返回空对象', () => {
    const result = parseCodexJsonLine('')
    expect(result.text).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it('非 JSON 行当作纯文本返回', () => {
    const result = parseCodexJsonLine('plain text output')
    expect(result.text).toBe('plain text output')
  })

  it('带空格的行会被 trim', () => {
    const result = parseCodexJsonLine('  {"text": "test"}  ')
    expect(result.text).toBe('test')
  })
})

// ---- extractCodexCliError 测试 ----

describe('extractCodexCliError', () => {
  it('返回最后一行', () => {
    const result = extractCodexCliError('line1\nline2\nError: model not found')
    expect(result).toBe('Error: model not found')
  })

  it('单行直接返回', () => {
    const result = extractCodexCliError('Single error message')
    expect(result).toBe('Single error message')
  })

  it('空字符串返回 undefined', () => {
    const result = extractCodexCliError('')
    expect(result).toBeUndefined()
  })

  it('只有空白字符返回 undefined', () => {
    const result = extractCodexCliError('   \n   ')
    expect(result).toBeUndefined()
  })
})
