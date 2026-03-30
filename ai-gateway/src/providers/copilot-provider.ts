/**
 * Copilot Provider - 通过 @github/copilot-sdk 桥接 GitHub Copilot CLI
 *
 * CopilotProvider
 *   |-- connect()              检测 CLI 可用性 + 获取模型列表
 *   |     |-- resolveCopilotCli()        获取 CLI 路径
 *   |     |-- CopilotClient.start()      启动客户端
 *   |     |-- client.listModels()        获取模型列表
 *   |     |-- 过滤 enabled 模型
 *   |     |-- 映射为 ModelInfo[] (provider = 'copilot')
 *   |     |-- client.stop()              清理
 *   |     └-- 返回 ConnectResult
 *   |
 *   |-- chat(req, model?)      流式聊天 (AsyncGenerator<SSEEvent>)
 *   |     |-- 创建 CopilotClient + start
 *   |     |-- createSession (streaming, onPermissionRequest)
 *   |     |-- session.on('assistant.message_delta') 收集增量
 *   |     |-- session.sendAndWait(prompt)
 *   |     |-- yield _deltaBuffer 作为 text 事件
 *   |     |-- yield done
 *   |     └-- finally: session.destroy() + client.stop()
 *   |
 *   |-- generate(req, model?)  非流式生成 (Promise)
 *   |     |-- 同 chat 流程但不 yield
 *   |     └-- 直接返回 { text }
 *   |
 *   |-- mapCopilotReasoningEffort()  effort 映射
 *   └-- friendlyError()             错误映射为友好提示
 */

import {
  BaseProvider,
  type ChatRequest,
  type ConnectResult,
  type SSEEvent,
  type ModelInfo,
} from './base-provider.js'
import type { ProviderConfig } from '../config.js'
import { resolveCopilotCli } from '../utils/copilot-client.js'

/** Copilot SDK 的模型类型 */
interface CopilotModel {
  id: string
  name?: string
  description?: string
  enabled?: boolean
  vendor?: string
  capabilities?: Record<string, unknown>
}

/** Copilot SDK 的 CopilotClient 实例接口 */
interface CopilotClientLike {
  start(): Promise<void>
  stop(): Promise<unknown>
  listModels(): Promise<CopilotModel[]>
  createSession(options: CopilotSessionOptions): Promise<CopilotSessionLike>
}

/** Copilot SDK 的 Session 实例接口 */
interface CopilotSessionLike {
  on(event: string, handler: (...args: unknown[]) => void): void
  sendAndWait(options: { prompt: string }, timeoutMs: number): Promise<unknown>
  destroy(): Promise<void>
}

/** createSession 参数接口 */
interface CopilotSessionOptions {
  model: string
  streaming: boolean
  onPermissionRequest: (request: unknown) => Promise<string>
  systemMessage?: { mode: string; content: string }
  reasoningEffort?: string
}

/**
 * 将通用 effort 值映射为 Copilot SDK 的 reasoningEffort
 *
 * 映射规则：
 * - max -> xhigh
 * - 其他值保持不变 (low, medium, high)
 */
export function mapCopilotReasoningEffort(
  effort: 'low' | 'medium' | 'high' | 'max' | undefined,
): string | undefined {
  if (!effort) return undefined
  if (effort === 'max') return 'xhigh'
  return effort
}

export class CopilotProvider extends BaseProvider {
  readonly name = 'copilot'

  constructor(config: ProviderConfig) {
    super(config)
  }

  /**
   * 检测 Copilot CLI 可用性并获取支持的模型列表
   *
   * 流程：
   * 1. resolveCopilotCli() 获取 CLI 路径
   * 2. 动态 import @github/copilot-sdk 的 CopilotClient
   * 3. 启动客户端，调用 listModels()
   * 4. 过滤 enabled 模型，映射为 ModelInfo[]
   * 5. 停止客户端，返回结果
   */
  async connect(): Promise<ConnectResult> {
    const cliPath = resolveCopilotCli()
    if (!cliPath) {
      return {
        connected: false,
        models: [],
        notInstalled: true,
        error: 'GitHub Copilot CLI not found',
      }
    }

    let client: CopilotClientLike | undefined

    try {
      // 动态导入 @github/copilot-sdk
      const sdk = await import('@github/copilot-sdk')
      // @ts-ignore - CopilotClient 导出方式因版本而异
      const CopilotClientClass: new (opts: unknown) => CopilotClientLike =
        sdk.CopilotClient ?? (sdk as Record<string, unknown>).CopilotClient

      if (!CopilotClientClass) {
        return {
          connected: false,
          models: [],
          error: 'Failed to load CopilotClient from @github/copilot-sdk',
        }
      }

      // 创建并启动客户端
      client = new CopilotClientClass({ autoStart: true, cliPath })
      await client.start()

      // 获取模型列表
      const rawModels = await client.listModels()

      // 过滤 enabled 模型并映射
      const models: ModelInfo[] = rawModels
        .filter((m: CopilotModel) => m.enabled !== false)
        .map((m: CopilotModel) => ({
          value: m.id,
          displayName: m.name ?? m.id,
          description: m.description ?? '',
          provider: 'copilot',
        }))

      // 停止客户端
      await client.stop()
      client = undefined

      // 无可用模型时提示用户登录
      if (models.length === 0) {
        return {
          connected: false,
          models: [],
          error: 'No models available. Run "copilot login" first.',
        }
      }

      return { connected: true, models }
    } catch (error) {
      // 确保客户端被清理
      if (client) {
        await client.stop().catch(() => {})
      }

      const raw = error instanceof Error ? error.message : 'Failed to connect'
      return {
        connected: false,
        models: [],
        error: this.friendlyError(raw),
      }
    }
  }

  /**
   * 流式聊天 - 通过 Copilot SDK 与 Copilot CLI 交互
   *
   * 流程：
   * 1. 创建 CopilotClient + start
   * 2. createSession (streaming, approve permissions)
   * 3. 订阅 assistant.message_delta 收集增量文本
   * 4. sendAndWait 发送 prompt
   * 5. yield 增量文本作为 text 事件
   * 6. yield done
   */
  async *chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent> {
    const cliPath = resolveCopilotCli()
    if (!cliPath) {
      yield { type: 'error', content: 'GitHub Copilot CLI not found.' }
      return
    }

    let client: CopilotClientLike | undefined
    let session: CopilotSessionLike | undefined

    try {
      // 动态导入 SDK
      const sdk = await import('@github/copilot-sdk')
      // @ts-ignore - CopilotClient 导出方式因 SDK 版本而异
      const CopilotClient = sdk.CopilotClient

      // 创建客户端
      client = new CopilotClient({ autoStart: true, cliPath }) as unknown as CopilotClientLike
      await client.start()

      // 从最后一条用户消息提取 prompt
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const prompt = lastUserMsg?.content ?? ''

      // 构建 reasoningEffort
      const reasoningEffort = mapCopilotReasoningEffort(req.effort)

      // 自动批准所有权限请求
      const approveAll = async (_request: unknown): Promise<string> => 'allow'

      // 创建会话
      session = await client.createSession({
        model: model ?? 'gpt-4o',
        streaming: true,
        onPermissionRequest: approveAll,
        ...(req.system ? { systemMessage: { mode: 'replace', content: req.system } } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      })

      // 收集增量文本的缓冲区
      let _deltaBuffer = ''

      // 订阅增量消息
      session.on('assistant.message_delta', (...args: unknown[]) => {
        const delta = args[0] as { text?: string } | undefined
        if (delta?.text) {
          _deltaBuffer += delta.text
        }
      })

      // 发送 prompt 并等待完成
      await session.sendAndWait({ prompt }, 120_000)

      // yield 收集到的文本
      if (_deltaBuffer) {
        yield { type: 'text', content: _deltaBuffer }
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      // 清理会话和客户端
      if (session) {
        await session.destroy().catch(() => {})
      }
      if (client) {
        await client.stop().catch(() => {})
      }
    }
  }

  /**
   * 非流式生成 - 等待完整结果后返回
   *
   * 流程与 chat 相同，但不 yield 事件，直接返回 { text }
   */
  async generate(
    req: ChatRequest,
    model?: string,
  ): Promise<{ text?: string; error?: string }> {
    const cliPath = resolveCopilotCli()
    if (!cliPath) {
      return { error: 'GitHub Copilot CLI not found.' }
    }

    let client: CopilotClientLike | undefined
    let session: CopilotSessionLike | undefined

    try {
      // 动态导入 SDK
      const sdk = await import('@github/copilot-sdk')
      // @ts-ignore - CopilotClient 导出方式因 SDK 版本而异
      const CopilotClient = sdk.CopilotClient

      // 创建客户端
      client = new CopilotClient({ autoStart: true, cliPath }) as unknown as CopilotClientLike
      await client.start()

      // 从最后一条用户消息提取 prompt
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const prompt = lastUserMsg?.content ?? ''

      // 构建 reasoningEffort
      const reasoningEffort = mapCopilotReasoningEffort(req.effort)

      // 自动批准所有权限请求
      const approveAll = async (_request: unknown): Promise<string> => 'allow'

      // 创建会话
      session = await client.createSession({
        model: model ?? 'gpt-4o',
        streaming: true,
        onPermissionRequest: approveAll,
        ...(req.system ? { systemMessage: { mode: 'replace', content: req.system } } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      })

      // 收集增量文本的缓冲区
      let _deltaBuffer = ''

      // 订阅增量消息
      session.on('assistant.message_delta', (...args: unknown[]) => {
        const delta = args[0] as { text?: string } | undefined
        if (delta?.text) {
          _deltaBuffer += delta.text
        }
      })

      // 发送 prompt 并等待完成
      await session.sendAndWait({ prompt }, 120_000)

      return { text: _deltaBuffer }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      // 清理会话和客户端
      if (session) {
        await session.destroy().catch(() => {})
      }
      if (client) {
        await client.stop().catch(() => {})
      }
    }
  }

  /**
   * 将原始错误信息映射为用户友好的提示
   *
   * 映射规则：
   * - not found / ENOENT -> CLI 未找到
   * - not authenticated / auth / login -> 未登录
   * - timeout -> 连接超时
   */
  private friendlyError(raw: string): string {
    if (/not found|ENOENT/i.test(raw)) {
      return 'GitHub Copilot CLI not found.'
    }
    if (/not authenticated|auth|login/i.test(raw)) {
      return 'Not authenticated. Run "copilot login" first.'
    }
    if (/timed?\s*out/i.test(raw)) {
      return 'Connection timed out.'
    }
    return raw
  }
}
