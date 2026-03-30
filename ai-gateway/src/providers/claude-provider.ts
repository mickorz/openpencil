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
  type McpServerConfig,
} from './base-provider.js'
import type { ProviderConfig } from '../config.js'

interface SkillQueryOptions {
  cwd?: string
  settingSources?: Array<'user' | 'project' | 'local'>
  plugins?: Array<{ type: 'local'; path: string }>
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
  allowedTools?: string[]
  disallowedTools?: string[]
  mcpServers?: Record<string, McpServerConfig>
}
import { resolveClaudeCli } from '../utils/resolve-claude-cli.js'
import {
  buildClaudeAgentEnv,
  getClaudeAgentDebugFilePath,
} from '../utils/resolve-claude-agent-env.js'
import { saveAttachmentsToTempFiles, cleanupDir } from '../utils/temp-files.js'
import { validateCwd } from '../utils/validate-cwd.js'

const log = {
  info: (...args: unknown[]) => console.log('[ClaudeProvider]', ...args),
  warn: (...args: unknown[]) => console.warn('[ClaudeProvider]', ...args),
  error: (...args: unknown[]) => console.error('[ClaudeProvider]', ...args),
}

export class ClaudeProvider extends BaseProvider {
  readonly name = 'claude'

  constructor(config: ProviderConfig) {
    super(config)
  }

  /**
   * 前置校验请求参数
   * cwd 不在白名单时直接抛错, 路由层在 SSE 流之前拦截
   */
  override validateRequest(req: Partial<ChatRequest>): void {
    if (req.cwd) {
      const allowedDirs = this.config.allowedCwdDirs ?? []
      const validated = validateCwd(req.cwd, allowedDirs)
      if (!validated) {
        throw new Error(`cwd "${req.cwd}" 不在允许的目录白名单中. 允许的目录: [${allowedDirs.join(', ')}]`)
      }
    }
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
    log.info('[connect] 开始检测 Claude Code CLI...')
    const claudePath = resolveClaudeCli()
    if (!claudePath) {
      log.warn('[connect] Claude Code CLI 未找到')
      return {
        connected: false,
        models: [],
        notInstalled: true,
        error: 'Claude Code CLI not found',
      }
    }

    log.info('[connect] CLI 路径:', claudePath)

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const env = buildClaudeAgentEnv()
      const debugFile = getClaudeAgentDebugFilePath()

      log.info('[connect] 构建 query, debugFile:', debugFile ?? '(无)')

      const q = query({
        prompt: '',
        options: {
          maxTurns: 1,
          // 不传 tools 或传 undefined, SDK 使用默认内置工具集 (Read, Glob, Bash 等)
        // tools: [],  // 空数组会禁用所有工具
          permissionMode: 'plan' as const,
          persistSession: false,
          env,
          ...(debugFile ? { debugFile } : {}),
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        },
      })

      log.info('[connect] 请求模型列表...')
      const raw = await q.supportedModels()
      q.close()

      const models: ModelInfo[] = raw.map((m: { value: string; displayName: string; description: string }) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
        provider: 'anthropic',
      }))

      log.info('[connect] 获取到模型列表, 数量:', models.length, models.map(m => m.value).join(', '))
      return { connected: true, models }
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Failed to connect'
      log.error('[connect] 连接失败:', raw)
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
    const startTime = Date.now()
    log.info('[chat] 开始流式聊天请求, model:', model ?? '(默认)')

    const claudePath = resolveClaudeCli()
    const env = buildClaudeAgentEnv()
    const debugFile = getClaudeAgentDebugFilePath()

    // 从最后一条用户消息中提取 prompt 和附件
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
    let prompt = lastUserMsg?.content ?? ''

    const attachments = lastUserMsg?.attachments ?? []
    const hasImages = attachments.length > 0
    let attachTempDir: string | undefined

    log.info('[chat] 消息数:', req.messages.length, ', 附件数:', attachments.length, ', 图片模式:', hasImages)
    log.info('[chat] prompt 长度:', prompt.length, ', effort:', req.effort ?? '(默认)', ', thinkingMode:', req.thinkingMode ?? '(默认)')

    try {
      // 图片模式：保存附件到项目目录内，供 Claude Code 的 Read 工具读取
      if (hasImages) {
        const saved = await saveAttachmentsToTempFiles(attachments, true)
        attachTempDir = saved.tempDir
        log.info('[chat] 保存附件到临时目录:', attachTempDir, ', 文件数:', saved.files.length)
        const imageRefs = saved.files
          .map((f) => `First, use the Read tool to read the image file at "${f}". Then analyze it.`)
          .join('\n')
        prompt = imageRefs + '\n\n' + (prompt || 'Describe what you see in the image.')
      }

      // 图片模式下需要移除 "NEVER use tools" 限制，以便 Claude Code 使用 Read 工具
      const systemPrompt = hasImages ? this.stripNoTools(req.system) : req.system
      const thinking = this.getThinkingConfig(req)

      const skillOpts = this.buildSkillOptions(req)

      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const queryOptions = {
        systemPrompt,
        ...(model ? { model } : {}),
        maxTurns: req.maxTurns ?? (hasImages ? 3 : 1),
        includePartialMessages: !hasImages,
        // 不传 tools 或传 undefined, SDK 使用默认内置工具集 (Read, Glob, Bash 等)
        // tools: [],  // 空数组会禁用所有工具
        plugins: skillOpts.plugins ?? [],
        permissionMode: req.permissionMode ?? 'plan',
        ...(req.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
        persistSession: false,
        ...(req.effort ? { effort: req.effort } : {}),
        ...(thinking ? { thinking } : {}),
        env,
        ...(debugFile ? { debugFile } : {}),
        ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        // skill 相关参数
        ...(skillOpts.cwd ? { cwd: skillOpts.cwd } : {}),
        ...(skillOpts.settingSources ? { settingSources: skillOpts.settingSources } : {}),
        ...(skillOpts.outputFormat ? { outputFormat: skillOpts.outputFormat } : {}),
        ...(skillOpts.allowedTools ? { allowedTools: skillOpts.allowedTools } : {}),
        ...(skillOpts.disallowedTools ? { disallowedTools: skillOpts.disallowedTools } : {}),
        ...(skillOpts.mcpServers ? { mcpServers: skillOpts.mcpServers } : {}),
      }

      log.info('[chat] 构建 query, maxTurns:', queryOptions.maxTurns, ', includePartialMessages:', queryOptions.includePartialMessages, ', permissionMode:', queryOptions.permissionMode)
      log.info('[chat] 发送请求, prompt 前100字符:', prompt.substring(0, 100))

      const q = query({ prompt, options: queryOptions })

      let eventCount = 0
      try {
        for await (const message of q) {
          eventCount++
          if (hasImages) {
            // 图片模式：只等待 result 事件
            if (message.type === 'result') {
              log.info('[chat] 图片模式收到 result, subtype:', message.subtype)
              const isErrorResult = 'is_error' in message && Boolean((message as { is_error?: boolean }).is_error)
              if (message.subtype === 'success' && !isErrorResult) {
                const text = (message as { result?: string }).result ?? ''
                log.info('[chat] 图片模式完整响应:', text)
                if (text) {
                  yield { type: 'text', content: text }
                }
              } else {
                const errors = 'errors' in message ? (message.errors as string[]) : []
                const resultText = 'result' in message ? String((message as { result?: string }).result ?? '') : ''
                const content = errors.join('; ') || resultText || `Query ended with: ${message.subtype}`
                log.warn('[chat] 图片模式错误:', content)
                yield { type: 'error', content }
              }
            }
          } else {
            // 文本模式：流式输出 content_block_delta
            if (message.type === 'stream_event') {
              const ev = (message as { event: { type: string; delta: { type: string; text?: string; thinking?: string } } }).event
              if (ev.type === 'content_block_delta') {
                if (ev.delta.type === 'text_delta') {
                  const deltaText = ev.delta.text ?? ''
                  log.info('[chat] 流式 delta (text_delta):', deltaText)
                  yield { type: 'text', content: deltaText }
                } else if (ev.delta.type === 'thinking_delta') {
                  const thinkingText = (ev.delta as { thinking?: string }).thinking ?? ''
                  log.info('[chat] 流式 delta (thinking_delta):', thinkingText)
                  yield { type: 'thinking', content: thinkingText }
                }
              }
            } else if (message.type === 'result') {
              const isErrorResult = 'is_error' in message && Boolean((message as { is_error?: boolean }).is_error)
              if (message.subtype !== 'success' || isErrorResult) {
                const errors = 'errors' in message ? (message.errors as string[]) : []
                const resultText = 'result' in message ? String((message as { result?: string }).result ?? '') : ''
                const content = errors.join('; ') || resultText || `Query ended with: ${message.subtype}`
                log.warn('[chat] 文本模式 result 错误:', content)
                yield { type: 'error', content }
              }
            }
          }
        }
      } finally {
        q.close()
      }

      const elapsed = Date.now() - startTime
      log.info('[chat] 流式聊天完成, 总事件数:', eventCount, ', 耗时:', elapsed, 'ms')
      yield { type: 'done', content: '' }
    } catch (error) {
      const elapsed = Date.now() - startTime
      log.error('[chat] 流式聊天异常, 耗时:', elapsed, 'ms, 错误:', error instanceof Error ? error.message : error)
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      // 清理临时文件
      if (attachTempDir) {
        log.info('[chat] 清理临时目录:', attachTempDir)
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
    const startTime = Date.now()
    log.info('[generate] 开始非流式生成请求, model:', model ?? '(默认)')

    const claudePath = resolveClaudeCli()
    const env = buildClaudeAgentEnv()
    const debugFile = getClaudeAgentDebugFilePath()
    const thinking = this.getThinkingConfig(req)

    try {
      const skillOpts = this.buildSkillOptions(req)

      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const prompt = lastUserMsg?.content ?? ''

      log.info('[generate] 消息数:', req.messages.length, ', prompt 长度:', prompt.length)

      const q = query({
        prompt,
        options: {
          systemPrompt: req.system,
          ...(model ? { model } : {}),
          maxTurns: req.maxTurns ?? 1,
          // 不传 tools 或传 undefined, SDK 使用默认内置工具集 (Read, Glob, Bash 等)
        // tools: [],  // 空数组会禁用所有工具
          plugins: skillOpts.plugins ?? [],
          permissionMode: req.permissionMode ?? 'plan',
          ...(req.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
          persistSession: false,
          ...(req.effort ? { effort: req.effort } : {}),
          ...(thinking ? { thinking } : {}),
          env,
          ...(debugFile ? { debugFile } : {}),
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
          // skill 相关参数
          ...(skillOpts.cwd ? { cwd: skillOpts.cwd } : {}),
          ...(skillOpts.settingSources ? { settingSources: skillOpts.settingSources } : {}),
          ...(skillOpts.outputFormat ? { outputFormat: skillOpts.outputFormat } : {}),
          ...(skillOpts.allowedTools ? { allowedTools: skillOpts.allowedTools } : {}),
          ...(skillOpts.disallowedTools ? { disallowedTools: skillOpts.disallowedTools } : {}),
        ...(skillOpts.mcpServers ? { mcpServers: skillOpts.mcpServers } : {}),
        },
      })

      let messageCount = 0
      try {
        for await (const message of q) {
          messageCount++
          if (message.type === 'result') {
            const isErrorResult = 'is_error' in message && Boolean((message as { is_error?: boolean }).is_error)
            if (message.subtype === 'success' && !isErrorResult) {
              const text = (message as { result?: string }).result ?? ''
              const elapsed = Date.now() - startTime
              log.info('[generate] 生成成功, 消息数:', messageCount, ', 耗时:', elapsed, 'ms')
              log.info('[generate] 完整响应内容:', text)
              return { text }
            }
            const errors = 'errors' in message ? (message.errors as string[]) : []
            const resultText = 'result' in message ? String((message as { result?: string }).result ?? '') : ''
            const errMsg = errors.join('; ') || resultText || 'Query failed'
            const elapsed = Date.now() - startTime
            log.error('[generate] 生成失败, 耗时:', elapsed, 'ms')
            log.error('[generate] 完整错误响应:', errMsg)
            return { error: errMsg }
          }
        }
      } finally {
        q.close()
      }

      const elapsed = Date.now() - startTime
      log.warn('[generate] 未收到 result 事件, 消息数:', messageCount, ', 耗时:', elapsed, 'ms')
      return { error: 'No result received from Claude Agent SDK' }
    } catch (error) {
      const elapsed = Date.now() - startTime
      log.error('[generate] 生成异常, 耗时:', elapsed, 'ms, 错误:', error instanceof Error ? error.message : error)
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
   * 从请求中构建 skill 相关的 query 选项
   * 统一处理 cwd / settingSources / plugins / outputFormat / allowedTools / disallowedTools
   */
  private buildSkillOptions(req: ChatRequest): SkillQueryOptions {
    const opts: SkillQueryOptions = {}

    // cwd - 安全校验后透传, 不在白名单则直接报错
    if (req.cwd) {
      const allowedDirs = this.config.allowedCwdDirs ?? []
      const validatedCwd = validateCwd(req.cwd, allowedDirs)
      if (validatedCwd) {
        opts.cwd = validatedCwd
        log.info('[buildSkillOptions] cwd 已校验通过:', validatedCwd)
      } else {
        throw new Error(`cwd "${req.cwd}" 不在允许的目录白名单中. 允许的目录: [${allowedDirs.join(', ')}]`)
      }
    }

    // settingSources
    if (req.settingSources && req.settingSources.length > 0) {
      opts.settingSources = req.settingSources
    }

    // plugins
    if (req.plugins && req.plugins.length > 0) {
      opts.plugins = req.plugins
    }

    // outputFormat
    if (req.outputFormat) {
      opts.outputFormat = req.outputFormat
    }

    // allowedTools
    if (req.allowedTools && req.allowedTools.length > 0) {
      opts.allowedTools = req.allowedTools
    }

    // disallowedTools
    if (req.disallowedTools && req.disallowedTools.length > 0) {
      opts.disallowedTools = req.disallowedTools
    }

    // mcpServers - 透传给 SDK
    if (req.mcpServers && Object.keys(req.mcpServers).length > 0) {
      opts.mcpServers = req.mcpServers
      log.info('[buildSkillOptions] mcpServers:', Object.keys(req.mcpServers).join(', '))
    }

    return opts
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
