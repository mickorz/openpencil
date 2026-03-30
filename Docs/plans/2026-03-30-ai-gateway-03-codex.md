# AI Gateway 03 - Codex CLI Provider

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 CodexProvider，通过 `spawn('codex')` 子进程桥接 Codex CLI，支持 connect / chat / generate。

**Architecture:** CodexProvider 继承 BaseProvider，包含环境变量白名单过滤、CLI 参数构建、JSON 输出解析等辅助函数。Codex 不支持流式输出，chat() 为伪流式（等待完成后一次性输出）。

**Tech Stack:** Node.js child_process (spawn)

**前置条件:** 计划 01-scaffold 已完成

---

### Task 1: Codex 客户端核心 (codex-client.ts)

**Files:**
- Create: `ai-gateway/src/utils/codex-client.ts`
- Test: `ai-gateway/__tests__/utils/codex-client.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect } from 'vitest'
import {
  filterCodexEnv,
  buildPrompt,
  buildCodexExecArgs,
  resolveCodexEffort,
} from '../../src/utils/codex-client'

describe('filterCodexEnv', () => {
  it('keeps system vars', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/user', UNKNOWN: 'nope' }
    const filtered = filterCodexEnv(env)
    expect(filtered.PATH).toBe('/usr/bin')
    expect(filtered.HOME).toBe('/home/user')
    expect(filtered.UNKNOWN).toBeUndefined()
  })

  it('keeps OPENAI_ prefixed vars', () => {
    const env = { OPENAI_API_KEY: 'sk-xxx', OTHER_KEY: 'nope' }
    const filtered = filterCodexEnv(env)
    expect(filtered.OPENAI_API_KEY).toBe('sk-xxx')
    expect(filtered.OTHER_KEY).toBeUndefined()
  })

  it('keeps CODEX_ prefixed vars', () => {
    const env = { CODEX_CONFIG: 'value' }
    const filtered = filterCodexEnv(env)
    expect(filtered.CODEX_CONFIG).toBe('value')
  })

  it('strips secrets from other providers', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk-ant',
      AWS_SECRET_KEY: 'secret',
      GITHUB_TOKEN: 'ghp_xxx',
    }
    const filtered = filterCodexEnv(env)
    expect(filtered.ANTHROPIC_API_KEY).toBeUndefined()
    expect(filtered.AWS_SECRET_KEY).toBeUndefined()
    expect(filtered.GITHUB_TOKEN).toBeUndefined()
  })

  it('keeps Windows essential vars', () => {
    const env = { SYSTEMROOT: 'C:\\Windows', COMSPEC: 'cmd.exe' }
    const filtered = filterCodexEnv(env)
    expect(filtered.SYSTEMROOT).toBe('C:\\Windows')
    expect(filtered.COMSPEC).toBe('cmd.exe')
  })
})

describe('buildPrompt', () => {
  it('returns user prompt only when no system prompt', () => {
    expect(buildPrompt(undefined, 'Hello')).toBe('Hello')
  })

  it('combines system and user prompt', () => {
    const result = buildPrompt('Be helpful', 'Hello')
    expect(result).toContain('SYSTEM INSTRUCTIONS:')
    expect(result).toContain('Be helpful')
    expect(result).toContain('USER REQUEST:')
    expect(result).toContain('Hello')
  })

  it('returns user prompt when system is empty', () => {
    expect(buildPrompt('  ', 'Hello')).toBe('Hello')
  })
})

describe('buildCodexExecArgs', () => {
  it('builds basic args', () => {
    const args = buildCodexExecArgs('/tmp/out.txt', {})
    expect(args).toContain('exec')
    expect(args).toContain('--json')
    expect(args).toContain('--skip-git-repo-check')
    expect(args).toContain('--sandbox')
    expect(args).toContain('read-only')
    expect(args).toContain('--output-last-message')
    expect(args).toContain('/tmp/out.txt')
    expect(args[args.length - 1]).toBe('-')
  })

  it('includes model when specified', () => {
    const args = buildCodexExecArgs('/tmp/out.txt', { model: 'gpt-4o' })
    const modelIdx = args.indexOf('--model')
    expect(modelIdx).toBeGreaterThan(-1)
    expect(args[modelIdx + 1]).toBe('gpt-4o')
  })

  it('includes effort config when specified', () => {
    const args = buildCodexExecArgs('/tmp/out.txt', { effort: 'high' })
    const configIdx = args.indexOf('--config')
    expect(configIdx).toBeGreaterThan(-1)
    expect(args[configIdx + 1]).toContain('model_reasoning_effort')
    expect(args[configIdx + 1]).toContain('high')
  })

  it('includes image files', () => {
    const args = buildCodexExecArgs('/tmp/out.txt', { imageFiles: ['/a.png', '/b.jpg'] })
    const images = args.filter((_, i) => args[i - 1] === '--image')
    expect(images).toEqual(['/a.png', '/b.jpg'])
  })
})

describe('resolveCodexEffort', () => {
  it('maps disabled to low', () => {
    expect(resolveCodexEffort('disabled', undefined)).toBe('low')
  })

  it('maps enabled to medium', () => {
    expect(resolveCodexEffort('enabled', undefined)).toBe('medium')
  })

  it('maps max to high', () => {
    expect(resolveCodexEffort(undefined, 'max')).toBe('high')
  })

  it('passes through low/medium/high', () => {
    expect(resolveCodexEffort(undefined, 'low')).toBe('low')
    expect(resolveCodexEffort(undefined, 'medium')).toBe('medium')
    expect(resolveCodexEffort(undefined, 'high')).toBe('high')
  })

  it('returns undefined for no config', () => {
    expect(resolveCodexEffort(undefined, undefined)).toBeUndefined()
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/utils/codex-client.test.ts
```

**Step 3: 实现 codex-client.ts**

```typescript
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type ThinkingMode = 'adaptive' | 'disabled' | 'enabled'
type ThinkingEffort = 'low' | 'medium' | 'high' | 'max'

export interface CodexExecOptions {
  model?: string
  systemPrompt?: string
  thinkingMode?: ThinkingMode
  thinkingBudgetTokens?: number
  effort?: ThinkingEffort
  timeoutMs?: number
  imageFiles?: string[]
}

export interface CodexCliResult {
  text?: string
  error?: string
}

const DEFAULT_CODEX_TIMEOUT_MS = 15 * 60 * 1000

// 环境变量白名单
const CODEX_ENV_ALLOWLIST = new Set([
  'PATH', 'HOME', 'TERM', 'LANG', 'SHELL', 'TMPDIR',
  'SYSTEMROOT', 'COMSPEC', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'PATHEXT', 'SYSTEMDRIVE', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH',
])

export function filterCodexEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(env)) {
    if (CODEX_ENV_ALLOWLIST.has(k) || k.startsWith('OPENAI_') || k.startsWith('CODEX_')) {
      result[k] = v
    }
  }
  return result
}

export function buildPrompt(
  systemPrompt: string | undefined,
  userPrompt: string,
): string {
  const userText = userPrompt.trim()
  if (!systemPrompt?.trim()) return userText
  return [
    'SYSTEM INSTRUCTIONS:',
    systemPrompt.trim(),
    '',
    'USER REQUEST:',
    userText,
  ].join('\n')
}

export function buildCodexExecArgs(
  outputPath: string,
  options: CodexExecOptions = {},
): string[] {
  const codexEffort = resolveCodexEffort(options.thinkingMode, options.effort)

  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--output-last-message', outputPath,
  ]

  if (options.model) args.push('--model', options.model)
  if (codexEffort) args.push('--config', `model_reasoning_effort="${codexEffort}"`)
  for (const f of options.imageFiles ?? []) args.push('--image', f)
  args.push('-')

  return args
}

export function resolveCodexEffort(
  thinkingMode?: ThinkingMode,
  effort?: ThinkingEffort,
): 'low' | 'medium' | 'high' | undefined {
  if (thinkingMode === 'disabled') return 'low'
  if (effort === 'max') return 'high'
  if (effort === 'low' || effort === 'medium' || effort === 'high') return effort
  if (thinkingMode === 'enabled') return 'medium'
  return undefined
}

export async function runCodexExec(
  userPrompt: string,
  options: CodexExecOptions = {},
): Promise<CodexCliResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ai-gateway-codex-'))
  const outputPath = join(tempDir, 'last-message.txt')
  const prompt = buildPrompt(options.systemPrompt, userPrompt)
  const args = buildCodexExecArgs(outputPath, options)

  try {
    const runResult = await executeCodexCommand(args, prompt, options.timeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS)
    const finalText = (await readFile(outputPath, 'utf-8').catch(() => '')).trim() || runResult.text.trim()

    if (finalText) return { text: finalText }
    if (runResult.errors.length > 0) return { error: runResult.errors.join('; ') }
    return { error: 'Codex returned no output.' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Codex execution failed' }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function executeCodexCommand(
  args: string[],
  prompt: string,
  timeoutMs: number,
): Promise<{ text: string; errors: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      env: filterCodexEnv(process.env as Record<string, string | undefined>),
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(process.platform === 'win32' && { shell: true }),
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let textAcc = ''
    const errors: string[] = []

    const flushLine = (line: string) => {
      const event = parseCodexJsonLine(line)
      if (!event) return
      if (event.text) textAcc += event.text
      if (event.error) errors.push(event.error)
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Codex request timed out after ${Math.round(timeoutMs / 1000)}s.`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8')
      let idx = stdoutBuffer.indexOf('\n')
      while (idx >= 0) {
        const line = stdoutBuffer.slice(0, idx).trim()
        stdoutBuffer = stdoutBuffer.slice(idx + 1)
        if (line) flushLine(line)
        idx = stdoutBuffer.indexOf('\n')
      }
    })

    child.stderr.on('data', (chunk: Buffer) => { stderrBuffer += chunk.toString('utf-8') })
    child.stdin.on('error', () => {})

    const payload = prompt.trim().length > 0 ? prompt : 'Please help with the request.'
    child.stdin.end(`${payload}\n`)

    child.on('error', (err) => { clearTimeout(timer); reject(err) })

    child.on('close', (code) => {
      clearTimeout(timer)
      const tail = stdoutBuffer.trim()
      if (tail) flushLine(tail)

      if (code === 0) {
        resolve({ text: textAcc, errors })
        return
      }

      const stderrError = extractCodexCliError(stderrBuffer)
      const fallback = errors[errors.length - 1]
      reject(new Error(stderrError || fallback || `Codex exited with code ${code ?? 'unknown'}.`))
    })
  })
}

function parseCodexJsonLine(line: string): { text?: string; error?: string } | null {
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(line) } catch { return null }

  const type = typeof parsed.type === 'string' ? parsed.type : ''
  if (type === 'error') {
    const msg = getStringField(parsed, ['message'])
    return { error: msg || 'Codex returned an unknown error.' }
  }

  const text = getStringField(parsed, ['delta', 'text', 'content'])
  return text ? { text } : null
}

function getStringField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'string' && val.length > 0) return val
  }
  return null
}

function extractCodexCliError(stderr: string): string | null {
  const trimmed = stderr.trim()
  if (!trimmed) return null
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].toLowerCase().startsWith('error:')) {
      return lines[i].replace(/^error:\s*/i, '').trim()
    }
  }
  return lines[lines.length - 1] ?? null
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/utils/codex-client.test.ts
```

**Step 5: 提交**

```bash
git add ai-gateway/src/utils/codex-client.ts ai-gateway/__tests__/utils/codex-client.test.ts
git commit -m "feat(gateway): add Codex CLI client with env filter, prompt builder, JSON parser"
```

---

### Task 2: 实现 CodexProvider

**Files:**
- Modify: `ai-gateway/src/providers/codex-provider.ts` (替换占位)
- Test: `ai-gateway/__tests__/providers/codex-provider.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/utils/codex-client', () => ({
  runCodexExec: vi.fn(),
}))

describe('CodexProvider', () => {
  it('connect returns notInstalled when codex not found', async () => {
    // 临时让 execSync 抛出
    const origPlatform = process.platform
    vi.doMock('node:child_process', () => ({
      execSync: vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes('where') || cmd.includes('which')) throw new Error('ENOENT')
        return ''
      }),
    }))

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.notInstalled).toBe(true)
  })

  it('generate delegates to runCodexExec', async () => {
    const { runCodexExec } = await import('../../src/utils/codex-client')
    ;(runCodexExec as any).mockResolvedValue({ text: 'Hello from Codex' })

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'codex',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o',
    })

    expect(result.text).toBe('Hello from Codex')
    expect(runCodexExec).toHaveBeenCalledWith(
      'Hello',
      expect.objectContaining({ model: 'gpt-4o', systemPrompt: 'You are helpful' }),
    )
  })

  it('generate returns error when runCodexExec fails', async () => {
    const { runCodexExec } = await import('../../src/utils/codex-client')
    ;(runCodexExec as any).mockResolvedValue({ error: 'Codex returned no output.' })

    const { CodexProvider } = await import('../../src/providers/codex-provider')
    const provider = new CodexProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'codex',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.error).toBe('Codex returned no output.')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/providers/codex-provider.test.ts
```

**Step 3: 实现 codex-provider.ts**

```typescript
import { execSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BaseProvider, type ChatRequest, type ConnectResult, type SSEEvent } from './base-provider'
import type { ProviderConfig } from '../config'
import { runCodexExec } from '../utils/codex-client'
import { saveAttachmentsToTempFiles, cleanupDir } from '../utils/temp-files'

export class CodexProvider extends BaseProvider {
  readonly name = 'codex'

  constructor(config: ProviderConfig) { super(config) }

  async connect(): Promise<ConnectResult> {
    try {
      // 检查 codex 是否在 PATH 中
      const whichCmd = process.platform === 'win32' ? 'where codex 2>nul' : 'which codex 2>/dev/null || echo ""'
      const which = execSync(whichCmd, { encoding: 'utf-8', timeout: 5000 })
        .trim().split(/\r?\n/)[0]?.trim() ?? ''
      if (!which) {
        return { connected: false, models: [], notInstalled: true, error: 'Codex CLI not found' }
      }

      // 验证可响应
      try {
        execSync('codex --version 2>&1', { encoding: 'utf-8', timeout: 5000 })
      } catch {
        return { connected: false, models: [], error: 'Codex CLI not responding' }
      }

      // 读取本地模型缓存
      const models = await this.readModelsCache()
      if (models.length === 0) {
        return { connected: false, models: [], error: 'No models found. Run codex once to populate cache.' }
      }

      return { connected: true, models }
    } catch (error) {
      return { connected: false, models: [], error: error instanceof Error ? error.message : 'Failed to connect' }
    }
  }

  async *chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent> {
    let attachTempDir: string | undefined

    try {
      const attachments = this.getLastUserAttachments(req)
      const prompt = this.getLastUserContent(req) || (attachments.length > 0 ? 'Analyze the attached image.' : '')
      let imageFiles: string[] | undefined

      if (attachments.length > 0) {
        const saved = await saveAttachmentsToTempFiles(attachments)
        attachTempDir = saved.tempDir
        imageFiles = saved.files
      }

      const result = await runCodexExec(prompt, {
        model,
        systemPrompt: req.system,
        thinkingMode: req.thinkingMode,
        thinkingBudgetTokens: req.thinkingBudgetTokens,
        effort: req.effort,
        imageFiles,
      })

      if (result.error) {
        yield { type: 'error', content: result.error }
      } else if (result.text) {
        yield { type: 'text', content: result.text }
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      yield { type: 'error', content: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      if (attachTempDir) await cleanupDir(attachTempDir).catch(() => {})
    }
  }

  async generate(req: ChatRequest, model?: string): Promise<{ text?: string; error?: string }> {
    let attachTempDir: string | undefined

    try {
      const attachments = this.getLastUserAttachments(req)
      const prompt = this.getLastUserContent(req) || ''
      let imageFiles: string[] | undefined

      if (attachments.length > 0) {
        const saved = await saveAttachmentsToTempFiles(attachments)
        attachTempDir = saved.tempDir
        imageFiles = saved.files
      }

      return await runCodexExec(prompt, {
        model,
        systemPrompt: req.system,
        thinkingMode: req.thinkingMode,
        thinkingBudgetTokens: req.thinkingBudgetTokens,
        effort: req.effort,
        imageFiles,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      if (attachTempDir) await cleanupDir(attachTempDir).catch(() => {})
    }
  }

  private async readModelsCache() {
    try {
      const raw = await readFile(join(homedir(), '.codex', 'models_cache.json'), 'utf-8')
      const cache = JSON.parse(raw) as {
        models?: Array<{
          slug: string
          display_name: string
          description: string
          visibility: string
          priority: number
        }>
      }
      if (!cache.models) return []
      return cache.models
        .filter((m) => m.visibility === 'list')
        .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
        .map((m) => ({
          value: m.slug,
          displayName: m.display_name,
          description: m.description ?? '',
          provider: 'openai' as const,
        }))
    } catch {
      return []
    }
  }

  private getLastUserContent(req: ChatRequest): string {
    return [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  }

  private getLastUserAttachments(req: ChatRequest) {
    return [...req.messages].reverse().find((m) => m.role === 'user')?.attachments ?? []
  }
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/providers/codex-provider.test.ts
```

**Step 5: 运行全部测试**

```bash
cd ai-gateway && npx vitest run
```

**Step 6: 提交**

```bash
git add ai-gateway/src/providers/codex-provider.ts ai-gateway/__tests__/providers/codex-provider.test.ts
git commit -m "feat(gateway): implement CodexProvider with connect/chat/generate"
```

---

## 完成检查

- [x] Codex CLI 客户端: 环境变量过滤、参数构建、JSON 解析 + 测试
- [x] CodexProvider connect/chat/generate + 测试
- [x] 伪流式: 等待完成后一次性 yield text
- [x] 图片附件通过 --image 参数传入

**下一步**: 执行 `2026-03-30-ai-gateway-04-opencode.md` 实现 OpenCode Provider
