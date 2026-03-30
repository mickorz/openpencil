# AI Gateway 01 - 项目脚手架 + 配置 + 基类 + 工具函数

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 搭建 ai-gateway 项目骨架，包括 package.json、TypeScript 配置、配置加载、Provider 基类、SSE 工具、临时文件工具及其测试。

**Architecture:** 独立 Node.js + TypeScript + Fastify 项目，Provider 适配器模式。本阶段只搭建框架，不涉及具体 Provider 实现。

**Tech Stack:** Node.js, TypeScript (strict), Fastify, Vitest

---

### Task 1: 初始化项目 + package.json + tsconfig

**Files:**
- Create: `ai-gateway/package.json`
- Create: `ai-gateway/tsconfig.json`

**Step 1: 创建项目目录并初始化**

```bash
mkdir -p ai-gateway/src/providers ai-gateway/src/routes ai-gateway/src/utils
mkdir -p ai-gateway/__tests__/providers ai-gateway/__tests__/utils ai-gateway/__tests__/integration
```

**Step 2: 创建 package.json**

```json
{
  "name": "ai-gateway",
  "version": "1.0.0",
  "description": "AI CLI gateway service - unified REST/SSE API for Claude Code, Codex, OpenCode, Copilot",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "fastify": "^5.3.3"
  },
  "devDependencies": {
    "typescript": "^5.8.2",
    "tsx": "^4.19.3",
    "vitest": "^3.1.1",
    "@types/node": "^22.14.0"
  }
}
```

**Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

**Step 4: 安装依赖**

```bash
cd ai-gateway && npm install
```

**Step 5: 创建默认配置文件**

Create: `ai-gateway/config.json`

```json
{
  "server": {
    "port": 4000,
    "host": "127.0.0.1"
  },
  "providers": {
    "claude": { "enabled": true, "timeoutMs": 120000, "debugLog": true },
    "codex": { "enabled": true, "timeoutMs": 900000 },
    "opencode": { "enabled": true, "port": 4096 },
    "copilot": { "enabled": true }
  },
  "logging": { "level": "info" }
}
```

**Step 6: 创建 vitest.config.ts**

Create: `ai-gateway/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*.test.ts'],
  },
})
```

**Step 7: 提交**

```bash
git add ai-gateway/
git commit -m "chore: scaffold ai-gateway project with fastify + vitest"
```

---

### Task 2: 配置加载模块 (config.ts)

**Files:**
- Create: `ai-gateway/src/config.ts`
- Test: `ai-gateway/__tests__/config.test.ts`

**Step 1: 写测试**

Create: `ai-gateway/__tests__/config.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'

// mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

describe('loadConfig', () => {
  beforeEach(() => { vi.resetModules() })

  it('loads valid config.json', async () => {
    const mockConfig = {
      server: { port: 4000, host: '127.0.0.1' },
      providers: {
        claude: { enabled: true, timeoutMs: 120000 },
        codex: { enabled: false },
      },
      logging: { level: 'info' },
    }
    ;(readFile as any).mockResolvedValue(JSON.stringify(mockConfig))

    const { loadConfig } = await import('../src/config')
    const config = loadConfig('config.json')

    expect(config.server.port).toBe(4000)
    expect(config.providers.claude.enabled).toBe(true)
    expect(config.providers.codex.enabled).toBe(false)
  })

  it('returns defaults when file not found', async () => {
    ;(readFile as any).mockRejectedValue(new Error('ENOENT'))

    const { loadConfig } = await import('../src/config')
    const config = loadConfig('nonexistent.json')

    expect(config.server.port).toBe(4000)
    expect(config.server.host).toBe('127.0.0.1')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/config.test.ts
```

Expected: FAIL - `loadConfig` 不存在

**Step 3: 实现 config.ts**

Create: `ai-gateway/src/config.ts`

```typescript
import { readFile } from 'node:fs/promises'

export interface ServerConfig {
  port: number
  host: string
}

export interface ProviderConfig {
  enabled: boolean
  timeoutMs?: number
  debugLog?: boolean
  port?: number
}

export interface LoggingConfig {
  level: 'info' | 'warn' | 'error'
}

export interface AppConfig {
  server: ServerConfig
  providers: {
    claude?: ProviderConfig
    codex?: ProviderConfig
    opencode?: ProviderConfig
    copilot?: ProviderConfig
  }
  logging: LoggingConfig
}

const DEFAULT_CONFIG: AppConfig = {
  server: { port: 4000, host: '127.0.0.1' },
  providers: {
    claude: { enabled: false },
    codex: { enabled: false },
    opencode: { enabled: false },
    copilot: { enabled: false },
  },
  logging: { level: 'info' },
}

export function loadConfig(configPath: string): AppConfig {
  // 同步读取 - 使用 require 缓存或直接 JSON.parse
  try {
    // @ts-ignore - 动态 require JSON
    const raw = require(configPath)
    return {
      server: { ...DEFAULT_CONFIG.server, ...raw.server },
      providers: { ...DEFAULT_CONFIG.providers, ...raw.providers },
      logging: { ...DEFAULT_CONFIG.logging, ...raw.logging },
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

// 异步版本供测试使用
export async function loadConfigAsync(configPath: string): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      server: { ...DEFAULT_CONFIG.server, ...parsed.server },
      providers: { ...DEFAULT_CONFIG.providers, ...parsed.providers },
      logging: { ...DEFAULT_CONFIG.logging, ...parsed.logging },
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/config.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add ai-gateway/src/config.ts ai-gateway/__tests__/config.test.ts
git commit -m "feat(gateway): add config loader with defaults"
```

---

### Task 3: Provider 基类 (base-provider.ts)

**Files:**
- Create: `ai-gateway/src/providers/base-provider.ts`

**Step 1: 实现基类**

Create: `ai-gateway/src/providers/base-provider.ts`

```typescript
/**
 * Provider 基类定义
 *
 * 所有 AI 提供商的统一接口:
 * BaseProvider
 *   |-- connect()     检测 CLI 可用性 + 获取模型列表
 *   |-- chat()        流式聊天 (AsyncGenerator)
 *   |-- generate()    非流式生成 (Promise)
 */

// SSE 统一事件格式
export interface SSEEvent {
  type: 'ping' | 'text' | 'thinking' | 'error' | 'done'
  content: string
}

// 连接检测结果
export interface ConnectResult {
  connected: boolean
  models: ModelInfo[]
  error?: string
  notInstalled?: boolean
}

// 模型信息
export interface ModelInfo {
  value: string
  displayName: string
  description: string
  provider: string
}

// 聊天/生成请求
export interface ChatRequest {
  provider: string
  system: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    attachments?: Attachment[]
  }>
  model?: string
  thinkingMode?: 'adaptive' | 'disabled' | 'enabled'
  thinkingBudgetTokens?: number
  effort?: 'low' | 'medium' | 'high' | 'max'
}

export type GenerateRequest = ChatRequest

// 附件
export interface Attachment {
  name: string
  mediaType: string
  data: string // base64
}

import type { ProviderConfig } from '../config'

// 抽象基类
export abstract class BaseProvider {
  abstract readonly name: string
  protected readonly config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
  }

  abstract connect(): Promise<ConnectResult>
  abstract chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent>
  abstract generate(
    req: GenerateRequest,
    model?: string,
  ): Promise<{ text?: string; error?: string }>
}
```

**Step 2: 提交**

```bash
git add ai-gateway/src/providers/base-provider.ts
git commit -m "feat(gateway): add BaseProvider abstract class with SSE types"
```

---

### Task 4: SSE 工具函数 (sse.ts)

**Files:**
- Create: `ai-gateway/src/utils/sse.ts`
- Test: `ai-gateway/__tests__/utils/sse.test.ts`

**Step 1: 写测试**

Create: `ai-gateway/__tests__/utils/sse.test.ts`

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatSSE, createKeepAlive, ALLOWED_MEDIA_TYPES, resolveMediaExtension } from '../../src/utils/sse'

describe('formatSSE', () => {
  it('serializes text event', () => {
    const result = formatSSE({ type: 'text', content: 'hello' })
    expect(result).toBe('data: {"type":"text","content":"hello"}\n\n')
  })

  it('serializes ping event', () => {
    const result = formatSSE({ type: 'ping', content: '' })
    expect(result).toBe('data: {"type":"ping","content":""}\n\n')
  })

  it('serializes done event', () => {
    const result = formatSSE({ type: 'done', content: '' })
    expect(result).toBe('data: {"type":"done","content":""}\n\n')
  })

  it('escapes JSON special characters in content', () => {
    const result = formatSSE({ type: 'text', content: 'line1\nline2' })
    expect(result).toContain('"line1\\nline2"')
  })
})

describe('createKeepAlive', () => {
  afterEach(() => { vi.useRealTimers() })

  it('calls tick at intervals', () => {
    vi.useFakeTimers()
    const tick = vi.fn()
    const ka = createKeepAlive(tick, 1000)

    vi.advanceTimersByTime(3500)
    expect(tick).toHaveBeenCalledTimes(3)

    ka.stop()
  })

  it('stops after calling stop()', () => {
    vi.useFakeTimers()
    const tick = vi.fn()
    const ka = createKeepAlive(tick, 1000)

    vi.advanceTimersByTime(1000)
    ka.stop()
    vi.advanceTimersByTime(5000)
    expect(tick).toHaveBeenCalledTimes(1)
  })
})

describe('resolveMediaExtension', () => {
  it('returns extension for allowed types', () => {
    expect(resolveMediaExtension('image/png')).toBe('png')
    expect(resolveMediaExtension('image/jpeg')).toBe('jpeg')
    expect(resolveMediaExtension('image/webp')).toBe('webp')
  })

  it('returns png for disallowed types', () => {
    expect(resolveMediaExtension('image/svg+xml')).toBe('png')
    expect(resolveMediaExtension('application/pdf')).toBe('png')
  })
})

describe('ALLOWED_MEDIA_TYPES', () => {
  it('contains expected types', () => {
    expect(ALLOWED_MEDIA_TYPES.has('image/png')).toBe(true)
    expect(ALLOWED_MEDIA_TYPES.has('image/jpeg')).toBe(true)
    expect(ALLOWED_MEDIA_TYPES.has('image/gif')).toBe(true)
    expect(ALLOWED_MEDIA_TYPES.has('image/webp')).toBe(true)
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/utils/sse.test.ts
```

Expected: FAIL

**Step 3: 实现 sse.ts**

Create: `ai-gateway/src/utils/sse.ts`

```typescript
import type { SSEEvent } from '../providers/base-provider'

// 允许的图片 MIME 类型
export const ALLOWED_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

// SSE 事件序列化
export function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

// 根据 MIME 类型解析文件扩展名
export function resolveMediaExtension(mediaType: string): string {
  return ALLOWED_MEDIA_TYPES.has(mediaType) ? mediaType.split('/')[1] : 'png'
}

// Keep-alive 心跳管理
export function createKeepAlive(
  tick: () => void,
  intervalMs = 15_000,
): { stop: () => void } {
  const timer = setInterval(tick, intervalMs)
  return {
    stop() {
      clearInterval(timer)
    },
  }
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/utils/sse.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add ai-gateway/src/utils/sse.ts ai-gateway/__tests__/utils/sse.test.ts
git commit -m "feat(gateway): add SSE utils with format, keepalive, media type"
```

---

### Task 5: 临时文件工具 (temp-files.ts)

**Files:**
- Create: `ai-gateway/src/utils/temp-files.ts`
- Test: `ai-gateway/__tests__/utils/temp-files.test.ts`

**Step 1: 写测试**

Create: `ai-gateway/__tests__/utils/temp-files.test.ts`

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveAttachmentsToTempFiles, cleanupDir } from '../../src/utils/temp-files'

describe('saveAttachmentsToTempFiles', () => {
  const dirsToCleanup: string[] = []

  afterEach(async () => {
    for (const dir of dirsToCleanup) {
      await cleanupDir(dir).catch(() => {})
    }
    dirsToCleanup.length = 0
  })

  it('saves base64 attachments to temp files', async () => {
    const attachments = [
      { name: 'test.png', mediaType: 'image/png', data: 'aGVsbG8=' },
    ]
    const { tempDir, files } = await saveAttachmentsToTempFiles(attachments)
    dirsToCleanup.push(tempDir)

    expect(files).toHaveLength(1)
    expect(existsSync(files[0])).toBe(true)
    expect(files[0]).toMatch(/0\.png$/)
    expect(readFileSync(files[0]).toString()).toBe('hello')
  })

  it('saves multiple attachments with correct extensions', async () => {
    const attachments = [
      { name: 'a.png', mediaType: 'image/png', data: 'YQ==' },
      { name: 'b.jpg', mediaType: 'image/jpeg', data: 'Yg==' },
    ]
    const { tempDir, files } = await saveAttachmentsToTempFiles(attachments)
    dirsToCleanup.push(tempDir)

    expect(files).toHaveLength(2)
    expect(files[0]).toMatch(/0\.png$/)
    expect(files[1]).toMatch(/1\.jpeg$/)
  })

  it('uses fallback extension for unknown media types', async () => {
    const attachments = [
      { name: 'f.svg', mediaType: 'image/svg+xml', data: 'Zg==' },
    ]
    const { tempDir, files } = await saveAttachmentsToTempFiles(attachments)
    dirsToCleanup.push(tempDir)

    expect(files[0]).toMatch(/0\.png$/)
  })

  it('creates temp dir inside project when insideProject=true', async () => {
    const attachments = [
      { name: 'test.png', mediaType: 'image/png', data: 'dGVzdA==' },
    ]
    const { tempDir, files } = await saveAttachmentsToTempFiles(attachments, true)
    dirsToCleanup.push(tempDir)

    expect(tempDir).toContain('.gateway-tmp')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/utils/temp-files.test.ts
```

Expected: FAIL

**Step 3: 实现 temp-files.ts**

Create: `ai-gateway/src/utils/temp-files.ts`

```typescript
import { mkdirSync, chmodSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveMediaExtension } from './sse'

interface Attachment {
  name: string
  mediaType: string
  data: string // base64
}

export async function saveAttachmentsToTempFiles(
  attachments: Attachment[],
  insideProject = false,
): Promise<{ tempDir: string; files: string[] }> {
  let tempDir: string

  if (insideProject) {
    // 保存到项目目录内，供 Claude Code Agent SDK (plan 模式) 读取
    const baseDir = join(process.cwd(), '.gateway-tmp')
    mkdirSync(baseDir, { recursive: true })
    chmodSync(baseDir, 0o700)
    tempDir = await mkdtemp(join(baseDir, 'attach-'))
  } else {
    tempDir = await mkdtemp(join(tmpdir(), 'ai-gateway-attach-'))
  }

  const files: string[] = []
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i]
    const ext = resolveMediaExtension(att.mediaType)
    const filePath = join(tempDir, `${i}.${ext}`)
    await writeFile(filePath, Buffer.from(att.data, 'base64'))
    files.push(filePath)
  }

  return { tempDir, files }
}

export async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
```

**Step 4: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/utils/temp-files.test.ts
```

Expected: PASS

**Step 5: 提交**

```bash
git add ai-gateway/src/utils/temp-files.ts ai-gateway/__tests__/utils/temp-files.test.ts
git commit -m "feat(gateway): add temp file utils for attachment management"
```

---

### Task 6: Provider 注册表 (providers/index.ts)

**Files:**
- Create: `ai-gateway/src/providers/index.ts`
- Test: `ai-gateway/__tests__/providers/registry.test.ts`

**Step 1: 写测试**

Create: `ai-gateway/__tests__/providers/registry.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'

// Mock 四个 provider 构造函数
vi.mock('../../src/providers/claude-provider', () => ({
  ClaudeProvider: vi.fn().mockImplementation(() => ({ name: 'claude' })),
}))
vi.mock('../../src/providers/codex-provider', () => ({
  CodexProvider: vi.fn().mockImplementation(() => ({ name: 'codex' })),
}))
vi.mock('../../src/providers/opencode-provider', () => ({
  OpenCodeProvider: vi.fn().mockImplementation(() => ({ name: 'opencode' })),
}))
vi.mock('../../src/providers/copilot-provider', () => ({
  CopilotProvider: vi.fn().mockImplementation(() => ({ name: 'copilot' })),
}))

describe('provider registry', () => {
  it('registers enabled providers', async () => {
    const { registerProviders, getProvider, listProviders } = await import('../../src/providers/index')
    const config = {
      server: { port: 4000, host: '127.0.0.1' },
      providers: {
        claude: { enabled: true },
        codex: { enabled: true },
        opencode: { enabled: false },
        copilot: { enabled: false },
      },
      logging: { level: 'info' as const },
    }

    registerProviders(config)

    expect(getProvider('claude')).toBeDefined()
    expect(getProvider('codex')).toBeDefined()
    expect(getProvider('opencode')).toBeUndefined()
    expect(getProvider('copilot')).toBeUndefined()
    expect(listProviders()).toEqual(['claude', 'codex'])
  })

  it('returns undefined for unknown provider', async () => {
    const { getProvider } = await import('../../src/providers/index')
    expect(getProvider('unknown')).toBeUndefined()
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd ai-gateway && npx vitest run __tests__/providers/registry.test.ts
```

Expected: FAIL

**Step 3: 实现 providers/index.ts**

Create: `ai-gateway/src/providers/index.ts`

```typescript
import type { AppConfig } from '../config'
import type { BaseProvider } from './base-provider'

const registry = new Map<string, BaseProvider>()

export async function registerProviders(config: AppConfig): Promise<void> {
  registry.clear()

  if (config.providers.claude?.enabled) {
    const { ClaudeProvider } = await import('./claude-provider')
    registry.set('claude', new ClaudeProvider(config.providers.claude))
  }
  if (config.providers.codex?.enabled) {
    const { CodexProvider } = await import('./codex-provider')
    registry.set('codex', new CodexProvider(config.providers.codex))
  }
  if (config.providers.opencode?.enabled) {
    const { OpenCodeProvider } = await import('./opencode-provider')
    registry.set('opencode', new OpenCodeProvider(config.providers.opencode))
  }
  if (config.providers.copilot?.enabled) {
    const { CopilotProvider } = await import('./copilot-provider')
    registry.set('copilot', new CopilotProvider(config.providers.copilot))
  }
}

export function getProvider(name: string): BaseProvider | undefined {
  return registry.get(name)
}

export function listProviders(): string[] {
  return Array.from(registry.keys())
}
```

**Step 4: 创建 Provider 占位文件**

为了让注册表 import 不报错，先创建四个占位文件：

Create: `ai-gateway/src/providers/claude-provider.ts`
```typescript
import { BaseProvider } from './base-provider'
import type { ProviderConfig } from '../config'

export class ClaudeProvider extends BaseProvider {
  readonly name = 'claude'
  constructor(config: ProviderConfig) { super(config) }
  async connect() { throw new Error('Not implemented') }
  async *chat() { throw new Error('Not implemented') }
  async generate() { throw new Error('Not implemented') }
}
```

Create: `ai-gateway/src/providers/codex-provider.ts`
```typescript
import { BaseProvider } from './base-provider'
import type { ProviderConfig } from '../config'

export class CodexProvider extends BaseProvider {
  readonly name = 'codex'
  constructor(config: ProviderConfig) { super(config) }
  async connect() { throw new Error('Not implemented') }
  async *chat() { throw new Error('Not implemented') }
  async generate() { throw new Error('Not implemented') }
}
```

Create: `ai-gateway/src/providers/opencode-provider.ts`
```typescript
import { BaseProvider } from './base-provider'
import type { ProviderConfig } from '../config'

export class OpenCodeProvider extends BaseProvider {
  readonly name = 'opencode'
  constructor(config: ProviderConfig) { super(config) }
  async connect() { throw new Error('Not implemented') }
  async *chat() { throw new Error('Not implemented') }
  async generate() { throw new Error('Not implemented') }
}
```

Create: `ai-gateway/src/providers/copilot-provider.ts`
```typescript
import { BaseProvider } from './base-provider'
import type { ProviderConfig } from '../config'

export class CopilotProvider extends BaseProvider {
  readonly name = 'copilot'
  constructor(config: ProviderConfig) { super(config) }
  async connect() { throw new Error('Not implemented') }
  async *chat() { throw new Error('Not implemented') }
  async generate() { throw new Error('Not implemented') }
}
```

**Step 5: 运行测试确认通过**

```bash
cd ai-gateway && npx vitest run __tests__/providers/registry.test.ts
```

Expected: PASS

**Step 6: 运行全部测试确认通过**

```bash
cd ai-gateway && npx vitest run
```

Expected: ALL PASS

**Step 7: 提交**

```bash
git add ai-gateway/src/providers/ ai-gateway/__tests__/providers/
git commit -m "feat(gateway): add provider registry with placeholder providers"
```

---

### Task 7: Fastify 启动入口 (index.ts)

**Files:**
- Create: `ai-gateway/src/index.ts`

**Step 1: 实现 Fastify 入口**

Create: `ai-gateway/src/index.ts`

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
 *   |-- loadConfig()
 *   |-- registerProviders()
 *   |-- registerRoutes()
 *   |-- listen()
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
  app.get('/health', async () => ({ status: 'ok', providers: activeProviders }))

  // 启动服务
  const { port, host } = config.server
  await app.listen({ port, host })
  console.log(`[INFO] AI Gateway 服务已启动: http://${host}:${port}`)
}

main().catch((err) => {
  console.error('[ERROR] 启动失败:', err)
  process.exit(1)
})
```

**Step 2: 创建路由占位文件**

Create: `ai-gateway/src/routes/connect.ts`
```typescript
import type { FastifyInstance } from 'fastify'
export async function connectRoute(app: FastifyInstance) {
  // 占位 - 在 06-routes 计划中实现
}
```

Create: `ai-gateway/src/routes/chat.ts`
```typescript
import type { FastifyInstance } from 'fastify'
export async function chatRoute(app: FastifyInstance) {
  // 占位 - 在 06-routes 计划中实现
}
```

Create: `ai-gateway/src/routes/generate.ts`
```typescript
import type { FastifyInstance } from 'fastify'
export async function generateRoute(app: FastifyInstance) {
  // 占位 - 在 06-routes 计划中实现
}
```

**Step 3: 类型检查确认无报错**

```bash
cd ai-gateway && npx tsc --noEmit
```

Expected: 无错误

**Step 4: 提交**

```bash
git add ai-gateway/src/index.ts ai-gateway/src/routes/
git commit -m "feat(gateway): add Fastify entry point with route placeholders"
```

---

## 完成检查

本计划完成后应具备：

- [x] 项目脚手架 (package.json, tsconfig, vitest)
- [x] 配置加载模块 + 测试
- [x] Provider 基类 + 类型定义
- [x] SSE 工具函数 + 测试
- [x] 临时文件工具 + 测试
- [x] Provider 注册表 + 测试
- [x] Fastify 启动入口 + 路由占位
- [x] 四个 Provider 占位文件

**下一步**: 执行 `2026-03-30-ai-gateway-02-claude.md` 实现 Claude Provider
