# AI Gateway 02 - Claude Code CLI Provider

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 ClaudeProvider，通过 `@anthropic-ai/claude-agent-sdk` 桥接 Claude Code CLI，支持 connect / chat / generate。

**Architecture:** ClaudeProvider 继承 BaseProvider，包含三个辅助模块：CLI 路径解析、环境变量构建、错误诊断。chat() 支持纯文本流式和图片附件 result-based 两种模式。

**Tech Stack:** @anthropic-ai/claude-agent-sdk, Node.js child_process

**前置条件:** 计划 01-scaffold 已完成

---

### Task 1: CLI 路径解析 (resolve-claude-cli.ts)

**Files:**
- Create: `ai-gateway/src/utils/resolve-claude-cli.ts`
- Test: `ai-gateway/__tests__/utils/resolve-claude-cli.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeClaudeCliPath } from '../../src/utils/resolve-claude-cli'

describe('normalizeClaudeCliPath', () => {
  it('returns undefined for empty input', () => {
    expect(normalizeClaudeCliPath('', { isWindows: false })).toBeUndefined()
  })

  it('returns undefined when file does not exist', () => {
    expect(
      normalizeClaudeCliPath('/nonexistent/path/claude', {
        isWindows: false,
        existsSyncFn: () => false,
      }),
    ).toBeUndefined()
  })

  it('passes through on Unix when file exists', () => {
    expect(
      normalizeClaudeCliPath('/usr/local/bin/claude', {
        isWindows: false,
        existsSyncFn: () => true,
      }),
    ).toBe('/usr/local/bin/claude')
  })

  it('passes through .exe on Windows', () => {
    expect(
      normalizeClaudeCliPath('C:\\Programs\\claude.exe', {
        isWindows: true,
        existsSyncFn: () => true,
      }),
    ).toBe('C:\\Programs\\claude.exe')
  })

  it('passes through .js on Windows', () => {
    expect(
      normalizeClaudeCliPath('C:\\npm\\cli.js', {
        isWindows: true,
        existsSyncFn: () => true,
      }),
    ).toBe('C:\\npm\\cli.js')
  })

  it('resolves npm shim to cli.js on Windows', () => {
    const existsFn = (p: string) => p.includes('cli.js')
    expect(
      normalizeClaudeCliPath('C:\\npm\\claude', {
        isWindows: true,
        existsSyncFn: existsFn,
      }),
    ).toContain('cli.js')
  })

  it('returns undefined for non-resolvable shim on Windows', () => {
    expect(
      normalizeClaudeCliPath('C:\\npm\\claude', {
        isWindows: true,
        existsSyncFn: () => false,
      }),
    ).toBeUndefined()
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/utils/resolve-claude-cli.test.ts
```

**Step 3: 实现 resolve-claude-cli.ts**

```typescript
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, extname, join } from 'node:path'

const isWindows = platform() === 'win32'

interface NormalizeOptions {
  isWindows?: boolean
  existsSyncFn?: (path: string) => boolean
}

export function normalizeClaudeCliPath(
  candidate: string,
  options: NormalizeOptions = {},
): string | undefined {
  if (!candidate) return undefined

  const exists = options.existsSyncFn ?? existsSync
  const windows = options.isWindows ?? isWindows

  if (!exists(candidate)) return undefined
  if (!windows) return candidate

  const extension = extname(candidate).toLowerCase()
  if (extension === '.exe' || extension === '.js') return candidate

  // Windows npm shim -> 查找真实 cli.js
  const cliJsPath = join(
    dirname(candidate),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'cli.js',
  )
  if (exists(cliJsPath)) return cliJsPath

  return undefined
}

function pickFirst(candidates: string[]): string | undefined {
  for (const c of candidates) {
    const resolved = normalizeClaudeCliPath(c)
    if (resolved) return resolved
  }
  return undefined
}

export function resolveClaudeCli(): string | undefined {
  // 1. PATH 查找
  try {
    const cmd = isWindows ? 'where claude' : 'which claude 2>/dev/null'
    const matches = execSync(cmd, { encoding: 'utf-8', timeout: 3000 })
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const resolved = pickFirst(matches)
    if (resolved) return resolved
  } catch { /* not in PATH */ }

  // 2. 常见安装路径
  const candidates = isWindows
    ? [
        join(process.env.LOCALAPPDATA || '', 'Programs', 'claude-code', 'claude.exe'),
        join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
        join(homedir(), '.claude', 'local', 'claude.exe'),
        join(homedir(), 'AppData', 'Local', 'Programs', 'claude-code', 'claude.exe'),
        join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        join(process.env.APPDATA || '', 'npm', 'claude'),
        join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      ]
    : [
        join(homedir(), '.local', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
      ]

  return pickFirst(candidates)
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/utils/resolve-claude-cli.test.ts
```

**Step 5: 提交**

```bash
git add ai-gateway/src/utils/resolve-claude-cli.ts ai-gateway/__tests__/utils/resolve-claude-cli.test.ts
git commit -m "feat(gateway): add Claude CLI path resolver with Windows npm shim support"
```

---

### Task 2: 环境变量构建 (resolve-claude-agent-env.ts)

**Files:**
- Create: `ai-gateway/src/utils/resolve-claude-agent-env.ts`
- Test: `ai-gateway/__tests__/utils/resolve-claude-agent-env.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}))

describe('buildClaudeAgentEnv', () => {
  beforeEach(() => { vi.resetModules() })

  it('merges settings.json env with process.env', async () => {
    const { readFileSync } = await import('node:fs')
    ;(readFileSync as any).mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
    }))

    const { buildClaudeAgentEnv } = await import('../../src/utils/resolve-claude-agent-env')
    const env = buildClaudeAgentEnv()

    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com')
  })

  it('process.env overrides settings.json', async () => {
    const { readFileSync } = await import('node:fs')
    ;(readFileSync as any).mockReturnValue(JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'https://old.com' },
    }))

    process.env.ANTHROPIC_BASE_URL = 'https://new.com'
    const { buildClaudeAgentEnv } = await import('../../src/utils/resolve-claude-agent-env')
    const env = buildClaudeAgentEnv()

    expect(env.ANTHROPIC_BASE_URL).toBe('https://new.com')
    delete process.env.ANTHROPIC_BASE_URL
  })

  it('removes CLAUDECODE env var', async () => {
    process.env.CLAUDECODE = '1'
    const { buildClaudeAgentEnv } = await import('../../src/utils/resolve-claude-agent-env')
    const env = buildClaudeAgentEnv()

    expect(env.CLAUDECODE).toBeUndefined()
    delete process.env.CLAUDECODE
  })

  it('deletes invalid ANTHROPIC_CUSTOM_HEADERS', async () => {
    process.env.ANTHROPIC_CUSTOM_HEADERS = 'not-json'
    const { buildClaudeAgentEnv } = await import('../../src/utils/resolve-claude-agent-env')
    const env = buildClaudeAgentEnv()

    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    delete process.env.ANTHROPIC_CUSTOM_HEADERS
  })

  it('maps ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-token'
    const { buildClaudeAgentEnv } = await import('../../src/utils/resolve-claude-agent-env')
    const env = buildClaudeAgentEnv()

    expect(env.ANTHROPIC_API_KEY).toBe('test-token')
    delete process.env.ANTHROPIC_AUTH_TOKEN
  })

  it('skips non-string env values from settings', async () => {
    const { readFileSync } = await import('node:fs')
    ;(readFileSync as any).mockReturnValue(JSON.stringify({
      env: { VALID_KEY: 'ok', OBJ_KEY: { nested: true }, NUM_KEY: 123 },
    }))

    const { buildClaudeAgentEnv } = await import('../../src/utils/resolve-claude-agent-env')
    const env = buildClaudeAgentEnv()

    expect(env.VALID_KEY).toBe('ok')
    expect(env.OBJ_KEY).toBeUndefined()
    // numbers are converted to strings
    expect(env.NUM_KEY).toBe('123')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/utils/resolve-claude-agent-env.test.ts
```

**Step 3: 实现 resolve-claude-agent-env.ts**

```typescript
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type EnvLike = Record<string, string | undefined>

interface ClaudeSettings {
  env?: Record<string, unknown>
}

function normalizeEnvValue(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') {
    return value.trim() === '' ? undefined : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return undefined
}

function readClaudeSettingsEnv(): EnvLike {
  try {
    const raw = readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as ClaudeSettings
    if (!parsed.env || typeof parsed.env !== 'object') return {}

    const env: EnvLike = {}
    for (const [key, value] of Object.entries(parsed.env)) {
      const normalized = normalizeEnvValue(value)
      if (normalized !== undefined) env[key] = normalized
    }
    return env
  } catch {
    return {}
  }
}

function isValidJson(str: string): boolean {
  try { JSON.parse(str); return true } catch { return false }
}

export function buildClaudeAgentEnv(): EnvLike {
  const fromSettings = readClaudeSettingsEnv()
  const fromProcess = process.env as EnvLike

  const merged: EnvLike = { ...fromSettings, ...fromProcess }

  // 验证 ANTHROPIC_CUSTOM_HEADERS 是否合法 JSON
  if (merged.ANTHROPIC_CUSTOM_HEADERS && !isValidJson(merged.ANTHROPIC_CUSTOM_HEADERS)) {
    delete merged.ANTHROPIC_CUSTOM_HEADERS
  }

  // 兼容: ANTHROPIC_AUTH_TOKEN -> ANTHROPIC_API_KEY
  if (merged.ANTHROPIC_AUTH_TOKEN && !merged.ANTHROPIC_API_KEY) {
    merged.ANTHROPIC_API_KEY = merged.ANTHROPIC_AUTH_TOKEN
  }

  // 防止嵌套调用
  delete merged.CLAUDECODE

  return merged
}

export function getClaudeAgentDebugFilePath(): string | undefined {
  try {
    const { mkdirSync } = require('node:fs')
    const dir = join('/tmp', 'ai-gateway-claude-debug')
    mkdirSync(dir, { recursive: true })
    return join(dir, 'claude-agent.log')
  } catch {
    return undefined
  }
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/utils/resolve-claude-agent-env.test.ts
```

**Step 5: 提交**

```bash
git add ai-gateway/src/utils/resolve-claude-agent-env.ts ai-gateway/__tests__/utils/resolve-claude-agent-env.test.ts
git commit -m "feat(gateway): add Claude Agent SDK env builder with settings.json merge"
```

---

### Task 3: 实现 ClaudeProvider

**Files:**
- Modify: `ai-gateway/src/providers/claude-provider.ts` (替换占位)
- Test: `ai-gateway/__tests__/providers/claude-provider.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/utils/resolve-claude-cli', () => ({
  resolveClaudeCli: vi.fn().mockReturnValue('/usr/local/bin/claude'),
}))

vi.mock('../../src/utils/resolve-claude-agent-env', () => ({
  buildClaudeAgentEnv: vi.fn().mockReturnValue({}),
  getClaudeAgentDebugFilePath: vi.fn().mockReturnValue(undefined),
}))

// Mock Agent SDK
const mockSupportedModels = vi.fn().mockResolvedValue([
  { value: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', description: 'Fast' },
])
const mockClose = vi.fn()
const mockIterator = (async function* () {})()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn().mockReturnValue({
    supportedModels: mockSupportedModels,
    close: mockClose,
    [Symbol.asyncIterator]: () => mockIterator,
  }),
}))

describe('ClaudeProvider', () => {
  it('connect returns models from Agent SDK', async () => {
    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true, timeoutMs: 120000 })
    const result = await provider.connect()

    expect(result.connected).toBe(true)
    expect(result.models).toHaveLength(1)
    expect(result.models[0].provider).toBe('anthropic')
    expect(result.models[0].value).toBe('claude-sonnet-4-20250514')
  })

  it('connect returns notInstalled when CLI not found', async () => {
    const { resolveClaudeCli } = await import('../../src/utils/resolve-claude-cli')
    ;(resolveClaudeCli as any).mockReturnValueOnce(undefined)

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.notInstalled).toBe(true)
  })

  it('generate returns text from result message', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const mockGen = (async function* () {
      yield { type: 'result', subtype: 'success', result: 'Generated text' }
    })()
    ;(query as any).mockReturnValueOnce({
      close: mockClose,
      [Symbol.asyncIterator]: () => mockGen,
    })

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'claude',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.text).toBe('Generated text')
  })

  it('generate returns error on failure', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const mockGen = (async function* () {
      yield { type: 'result', subtype: 'error', errors: ['Something went wrong'] }
    })()
    ;(query as any).mockReturnValueOnce({
      close: mockClose,
      [Symbol.asyncIterator]: () => mockGen,
    })

    const { ClaudeProvider } = await import('../../src/providers/claude-provider')
    const provider = new ClaudeProvider({ enabled: true })
    const result = await provider.generate({
      provider: 'claude',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.error).toContain('Something went wrong')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/providers/claude-provider.test.ts
```

**Step 3: 实现 claude-provider.ts**

```typescript
import { BaseProvider, type ChatRequest, type ConnectResult, type SSEEvent } from './base-provider'
import type { ProviderConfig } from '../config'
import { resolveClaudeCli } from '../utils/resolve-claude-cli'
import { buildClaudeAgentEnv, getClaudeAgentDebugFilePath } from '../utils/resolve-claude-agent-env'
import { saveAttachmentsToTempFiles, cleanupDir } from '../utils/temp-files'
import { formatSSE } from '../utils/sse'

export class ClaudeProvider extends BaseProvider {
  readonly name = 'claude'

  constructor(config: ProviderConfig) { super(config) }

  async connect(): Promise<ConnectResult> {
    const claudePath = resolveClaudeCli()
    if (!claudePath) {
      return { connected: false, models: [], notInstalled: true, error: 'Claude Code CLI not found' }
    }

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const env = buildClaudeAgentEnv()
      const debugFile = getClaudeAgentDebugFilePath()

      const q = query({
        prompt: '',
        options: {
          maxTurns: 1,
          tools: [],
          permissionMode: 'plan',
          persistSession: false,
          env,
          ...(debugFile ? { debugFile } : {}),
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        },
      })

      const raw = await q.supportedModels()
      q.close()

      const models = raw.map((m: any) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
        provider: 'anthropic' as const,
      }))

      return { connected: true, models }
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Failed to connect'
      return { connected: false, models: [], error: this.friendlyError(raw) }
    }
  }

  async *chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent> {
    const claudePath = resolveClaudeCli()
    const env = buildClaudeAgentEnv()
    const debugFile = getClaudeAgentDebugFilePath()

    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
    let prompt = lastUserMsg?.content ?? ''

    const attachments = lastUserMsg?.attachments ?? []
    const hasImages = attachments.length > 0
    let attachTempDir: string | undefined

    try {
      if (hasImages) {
        // 图片模式: 保存到项目目录，使用 Read 工具
        const saved = await saveAttachmentsToTempFiles(attachments, true)
        attachTempDir = saved.tempDir
        const imageRefs = saved.files
          .map((f) => `First, use the Read tool to read the image file at "${f}". Then analyze it.`)
          .join('\n')
        prompt = imageRefs + '\n\n' + (prompt || 'Describe what you see in the image.')
      }

      const systemPrompt = hasImages ? this.stripNoTools(req.system) : req.system
      const thinking = this.getThinkingConfig(req)

      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const q = query({
        prompt,
        options: {
          systemPrompt,
          ...(model ? { model } : {}),
          maxTurns: hasImages ? 3 : 1,
          includePartialMessages: !hasImages,
          tools: [],
          plugins: [],
          permissionMode: 'plan',
          persistSession: false,
          ...(req.effort ? { effort: req.effort } : {}),
          ...(thinking ? { thinking } : {}),
          env,
          ...(debugFile ? { debugFile } : {}),
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        },
      })

      try {
        for await (const message of q) {
          if (hasImages) {
            // 图片模式: 只等待 result
            if (message.type === 'result') {
              if (message.subtype === 'success') {
                yield { type: 'text', content: message.result ?? '' }
              } else {
                const errors = 'errors' in message ? (message.errors as string[]) : []
                yield { type: 'error', content: errors.join('; ') || message.result || 'Query failed' }
              }
            }
          } else {
            // 文本模式: 流式输出
            if (message.type === 'stream_event') {
              const ev = message.event
              if (ev.type === 'content_block_delta') {
                if (ev.delta.type === 'text_delta') {
                  yield { type: 'text', content: ev.delta.text }
                } else if (ev.delta.type === 'thinking_delta') {
                  yield { type: 'thinking', content: (ev.delta as any).thinking }
                }
              }
            } else if (message.type === 'result' && message.subtype !== 'success') {
              const errors = 'errors' in message ? (message.errors as string[]) : []
              yield { type: 'error', content: errors.join('; ') || 'Query failed' }
            }
          }
        }
      } finally {
        q.close()
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      if (attachTempDir) await cleanupDir(attachTempDir).catch(() => {})
    }
  }

  async generate(req: ChatRequest, model?: string): Promise<{ text?: string; error?: string }> {
    const claudePath = resolveClaudeCli()
    const env = buildClaudeAgentEnv()
    const debugFile = getClaudeAgentDebugFilePath()
    const thinking = this.getThinkingConfig(req)

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')

      const q = query({
        prompt: lastUserMsg?.content ?? '',
        options: {
          systemPrompt: req.system,
          ...(model ? { model } : {}),
          maxTurns: 1,
          tools: [],
          plugins: [],
          permissionMode: 'plan',
          persistSession: false,
          ...(req.effort ? { effort: req.effort } : {}),
          ...(thinking ? { thinking } : {}),
          env,
          ...(debugFile ? { debugFile } : {}),
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        },
      })

      try {
        for await (const message of q) {
          if (message.type === 'result') {
            if (message.subtype === 'success') {
              return { text: message.result ?? '' }
            }
            const errors = 'errors' in message ? (message.errors as string[]) : []
            return { error: errors.join('; ') || message.result || 'Query failed' }
          }
        }
      } finally {
        q.close()
      }

      return { error: 'No result received from Claude Agent SDK' }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private getThinkingConfig(req: ChatRequest) {
    if (!req.thinkingMode) return undefined
    if (req.thinkingMode === 'enabled') {
      return { type: 'enabled' as const, budgetTokens: req.thinkingBudgetTokens }
    }
    return { type: req.thinkingMode }
  }

  private stripNoTools(prompt: string): string {
    return prompt.replace(/^.*NEVER use tools.*$/gim, '').replace(/\n{3,}/g, '\n\n')
  }

  private friendlyError(raw: string): string {
    if (/process exited with code 1|invalid model|unknown model/i.test(raw)) {
      return 'Claude Code exited with code 1. Check model mapping and run "claude login" if needed.'
    }
    if (/exited with code/i.test(raw)) {
      return 'Unable to connect. Claude Code process exited unexpectedly.'
    }
    if (/not found|ENOENT/i.test(raw)) {
      return 'Claude Code CLI not found. Please install it first.'
    }
    if (/timed?\s*out/i.test(raw)) {
      return 'Connection timed out. Please try again.'
    }
    return raw
  }
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/providers/claude-provider.test.ts
```

**Step 5: 运行全部测试**

```bash
cd ai-gateway && npx vitest run
```

**Step 6: 提交**

```bash
git add ai-gateway/src/providers/claude-provider.ts ai-gateway/__tests__/providers/claude-provider.test.ts
git commit -m "feat(gateway): implement ClaudeProvider with connect/chat/generate"
```

---

## 完成检查

- [x] Claude CLI 路径解析 + Windows npm shim 支持 + 测试
- [x] 环境变量构建 (settings.json 合并) + 测试
- [x] ClaudeProvider connect/chat/generate + 测试
- [x] 图片附件处理 (保存到项目目录 + Read 工具)
- [x] 纯文本流式 + thinking 模式支持
- [x] 友好错误映射

**下一步**: 执行 `2026-03-30-ai-gateway-03-codex.md` 实现 Codex Provider
