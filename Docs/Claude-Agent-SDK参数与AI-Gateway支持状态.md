# Claude Agent SDK 参数与 AI-Gateway 支持状态

> 更新时间: 2026-03-30
> SDK 版本: @anthropic-ai/claude-agent-sdk (类型定义 sdk.d.ts)
> AI-Gateway 端口: 10320

## SDK Options 完整参数

### query() 调用签名

```typescript
query({ prompt: string | AsyncIterable<SDKUserMessage>, options?: Options }): Query
```

### 参数对照表

| SDK 参数 | 类型 | AI-Gateway 状态 | 说明 |
|----------|------|-----------------|------|
| `systemPrompt` | `string \| { type: 'preset', preset: 'claude_code', append?: string }` | 已用 | 系统提示词 |
| `model` | `string` | 已用 | 模型标识符, 如 claude-sonnet-4-6 |
| `maxTurns` | `number` | 已用 | 最大对话轮数 |
| `includePartialMessages` | `boolean` | 已用 | 启用流式输出 |
| `tools` | `string[] \| { type: 'preset', preset: 'claude_code' }` | 已用(空数组) | 内置工具集 |
| `plugins` | `SdkPluginConfig[]` | 已用(空数组) | 插件配置 |
| `permissionMode` | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'plan' \| 'dontAsk'` | 已用(2026-03-30 新增透传) | 权限模式, 默认 plan |
| `persistSession` | `boolean` | 已用(false) | 是否持久化会话 |
| `effort` | `'low' \| 'medium' \| 'high' \| 'max'` | 已用 | 推理努力程度 |
| `thinking` | `ThinkingConfig` | 已用 | 思考模式配置 |
| `env` | `Record<string, string \| undefined>` | 已用 | 环境变量 |
| `debugFile` | `string` | 已用 | 调试日志文件路径 |
| `pathToClaudeCodeExecutable` | `string` | 已用 | Claude Code CLI 路径 |
| **`cwd`** | `string` | **未用** | 工作目录, 默认 process.cwd() |
| **`outputFormat`** | `{ type: 'json_schema', schema: Record<string, unknown> }` | **未用** | 结构化 JSON 输出 |
| **`additionalDirectories`** | `string[]` | **未用** | 额外可访问目录 |
| **`allowedTools`** | `string[]` | **未用** | 自动允许的工具列表 |
| **`disallowedTools`** | `string[]` | **未用** | 禁用的工具列表 |
| **`mcpServers`** | `Record<string, McpServerConfig>` | **未用** | MCP 服务器配置 |
| **`settingSources`** | `('user' \| 'project' \| 'local')[]` | **未用** | 加载哪些文件系统设置 |
| **`resume`** | `string` | **未用** | 恢复会话 ID |
| **`sessionId`** | `string (UUID)` | **未用** | 自定义会话 ID |
| **`continue`** | `boolean` | **未用** | 继续最近对话 |
| **`forkSession`** | `boolean` | **未用** | 恢复时分叉到新会话 |
| **`resumeSessionAt`** | `string` | **未用** | 从特定消息恢复 |
| **`agent`** | `string` | **未用** | 主线程 Agent 名称 |
| **`agents`** | `Record<string, AgentDefinition>` | **未用** | 自定义子 Agent 定义 |
| **`canUseTool`** | `CanUseTool` | **未用** | 自定义权限回调 |
| **`hooks`** | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | **未用** | 钩子回调 |
| **`executable`** | `'bun' \| 'deno' \| 'node'` | **未用** | JS 运行时选择 |
| **`executableArgs`** | `string[]` | **未用** | 运行时额外参数 |
| **`extraArgs`** | `Record<string, string \| null>` | **未用** | CLI 额外参数 |
| **`fallbackModel`** | `string` | **未用** | 备用模型 |
| **`enableFileCheckpointing`** | `boolean` | **未用** | 文件检查点(用于回滚) |
| **`betas`** | `SdkBeta[]` | **未用** | Beta 功能 |
| **`sandbox`** | `SandboxSettings` | **未用** | 沙箱隔离配置 |
| **`debug`** | `boolean` | **未用** | 启用调试模式 |
| **`stderr`** | `(data: string) => void` | **未用** | stderr 输出回调 |
| **`strictMcpConfig`** | `boolean` | **未用** | 严格 MCP 配置校验 |
| **`spawnClaudeCodeProcess`** | `(options: SpawnOptions) => SpawnedProcess` | **未用** | 自定义进程启动 |
| **`allowDangerouslySkipPermissions`** | `boolean` | **未用** | bypassPermissions 时必须设为 true |
| **`permissionPromptToolName`** | `string` | **未用** | MCP 权限提示工具名 |
| **`maxThinkingTokens`** | `number` | **未用(已弃用)** | 已弃用, 用 thinking 替代 |
| **`maxBudgetUsd`** | `number` | **未用** | 最大预算(USD) |

## Query 对象方法

| 方法 | 说明 |
|------|------|
| `supportedModels()` | 获取可用模型列表 |
| `supportedCommands()` | 获取可用命令/技能列表 |
| `mcpServerStatus()` | 获取 MCP 服务器状态 |
| `accountInfo()` | 获取认证账号信息 |
| `initializationResult()` | 获取完整初始化结果 |
| `setPermissionMode(mode)` | 动态修改权限模式 |
| `setModel(model)` | 动态切换模型 |
| `interrupt()` | 中断当前查询 |
| `close()` | 关闭查询并清理资源 |
| `rewindFiles(userMessageId)` | 回滚文件到指定消息状态 |
| `reconnectMcpServer(name)` | 重连 MCP 服务器 |
| `toggleMcpServer(name, enabled)` | 启用/禁用 MCP 服务器 |
| `setMcpServers(servers)` | 动态设置 MCP 服务器 |
| `streamInput(stream)` | 多轮对话输入流 |
| `stopTask(taskId)` | 停止运行中的任务 |

## V2 不稳定 API (alpha)

| API | 说明 |
|-----|------|
| `unstable_v2_createSession(options)` | 创建持久会话(多轮对话) |
| `unstable_v2_prompt(message, options)` | 单次便捷调用 |
| `unstable_v2_resumeSession(sessionId, options)` | 恢复已有会话 |

## 优先级建议 (后续接入)

### 高优先级
- `cwd` - 支持指定工作目录, 影响文件操作和上下文
- `outputFormat` - 结构化 JSON 输出, 提升解析可靠性
- `settingSources` - 控制加载哪些项目设置

### 中优先级
- `additionalDirectories` - 扩展文件访问范围
- `allowedTools` / `disallowedTools` - 精细控制工具权限
- `mcpServers` - 动态 MCP 服务器配置
- `resume` / `continue` - 会话恢复

### 低优先级
- `sandbox` - 沙箱隔离
- `agent` / `agents` - 自定义 Agent
- `hooks` - 钩子回调
- `enableFileCheckpointing` - 文件检查点

## 引用

- [Claude Agent SDK 类型定义](file:///D:/NodejsP/PencilUnity/openpencil/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts)
- [Claude 结构化输出文档](https://platform.claude.com/docs/zh-CN/build-with-claude/structured-outputs)
