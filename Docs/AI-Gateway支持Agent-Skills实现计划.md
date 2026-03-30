# AI-Gateway 支持 Agent Skills 实现计划

> 日期: 2026-03-30
> 状态: 待实现

## Context

ai-gateway 当前通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 桥接 Claude Code CLI，但未传入 `cwd`、`settingSources`、`plugins` 等参数，处于 SDK 隔离模式。这意味着无法加载项目的 CLAUDE.md、Skills、自定义 Agent 等配置。本次改动让请求方可以通过 API 参数启用这些能力。

## 数据流

```
HTTP Body (JSON)
  |-- cwd, settingSources, plugins, outputFormat, allowedTools, disallowedTools
  |
  v
Route 校验 (chat.ts / generate.ts)
  |
  v
ChatRequest (base-provider.ts)
  |
  v
ClaudeProvider.chat() / .generate()
  |-- validateCwd(cwd, allowedCwdDirs)   路径安全校验
  |-- buildSkillOptions(req)             构建参数
  |
  v
query({ prompt, options: { ...skillOpts } })
  |
  v
Claude Code CLI (加载项目配置、Skills、CLAUDE.md)
```

## 改动范围

### 1. `src/providers/base-provider.ts` -- 新增类型定义

在 `ChatRequest` 中添加 6 个可选字段：

```typescript
// 新增类型
export interface SdkPluginConfig { type: 'local'; path: string }
export interface SdkOutputFormat { type: 'json_schema'; schema: Record<string, unknown> }

// ChatRequest 新增字段
cwd?: string                                          // 工作目录
settingSources?: Array<'user' | 'project' | 'local'>  // 加载哪些设置
plugins?: SdkPluginConfig[]                           // 插件
outputFormat?: SdkOutputFormat                        // 结构化 JSON 输出
allowedTools?: string[]                               // 自动允许的工具
disallowedTools?: string[]                            // 禁用的工具
```

所有字段可选，不传则保持当前行为。

### 2. `src/utils/validate-cwd.ts` -- 新建路径安全校验

- `resolve()` + `normalize()` 消除路径穿越
- 对照 `config.json` 中的 `allowedCwdDirs` 白名单
- 白名单为空时拒绝所有 cwd 请求

### 3. `src/config.ts` -- 扩展 ProviderConfig

```typescript
export interface ProviderConfig {
  // ... 现有字段
  allowedCwdDirs?: string[]  // cwd 允许的基础目录
}
```

`config.json` 示例：
```json
{
  "providers": {
    "claude": {
      "enabled": true,
      "timeoutMs": 120000,
      "debugLog": true,
      "allowedCwdDirs": ["D:\\NodejsP\\PencilUnity"]
    }
  }
}
```

### 4. `src/providers/claude-provider.ts` -- 核心逻辑

- 新增 `buildSkillOptions(req)` 私有方法，统一构建 skill 相关参数
- `chat()` 和 `generate()` 的 `queryOptions` 中 spread skill 参数
- `plugins` 替换当前的硬编码 `[]`

### 5. `src/routes/chat.ts` + `src/routes/generate.ts` -- 输入校验

对新增字段做类型校验，不符合返回 400。

### 6. `config.json` -- 配置 allowedCwdDirs

## 实施顺序

| 步骤 | 文件 | 说明 |
|------|------|------|
| 1 | `base-provider.ts` | 纯类型变更，现有代码无需修改 |
| 2 | `validate-cwd.ts` | 新建工具函数 |
| 3 | `config.ts` | 扩展配置接口 |
| 4 | `claude-provider.ts` | 核心逻辑，buildSkillOptions + 透传 |
| 5 | `routes/chat.ts` + `routes/generate.ts` | 输入校验 |
| 6 | `config.json` | 实际配置 allowedCwdDirs |

## 默认值设计

| 字段 | 缺省行为 | 传值后效果 |
|------|----------|-----------|
| `cwd` | SDK 用 process.cwd() | 指定项目目录，加载该目录的 CLAUDE.md |
| `settingSources` | 不加载任何设置(隔离模式) | 加载用户/项目/本地设置 |
| `plugins` | `[]` (无插件) | 加载指定路径的插件 |
| `outputFormat` | 自由文本 | 强制 JSON schema 输出 |
| `allowedTools` | 无自动允许 | 指定工具自动允许 |
| `disallowedTools` | 无禁用 | 指定工具禁用 |

## 安全考虑

- **cwd 白名单**: 防路径穿越，`allowedCwdDirs` 为空时拒绝所有 cwd 请求
- **plugins 路径**: 需运维感知，后续可加白名单
- **settingSources**: 启用 `project` 会读取 cwd 下的 `.claude/` 配置，依赖 cwd 白名单保障

## 不变的部分

- `connect()` 不改（仅检测可用性）
- 其他 Provider (codex/opencode/copilot) 忽略新字段
- SSE 协议格式不变
- `src/index.ts` Fastify 配置不变

## 测试方案

1. 发送带 `cwd` + `settingSources` 的请求，验证 SDK 日志显示加载了项目设置
2. 发送带 `outputFormat` 的请求，验证返回 JSON 格式
3. 发送非法 `cwd`（不在白名单），验证被拒绝
4. 不传新字段的请求，验证行为不变

## 请求示例

```bash
curl -X POST http://127.0.0.1:10320/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "model": "haiku",
    "system": "You are a helpful assistant.",
    "messages": [{"role": "user", "content": "Hello"}],
    "cwd": "D:\\NodejsP\\PencilUnity\\openpencil",
    "settingSources": ["user", "project"],
    "permissionMode": "plan"
  }'
```
