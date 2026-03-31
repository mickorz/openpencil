# AI-Gateway API 文档

> 版本: 1.0.0 | 更新日期: 2026-03-31
>
> AI-Gateway 是一个本地 HTTP 服务, 通过统一的 REST API 桥接多种 AI 编码代理 (Claude Code / Codex / OpenCode / Copilot), 提供流式聊天、非流式生成、连接检测等能力.

---

## 目录

- [服务配置](#服务配置)
- [通用说明](#通用说明)
- [接口列表](#接口列表)
  - [1. POST /api/connect](#1-post-apiconnect)
  - [2. POST /api/chat](#2-post-apichat)
  - [3. POST /api/generate](#3-post-apigenerate)
  - [4. GET /health](#4-get-health)
- [请求参数详解](#请求参数详解)
  - [必填参数](#必填参数)
  - [模型与推理参数](#模型与推理参数)
  - [权限与工具参数](#权限与工具参数)
  - [Agent Skill 参数](#agent-skill-参数)
  - [MCP Server 参数](#mcp-server-参数)
  - [图片附件参数](#图片附件参数)
- [响应格式](#响应格式)
- [错误码](#错误码)
- [请求示例](#请求示例)

---

## 服务配置

配置文件: `ai-gateway/config.json`

```json
{
  "server": {
    "port": 10320,
    "host": "127.0.0.1"
  },
  "providers": {
    "claude": {
      "enabled": true,
      "timeoutMs": 120000,
      "debugLog": true,
      "allowedCwdDirs": ["D:\\NodejsP\\PencilUnity\\openpencil"]
    },
    "codex": { "enabled": true, "timeoutMs": 900000 },
    "opencode": { "enabled": true, "port": 4096 },
    "copilot": { "enabled": true }
  },
  "logging": { "level": "info" }
}
```

### ProviderConfig 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用该 provider |
| `timeoutMs` | number? | 超时时间 (毫秒) |
| `debugLog` | boolean? | 是否输出详细日志 |
| `port` | number? | provider 监听端口 (opencode 专用) |
| `allowedCwdDirs` | string[]? | cwd 允许的基础目录白名单 |

> **注意**: `allowedCwdDirs` 为空数组时, 所有 cwd 请求都会被拒绝. 请务必配置需要开放的项目目录.

---

## 通用说明

### Base URL

```
http://127.0.0.1:10320
```

### Content-Type

所有 POST 请求使用 `application/json`.

### 支持的 Provider

| provider 值 | 说明 |
|-------------|------|
| `claude` | 通过 Claude Agent SDK 桥接 Claude Code CLI |
| `codex` | Codex CLI 客户端 |
| `opencode` | OpenCode 服务端 |
| `copilot` | GitHub Copilot CLI |

---

## 接口列表

### 1. POST /api/connect

检测 CLI 可用性并获取模型列表.

**请求体:**

```json
{
  "agent": "claude"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent` | string | 是 | provider 名称 |

**响应 ConnectResult:**

```json
{
  "connected": true,
  "models": [
    {
      "value": "claude-sonnet-4-20250514",
      "displayName": "Claude Sonnet 4",
      "description": "...",
      "provider": "anthropic"
    }
  ]
}
```

**错误响应:**

```json
{
  "connected": false,
  "models": [],
  "error": "Claude Code CLI not found",
  "notInstalled": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `connected` | boolean | 是否连接成功 |
| `models` | ModelInfo[] | 可用模型列表 |
| `error` | string? | 错误信息 |
| `notInstalled` | boolean? | CLI 未安装标记 |

---

### 2. POST /api/chat

流式聊天接口, 通过 Server-Sent Events (SSE) 返回增量文本.

**请求体:** 见 [请求参数详解](#请求参数详解)

**响应:** SSE 事件流 (`text/event-stream`)

每个事件的格式为:

```
event: message
data: {"type":"...","content":"..."}
```

**SSE 事件类型:**

| type | 说明 |
|------|------|
| `text` | 文本增量内容 |
| `thinking` | 思维链增量内容 (extended thinking) |
| `ping` | 心跳保活 (每 15 秒) |
| `done` | 流式输出完成 |
| `error` | 错误信息 |

**cURL 示例:**

```bash
curl -N -X POST http://127.0.0.1:10320/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "system": "你是一个编程助手.",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

---

### 3. POST /api/generate

非流式生成接口, 返回完整生成结果.

**请求体:** 与 `/api/chat` 相同, 见 [请求参数详解](#请求参数详解)

**响应:**

成功时:

```json
{
  "text": "完整的生成结果文本..."
}
```

失败时:

```json
{
  "error": "错误信息描述"
}
```

---

### 4. GET /health

健康检查接口.

**响应:**

```json
{
  "status": "ok",
  "providers": ["claude", "codex", "opencode", "copilot"]
}
```

---

## 请求参数详解

`/api/chat` 和 `/api/generate` 共享相同的请求体结构 (`ChatRequest`).

### 必填参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `provider` | string | 是 | provider 名称: `claude` / `codex` / `opencode` / `copilot` |
| `model` | string | 是 | 模型 ID, 如 `claude-sonnet-4-20250514` |
| `system` | string | 是 | 系统提示词 |
| `messages` | array | 是 | 消息列表, 至少包含一条消息 |

### messages 数组元素

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `role` | string | 是 | `"user"` 或 `"assistant"` |
| `content` | string | 是 | 消息文本内容 |
| `attachments` | Attachment[]? | 否 | 图片附件列表 |

### Attachment 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 文件名 |
| `mediaType` | string | MIME 类型, 如 `image/png` |
| `data` | string | Base64 编码的文件内容 |

---

### 模型与推理参数

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `thinkingMode` | string? | - | 思维链模式: `"adaptive"` / `"disabled"` / `"enabled"` |
| `thinkingBudgetTokens` | number? | - | 思维链 token 预算 (仅 thinkingMode=enabled 时生效) |
| `effort` | string? | - | 推理强度: `"low"` / `"medium"` / `"high"` / `"max"` |

---

### 权限与工具参数

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `permissionMode` | string? | `"plan"` | 权限模式, 见下表 |
| `maxTurns` | number? | chat: 1 (文本) / 3 (图片); generate: 1 | 最大对话轮数 (1-50) |
| `allowedTools` | string[]? | - | 自动允许的工具列表 |
| `disallowedTools` | string[]? | - | 禁用的工具列表 |

#### permissionMode 可选值

| 值 | 说明 |
|----|------|
| `"plan"` | 计划模式 (默认), 不执行实际工具调用 |
| `"default"` | 标准模式, 危险操作会提示确认 |
| `"acceptEdits"` | 自动接受文件编辑操作 |
| `"bypassPermissions"` | 跳过所有权限确认 (自动启用 allowDangerouslySkipPermissions) |
| `"dontAsk"` | 不提示权限确认, 未预批准则拒绝 |

---

### Agent Skill 参数

这些参数透传给 Claude Agent SDK 的 `query()` 函数, 用于启用项目配置、插件、结构化输出等能力.

| 字段 | 类型 | 说明 |
|------|------|------|
| `cwd` | string? | 工作目录, 决定 CLAUDE.md / .claude/ 的查找路径. 必须在 config.json 的 `allowedCwdDirs` 白名单内 |
| `settingSources` | string[]? | 加载哪些设置来源, 取值: `"user"` / `"project"` / `"local"` |
| `plugins` | Plugin[]? | 插件配置列表 |
| `outputFormat` | object? | 结构化 JSON 输出格式 |

#### Plugin 结构

```json
{ "type": "local", "path": "/path/to/plugin" }
```

#### outputFormat 结构

```json
{
  "type": "json_schema",
  "schema": {
    "type": "object",
    "properties": {
      "result": { "type": "string" }
    }
  }
}
```

---

### MCP Server 参数

通过 `mcpServers` 字段配置 MCP (Model Context Protocol) 服务器, 让 Claude 可以使用额外的工具能力.

| 字段 | 类型 | 说明 |
|------|------|------|
| `mcpServers` | Record<string, McpServerConfig>? | MCP Server 配置映射, key 为服务器名称 |

#### 支持的 MCP Server 类型

**stdio 类型 (默认)**

启动本地子进程作为 MCP Server.

```json
{
  "my-server": {
    "type": "stdio",
    "command": "node",
    "args": ["./my-mcp-server.js"],
    "env": { "API_KEY": "xxx" }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 否 | `"stdio"` (默认值, 可省略) |
| `command` | string | 是 | 要执行的命令 |
| `args` | string[]? | 否 | 命令参数 |
| `env` | object? | 否 | 环境变量 |

**sse 类型**

通过 Server-Sent Events 连接远程 MCP Server.

```json
{
  "remote-server": {
    "type": "sse",
    "url": "http://localhost:3001/sse",
    "headers": { "Authorization": "Bearer xxx" }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | `"sse"` |
| `url` | string | 是 | SSE 端点 URL |
| `headers` | object? | 否 | 自定义请求头 |

**http 类型**

通过 HTTP 连接远程 MCP Server (Streamable HTTP).

```json
{
  "http-server": {
    "type": "http",
    "url": "http://localhost:3002/mcp",
    "headers": { "Authorization": "Bearer xxx" }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | `"http"` |
| `url` | string | 是 | HTTP 端点 URL |
| `headers` | object? | 否 | 自定义请求头 |

---

### 图片附件参数

在 `messages` 数组的最后一条 `user` 消息中添加 `attachments` 字段, 支持发送图片给 AI.

**注意:** 图片模式下:
- `maxTurns` 自动调整为 3
- 使用 result-based 模式等待完整结果 (非流式增量)
- 系统提示中的 "NEVER use tools" 限制会被自动移除

```json
{
  "provider": "claude",
  "model": "claude-sonnet-4-20250514",
  "system": "你是一个图片分析助手.",
  "messages": [{
    "role": "user",
    "content": "分析这张图片",
    "attachments": [{
      "name": "screenshot.png",
      "mediaType": "image/png",
      "data": "<base64-encoded-data>"
    }]
  }]
}
```

---

## 响应格式

### /api/chat SSE 事件流

```
event: message
data: {"type":"text","content":"你"}

event: message
data: {"type":"text","content":"好"}

event: message
data: {"type":"thinking","content":"用户在问..."}

event: message
data: {"type":"ping","content":""}

event: message
data: {"type":"done","content":""}
```

### /api/generate JSON 响应

```json
{
  "text": "完整的生成结果"
}
```

### /api/connect JSON 响应

```json
{
  "connected": true,
  "models": [
    { "value": "model-id", "displayName": "Model Name", "description": "...", "provider": "anthropic" }
  ]
}
```

---

## 错误码

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| `200` | 成功 |
| `400` | 请求参数错误 (缺少必填字段 / 类型错误 / cwd 不在白名单等) |
| `500` | 服务端内部错误 (provider 调用失败等) |

### 400 错误示例

```json
{ "error": "Missing required field: provider" }
{ "error": "Missing required field: model" }
{ "error": "Missing required field: system" }
{ "error": "Missing required field: messages" }
{ "error": "Field \"cwd\" must be a string" }
{ "error": "Field \"maxTurns\" must be a number between 1 and 50" }
{ "error": "cwd \"xxx\" 不在允许的目录白名单中. 允许的目录: [D:\\NodejsP\\PencilUnity\\openpencil]" }
{ "error": "Field \"mcpServers\" must be an object { name: config }" }
{ "error": "mcpServers[\"my-server\"] (stdio) requires \"command\" string" }
{ "error": "Provider \"xxx\" not found" }
```

---

## 请求示例

### 基础聊天 (流式)

```bash
curl -N -X POST http://127.0.0.1:10320/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "system": "你是一个编程助手.",
    "messages": [{"role": "user", "content": "什么是 React?"}]
  }'
```

### 非流式生成

```bash
curl -X POST http://127.0.0.1:10320/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "system": "你是一个编程助手.",
    "messages": [{"role": "user", "content": "写一个 hello world"}]
  }'
```

### 使用 cwd + Skills (Agent 模式)

```bash
curl -X POST http://127.0.0.1:10320/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "system": "你是一个编程助手.",
    "messages": [{"role": "user", "content": "list all agents"}],
    "cwd": "D:\\NodejsP\\PencilUnity\\openpencil",
    "settingSources": ["user", "project"],
    "permissionMode": "bypassPermissions",
    "maxTurns": 5
  }'
```

### 带 MCP Server

```bash
curl -X POST http://127.0.0.1:10320/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "system": "你是一个设计工具助手.",
    "messages": [{"role": "user", "content": "查询当前项目的所有设计节点"}],
    "cwd": "D:\\NodejsP\\PencilUnity\\openpencil",
    "permissionMode": "bypassPermissions",
    "maxTurns": 10,
    "mcpServers": {
      "openpencil-design": {
        "command": "node",
        "args": ["src/mcp/server.ts"]
      }
    }
  }'
```

### 带 Extended Thinking

```bash
curl -X POST http://127.0.0.1:10320/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "system": "你是一个数学专家.",
    "messages": [{"role": "user", "content": "证明根号2是无理数"}],
    "thinkingMode": "enabled",
    "thinkingBudgetTokens": 10000,
    "effort": "high"
  }'
```

### 带图片附件

```bash
curl -N -X POST http://127.0.0.1:10320/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "system": "你是一个图片分析助手.",
    "messages": [{
      "role": "user",
      "content": "描述这张图片",
      "attachments": [{
        "name": "photo.png",
        "mediaType": "image/png",
        "data": "iVBORw0KGgo..."
      }]
    }]
  }'
```

### 结构化 JSON 输出

```bash
curl -X POST http://127.0.0.1:10320/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "claude-sonnet-4-20250514",
    "system": "你是一个情感分析助手.",
    "messages": [{"role": "user", "content": "今天天气真好, 心情愉快!"}],
    "outputFormat": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": {
          "sentiment": { "type": "string", "enum": ["positive", "negative", "neutral"] },
          "score": { "type": "number" }
        },
        "required": ["sentiment", "score"]
      }
    }
  }'
```

### 连接检测 + 获取模型列表

```bash
curl -X POST http://127.0.0.1:10320/api/connect \
  -H "Content-Type: application/json" \
  -d '{"agent": "claude"}'
```

### 健康检查

```bash
curl http://127.0.0.1:10320/health
```

---

## 参数速查表

| 字段 | 类型 | 必填 | 默认值 | 适用接口 | 说明 |
|------|------|------|--------|----------|------|
| `provider` | string | 是 | - | chat/generate | provider 名称 |
| `model` | string | 是 | - | chat/generate | 模型 ID |
| `system` | string | 是 | - | chat/generate | 系统提示词 |
| `messages` | array | 是 | - | chat/generate | 消息列表 |
| `thinkingMode` | string? | 否 | - | chat/generate | 思维链模式 |
| `thinkingBudgetTokens` | number? | 否 | - | chat/generate | 思维链 token 预算 |
| `effort` | string? | 否 | - | chat/generate | 推理强度 |
| `permissionMode` | string? | 否 | `"plan"` | chat/generate | 权限模式 |
| `maxTurns` | number? | 否 | 1 或 3 | chat/generate | 最大轮数 (1-50) |
| `cwd` | string? | 否 | - | chat/generate | 工作目录 (需白名单) |
| `settingSources` | string[]? | 否 | - | chat/generate | 设置来源 |
| `plugins` | Plugin[]? | 否 | - | chat/generate | 插件配置 |
| `outputFormat` | object? | 否 | - | chat/generate | 结构化输出 |
| `allowedTools` | string[]? | 否 | - | chat/generate | 允许的工具 |
| `disallowedTools` | string[]? | 否 | - | chat/generate | 禁用的工具 |
| `mcpServers` | object? | 否 | - | chat/generate | MCP Server 配置 |
| `agent` | string | 是 | - | connect | provider 名称 |
