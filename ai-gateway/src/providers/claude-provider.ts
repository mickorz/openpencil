/**
 * Claude Provider - 通过 Claude Agent SDK 桥接 Claude Code CLI
 *
 * ClaudeProvider
 *   |-- connect()       检测 CLI 可用性 + 获取模型列表
 *   |     |-- resolveClaudeCli()        获取 CLI 路径
 *   |     |-- query().supportedModels() 获取模型列表
 *   |     |-- friendlyError()           错误映射
 *   |     └-- 返回 ConnectResult
 *   |
 *   |-- chat()          流式聊天 (AsyncGenerator<SSEEvent>)
 *   |     |-- 图片模式 (attachments > 0)
 *   |     |     |-- saveAttachmentsToTempFiles()  保存到项目内临时文件
 *   |     |     |-- stripNoTools()                移除工具限制
 *   |     |     |-- maxTurns=3, result-based 等待
 *   |     |     └-- yield 完整结果
 *   |     |
 *   |     |-- 文本模式 (无 attachments)
 *   |     |     |-- includePartialMessages=true
 *   |     |     |-- maxTurns=1
 *   |     |     └-- 流式 yield content_block_delta
 *   |     |
 *   |     └-- yield { type: 'done' } + cleanup
 *   |
 *   |-- generate()      非流式生成 (Promise)
 *   |     |-- 等待 result 事件
 *   |     |-- success -> { text }
 *   |     |-- error   -> { error }
 *   |     └-- 无 result -> { error: 'No result received' }
 *   |
 *   |-- getThinkingConfig()  根据 thinkingMode 构建 thinking 配置
 *   |-- stripNoTools()       移除 "NEVER use tools" 指令
 *   └-- friendlyError()     原始错误映射为友好提示
 */

import {
  BaseProvider,
  type ChatRequest,
  type ConnectResult,
  type SSEEvent,
  type ModelInfo,
} from './base-provider.js'
import type { ProviderConfig } from '../config.js'
import { resolveClaudeCli } from '../utils/resolve-claude-cli.js'
import {
  buildClaudeAgentEnv,
  getClaudeAgentDebugFilePath,
} from '../utils/resolve-claude-agent-env.js'
import { saveAttachmentsToTempFiles, cleanupDir } from '../utils/temp-files.js'

export class ClaudeProvider extends BaseProvider {
  readonly name = 'claude'

  constructor(config: ProviderConfig) {
    super(config)
  }

  /**
   * 检测 Claude Code CLI 可用性并获取支持的模型列表
   *
   * 流程：
   * 1. resolveClaudeCli() 获取 CLI 路径
   * 2. 动态 import Agent SDK 的 query 函数
   * 3. 用 buildClaudeAgentEnv() 构建环境变量
   * 4. 调用 q.supportedModels() 获取模型列表
   * 5. 映射为 ModelInfo[]（provider 设为 'anthropic'）
   */
  async connect(): Promise<ConnectResult> {
    const claudePath = resolveClaudeCli()
    if (!claudePath) {
      return {
        connected: false,
        models: [],
        notInstalled: true,
        error: 'Claude Code CLI not found',
      }
    }

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const env = buildClaudeAgentEnv()
      const debugFile = getClaudeAgentDebugFilePath()

      const q = query({
        prompt: '',
        options: {
          maxTurns: 1,
          tools: [],
          permissionMode: 'plan',
          persistSession: false,
          env,
          ...(debugFile ? { debugFile } : {}),
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        },
      })

      const raw = await q.supportedModels()
      q.close()

      const models: ModelInfo[] = raw.map((m: { value: string; displayName: string; description: string }) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
        provider: 'anthropic',
      }))

      return { connected: true, models }
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Failed to connect'
      return {
        connected: false,
        models: [],
        error: this.friendlyError(raw),
      }
    }
  }

  /**
   * 流式聊天 - 通过 Claude Agent SDK 与 Claude Code CLI 交互
   *
   * 两种模式：
   * - 图片模式 (attachments.length > 0): 保存到项目内临时文件，用 Read 工具引用，result-based 等待完整结果
   * - 文本模式 (无 attachments): includePartialMessages=true，流式 yield content_block_delta
   */
  async *chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent> {
    const claudePath = resolveClaudeCli()
    const env = buildClaudeAgentEnv()
    const debugFile = getClaudeAgentDebugFilePath()

    // 从最后一条用户消息中提取 prompt 和附件
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
    let prompt = lastUserMsg?.content ?? ''

    const attachments = lastUserMsg?.attachments ?? []
    const hasImages = attachments.length > 0
    let attachTempDir: string | undefined

    try {
      // 图片模式：保存附件到项目目录内，供 Claude Code 的 Read 工具读取
      if (hasImages) {
        const saved = await saveAttachmentsToTempFiles(attachments, true)
        attachTempDir = saved.tempDir
        const imageRefs = saved.files
          .map((f) => `First, use the Read tool to read the image file at "${f}". Then analyze it.`)
          .join('\n')
        prompt = imageRefs + '\n\n' + (prompt || 'Describe what you see in the image.')
      }

      // 图片模式下需要移除 "NEVER use tools" 限制，以便 Claude Code 使用 Read 工具
      const systemPrompt = hasImages ? this.stripNoTools(req.system) : req.system
      const thinking = this.getThinkingConfig(req)

      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const q = query({
        prompt,
        options: {
          systemPrompt,
          ...(model ? { model } : {}),
          maxTurns: hasImages ? 3 : 1,
          includePartialMessages: !hasImages,
          tools: [],
          plugins: [],
          permissionMode: 'plan',
          persistSession: false,
          ...(req.effort ? { effort: req.effort } : {}),
          ...(thinking ? { thinking } : {}),
          env,
          ...(debugFile ? { debugFile } : {}),
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        },
      })

      try {
        for await (const message of q) {
          if (hasImages) {
            // 图片模式：只等待 result 事件
            if (message.type === 'result') {
              const isErrorResult = 'is_error' in message && Boolean((message as { is_error?: boolean }).is_error)
              if (message.subtype === 'success' && !isErrorResult) {
                const text = (message as { result?: string }).result ?? ''
                if (text) {
                  yield { type: 'text', content: text }
                }
              } else {
                const errors = 'errors' in message ? (message.errors as string[]) : []
                const resultText = 'result' in message ? String((message as { result?: string }).result ?? '') : ''
                const content = errors.join('; ') || resultText || `Query ended with: ${message.subtype}`
                yield { type: 'error', content }
              }
            }
          } else {
            // 文本模式：流式输出 content_block_delta
            if (message.type === 'stream_event') {
              const ev = (message as { event: { type: string; delta: { type: string; text?: string; thinking?: string } } }).event
              if (ev.type === 'content_block_delta') {
                if (ev.delta.type === 'text_delta') {
                  yield { type: 'text', content: ev.delta.text ?? '' }
                } else if (ev.delta.type === 'thinking_delta') {
                  yield { type: 'thinking', content: (ev.delta as { thinking?: string }).thinking ?? '' }
                }
              }
            } else if (message.type === 'result') {
              const isErrorResult = 'is_error' in message && Boolean((message as { is_error?: boolean }).is_error)
              if (message.subtype !== 'success' || isErrorResult) {
                const errors = 'errors' in message ? (message.errors as string[]) : []
                const resultText = 'result' in message ? String((message as { result?: string }).result ?? '') : ''
                const content = errors.join('; ') || resultText || `Query ended with: ${message.subtype}`
                yield { type: 'error', content }
              }
            }
          }
        }
      } finally {
        q.close()
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      // 清理临时文件
      if (attachTempDir) {
        await cleanupDir(attachTempDir).catch(() => {})
      }
    }
  }

  /**
   * 非流式生成 - 等待完整结果后返回
   *
   * 流程：
   * 1. 构建 query 参数
   * 2. 等待 result 事件
   * 3. success 返回 { text: message.result }
   * 4. error 返回 { error: ... }
   * 5. 无 result 返回 { error: 'No result received from Claude Agent SDK' }
   */
  async generate(
    req: ChatRequest,
    model?: string,
  ): Promise<{ text?: string; error?: string }> {
    const claudePath = resolveClaudeCli()
    const env = buildClaudeAgentEnv()
    const debugFile = getClaudeAgentDebugFilePath()
    const thinking = this.getThinkingConfig(req)

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')

      const q = query({
        prompt: lastUserMsg?.content ?? '',
        options: {
          systemPrompt: req.system,
          ...(model ? { model } : {}),
          maxTurns: 1,
          tools: [],
          plugins: [],
          permissionMode: 'plan',
          persistSession: false,
          ...(req.effort ? { effort: req.effort } : {}),
          ...(thinking ? { thinking } : {}),
          env,
          ...(debugFile ? { debugFile } : {}),
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        },
      })

      try {
        for await (const message of q) {
          if (message.type === 'result') {
            const isErrorResult = 'is_error' in message && Boolean((message as { is_error?: boolean }).is_error)
            if (message.subtype === 'success' && !isErrorResult) {
              return { text: (message as { result?: string }).result ?? '' }
            }
            const errors = 'errors' in message ? (message.errors as string[]) : []
            const resultText = 'result' in message ? String((message as { result?: string }).result ?? '') : ''
            return { error: errors.join('; ') || resultText || 'Query failed' }
          }
        }
      } finally {
        q.close()
      }

      return { error: 'No result received from Claude Agent SDK' }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * 根据请求中的 thinkingMode 构建 thinking 配置
   *
   * - enabled -> { type: 'enabled', budgetTokens? }
   * - adaptive / disabled -> { type: mode }
   * - undefined -> undefined
   */
  private getThinkingConfig(req: ChatRequest):
    | { type: 'adaptive' | 'disabled' }
    | { type: 'enabled'; budgetTokens?: number }
    | undefined {
    if (!req.thinkingMode) return undefined
    if (req.thinkingMode === 'enabled') {
      return { type: 'enabled', budgetTokens: req.thinkingBudgetTokens }
    }
    return { type: req.thinkingMode }
  }

  /**
   * 移除系统提示中的 "NEVER use tools" 限制
   * 图片模式下 Claude Code 需要使用 Read 工具读取图片文件
   */
  private stripNoTools(prompt: string): string {
    return prompt
      .replace(/^.*NEVER use tools.*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
  }

  /**
   * 将原始错误信息映射为用户友好的提示
   */
  private friendlyError(raw: string): string {
    if (/process exited with code 1|invalid model|unknown model|model.*not/i.test(raw)) {
      return 'Claude Code exited with code 1. Check your model mapping and run "claude login" if needed.'
    }
    if (/exited with code/i.test(raw)) {
      return 'Unable to connect. Claude Code process exited unexpectedly.'
    }
    if (/not found|ENOENT/i.test(raw)) {
      return 'Claude Code CLI not found. Please install it first.'
    }
    if (/timed?\s*out/i.test(raw)) {
      return 'Connection timed out. Please try again.'
    }
    return raw
  }
}
