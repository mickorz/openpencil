# AI Gateway 04 - OpenCode Provider

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 OpenCodeProvider，通过 `@opencode-ai/sdk` 桥接 OpenCode 服务，支持 connect / chat / generate。

**Architecture:** OpenCodeProvider 继承 BaseProvider，管理 OpenCode 服务端口（复用 4096 或启动临时服务），通过 session 机制交互，支持 reasoning 回退。

**Tech Stack:** @opencode-ai/sdk

**前置条件:** 计划 01-scaffold 已完成

---

### Task 1: OpenCode 客户端管理 (opencode-client.ts)

**Files:**
- Create: `ai-gateway/src/utils/opencode-client.ts`

**Step 1: 实现 opencode-client.ts**

```typescript
/**
 * OpenCode 客户端管理器
 *
 * 端口管理策略:
 *   1. 优先连接已运行的 4096 端口服务
 *   2. 失败则启动临时随机端口服务
 *   3. 跟踪已启动的服务，进程退出时清理
 */

const activeServers = new Set<{ close(): void }>()

function cleanup() {
  for (const server of activeServers) {
    try { server.close() } catch { /* ignore */ }
  }
  activeServers.clear()
}

process.on('beforeExit', cleanup)
process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)

export async function getOpencodeClient() {
  const { createOpencodeClient, createOpencode } = await import('@opencode-ai/sdk/v2')

  // 尝试连接已运行的服务
  try {
    const client = createOpencodeClient()
    await client.config.providers() // 探测连接
    return { client, server: undefined }
  } catch {
    // 启动临时服务
    const oc = await createOpencode({ port: 0 })
    activeServers.add(oc.server)
    return { client: oc.client, server: oc.server }
  }
}

export function releaseOpencodeServer(server: { close(): void } | undefined) {
  if (!server) return
  try { server.close() } catch { /* ignore */ }
  activeServers.delete(server)
}
```

**Step 2: 提交**

```bash
git add ai-gateway/src/utils/opencode-client.ts
git commit -m "feat(gateway): add OpenCode client manager with port reuse"
```

---

### Task 2: 实现 OpenCodeProvider

**Files:**
- Modify: `ai-gateway/src/providers/opencode-provider.ts` (替换占位)
- Test: `ai-gateway/__tests__/providers/opencode-provider.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect, vi } from 'vitest'

// Mock opencode-client
vi.mock('../../src/utils/opencode-client', () => ({
  getOpencodeClient: vi.fn(),
  releaseOpencodeServer: vi.fn(),
}))

// Mock child_process for connect
vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockImplementation((cmd: string) => {
    if (cmd.includes('opencode')) return '/usr/local/bin/opencode'
    throw new Error('not found')
  }),
}))

describe('OpenCodeProvider', () => {
  it('connect returns models from SDK', async () => {
    const { getOpencodeClient } = await import('../../src/utils/opencode-client')
    ;(getOpencodeClient as any).mockResolvedValue({
      client: {
        config: {
          providers: vi.fn().mockResolvedValue({
            data: {
              providers: [
                {
                  id: 'openai',
                  name: 'OpenAI',
                  models: { gpt4o: { id: 'gpt-4o', name: 'GPT-4o' } },
                },
              ],
            },
            error: null,
          }),
        },
      },
      server: undefined,
    })

    const { OpenCodeProvider } = await import('../../src/providers/opencode-provider')
    const provider = new OpenCodeProvider({ enabled: true, port: 4096 })
    const result = await provider.connect()

    expect(result.connected).toBe(true)
    expect(result.models).toHaveLength(1)
    expect(result.models[0].value).toBe('openai/gpt-4o')
    expect(result.models[0].provider).toBe('opencode')
  })

  it('generate returns text from response parts', async () => {
    const { getOpencodeClient } = await import('../../src/utils/opencode-client')
    ;(getOpencodeClient as any).mockResolvedValue({
      client: {
        session: {
          create: vi.fn().mockResolvedValue({ data: { id: 'sess-1' }, error: null }),
          prompt: vi.fn()
            .mockResolvedValueOnce({ error: null }) // noReply system prompt
            .mockResolvedValueOnce({ // actual prompt
              data: { parts: [{ type: 'text', text: 'Generated text' }] },
              error: null,
            }),
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
      model: 'openai/gpt-4o',
    })

    expect(result.text).toBe('Generated text')
  })

  it('generate returns error on session failure', async () => {
    const { getOpencodeClient } = await import('../../src/utils/opencode-client')
    ;(getOpencodeClient as any).mockResolvedValue({
      client: {
        session: {
          create: vi.fn().mockResolvedValue({ data: null, error: 'Session failed' }),
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

    expect(result.error).toContain('Failed to create OpenCode session')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/providers/opencode-provider.test.ts
```

**Step 3: 实现 opencode-provider.ts**

```typescript
import { execSync } from 'node:child_process'
import { BaseProvider, type ChatRequest, type ConnectResult, type SSEEvent } from './base-provider'
import type { ProviderConfig } from '../config'
import { getOpencodeClient, releaseOpencodeServer } from '../utils/opencode-client'

export class OpenCodeProvider extends BaseProvider {
  readonly name = 'opencode'

  constructor(config: ProviderConfig) { super(config) }

  async connect(): Promise<ConnectResult> {
    try {
      // 检查 opencode 是否在 PATH 中
      const whichCmd = process.platform === 'win32' ? 'where opencode 2>nul' : 'which opencode 2>/dev/null || echo ""'
      const whichResult = execSync(whichCmd, { encoding: 'utf-8', timeout: 5000 }).trim()
      if (!whichResult) {
        return { connected: false, models: [], notInstalled: true, error: 'OpenCode CLI not found' }
      }

      const { client, server } = await getOpencodeClient()
      const { data, error } = await client.config.providers()
      releaseOpencodeServer(server)

      if (error) {
        return { connected: false, models: [], error: 'Failed to fetch providers from OpenCode server.' }
      }

      const models: ConnectResult['models'] = []
      for (const provider of data?.providers ?? []) {
        if (!provider.models) continue
        for (const [, model] of Object.entries(provider.models)) {
          models.push({
            value: `${provider.id}/${model.id}`,
            displayName: model.name || model.id,
            description: `via ${provider.name || provider.id}`,
            provider: 'opencode',
          })
        }
      }

      if (models.length === 0) {
        return { connected: false, models: [], error: 'No models configured. Run "opencode" to set up providers.' }
      }

      return { connected: true, models }
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Failed to connect'
      return { connected: false, models: [], error: this.friendlyError(raw) }
    }
  }

  async *chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent> {
    let ocServer: { close(): void } | undefined

    try {
      const { client, server } = await getOpencodeClient()
      const ocClient = client
      ocServer = server

      // 创建会话
      const { data: session, error: sessionError } = await ocClient.session.create({
        title: 'AI Gateway Chat',
      })
      if (sessionError || !session) {
        yield { type: 'error', content: 'Failed to create OpenCode session' }
        return
      }

      // 注入系统提示 (不触发 AI 回复)
      await ocClient.session.prompt({
        sessionID: session.id,
        noReply: true,
        parts: [{ type: 'text', text: req.system }],
      })

      // 构建消息
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const prompt = lastUserMsg?.content ?? ''
      const parsed = this.parseModel(model)

      const parts: Array<Record<string, unknown>> = [
        ...(lastUserMsg?.attachments ?? []).map((a) => ({
          type: 'image',
          url: `data:${a.mediaType};base64,${a.data}`,
        })),
        { type: 'text', text: prompt || 'Analyze these images.' },
      ]

      const promptPayload: Record<string, unknown> = {
        sessionID: session.id,
        ...(parsed ? { model: parsed } : {}),
        parts,
      }

      const { data: result, error: promptError } = await this.promptWithThinking(
        ocClient, promptPayload, req,
      )

      if (promptError) {
        yield { type: 'error', content: 'OpenCode prompt failed' }
        return
      }

      if (result?.parts) {
        for (const part of result.parts) {
          if (part.type === 'text' && 'text' in part) {
            yield { type: 'text', content: part.text }
          }
        }
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      yield { type: 'error', content: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      releaseOpencodeServer(ocServer)
    }
  }

  async generate(req: ChatRequest, model?: string): Promise<{ text?: string; error?: string }> {
    let ocServer: { close(): void } | undefined

    try {
      const { client, server } = await getOpencodeClient()
      const ocClient = client
      ocServer = server

      const { data: session, error: sessionError } = await ocClient.session.create({
        title: 'AI Gateway Generate',
      })
      if (sessionError || !session) {
        return { error: 'Failed to create OpenCode session' }
      }

      await ocClient.session.prompt({
        sessionID: session.id,
        noReply: true,
        parts: [{ type: 'text', text: req.system }],
      })

      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const parsed = this.parseModel(model)

      const parts: Array<Record<string, unknown>> = [
        ...(lastUserMsg?.attachments ?? []).map((a) => ({
          type: 'image',
          url: `data:${a.mediaType};base64,${a.data}`,
        })),
        { type: 'text', text: lastUserMsg?.content ?? '' },
      ]

      const promptPayload: Record<string, unknown> = {
        sessionID: session.id,
        ...(parsed ? { model: parsed } : {}),
        parts,
      }

      const { data: result, error: promptError } = await this.promptWithThinking(
        ocClient, promptPayload, req,
      )

      if (promptError) return { error: 'OpenCode generation failed' }

      const texts: string[] = []
      if (result?.parts) {
        for (const part of result.parts) {
          if (part.type === 'text' && part.text) texts.push(part.text)
        }
      }

      return { text: texts.join('') }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      releaseOpencodeServer(ocServer)
    }
  }

  private parseModel(model?: string): { providerID: string; modelID: string } | undefined {
    if (!model || !model.includes('/')) return undefined
    const idx = model.indexOf('/')
    return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) }
  }

  private async promptWithThinking(
    ocClient: any,
    basePayload: Record<string, unknown>,
    req: ChatRequest,
  ) {
    const reasoning = this.buildReasoning(req)
    if (!reasoning) return await ocClient.session.prompt(basePayload)

    const enhanced = { ...basePayload, reasoning }
    const firstTry = await ocClient.session.prompt(enhanced)
    if (!firstTry.error) return firstTry

    // reasoning 被拒绝，回退
    console.warn('[WARN] [opencode] Reasoning options rejected, retrying without reasoning.')
    return await ocClient.session.prompt(basePayload)
  }

  private buildReasoning(req: ChatRequest): Record<string, unknown> | undefined {
    const reasoning: Record<string, unknown> = {}
    const effort = this.mapEffort(req.effort)
    if (effort) reasoning.effort = effort
    if (req.thinkingMode === 'enabled') reasoning.enabled = true
    else if (req.thinkingMode === 'disabled') reasoning.enabled = false
    if (typeof req.thinkingBudgetTokens === 'number' && req.thinkingBudgetTokens > 0) {
      reasoning.budgetTokens = req.thinkingBudgetTokens
    }
    return Object.keys(reasoning).length > 0 ? reasoning : undefined
  }

  private mapEffort(effort?: string): string | undefined {
    if (!effort) return undefined
    if (effort === 'max') return 'high'
    return effort
  }

  private friendlyError(raw: string): string {
    if (/ECONNREFUSED/i.test(raw)) return 'OpenCode server not running. Start it with "opencode" first.'
    if (/not found|ENOENT/i.test(raw)) return 'OpenCode CLI not found. Please install it first.'
    if (/timed?\s*out/i.test(raw)) return 'Connection timed out. Please try again.'
    return raw
  }
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/providers/opencode-provider.test.ts
```

**Step 5: 运行全部测试**

```bash
cd ai-gateway && npx vitest run
```

**Step 6: 提交**

```bash
git add ai-gateway/src/providers/opencode-provider.ts ai-gateway/src/utils/opencode-client.ts ai-gateway/__tests__/providers/opencode-provider.test.ts
git commit -m "feat(gateway): implement OpenCodeProvider with connect/chat/generate"
```

---

## 完成检查

- [x] OpenCode 客户端管理器 (端口复用/临时服务)
- [x] OpenCodeProvider connect/chat/generate + 测试
- [x] Session 机制 (创建 -> 注入系统提示 -> 发送 prompt)
- [x] Reasoning 回退机制
- [x] 友好错误映射

**下一步**: 执行 `2026-03-30-ai-gateway-05-copilot.md` 实现 Copilot Provider
