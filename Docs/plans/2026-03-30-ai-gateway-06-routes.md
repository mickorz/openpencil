# AI Gateway 06 - 路由层 + 集成测试 + 启动入口完善

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现三个 Fastify 路由 (connect, chat, generate)，编写集成测试，完善启动入口。

**Architecture:** 路由层极薄：参数验证 -> 查找 provider -> 调用方法 -> 返回结果。chat 路由使用 SSE 流，connect/generate 返回 JSON。集成测试注入 mock provider。

**Tech Stack:** Fastify, Vitest

**前置条件:** 计划 01-05 全部完成

---

### Task 1: Connect 路由 (connect.ts)

**Files:**
- Modify: `ai-gateway/src/routes/connect.ts` (替换占位)
- Test: `ai-gateway/__tests__/integration/connect.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock provider
const mockConnect = vi.fn()

vi.mock('../../src/providers/index', () => ({
  getProvider: vi.fn().mockImplementation((name: string) => {
    if (name === 'claude') return { name: 'claude', connect: mockConnect }
    return undefined
  }),
  listProviders: vi.fn().mockReturnValue(['claude']),
}))

describe('POST /api/connect', () => {
  let app: any

  beforeAll(async () => {
    const { default: Fastify } = await import('fastify')
    const { connectRoute } = await import('../../src/routes/connect')
    app = Fastify()
    app.register(connectRoute)
    await app.ready()
  })

  it('returns connected for valid provider', async () => {
    mockConnect.mockResolvedValueOnce({
      connected: true,
      models: [{ value: 'claude-sonnet-4', displayName: 'Sonnet 4', description: 'Fast', provider: 'anthropic' }],
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/connect',
      payload: { agent: 'claude' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.connected).toBe(true)
    expect(body.models).toHaveLength(1)
  })

  it('returns 400 for missing agent', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/connect',
      payload: {},
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns error for unknown agent', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/connect',
      payload: { agent: 'unknown' },
    })

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body.error).toContain('not available')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/integration/connect.test.ts
```

**Step 3: 实现 connect.ts**

```typescript
import type { FastifyInstance } from 'fastify'
import { getProvider } from '../providers'

interface ConnectBody {
  agent: string
}

export async function connectRoute(app: FastifyInstance) {
  app.post('/api/connect', async (request, reply) => {
    const body = request.body as ConnectBody

    if (!body?.agent) {
      return reply.code(400).send({ error: 'Missing agent field' })
    }

    const provider = getProvider(body.agent)
    if (!provider) {
      return reply.code(400).send({
        connected: false,
        models: [],
        notInstalled: true,
        error: `Provider "${body.agent}" is not available`,
      })
    }

    const result = await provider.connect()
    return reply.send(result)
  })
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/integration/connect.test.ts
```

**Step 5: 提交**

```bash
git add ai-gateway/src/routes/connect.ts ai-gateway/__tests__/integration/connect.test.ts
git commit -m "feat(gateway): implement /api/connect route with provider lookup"
```

---

### Task 2: Chat 路由 (chat.ts)

**Files:**
- Modify: `ai-gateway/src/routes/chat.ts` (替换占位)
- Test: `ai-gateway/__tests__/integration/chat.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock provider with async generator
async function* mockChatGenerator() {
  yield { type: 'text', content: 'Hello' }
  yield { type: 'text', content: ' world' }
  yield { type: 'done', content: '' }
}

vi.mock('../../src/providers/index', () => ({
  getProvider: vi.fn().mockImplementation((name: string) => {
    if (name === 'claude') {
      return { name: 'claude', chat: vi.fn().mockReturnValue(mockChatGenerator()) }
    }
    return undefined
  }),
}))

describe('POST /api/chat', () => {
  let app: any

  beforeAll(async () => {
    const { default: Fastify } = await import('fastify')
    const { chatRoute } = await import('../../src/routes/chat')
    app = Fastify()
    app.register(chatRoute)
    await app.ready()
  })

  it('streams SSE events', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'content-type': 'application/json' },
      payload: {
        provider: 'claude',
        model: 'claude-sonnet-4',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    })

    expect(response.statusCode).toBe(200)
    const body = response.body
    expect(body).toContain('"type":"text"')
    expect(body).toContain('"content":"Hello"')
    expect(body).toContain('"type":"done"')
  })

  it('returns 400 for missing provider', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns 400 for missing model', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        provider: 'claude',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    })

    expect(response.statusCode).toBe(400)
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/integration/chat.test.ts
```

**Step 3: 实现 chat.ts**

```typescript
import type { FastifyInstance } from 'fastify'
import { getProvider } from '../providers'
import { formatSSE, createKeepAlive } from '../utils/sse'
import type { ChatRequest } from '../providers/base-provider'

export async function chatRoute(app: FastifyInstance) {
  app.post<{ Body: ChatRequest }>('/api/chat', async (request, reply) => {
    const body = request.body as ChatRequest

    // 参数验证
    if (!body?.system || !body?.messages) {
      return reply.code(400).send({ error: 'Missing required fields: system, messages' })
    }
    if (!body.provider) {
      return reply.code(400).send({ error: 'Missing provider' })
    }
    if (!body.model?.trim()) {
      return reply.code(400).send({ error: 'Missing model' })
    }

    const provider = getProvider(body.provider)
    if (!provider) {
      return reply.code(400).send({ error: `Provider "${body.provider}" is not available` })
    }

    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    // Keep-alive 心跳
    const ka = createKeepAlive(() => {
      try {
        reply.raw.write(formatSSE({ type: 'ping', content: '' }))
      } catch { /* stream closed */ }
    })

    try {
      for await (const event of provider.chat(body, body.model)) {
        ka.stop()
        reply.raw.write(formatSSE(event))
        if (event.type === 'done' || event.type === 'error') break
      }
    } catch (error) {
      reply.raw.write(formatSSE({
        type: 'error',
        content: error instanceof Error ? error.message : 'Unknown error',
      }))
    } finally {
      ka.stop()
      reply.raw.end()
    }

    return reply
  })
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/integration/chat.test.ts
```

**Step 5: 提交**

```bash
git add ai-gateway/src/routes/chat.ts ai-gateway/__tests__/integration/chat.test.ts
git commit -m "feat(gateway): implement /api/chat SSE streaming route"
```

---

### Task 3: Generate 路由 (generate.ts)

**Files:**
- Modify: `ai-gateway/src/routes/generate.ts` (替换占位)
- Test: `ai-gateway/__tests__/integration/generate.test.ts`

**Step 1: 写测试**

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest'

vi.mock('../../src/providers/index', () => ({
  getProvider: vi.fn().mockImplementation((name: string) => {
    if (name === 'codex') {
      return {
        name: 'codex',
        generate: vi.fn().mockResolvedValue({ text: 'Generated response' }),
      }
    }
    return undefined
  }),
}))

describe('POST /api/generate', () => {
  let app: any

  beforeAll(async () => {
    const { default: Fastify } = await import('fastify')
    const { generateRoute } = await import('../../src/routes/generate')
    app = Fastify()
    app.register(generateRoute)
    await app.ready()
  })

  it('returns generated text', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        provider: 'codex',
        model: 'gpt-4o',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.text).toBe('Generated response')
  })

  it('returns 400 for missing provider', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns error when provider fails', async () => {
    const { getProvider } = await import('../../src/providers/index')
    const provider = (getProvider as any)('codex')
    provider.generate.mockResolvedValueOnce({ error: 'Codex failed' })

    const response = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: {
        provider: 'codex',
        model: 'gpt-4o',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().error).toBe('Codex failed')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/integration/generate.test.ts
```

**Step 3: 实现 generate.ts**

```typescript
import type { FastifyInstance } from 'fastify'
import { getProvider } from '../providers'
import type { GenerateRequest } from '../providers/base-provider'

export async function generateRoute(app: FastifyInstance) {
  app.post<{ Body: GenerateRequest }>('/api/generate', async (request, reply) => {
    const body = request.body as GenerateRequest

    if (!body?.system || !body?.messages) {
      return reply.code(400).send({ error: 'Missing required fields: system, messages' })
    }
    if (!body.provider) {
      return reply.code(400).send({ error: 'Missing provider' })
    }
    if (!body.model?.trim()) {
      return reply.code(400).send({ error: 'Missing model' })
    }

    const provider = getProvider(body.provider)
    if (!provider) {
      return reply.code(400).send({ error: `Provider "${body.provider}" is not available` })
    }

    const result = await provider.generate(body, body.model)
    return reply.send(result)
  })
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/integration/generate.test.ts
```

**Step 5: 提交**

```bash
git add ai-gateway/src/routes/generate.ts ai-gateway/__tests__/integration/generate.test.ts
git commit -m "feat(gateway): implement /api/generate route"
```

---

### Task 4: 更新启动入口 (index.ts)

**Files:**
- Modify: `ai-gateway/src/index.ts`

**Step 1: 更新 index.ts 为最终版本**

```typescript
import Fastify from 'fastify'
import { loadConfig } from './config'
import { registerProviders, listProviders } from './providers'
import { connectRoute } from './routes/connect'
import { chatRoute } from './routes/chat'
import { generateRoute } from './routes/generate'

/**
 * AI Gateway 启动入口
 *
 * 启动流程:
 * Fastify()
 *   |-- loadConfig()          读取 config.json
 *   |-- registerProviders()   注册启用的 provider
 *   |-- registerRoutes()      注册 API 路由
 *   |-- listen()              启动 HTTP 服务
 */

async function main() {
  const config = loadConfig('config.json')

  const app = Fastify({ logger: false })

  // 注册 providers
  await registerProviders(config)
  const activeProviders = listProviders()
  console.log(`[INFO] 已注册 ${activeProviders.length} 个 provider: ${activeProviders.join(', ')}`)

  // 注册路由
  app.register(connectRoute)
  app.register(chatRoute)
  app.register(generateRoute)

  // 健康检查
  app.get('/health', async () => ({
    status: 'ok',
    providers: activeProviders,
  }))

  // 启动服务
  const { port, host } = config.server
  await app.listen({ port, host })
  console.log(`[INFO] AI Gateway 服务已启动: http://${host}:${port}`)
  console.log(`[INFO] 健康检查: http://${host}:${port}/health`)
}

main().catch((err) => {
  console.error('[ERROR] 启动失败:', err)
  process.exit(1)
})
```

**Step 2: 类型检查**

```bash
cd ai-gateway && npx tsc --noEmit
```

Expected: 无错误

**Step 3: 运行全部测试**

```bash
cd ai-gateway && npx vitest run
```

Expected: ALL PASS

**Step 4: 提交**

```bash
git add ai-gateway/src/index.ts
git commit -m "feat(gateway): finalize entry point with all routes"
```

---

## 完成检查

全部 6 个计划完成后应具备：

- [x] 项目脚手架 + 配置 + 基类 + 工具函数 (计划 01)
- [x] ClaudeProvider + CLI 解析 + 环境变量 (计划 02)
- [x] CodexProvider + 子进程客户端 + JSON 解析 (计划 03)
- [x] OpenCodeProvider + 端口管理 + Session (计划 04)
- [x] CopilotProvider + 流式输出 + Effort 映射 (计划 05)
- [x] 路由层 + 集成测试 + 启动入口 (计划 06)

**最终验证命令:**

```bash
cd ai-gateway && npx tsc --noEmit && npx vitest run
```

两个命令都通过即可认为项目完成。
