/**
 * Provider 基类定义
 *
 * BaseProvider
 *   |-- connect()     检测 CLI 可用性 + 获取模型列表
 *   |-- chat()        流式聊天 (AsyncGenerator)
 *   |-- generate()    非流式生成 (Promise)
 */

export interface SSEEvent {
  type: 'ping' | 'text' | 'thinking' | 'error' | 'done'
  content: string
}

/**
 * MCP Server 配置类型 - 仅支持可序列化的类型 (stdio / sse / http)
 * 不支持 sdk 类型 (需要进程内 McpServer 实例, 不可序列化)
 */
export type McpServerConfig =
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }

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
  permissionMode?: 'plan' | 'default' | 'bypassPermissions' | 'acceptEdits' | 'dontAsk'
  /** 工作目录, 决定 CLAUDE.md 和 .claude/ 的查找路径 */
  cwd?: string
  /** 加载哪些设置来源 */
  settingSources?: Array<'user' | 'project' | 'local'>
  /** 插件配置 */
  plugins?: Array<{ type: 'local'; path: string }>
  /** 结构化 JSON 输出格式 */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
  /** 自动允许的工具列表 */
  allowedTools?: string[]
  /** 禁用的工具列表 */
  disallowedTools?: string[]
  /** 最大对话轮数, 默认 chat文本模式1 / chat图片模式3 / generate1 */
  maxTurns?: number
  /** MCP Server 配置, 透传给 SDK query() */
  mcpServers?: Record<string, McpServerConfig>
}

export type GenerateRequest = ChatRequest

export interface Attachment {
  name: string
  mediaType: string
  data: string
}

import type { ProviderConfig } from '../config.js'

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

  /**
   * 前置校验请求参数, 校验失败直接 throw Error
   * 在路由层调用, 用于在 SSE 流开始之前拦截参数错误
   */
  validateRequest(_req: Partial<ChatRequest>): void {
    // 默认不做额外校验, 子类可 override
  }
}
