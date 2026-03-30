# OpenPencil Server - Claude Code CLI 与 Codex CLI 集成架构分析

> 分析日期: 2026-03-30
> 涉及模块: `server/utils/`, `server/api/ai/`

---

## 1. 架构总览

OpenPencil 后端实现了一套多提供商 AI 网关，通过本地 CLI 工具桥接不同的 AI 服务。核心架构分为三层：

```text
前端请求 (SSE)
    |
    v
路由层 (chat.ts / connect-agent.ts / generate.ts / validate.ts)
    |
    v
提供商适配层 (Agent SDK / Codex CLI / OpenCode SDK / Copilot SDK)
    |
    v
CLI 工具层 (claude 二进制 / codex 二进制)
```

### 1.1 文件分布图

```text
server/
  utils/
    resolve-claude-cli.ts         Claude 二进制路径解析
    resolve-claude-agent-env.ts   Claude Agent SDK 环境变量构建
    codex-client.ts               Codex CLI 完整客户端
    copilot-client.ts             Copilot 二进制路径解析
    opencode-client.ts            OpenCode SDK 客户端管理
  api/ai/
    connect-agent.ts              连接检测 + 模型列表获取 (4个提供商)
    chat.ts                       流式聊天 SSE 端点 (4个提供商)
    generate.ts                   非流式生成端点
    validate.ts                   视觉验证端点 (截图分析)
    models.ts                     模型列表缓存
    install-agent.ts              CLI 工具自动安装
    mcp-install.ts                MCP 服务注册到 CLI 配置
```

---

## 2. Claude Code CLI 集成

### 2.1 核心流程图

```text
前端 POST /api/ai/chat { provider: anthropic }
    |
    v
resolveClaudeCli()
    |-- [Phase 1] where/which PATH 查找
    |-- [Phase 2] 常见安装路径遍历 (7个Windows路径, 3个Unix路径)
    |-- [normalizeClaudeCliPath] Windows npm shim -> cli.js 转换
    v
buildClaudeAgentEnv()
    |-- 读取 ~/.claude/settings.json 中的 env 配置
    |-- 合并 process.env (优先级: process.env > settings.json)
    |-- 验证 ANTHROPIC_CUSTOM_HEADERS 是否合法 JSON
    |-- 兼容: ANTHROPIC_AUTH_TOKEN -> ANTHROPIC_API_KEY
    |-- 移除 CLAUDECODE 环境变量 (防止嵌套调用)
    v
import('@anthropic-ai/claude-agent-sdk').query()
    |
    |-- [纯文本模式]
    |   |-- includePartialMessages: true (流式)
    |   |-- maxTurns: 1
    |   |-- 监听 content_block_delta -> text_delta / thinking_delta
    |   |-- SSE 输出: { type: text/thinking, content }
    |
    |-- [图片附件模式]
    |   |-- 保存图片到项目目录 .openpencil-tmp/ (SDK plan模式可访问)
    |   |-- stripNoToolsRestriction() 移除 NEVER use tools 限制
    |   |-- 指示 Claude 使用 Read 工具读取图片
    |   |-- maxTurns: 3 (允许多轮工具调用)
    |   |-- result-based: 等待最终结果后一次性输出
    |
    v
SSE 事件流: { type: ping/text/thinking/error/done }
```

### 2.2 路径解析详解 (`resolve-claude-cli.ts`)

**问题背景**: Nitro 打包 `@anthropic-ai/claude-agent-sdk` 时，SDK 内部使用 `import.meta.url` 定位自身 `cli.js` 的逻辑会失效。

**解决方案**: 手动定位独立原生二进制文件，通过 `pathToClaudeCodeExecutable` 参数传递给 SDK。SDK 检测到非 `.js` 路径时直接作为原生二进制启动。

**查找策略**:

| 阶段 | Windows | Unix |
|------|---------|------|
| PATH 查找 | `where claude` | `which claude` |
| 常见路径 | LOCALAPPDATA/Programs/claude-code/claude.exe | ~/.local/bin/claude |
| | LOCALAPPDATA/Microsoft/WinGet/Links/claude.exe | /usr/local/bin/claude |
| | ~/.claude/local/claude.exe | /opt/homebrew/bin/claude |
| | APPDATA/npm/ 下 claude.cmd / cli.js | |
| | AppData/Local/Programs/claude-code/claude.exe | |

**Windows 特殊处理** (`normalizeClaudeCliPath`):
- npm 安装的 `claude` 可能是一个 shell shim (如 `claude.cmd`)
- 检测到非 `.exe` / `.js` 扩展名时，自动查找同目录下 `node_modules/@anthropic-ai/claude-code/cli.js`
- 将 shim 路径转换为真正的 `cli.js` 入口

### 2.3 环境变量构建 (`resolve-claude-agent-env.ts`)

```text
buildClaudeAgentEnv()
    |
    v
readClaudeSettingsEnv()
    |-- 读取 ~/.claude/settings.json
    |-- 提取 env 字段中的键值对
    |-- normalizeEnvValue(): 过滤空字符串、对象、数组等非法值
    |
    v
合并策略: { ...settingsEnv, ...processEnv }
    |-- process.env 优先级更高 (覆盖 settings)
    |
    v
后处理:
    |-- 验证 ANTHROPIC_CUSTOM_HEADERS 是合法 JSON，否则删除
    |-- 如果有 ANTHROPIC_AUTH_TOKEN 但没有 ANTHROPIC_API_KEY，自动映射
    |-- 删除 CLAUDECODE 变量 (防止嵌套终端问题)
```

**为什么要读取 `settings.json`?**
Claude Code 的配置文件 `~/.claude/settings.json` 中的 `env` 字段可以配置自定义 API 密钥、代理地址、自定义请求头等。这些配置在用户通过 `claude` 命令行使用时自动生效，但通过 Agent SDK 调用时不会自动读取，需要手动注入。

### 2.4 Agent SDK 调用参数

| 参数 | 纯文本模式 | 图片附件模式 |
|------|-----------|------------|
| `maxTurns` | 1 | 3 |
| `permissionMode` | plan | plan |
| `includePartialMessages` | true (流式) | false (result-based) |
| `tools` | [] (空) | 使用内置 Read 工具 |
| `systemPrompt` | 原始 | stripNoToolsRestriction() |
| `persistSession` | false | false |

### 2.5 错误诊断机制

```text
Claude Code 进程异常退出 (exit code 1)
    |
    v
readDebugTail(debugFile, 40)
    |-- 读取 /tmp/openpencil-claude-debug/claude-agent.log 最后40行
    |-- 过滤敏感信息 (API Key, Authorization header)
    |
    v
buildClaudeExitHint()
    |-- 检测: EPERM 权限问题 -> ~/.claude.json 无法写入
    |-- 检测: Connection error -> 上游 API 网络问题
    |-- 检测: ANTHROPIC_CUSTOM_HEADERS missing -> 认证头未生效
    |
    v
返回增强错误信息给前端
```

### 2.6 连接检测 (`connectClaudeCode`)

```text
POST /api/ai/connect-agent { agent: claude-code }
    |
    v
resolveClaudeCli()  -- 查找 claude 二进制
    |
    v
import('@anthropic-ai/claude-agent-sdk').query({ prompt: '', options: ... })
    |
    v
q.supportedModels()  -- 获取支持的模型列表
    |
    v
映射为 GroupedModel[] { value, displayName, description, provider: 'anthropic' }
    |
    v
返回 { connected: true, models }
```

**友好的错误映射** (`friendlyClaudeError`):
- `exited with code 1` -> 检查模型映射，运行 `claude login`
- `not found / ENOENT` -> CLI 未安装
- `timed out` -> 连接超时

---

## 3. Codex CLI 集成

### 3.1 核心流程图

```text
前端 POST /api/ai/chat { provider: openai }
    |
    v
saveAttachmentsToTempFiles()  -- 保存图片附件 (系统临时目录)
    |
    v
runCodexExec(prompt, options)
    |
    v
buildPrompt(systemPrompt, userPrompt)
    |-- 如果有 systemPrompt:
    |   SYSTEM INSTRUCTIONS:
    |   <system>
    |   (空行)
    |   USER REQUEST:
    |   <user>
    |-- 否则直接返回 userPrompt
    |
    v
buildCodexExecArgs(outputPath, options)
    |-- exec --json --skip-git-repo-check --sandbox read-only
    |-- --output-last-message <tempPath>
    |-- --model <model> (如果指定)
    |-- --config model_reasoning_effort="<level>" (如果指定)
    |-- --image <file> (循环添加图片)
    |-- - (使用 stdin 传递 prompt)
    |
    v
executeCodexCommand(args, prompt, timeout)
    |-- spawn('codex', args, { env: filterCodexEnv(process.env) })
    |-- Windows: shell: true (npm 安装的 codex 需要 shell 解析)
    |-- 通过 stdin 管道传递 prompt
    |-- 逐行解析 stdout JSON 输出
    |-- 超时控制: 默认 15 分钟
    |
    v
读取 --output-last-message 输出文件
    |
    v
返回 SSE: { type: text, content: 完整文本 }
返回 SSE: { type: done }
```

### 3.2 安全设计: 环境变量过滤 (`filterCodexEnv`)

Codex CLI 作为子进程运行，环境变量采用 **白名单机制**，防止敏感信息泄露：

```text
允许通过的环境变量:
    系统基础:
        PATH, HOME, TERM, LANG, SHELL, TMPDIR
    Windows 必需:
        SYSTEMROOT, COMSPEC, USERPROFILE, APPDATA, LOCALAPPDATA
        PATHEXT, SYSTEMDRIVE, TEMP, TMP, HOMEDRIVE, HOMEPATH
    前缀匹配:
        OPENAI_*   (如 OPENAI_API_KEY)
        CODEX_*    (如 CODEX_开头的自定义配置)

显式阻止 (不传):
        ANTHROPIC_API_KEY, AWS_SECRET_KEY, GITHUB_TOKEN 等
```

**设计原理**: Codex CLI 只需要 OpenAI 相关的凭据。其他提供商的 API 密钥不应暴露给子进程。

### 3.3 推理努力程度映射 (`resolveCodexEffort`)

```text
前端参数 -> Codex CLI 参数

thinkingMode: disabled  -> low
thinkingMode: enabled   -> medium
effort: low             -> low
effort: medium          -> medium
effort: high            -> high
effort: max             -> high
其他                    -> undefined (不传)
```

### 3.4 JSON 输出解析 (`parseCodexJsonLine`)

Codex CLI 以 `--json` 模式运行时，每行输出一个 JSON 对象：

```json
// 正常文本增量
{ "delta": "Hello" }
{ "text": " world" }
{ "content": "!" }

// 错误
{ "type": "error", "message": "Rate limit exceeded" }
```

解析逻辑按字段优先级提取文本: `delta` > `text` > `content`

### 3.5 连接检测 (`connectCodexCli`)

```text
POST /api/ai/connect-agent { agent: codex-cli }
    |
    v
where/which codex         -- 检查二进制是否存在
    |
    v
codex --version           -- 验证 CLI 是否可响应
    |
    v
读取 ~/.codex/models_cache.json
    |-- 过滤: visibility === 'list'
    |-- 排序: 按 priority 升序
    |-- 映射: slug -> value, display_name -> displayName
    |
    v
返回 { connected: true, models: GroupedModel[] }
```

**注意**: Codex CLI 的模型列表来自本地缓存文件，而非实时 API 调用。如果用户从未运行过 `codex`，缓存文件可能不存在。

---

## 4. Claude Code vs Codex CLI 对比

### 4.1 架构对比

| 维度 | Claude Code CLI | Codex CLI |
|------|----------------|-----------|
| SDK | `@anthropic-ai/claude-agent-sdk` | 原生子进程 `spawn('codex')` |
| 通信方式 | SDK 抽象层 (异步迭代器) | stdin/stdout 管道 |
| 流式支持 | 原生流式 (`includePartialMessages`) | 非流式 (完整结果后输出) |
| 图片处理 | SDK 内置 Read 工具读取项目目录内文件 | `--image` CLI 参数 |
| 环境变量 | 合并 settings.json + process.env | 白名单过滤 |
| 模型获取 | SDK `supportedModels()` API | 读取本地 `models_cache.json` |
| 超时控制 | SDK 内置 | 手动 setTimeout + SIGTERM |
| 沙箱模式 | plan (只读) | `--sandbox read-only` |
| 提供商标识 | `anthropic` | `openai` |

### 4.2 流式输出对比

```text
Claude Code (真正的流式):
    前端 <- SSE <- { type: text, content: "H" }
    前端 <- SSE <- { type: text, content: "el" }
    前端 <- SSE <- { type: text, content: "lo" }
    前端 <- SSE <- { type: thinking, content: "分析中..." }
    前端 <- SSE <- { type: text, content: "世" }
    前端 <- SSE <- { type: text, content: "界" }
    前端 <- SSE <- { type: done }

Codex CLI (伪流式):
    前端 <- SSE <- { type: ping } (等待中)
    前端 <- SSE <- { type: ping } (等待中)
    ... Codex 处理完成 ...
    前端 <- SSE <- { type: text, content: "完整响应文本" }
    前端 <- SSE <- { type: done }
```

### 4.3 图片处理对比

```text
Claude Code:
    1. 保存图片到 CWD/.openpencil-tmp/ (项目目录内)
    2. 移除系统提示中的 NEVER use tools 限制
    3. 在 prompt 中指示: "使用 Read 工具读取 <path>"
    4. maxTurns=3, 允许多轮工具调用
    5. 等待最终 result 消息后一次性输出

Codex CLI:
    1. 保存图片到系统临时目录 (tmpdir)
    2. 通过 --image <path> 参数传入
    3. Codex 内部处理图片输入
    4. 正常执行，返回文本结果
```

---

## 5. 共享机制

### 5.1 SSE 协议

所有提供商统一使用 SSE (Server-Sent Events) 协议向前端推送消息：

```typescript
// SSE 事件类型
type SSEEvent =
  | { type: 'ping', content: '' }          // 心跳保活 (每15秒)
  | { type: 'text', content: string }       // 文本增量/完整文本
  | { type: 'thinking', content: string }   // 思考过程 (仅 Claude)
  | { type: 'error', content: string }      // 错误信息
  | { type: 'done', content: '' }           // 完成信号
```

### 5.2 Keep-Alive 机制

所有流式端点在等待首个真实数据块前，每 **15 秒** 发送一次 `ping` 事件，防止客户端因超时断开连接。当首个文本/错误数据到达后停止 ping。

### 5.3 临时文件清理

```text
Claude Code:
    附件目录: CWD/.openpencil-tmp/attach-XXXX/
    清理时机: finally 块中 rm -rf

Codex CLI:
    输出目录: tmpdir/openpencil-codex-XXXX/
    附件目录: tmpdir/openpencil-attach-XXXX/
    清理时机: finally 块中 rm -rf
```

### 5.4 GroupedModel 统一模型格式

```typescript
interface GroupedModel {
  value: string          // 模型标识符
  displayName: string    // 显示名称
  description: string    // 描述信息
  provider: 'anthropic' | 'openai' | 'opencode' | 'copilot'
}
```

---

## 6. 关键设计决策

### 6.1 为什么 Claude Code 使用 SDK 而 Codex 使用 spawn?

Claude Agent SDK 提供了高级抽象：流式消息、工具调用管理、会话控制。SDK 封装了与 `claude` 二进制通信的复杂性，包括权限管理、消息格式解析等。

Codex CLI 没有等效的 Node.js SDK，其 `--json` 模式输出是结构化的 newline-delimited JSON，适合直接通过子进程管道解析。

### 6.2 为什么图片附件保存位置不同?

Claude Code Agent SDK 在 `plan` 权限模式下，只能访问项目目录内的文件。因此图片必须保存在 `CWD/.openpencil-tmp/` 下，并指示 Claude Code 通过 Read 工具读取。

Codex CLI 的 `--image` 参数接受任意路径，因此使用系统临时目录即可。

### 6.3 安全考量

1. **环境变量隔离** (`filterCodexEnv`): 防止将其他提供商的 API 密钥泄露给 Codex 子进程
2. **日志脱敏** (`SENSITIVE_LOG_PATTERN`): 调试日志输出前过滤 API Key、Authorization header
3. **CLAUDECODE 环境清理**: 防止在 Claude Code 终端内嵌套调用导致的递归问题
4. **ANTHROPIC_CUSTOM_HEADERS 验证**: 防止非法 JSON 导致 SDK 崩溃

---

## 7. API 端点汇总

| 端点 | 方法 | 用途 | CLI 涉及 |
|------|------|------|---------|
| `/api/ai/chat` | POST | 流式聊天 | claude + codex + opencode + copilot |
| `/api/ai/connect-agent` | POST | 连接检测+模型获取 | claude + codex + opencode + copilot |
| `/api/ai/generate` | POST | 非流式生成 | claude + codex + opencode |
| `/api/ai/validate` | POST | 视觉验证(截图分析) | claude + codex |
| `/api/ai/models` | GET | 模型列表缓存 | claude |
| `/api/ai/install-agent` | POST | CLI 自动安装 | claude + codex + opencode + copilot |
| `/api/ai/mcp-install` | POST | MCP 服务注册 | claude + codex + gemini + opencode + kiro + copilot |

---

## 8. 类比理解

把整个架构想象成一家 **翻译公司的接线台**:

```text
客户 (前端)
    |
    打电话来要求翻译服务
    |
接线台 (chat.ts 路由层)
    |
    根据客户要求的外语种类，转接到对应的翻译专员
    |
    +---> Claude 专员 (Anthropic)
    |     使用高级耳麦 (Agent SDK) 实时传译
    |     支持边听边说 (流式)
    |     可以看图片翻译 (Read 工具)
    |
    +---> Codex 专员 (OpenAI)
          使用老式对讲机 (spawn 子进程)
          必须听完一整段才能回复 (非流式)
          看图片需要把照片传过去 (--image)

接线台规则:
    - 每隔15秒说一句 "请稍等" (ping心跳)
    - 翻译完成后说 "结束" (done事件)
    - 出问题时说 "遇到困难" (error事件)
```

---

## 引用说明

- [Claude Agent SDK](https://github.com/anthropics/claude-code/tree/main/packages/agent-sdk) - Claude Code Agent SDK 官方仓库
- [Codex CLI](https://github.com/openai/codex) - OpenAI Codex CLI 工具
- [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) - MDN Web Docs
- [Anthropic API](https://docs.anthropic.com/en/docs) - Anthropic API 文档
- [OpenAI API](https://platform.openai.com/docs) - OpenAI API 文档
