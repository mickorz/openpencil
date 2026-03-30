# AI Gateway 05 - GitHub Copilot Provider

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 CopilotProvider，通过 `@github/copilot-sdk` 桥接 GitHub Copilot CLI，支持 connect / chat / generate。

**Architecture:** CopilotProvider 继承 BaseProvider，使用独立 copilot 二进制路径（避免 Bun 的 node:sqlite 兼容问题），支持真流式输出（message_delta 事件）。

**Tech Stack:** @github/copilot-sdk

**前置条件:** 计划 01-scaffold 已完成

---

### Task 1: Copilot CLI 路径解析 (copilot-client.ts)

**Files:**
- Create: `ai-gateway/src/utils/copilot-client.ts`

**Step 1: 实现 copilot-client.ts**

```typescript
import { execSync } from 'node:child_process'

/**
 * 解析 copilot CLI 二进制路径
 * 使用独立二进制文件，避免 Bun 的 node:sqlite 兼容问题
 */
export function resolveCopilotCli(): string | undefined {
  try {
    const cmd = process.platform === 'win32' ? 'where copilot 2>nul' : 'which copilot 2>/dev/null'
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim()
    const path = result.split(/\r?\n/)[0]?.trim()
    return path || undefined
  } catch {
    return undefined
  }
}
```

**Step 2: 提交**

```bash
git add ai-gateway/src/utils/copilot-client.ts
git commit -m "feat(gateway): add Copilot CLI binary resolver"
```

---

### Task 2: 实现 CopilotProvider

**Files:**
- Modify: `ai-gateway/src/providers/copilot-provider.ts` (替换占位)
- Test: `ai-gateway/__tests__/providers/copilot-provider.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/utils/copilot-client', () => ({
  resolveCopilotCli: vi.fn().mockReturnValue('/usr/local/bin/copilot'),
}))

describe('CopilotProvider', () => {
  it('connect returns notInstalled when CLI not found', async () => {
    const { resolveCopilotCli } = await import('../../src/utils/copilot-client')
    ;(resolveCopilotCli as any).mockReturnValueOnce(undefined)

    const { CopilotProvider } = await import('../../src/providers/copilot-provider')
    const provider = new CopilotProvider({ enabled: true })
    const result = await provider.connect()

    expect(result.connected).toBe(false)
    expect(result.notInstalled).toBe(true)
  })

  it('mapReasoningEffort maps max to xhigh', async () => {
    const { mapCopilotReasoningEffort } = await import('../../src/providers/copilot-provider')
    expect(mapCopilotReasoningEffort('max')).toBe('xhigh')
    expect(mapCopilotReasoningEffort('high')).toBe('high')
    expect(mapCopilotReasoningEffort(undefined)).toBeUndefined()
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/providers/copilot-provider.test.ts
```

**Step 3: 实现 copilot-provider.ts**

```typescript
import { BaseProvider, type ChatRequest, type ConnectResult, type SSEEvent } from './base-provider'
import type { ProviderConfig } from '../config'
import { resolveCopilotCli } from '../utils/copilot-client'

export class CopilotProvider extends BaseProvider {
  readonly name = 'copilot'

  constructor(config: ProviderConfig) { super(config) }

  async connect(): Promise<ConnectResult> {
    const cliPath = resolveCopilotCli()
    if (!cliPath) {
      return { connected: false, models: [], notInstalled: true, error: 'GitHub Copilot CLI not found' }
    }

    try {
      const { CopilotClient } = await import('@github/copilot-sdk')
      const client = new CopilotClient({ autoStart: true, cliPath })
      await client.start()

      let models: ConnectResult['models'] = []
      try {
        const modelList = await client.listModels()
        models = modelList
          .filter((m: any) => !m.policy || m.policy.state === 'enabled')
          .map((m: any) => ({
            value: m.id,
            displayName: m.name,
            description: m.capabilities?.supports?.vision ? 'vision' : '',
            provider: 'copilot' as const,
          }))
      } catch (listErr) {
        await client.stop().catch(() => {})
        const msg = listErr instanceof Error ? listErr.message : 'Failed to list models'
        return { connected: false, models: [], error: this.friendlyError(msg) }
      }

      await client.stop()

      if (models.length === 0) {
        return { connected: false, models: [], error: 'No models found. Run "copilot login" first.' }
      }

      return { connected: true, models }
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Failed to connect'
      return { connected: false, models: [], error: this.friendlyError(raw) }
    }
  }

  async *chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent> {
    let copilotClient: { stop(): Promise<unknown> } | undefined

    try {
      const { CopilotClient, approveAll } = await import('@github/copilot-sdk')
      const cliPath = resolveCopilotCli()
      const client = new CopilotClient({ autoStart: true, ...(cliPath ? { cliPath } : {}) })
      copilotClient = client
      await client.start()

      // 创建流式会话
      const session = await client.createSession({
        ...(model ? { model } : {}),
        streaming: true,
        onPermissionRequest: approveAll,
        systemMessage: { mode: 'replace', content: req.system },
        ...(req.effort ? { reasoningEffort: mapCopilotReasoningEffort(req.effort) } : {}),
      })

      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const prompt = lastUserMsg?.content ?? ''

      // 订阅流式增量事件
      session.on('assistant.message_delta', (event: any) => {
        const deltaContent = event.data?.deltaContent ?? ''
        if (deltaContent) {
          // 直接通过 generator yield (使用 buffer 收集)
          this._deltaBuffer += deltaContent
        }
      })

      this._deltaBuffer = ''
      await session.sendAndWait({ prompt }, 120_000)
      await session.destroy()

      if (this._deltaBuffer) {
        yield { type: 'text', content: this._deltaBuffer }
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      yield { type: 'error', content: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      if (copilotClient) copilotClient.stop().catch(() => {})
    }
  }

  async generate(req: ChatRequest, model?: string): Promise<{ text?: string; error?: string }> {
    let copilotClient: { stop(): Promise<unknown> } | undefined

    try {
      const { CopilotClient, approveAll } = await import('@github/copilot-sdk')
      const cliPath = resolveCopilotCli()
      const client = new CopilotClient({ autoStart: true, ...(cliPath ? { cliPath } : {}) })
      copilotClient = client
      await client.start()

      const session = await client.createSession({
        ...(model ? { model } : {}),
        streaming: true,
        onPermissionRequest: approveAll,
        systemMessage: { mode: 'replace', content: req.system },
        ...(req.effort ? { reasoningEffort: mapCopilotReasoningEffort(req.effort) } : {}),
      })

      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const prompt = lastUserMsg?.content ?? ''

      let fullText = ''
      session.on('assistant.message_delta', (event: any) => {
        fullText += event.data?.deltaContent ?? ''
      })

      await session.sendAndWait({ prompt }, 120_000)
      await session.destroy()

      return fullText ? { text: fullText } : { error: 'No response from Copilot' }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      if (copilotClient) copilotClient.stop().catch(() => {})
    }
  }

  // 用于 chat generator 的增量缓冲
  private _deltaBuffer = ''

  private friendlyError(raw: string): string {
    if (/not found|ENOENT/i.test(raw)) return 'GitHub Copilot CLI not found.'
    if (/not authenticated|authenticate first|auth|unauthenticated|login/i.test(raw)) {
      return 'Not authenticated. Run "copilot login" in your terminal first.'
    }
    if (/timed?\s*out/i.test(raw)) return 'Connection timed out. Please try again.'
    return raw
  }
}

/** 映射通用 effort 到 Copilot 的 ReasoningEffort (使用 xhigh 代替 max) */
export function mapCopilotReasoningEffort(
  effort?: 'low' | 'medium' | 'high' | 'max',
): 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  if (!effort) return undefined
  if (effort === 'max') return 'xhigh'
  return effort
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/providers/copilot-provider.test.ts
```

**Step 5: 运行全部测试**

```bash
cd ai-gateway && npx vitest run
```

**Step 6: 提交**

```bash
git add ai-gateway/src/providers/copilot-provider.ts ai-gateway/src/utils/copilot-client.ts ai-gateway/__tests__/providers/copilot-provider.test.ts
git commit -m "feat(gateway): implement CopilotProvider with connect/chat/generate"
```

---

## 完成检查

- [x] Copilot CLI 二进制路径解析
- [x] CopilotProvider connect/chat/generate + 测试
- [x] 真流式: message_delta 事件订阅
- [x] effort 映射 (max -> xhigh)
- [x] 友好错误映射 (认证、超时等)

**下一步**: 执行 `2026-03-30-ai-gateway-06-routes.md` 实现路由层 + 集成测试 + 启动入口
