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
}
