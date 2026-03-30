# AI Gateway CLI Server - 设计文档

> 日期: 2026-03-30
> 状态: 已批准
> 参考文档: [ClaudeCode与CodexCLI集成架构分析](../../Docs/ClaudeCode与CodexCLI集成架构分析.md)

---

## 1. 项目概述

一个独立的 Node.js + TypeScript Web 服务，作为 AI CLI 工具的统一网关。通过 Fastify 提供 REST/SSE API，桥接四个 AI 提供商：Claude Code CLI、Codex CLI、OpenCode SDK、GitHub Copilot SDK。

### 技术栈

| 技术 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js | 稳定，生态最全 |
| 包管理 | npm | 最通用 |
| Web 框架 | Fastify | 插件生态丰富，内置 Schema 验证 |
| 语言 | TypeScript (strict) | 类型安全 |
| 配置 | config.json | 结构化，支持嵌套配置 |
| 日志 | console.log/warn/error | 够用就好 |
| 测试 | Vitest | 快速，TypeScript 原生支持 |

### 功能范围

仅包含三个核心端点：

1. **POST /api/connect** — 检测 CLI 可用性 + 获取模型列表
2. **POST /api/chat** — 流式聊天（SSE）
3. **POST /api/generate** — 非流式生成

---

## 2. 项目结构

```text
ai-gateway/
  package.json
  tsconfig.json
  config.json                    # 提供商配置
  src/
    index.ts                     # Fastify 启动入口
    config.ts                    # 配置加载 + 类型定义
    providers/
      base-provider.ts           # 抽象基类 + 公共类型
      claude-provider.ts         # Claude Code CLI (Agent SDK)
      codex-provider.ts          # Codex CLI (spawn 子进程)
      opencode-provider.ts       # OpenCode SDK
      copilot-provider.ts        # GitHub Copilot SDK
      index.ts                   # 注册表：name -> Provider 实例
    routes/
      chat.ts                    # POST /api/chat
      connect.ts                 # POST /api/connect
      generate.ts                # POST /api/generate
    utils/
      sse.ts                     # SSE 事件格式化 + keep-alive
      temp-files.ts              # 临时文件管理（创建 + 清理）
  __tests__/
    providers/
      claude-provider.test.ts
      codex-provider.test.ts
      opencode-provider.test.ts
      copilot-provider.test.ts
    utils/
      sse.test.ts
      temp-files.test.ts
    integration/
      connect.test.ts
      chat.test.ts
      generate.test.ts
```

---

## 3. 配置结构

```json
{
  "server": {
    "port": 4000,
    "host": "127.0.0.1"
  },
  "providers": {
    "claude": {
      "enabled": true,
      "timeoutMs": 120000,
      "debugLog": true
    },
    "codex": {
      "enabled": true,
      "timeoutMs": 900000
    },
    "opencode": {
      "enabled": true,
      "port": 4096
    },
    "copilot": {
      "enabled": true
    }
  },
  "logging": {
    "level": "info"
  }
}
```

**设计要点**:
- 每个提供商可独立启用/禁用
- 不存放敏感信息（API Key 由 CLI 工具自身管理）
- `config.ts` 导出 `AppConfig` 类型定义 + `loadConfig()` 加载函数

---

## 4. Provider 适配器架构

### 4.1 基类定义

```typescript
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

export interface ModelInfo {
  value: string
  displayName: string
  description: string
  provider: string
}

// 聊天请求
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

export interface Attachment {
  name: string
  mediaType: string
  data: string  // base64
}

// 抽象基类
export abstract class BaseProvider {
  abstract readonly name: string
  abstract connect(): Promise<ConnectResult>
  abstract chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent>
  abstract generate(req: GenerateRequest, model?: string): Promise<{ text?: string; error?: string }>
}
```

**设计要点**:
- `chat()` 使用 `AsyncGenerator<SSEEvent>` -- 天然适配 SSE 流式推送
- `generate()` 返回普通 Promise -- 简单请求-响应模式
- 所有类型定义在基类文件中，子类直接复用

### 4.2 Provider 注册表

```typescript
// src/providers/index.ts
const registry = new Map<string, BaseProvider>()

export function registerProviders(config: AppConfig): void {
  if (config.providers.claude?.enabled) registry.set('claude', new ClaudeProvider(config))
  if (config.providers.codex?.enabled) registry.set('codex', new CodexProvider(config))
  if (config.providers.opencode?.enabled) registry.set('opencode', new OpenCodeProvider(config))
  if (config.providers.copilot?.enabled) registry.set('copilot', new CopilotProvider(config))
}

export function getProvider(name: string): BaseProvider | undefined {
  return registry.get(name)
}
```

根据 `config.json` 的 `enabled` 字段决定注册哪些 provider。未启用的 provider 请求直接返回错误。

---

## 5. 各 Provider 实现要点

### 5.1 Claude Provider

```
connect()
  resolveClaudeCli()  -- PATH查找 + 常见安装路径
  Agent SDK query().supportedModels()

chat(req, model)
  有图片附件?
    |-- 是: 保存图片到 CWD/.gateway-tmp/
    |      stripNoToolsRestriction()
    |      指示使用 Read 工具, maxTurns=3
    |      等待 result 消息, 一次性 yield text
    |
    |-- 否: includePartialMessages=true, maxTurns=1
            yield text_delta / thinking_delta 事件流

generate(req, model)
  Agent SDK query(), maxTurns=1
  遍历消息取 result, 返回文本
```

**依赖**: `@anthropic-ai/claude-agent-sdk`
**特有逻辑**: 环境变量合并 (~/.claude/settings.json + process.env)、Windows npm shim 路径转换、调试日志错误诊断

### 5.2 Codex Provider

```
connect()
  where/which codex
  codex --version
  读取 ~/.codex/models_cache.json

chat(req, model)
  保存附件到系统临时目录
  spawn('codex', [exec, --json, --sandbox, read-only, ...])
  stdin 管道传入 prompt
  解析 stdout 逐行 JSON
  yield 完整文本 (伪流式)

generate(req, model)
  同 chat 但返回 Promise
  读取 --output-last-message 文件
```

**依赖**: 无额外 SDK，直接 spawn 子进程
**特有逻辑**: filterCodexEnv() 白名单环境变量、Windows shell: true、推理努力程度映射

### 5.3 OpenCode Provider

```
connect()
  where/which opencode
  getOpencodeClient() -- 连接 4096 端口或启动临时服务
  client.config.providers() -- 获取模型列表

chat(req, model)
  创建 session
  注入系统提示 (noReply)
  发送 prompt + 图片附件 (data URI)
  yield 响应 parts 中的文本

generate(req, model)
  同 chat，返回完整文本
```

**依赖**: `@opencode-ai/sdk`
**特有逻辑**: 服务端口管理（复用 4096 / 随机端口）、reasoning 回退机制

### 5.4 Copilot Provider

```
connect()
  resolveCopilotCli()
  CopilotClient.start()
  client.listModels()
  过滤 policy === 'enabled'

chat(req, model)
  CopilotClient 创建流式 session
  订阅 assistant.message_delta 事件
  yield deltaContent (真流式)

generate(req, model)
  同 chat，收集完整文本后返回
```

**依赖**: `@github/copilot-sdk`
**特有逻辑**: 独立二进制路径（避免 Bun 的 node:sqlite）、approveAll 权限、xhigh effort 映射

---

## 6. 路由层设计

### 6.1 POST /api/connect

```typescript
// Body: { agent: 'claude' | 'codex' | 'opencode' | 'copilot' }
// Response: ConnectResult (JSON)
```

从注册表查找 provider 实例，调用 `connect()`，返回结果。provider 未注册时返回 `notInstalled: true`。

### 6.2 POST /api/chat

```typescript
// Body: ChatRequest (含 provider + model 字段)
// Response: SSE 流 (text/event-stream)
```

数据流:
```
前端 POST -> Fastify 路由 -> 验证字段 -> 查找 provider
  -> for await (const event of provider.chat(req, model))
    -> reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
  -> 完成
```

### 6.3 POST /api/generate

```typescript
// Body: GenerateRequest (含 provider + model 字段)
// Response: { text?: string; error?: string } (JSON)
```

调用 `provider.generate(req, model)`，直接返回 JSON 结果。

---

## 7. 公共工具

### 7.1 SSE 工具 (`utils/sse.ts`)

- `formatSSE(event: SSEEvent): string` -- 序列化为 `data: {...}\n\n` 格式
- `createKeepAlive(intervalMs?: number): { tick(): void; stop(): void }` -- 15秒心跳管理
- `ALLOWED_MEDIA_TYPES` -- 允许的图片 MIME 类型集合
- `resolveMediaExtension(mediaType: string): string` -- MIME -> 扩展名

### 7.2 临时文件工具 (`utils/temp-files.ts`)

- `saveAttachmentsToTempFiles(attachments, options?): Promise<{ tempDir, files }>`
  - `insideProject: true` -- 保存到 `CWD/.gateway-tmp/`（Claude Agent SDK plan 模式可访问）
  - `insideProject: false` -- 保存到系统临时目录（Codex 等使用）
- 自动清理：调用方在 `finally` 块中 `rm(tempDir, { recursive: true, force: true })`

---

## 8. 错误处理

### 错误层级

| 层级 | 场景 | 处理方式 |
|------|------|---------|
| 路由层 | 参数缺失/非法 | 直接返回 400 JSON |
| 路由层 | provider 未注册 | 返回 { error: 'Provider not available' } |
| Provider | CLI 未安装 | connect() 返回 { notInstalled: true } |
| Provider | CLI 无响应 | connect() 返回 { connected: false, error } |
| Provider | 执行超时 | chat yield { type: error } |
| Provider | 进程异常 | 解析 stderr + 调试日志，构建友好提示 |

### 友好错误映射

| Provider | 典型错误 | 友好提示 |
|----------|---------|---------|
| Claude | exited with code 1 | 检查模型映射，运行 claude login |
| Claude | EPERM ~/.claude.json | 配置文件权限不足 |
| Codex | ENOENT | Codex CLI 未安装 |
| Codex | 超时 15min | Codex 请求超时 |
| OpenCode | ECONNREFUSED | OpenCode 服务未运行 |
| Copilot | not authenticated | 运行 copilot login |

---

## 9. 日志策略

```
级别:
  [INFO]  服务启动/停止、provider 注册状态
  [WARN]  provider 连接失败、reasoning 回退
  [ERROR] 执行异常、超时、CLI 崩溃

格式: [时间戳] [级别] [provider] 消息
示例: [2026-03-30T10:00:00] [INFO] [claude] 已连接，可用 5 个模型
      [2026-03-30T10:01:00] [WARN] [codex] Codex CLI 未安装，已跳过注册

敏感信息过滤: 日志输出前移除 API Key、Authorization header
```

---

## 10. 测试策略

### 工具

Vitest + tsx

### 测试分布

| 分类 | 文件 | 测试内容 |
|------|------|---------|
| Provider 单元 | claude-provider.test.ts | mock Agent SDK，测试 connect/chat/generate |
| Provider 单元 | codex-provider.test.ts | buildPrompt, buildArgs, filterEnv |
| Provider 单元 | opencode-provider.test.ts | mock SDK，测试模型解析 |
| Provider 单元 | copilot-provider.test.ts | mock SDK，测试模型过滤 |
| 工具单元 | sse.test.ts | 事件序列化格式 |
| 工具单元 | temp-files.test.ts | 临时文件创建/清理 |
| 集成 | connect.test.ts | /api/connect 路由完整流程 |
| 集成 | chat.test.ts | /api/chat SSE 流完整流程 |
| 集成 | generate.test.ts | /api/generate 路由完整流程 |

### 测试原则

- Provider 单元测试：mock 外部 SDK/子进程，验证输入输出转换逻辑
- 工具函数测试：纯函数，不依赖外部状态
- 路由集成测试：注入 mock provider，验证 HTTP 层面请求/响应/SSE 格式
- 不依赖真实 CLI 工具（CI 环境可能没有安装）

---

## 11. 类比理解

把这个服务想象成一个 **多语种翻译调度中心**:

```text
客户 (前端应用)
    |
    打电话来要求翻译服务 (POST /api/chat)
    |
调度台 (Fastify 路由层)
    |
    根据客户指定的语言种类，转接到对应的翻译专员
    |
    +---> Claude 专员
    |     使用高级耳麦 (Agent SDK) 实时传译
    |     支持边听边说 (真流式)
    |     可以看图片翻译 (Read 工具)
    |
    +---> Codex 专员
    |     使用老式对讲机 (spawn 子进程)
    |     必须听完一整段才能回复 (非流式)
    |     看图片需要把照片传过去 (--image)
    |
    +---> OpenCode 专员
    |     通过内线电话连接 (SDK + 本地服务)
    |     先建立会话再沟通 (session 机制)
    |
    +---> Copilot 专员
          通过专用通信设备 (Copilot SDK)
          支持实时传译 (真流式)

调度台规则:
    - 先检查专员是否在岗 (POST /api/connect)
    - 每隔15秒说一句请稍等 (ping心跳)
    - 翻译完成后说结束 (done事件)
    - 出问题时说遇到困难 (error事件)
    - 根据排班表决定哪些专员上班 (config.json enabled)
```
