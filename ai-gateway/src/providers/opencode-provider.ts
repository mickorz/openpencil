/**
 * OpenCode Provider - 通过 OpenCode SDK 桥接 OpenCode CLI
 *
 * OpenCodeProvider
 *   |-- connect()       检测 CLI 可用性 + 获取模型列表
 *   |     |-- execSync('which opencode' / 'where opencode')  检测 CLI
 *   |     |-- getOpencodeClient()                              获取客户端
 *   |     |-- client.config.providers()                        获取 provider 列表
 *   |     |-- 遍历 providers + models -> ModelInfo[]           映射为统一格式
 *   |     |-- releaseOpencodeServer()                          释放服务
 *   |     └-- 返回 ConnectResult
 *   |
 *   |-- chat()          流式聊天 (AsyncGenerator<SSEEvent>)
 *   |     |-- getOpencodeClient()                              获取客户端
 *   |     |-- client.session.create()                          创建会话
 *   |     |-- 注入系统提示 (noReply: true)                      首轮系统消息
 *   |     |-- 构建 parts: 图片 data URI + 文本 text             消息组装
 *   |     |-- promptWithThinking()                             发送 (支持 reasoning 回退)
 *   |     |-- 遍历 result.parts yield text                     流式输出
 *   |     |-- yield done
 *   |     └-- finally releaseOpencodeServer
 *   |
 *   |-- generate()      非流式生成 (Promise)
 *   |     |-- 同 chat 流程
 *   |     |-- 收集所有 text parts
 *   |     └-- 返回 { text: joined }
 *   |
 *   |-- parseModel(model)         解析 "providerId/modelId" 格式
 *   |-- buildReasoning(req)       构建 reasoning 配置对象
 *   |-- promptWithThinking()      先尝试带 reasoning，失败回退不带
 *   |-- mapEffort(effort)         effort 映射 (max -> high)
 *   └-- friendlyError(raw)       原始错误映射为友好提示
 */

import { execSync } from 'node:child_process'
import {
  BaseProvider,
  type ChatRequest,
  type ConnectResult,
  type SSEEvent,
  type ModelInfo,
} from './base-provider.js'
import type { ProviderConfig } from '../config.js'
import {
  getOpencodeClient,
  releaseOpencodeServer,
} from '../utils/opencode-client.js'

export class OpenCodeProvider extends BaseProvider {
  readonly name = 'opencode'

  constructor(config: ProviderConfig) {
    super(config)
  }

  /**
   * 检测 OpenCode CLI 可用性并获取支持的模型列表
   *
   * 流程：
   * 1. which/where 查找 opencode 可执行文件
   * 2. getOpencodeClient() 获取客户端连接
   * 3. client.config.providers() 获取 providers 列表
   * 4. 遍历 providers 和 models，映射为 "{providerId}/{modelId}" 格式
   * 5. provider 字段设为 'opencode'
   */
  async connect(): Promise<ConnectResult> {
    // 检测 CLI 可用性
    if (!this.findOpencodeBinary()) {
      return {
        connected: false,
        models: [],
        notInstalled: true,
        error: 'OpenCode CLI not found',
      }
    }

    let server: { close(): void } | undefined
    try {
      const { client, server: srv } = await getOpencodeClient()
      server = srv

      const result = await client.config.providers()
      if (result.error) {
        return {
          connected: false,
          models: [],
          error: this.friendlyError(String(result.error)),
        }
      }

      const { providers } = result.data
      const models: ModelInfo[] = []

      for (const provider of providers) {
        for (const modelKey of Object.keys(provider.models)) {
          const model = provider.models[modelKey]
          models.push({
            value: `${provider.id}/${model.id}`,
            displayName: model.name || model.id,
            description: `${provider.name} - ${model.name || model.id}`,
            provider: 'opencode',
          })
        }
      }

      if (models.length === 0) {
        return {
          connected: false,
          models: [],
          error: 'No models found. Make sure OpenCode is configured with at least one provider.',
        }
      }

      return { connected: true, models }
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Failed to connect'
      return {
        connected: false,
        models: [],
        error: this.friendlyError(raw),
      }
    } finally {
      releaseOpencodeServer(server)
    }
  }

  /**
   * 流式聊天 - 通过 OpenCode SDK 与模型交互
   *
   * 流程：
   * 1. 获取客户端连接
   * 2. 创建新会话
   * 3. 注入系统提示 (noReply: true)
   * 4. 构建 parts (图片用 data URI, 文本用 text part)
   * 5. 调用 promptWithThinking() 发送消息
   * 6. 遍历 result.parts 流式 yield text
   * 7. yield done
   */
  async *chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent> {
    let server: { close(): void } | undefined
    try {
      const { client, server: srv } = await getOpencodeClient()
      server = srv

      // 创建会话
      const sessionResult = await client.session.create()
      if (sessionResult.error || !sessionResult.data) {
        yield {
          type: 'error',
          content: this.friendlyError(
            sessionResult.error
              ? String(sessionResult.error)
              : 'Failed to create session',
          ),
        }
        return
      }
      const sessionId = sessionResult.data.id

      // 注入系统提示（不期望回复）
      if (req.system) {
        await client.session.prompt({
          path: { id: sessionId },
          body: {
            noReply: true,
            parts: [{ type: 'text', text: req.system }],
          },
        })
      }

      // 构建消息 parts
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const parts = this.buildParts(lastUserMsg)

      // 发送消息（带 reasoning 回退）
      const result = await this.promptWithThinking(
        client,
        { path: { id: sessionId }, body: { parts } },
        req,
        model,
      )

      if (result.error || !result.data) {
        yield {
          type: 'error',
          content: this.friendlyError(
            result.error ? String(result.error) : 'No response received',
          ),
        }
        return
      }

      // 流式输出文本
      for (const part of result.data.parts) {
        if (part.type === 'text' && part.text) {
          yield { type: 'text', content: part.text }
        }
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      releaseOpencodeServer(server)
    }
  }

  /**
   * 非流式生成 - 等待完整结果后返回
   *
   * 流程同 chat，但收集所有 text parts 后拼接返回。
   */
  async generate(
    req: ChatRequest,
    model?: string,
  ): Promise<{ text?: string; error?: string }> {
    let server: { close(): void } | undefined
    try {
      const { client, server: srv } = await getOpencodeClient()
      server = srv

      // 创建会话
      const sessionResult = await client.session.create()
      if (sessionResult.error || !sessionResult.data) {
        return {
          error: this.friendlyError(
            sessionResult.error
              ? String(sessionResult.error)
              : 'Failed to create session',
          ),
        }
      }
      const sessionId = sessionResult.data.id

      // 注入系统提示
      if (req.system) {
        await client.session.prompt({
          path: { id: sessionId },
          body: {
            noReply: true,
            parts: [{ type: 'text', text: req.system }],
          },
        })
      }

      // 构建消息 parts
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const parts = this.buildParts(lastUserMsg)

      // 发送消息
      const result = await this.promptWithThinking(
        client,
        { path: { id: sessionId }, body: { parts } },
        req,
        model,
      )

      if (result.error || !result.data) {
        return {
          error: this.friendlyError(
            result.error ? String(result.error) : 'No response received',
          ),
        }
      }

      // 收集所有文本
      const texts: string[] = []
      for (const part of result.data.parts) {
        if (part.type === 'text' && part.text) {
          texts.push(part.text)
        }
      }

      return { text: texts.join('') }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      releaseOpencodeServer(server)
    }
  }

  /**
   * 查找 OpenCode 可执行文件路径
   * 在 Windows 上使用 where，其他平台使用 which
   */
  private findOpencodeBinary(): string | null {
    const cmd = process.platform === 'win32' ? 'where opencode' : 'which opencode'
    try {
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim()
      return result || null
    } catch {
      return null
    }
  }

  /**
   * 构建 prompt parts
   * 图片附件用 data URI 格式，文本用 text part
   */
  private buildParts(
    lastUserMsg: { role: string; content: string; attachments?: Array<{ name: string; mediaType: string; data: string }> } | undefined,
  ): Array<{ type: string; text: string }> {
    const parts: Array<{ type: string; text: string }> = []

    // 添加图片附件（data URI 格式）
    if (lastUserMsg?.attachments?.length) {
      for (const attachment of lastUserMsg.attachments) {
        parts.push({
          type: 'text',
          text: `data:${attachment.mediaType};base64,${attachment.data}`,
        })
      }
    }

    // 添加文本内容
    const textContent = lastUserMsg?.content ?? ''
    if (textContent) {
      parts.push({ type: 'text', text: textContent })
    }

    return parts
  }

  /**
   * 解析模型标识符
   * 格式: "providerId/modelId" -> { providerID, modelID }
   * 如果没有斜杠，返回默认值
   */
  private parseModel(model?: string): { providerID: string; modelID: string } | undefined {
    if (!model) return undefined
    const slashIndex = model.indexOf('/')
    if (slashIndex === -1) {
      return { providerID: model, modelID: model }
    }
    return {
      providerID: model.substring(0, slashIndex),
      modelID: model.substring(slashIndex + 1),
    }
  }

  /**
   * 根据 ChatRequest 构建 reasoning 配置
   * 支持 effort 和 thinkingBudgetTokens 参数
   */
  private buildReasoning(req: ChatRequest): Record<string, unknown> | undefined {
    if (!req.thinkingMode || req.thinkingMode === 'disabled') return undefined

    const reasoning: Record<string, unknown> = {
      enabled: req.thinkingMode === 'enabled' || req.thinkingMode === 'adaptive',
      effort: this.mapEffort(req.effort),
    }

    if (req.thinkingBudgetTokens) {
      reasoning.budgetTokens = req.thinkingBudgetTokens
    }

    return reasoning
  }

  /**
   * 发送 prompt，先尝试带 reasoning 参数，失败则回退到不带 reasoning
   * 某些模型不支持 reasoning 参数，需要回退机制
   */
  private async promptWithThinking(
    client: OpencodeClient,
    basePayload: {
      path: { id: string }
      body: {
        parts: Array<{ type: string; text: string }>
        model?: { providerID: string; modelID: string }
      }
    },
    req: ChatRequest,
    model?: string,
  ): Promise<OpencodePromptResult> {
    const parsedModel = this.parseModel(model)
    const reasoning = this.buildReasoning(req)

    const payload = {
      ...basePayload,
      body: {
        ...basePayload.body,
        ...(parsedModel ? { model: parsedModel } : {}),
        ...(reasoning ? { reasoning } : {}),
      },
    }

    try {
      return await client.session.prompt(payload)
    } catch {
      // reasoning 不被支持时回退到不带 reasoning
      if (reasoning) {
        const fallbackPayload = {
          ...basePayload,
          body: {
            ...basePayload.body,
            ...(parsedModel ? { model: parsedModel } : {}),
          },
        }
        return await client.session.prompt(fallbackPayload)
      }
      throw new Error('Prompt failed')
    }
  }

  /**
   * effort 值映射
   * max -> high (OpenCode SDK 不支持 max)
   * 其他值保持不变
   */
  private mapEffort(effort?: string): string | undefined {
    if (!effort) return undefined
    if (effort === 'max') return 'high'
    return effort
  }

  /**
   * 将原始错误信息映射为用户友好的提示
   */
  private friendlyError(raw: string): string {
    if (/ECONNREFUSED/i.test(raw)) {
      return 'OpenCode server is not reachable. Please start OpenCode first.'
    }
    if (/not found|ENOENT/i.test(raw)) {
      return 'OpenCode CLI not found. Please install it first.'
    }
    if (/timed?\s*out/i.test(raw)) {
      return 'Connection timed out. Please try again.'
    }
    return raw
  }
}

/**
 * 以下为 OpenCode SDK 类型声明
 * 用于 provider 内部类型推断
 */
interface OpencodeClient {
  config: {
    providers(options?: unknown): Promise<{
      data: {
        providers: Array<{
          id: string
          name: string
          models: Record<string, { id: string; name: string; providerID: string }>
        }>
        default: Record<string, string>
      }
      error: unknown
    }>
  }
  session: {
    create(options?: {
      body?: { parentID?: string; title?: string }
    }): Promise<{
      data: { id: string; title: string } | undefined
      error: unknown
    }>
    prompt(options: {
      path: { id: string }
      body: {
        model?: { providerID: string; modelID: string }
        noReply?: boolean
        reasoning?: Record<string, unknown>
        parts: Array<{ type: string; text: string }>
      }
    }): Promise<OpencodePromptResult>
  }
}

interface OpencodePromptResult {
  data:
    | {
        info: Record<string, unknown>
        parts: Array<{ type: string; text?: string } & Record<string, unknown>>
      }
    | undefined
  error: unknown
}
