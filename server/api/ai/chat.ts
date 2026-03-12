/**
 * AI 聊天流式 API 端点
 *
 * 支持多种 AI 提供商：
 * - anthropic: Claude Agent SDK（使用本地 Claude Code OAuth 登录）
 * - openai: 通过 Codex CLI 调用
 * - opencode: OpenCode SDK
 * - copilot: GitHub Copilot SDK
 *
 * 数据流架构：
 * ┌─────────────┐      ┌──────────────────┐      ┌─────────────┐
 * │  前端请求    │ ───> │  路由选择 Provider │ ───> │  AI SDK调用  │
 * │ (SSE格式)   │      │  anthropic/       │      │  流式响应    │
 * │             │ <─── │  opencode/codex/  │ <─── │             │
 * │             │      │  copilot          │      │             │
 * └─────────────┘      └──────────────────┘      └─────────────┘
 */
import { defineEventHandler, readBody, setResponseHeaders } from 'h3'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveClaudeCli } from '../../utils/resolve-claude-cli'
import { runCodexExec } from '../../utils/codex-client'
import {
  buildClaudeAgentEnv,
  getClaudeAgentDebugFilePath,
} from '../../utils/resolve-claude-agent-env'

/** 调试日志中敏感数据的检测模式（用于过滤日志输出） */
export const SENSITIVE_LOG_PATTERN = /ANTHROPIC_API_KEY=|Authorization:\s*Bearer|api[_-]?key\s*[:=]/i

/** 允许的图片附件媒体类型 */
export const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * 根据媒体类型解析文件扩展名
 * 对于不允许的类型，回退到 'png'
 */
export function resolveMediaExtension(mediaType: string): string {
  return ALLOWED_MEDIA_TYPES.has(mediaType) ? mediaType.split('/')[1] : 'png'
}

/**
 * 聊天附件的传输格式（base64编码）
 */
interface ChatAttachmentWire {
  name: string       // 文件名
  mediaType: string  // MIME类型，如 'image/png'
  data: string       // base64编码的数据
}

/**
 * 聊天请求体结构
 */
interface ChatBody {
  system: string        // 系统提示词
  messages: Array<{     // 消息历史
    role: 'user' | 'assistant'
    content: string
    attachments?: ChatAttachmentWire[]  // 可选的图片附件
  }>
  model?: string        // 模型标识符
  provider?: 'anthropic' | 'openai' | 'opencode' | 'copilot'  // AI提供商
  thinkingMode?: 'adaptive' | 'disabled' | 'enabled'  // 思考模式
  thinkingBudgetTokens?: number  // 思考预算token数
  effort?: 'low' | 'medium' | 'high' | 'max'  // 推理努力程度
}

/**
 * 读取调试日志文件的最后几行
 * 用于在 Claude Code 退出时分析错误原因
 * @param path 调试日志文件路径
 * @param maxLines 最大读取行数，默认40行
 * @returns 过滤敏感信息后的日志行数组，失败返回 undefined
 */
async function readDebugTail(path?: string, maxLines = 40): Promise<string[] | undefined> {
  if (!path) return undefined
  try {
    const raw = await readFile(path, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    // 过滤掉包含敏感信息的日志行
    const sanitized = lines.filter(l => !SENSITIVE_LOG_PATTERN.test(l))
    return sanitized.slice(-maxLines)
  } catch {
    return undefined
  }
}

/**
 * 根据 Claude Code 退出错误和调试日志构建更友好的错误提示
 * @param rawError 原始错误信息
 * @param debugTail 调试日志尾部
 * @returns 增强后的错误提示，如果无法确定原因则返回 undefined
 */
function buildClaudeExitHint(rawError: string, debugTail?: string[]): string | undefined {
  // 只处理退出码为1的情况
  if (!/process exited with code 1/i.test(rawError)) return undefined
  if (!debugTail || debugTail.length === 0) return undefined
  const text = debugTail.join('\n')

  const hints: string[] = []
  // 检测配置文件权限问题
  if (/Failed to save config with lock: Error: EPERM|operation not permitted, .*\.claude\.json/i.test(text)) {
    hints.push('Claude Code cannot write ~/.claude.json in the current runtime (permission denied).')
  }
  // 检测网络连接问题
  if (/Connection error|Could not resolve host|Failed to connect/i.test(text)) {
    hints.push('Upstream API connection failed (check proxy/DNS/network reachability to your ANTHROPIC_BASE_URL).')
  }
  // 检测认证头问题
  if (/ANTHROPIC_CUSTOM_HEADERS present: false, has Authorization header: false/i.test(text)) {
    hints.push('No API auth header detected by Claude runtime; verify token/header env mapping.')
  }

  if (hints.length === 0) return undefined
  return `${rawError}\n${hints.join(' ')}`
}

/**
 * 流式聊天 API 端点
 *
 * 根据请求中的 `provider` 字段路由到对应的 AI 提供商 SDK：
 * - anthropic → streamViaAgentSDK（Claude Agent SDK）
 * - opencode → streamViaOpenCode（OpenCode SDK）
 * - copilot → streamViaCopilot（GitHub Copilot SDK）
 * - openai → streamViaCodex（Codex CLI）
 *
 * 要求：必须显式指定 provider 和 model，不提供回退路由
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<ChatBody>(event)

  // 验证必填字段
  if (!body?.messages || !body?.system) {
    setResponseHeaders(event, { 'Content-Type': 'application/json' })
    return { error: 'Missing required fields: system, messages' }
  }
  if (!body.provider) {
    setResponseHeaders(event, { 'Content-Type': 'application/json' })
    return { error: 'Missing provider. Provider fallback is disabled.' }
  }
  if (!body.model?.trim()) {
    setResponseHeaders(event, { 'Content-Type': 'application/json' })
    return { error: 'Missing model. Model fallback is disabled.' }
  }
  if (body.provider !== 'anthropic' && body.provider !== 'openai' && body.provider !== 'opencode' && body.provider !== 'copilot') {
    setResponseHeaders(event, { 'Content-Type': 'application/json' })
    return { error: 'Missing or unsupported provider. Provider fallback is disabled.' }
  }

  // 设置 SSE（Server-Sent Events）响应头
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  // 根据提供商路由到对应的流处理函数
  if (body.provider === 'anthropic') return streamViaAgentSDK(body, body.model)
  if (body.provider === 'opencode') return streamViaOpenCode(body, body.model)
  if (body.provider === 'copilot') return streamViaCopilot(body, body.model)
  return streamViaCodex(body, body.model)
})

/** Keep-alive 心跳间隔（毫秒）— 在等待 API 首字节响应时防止客户端超时 */
const KEEPALIVE_INTERVAL_MS = 15_000

/**
 * 获取 Claude Agent 的思考模式配置
 * @param body 聊天请求体
 * @returns 思考配置对象，如果未指定则返回 undefined
 */
function getAgentThinkingConfig(body: ChatBody):
  | { type: 'adaptive' | 'disabled' }
  | { type: 'enabled'; budgetTokens?: number }
  | undefined {
  if (!body.thinkingMode) return undefined
  if (body.thinkingMode === 'enabled') {
    return { type: 'enabled', budgetTokens: body.thinkingBudgetTokens }
  }
  return { type: body.thinkingMode }
}

/**
 * 将 base64 编码的附件保存到临时文件
 *
 * 返回 { tempDir, files[] } — 调用者必须负责清理 tempDir
 *
 * 当 `insideProject` 为 true 时，文件保存在当前工作目录的 `.openpencil-tmp/` 下
 * 这样 Claude Code Agent SDK（在 plan 模式下限制只能读取项目目录）可以访问它们
 *
 * @param attachments 附件列表（base64编码）
 * @param insideProject 是否保存在项目目录内
 * @returns 临时目录路径和文件路径数组
 */
async function saveAttachmentsToTempFiles(
  attachments: ChatAttachmentWire[],
  insideProject = false,
): Promise<{ tempDir: string; files: string[] }> {
  let tempDir: string
  if (insideProject) {
    // 在项目目录内创建临时文件夹，供 Claude Code Agent SDK 读取
    const { mkdirSync, chmodSync } = await import('node:fs')
    const baseDir = join(process.cwd(), '.openpencil-tmp')
    mkdirSync(baseDir, { recursive: true, mode: 0o700 })
    chmodSync(baseDir, 0o700)
    tempDir = await mkdtemp(join(baseDir, 'attach-'))
  } else {
    // 使用系统临时目录
    tempDir = await mkdtemp(join(tmpdir(), 'openpencil-attach-'))
  }
  const files: string[] = []
  for (const att of attachments) {
    const ext = resolveMediaExtension(att.mediaType)
    const filePath = join(tempDir, `${files.length}.${ext}`)
    await writeFile(filePath, Buffer.from(att.data, 'base64'))
    files.push(filePath)
  }
  return { tempDir, files }
}

/** 从最后一条用户消息中提取所有附件 */
function getLastUserAttachments(body: ChatBody): ChatAttachmentWire[] {
  const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')
  return lastUser?.attachments ?? []
}

/**
 * 从系统提示中移除 "NEVER use tools" 等限制指令
 * 当需要 Claude Code Agent SDK 使用其 Read 工具来分析图片时使用
 * @param systemPrompt 原始系统提示
 * @returns 移除工具限制后的系统提示
 */
function stripNoToolsRestriction(systemPrompt: string): string {
  return systemPrompt
    .replace(/^.*NEVER use tools.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * 通过 Claude Agent SDK 进行流式聊天
 * 使用本地 Claude Code OAuth 登录，无需 API Key
 *
 * 处理流程：
 * 1. 从最后一条用户消息构建 prompt
 * 2. 如果有图片附件，保存到项目内临时文件供 SDK 读取
 * 3. 有图片时使用 result-based 流程，避免流式输出工具调用前缀
 * 4. 纯文本时使用流式输出，支持 thinking 模式
 *
 * @param body 聊天请求体
 * @param model 模型标识符
 * @returns SSE 流式响应
 */
function streamViaAgentSDK(body: ChatBody, model?: string) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      // 在第一个真实数据块到达前发送 keep-alive 心跳，防止客户端超时
      const pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping', content: '' })}\n\n`))
        } catch { /* stream already closed */ }
      }, KEEPALIVE_INTERVAL_MS)
      let debugFile: string | undefined
      let attachTempDir: string | undefined

      try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk')

        // 从最后一条用户消息构建 prompt
        const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user')
        let prompt = lastUserMsg?.content ?? ''

        // 如果最后一条用户消息包含图片附件，保存到项目内临时文件
        // 这样 Claude Code SDK 才有权限读取
        const attachments = getLastUserAttachments(body)
        const hasImageAttachments = attachments.length > 0
        if (hasImageAttachments) {
          const saved = await saveAttachmentsToTempFiles(attachments, true)
          attachTempDir = saved.tempDir
          const imageRefs = saved.files.map((f) =>
            `First, use the Read tool to read the image file at "${f}". Then analyze it and respond to the user.`,
          ).join('\n')
          prompt = imageRefs + '\n\n' + (prompt || 'Describe what you see in the image.')
        }

        // 构建环境变量，移除 CLAUDECODE 环境以允许在 CC 终端内运行
        const env = buildClaudeAgentEnv()
        debugFile = getClaudeAgentDebugFilePath()

        const claudePath = resolveClaudeCli()
        const thinking = getAgentThinkingConfig(body)

        // 当有图片附件时，移除系统提示中的 "NEVER use tools" 限制
        // 以便 Claude Code 使用其 Read 工具查看图片
        const effectiveSystemPrompt = hasImageAttachments
          ? stripNoToolsRestriction(body.system)
          : body.system

        // 当有图片附件时，使用 result-based 流程（类似 validate.ts）：
        // 让 Claude Code 内部通过 Read 工具读取图片，然后只发送最终结果
        // 这避免了流式输出中间的工具调用前缀，如 "I need to read the file first"
        if (hasImageAttachments) {
          const runImageQuery = async (): Promise<string> => {
            const q = query({
              prompt,
              options: {
                systemPrompt: effectiveSystemPrompt,
                ...(model ? { model } : {}),
                maxTurns: 3,  // 允许多轮工具调用
                plugins: [],
                permissionMode: 'plan',
                persistSession: false,
                ...(body.effort ? { effort: body.effort } : {}),
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
                    return message.result ?? ''
                  }
                  const errors = 'errors' in message ? (message.errors as string[]) : []
                  const resultText = 'result' in message ? String(message.result ?? '') : ''
                  const errContent = errors.join('; ') || resultText || `Query ended with: ${message.subtype}`
                  throw new Error(errContent)
                }
              }
              return ''
            } finally {
              q.close()
            }
          }

          const resultText = await runImageQuery()

          clearInterval(pingTimer)
          if (resultText) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'text', content: resultText })}\n\n`),
            )
          }
        } else {
          // 普通纯文本聊天：流式输出部分消息
          const runQuery = async () => {
            const q = query({
              prompt,
              options: {
                systemPrompt: effectiveSystemPrompt,
                ...(model ? { model } : {}),
                maxTurns: 1,  // 单轮对话
                includePartialMessages: true,  // 启用流式输出
                tools: [],
                plugins: [],
                permissionMode: 'plan',
                persistSession: false,
                ...(body.effort ? { effort: body.effort } : {}),
                ...(thinking ? { thinking } : {}),
                env,
                ...(debugFile ? { debugFile } : {}),
                ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
              },
            })

            try {
              for await (const message of q) {
                if (message.type === 'stream_event') {
                  const ev = message.event
                  if (ev.type === 'content_block_delta') {
                    if (ev.delta.type === 'text_delta') {
                      clearInterval(pingTimer)
                      const data = JSON.stringify({ type: 'text', content: ev.delta.text })
                      controller.enqueue(encoder.encode(`data: ${data}\n\n`))
                    } else if (ev.delta.type === 'thinking_delta') {
                      // 在 thinking 期间保持心跳 — 只在文本输出时停止
                      const data = JSON.stringify({ type: 'thinking', content: (ev.delta as any).thinking })
                      controller.enqueue(encoder.encode(`data: ${data}\n\n`))
                    }
                  }
                } else if (message.type === 'result') {
                    const isErrorResult = 'is_error' in message && Boolean((message as { is_error?: boolean }).is_error)
                    if (message.subtype !== 'success' || isErrorResult) {
                      const errors = 'errors' in message ? (message.errors as string[]) : []
                      const resultText = 'result' in message ? String(message.result ?? '') : ''
                      const content = errors.join('; ') || resultText || `Query ended with: ${message.subtype}`
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: 'error', content })}\n\n`),
                      )
                  }
                }
              }
            } finally {
              q.close()
            }
          }

          await runQuery()
        }

        // 发送完成信号
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done', content: '' })}\n\n`),
        )
      } catch (error) {
        // 错误处理：尝试从调试日志获取更友好的错误提示
        const rawContent = error instanceof Error ? error.message : 'Unknown error'
        const tail = await readDebugTail(debugFile)
        const hintedContent = buildClaudeExitHint(rawContent, tail)
        const content = hintedContent ?? rawContent
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', content })}\n\n`),
        )
      } finally {
        // 清理资源
        clearInterval(pingTimer)
        if (attachTempDir) {
          rm(attachTempDir, { recursive: true, force: true }).catch(() => {})
        }
        controller.close()
      }
    },
  })

  return new Response(stream)
}

/**
 * 解析 OpenCode 模型字符串（格式为 "providerID/modelID"）
 * @param model 模型字符串
 * @returns 解析后的 { providerID, modelID } 或 undefined
 */
function parseOpenCodeModel(model?: string): { providerID: string; modelID: string } | undefined {
  if (!model || !model.includes('/')) return undefined
  const idx = model.indexOf('/')
  return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) }
}

/**
 * 将通用 effort 映射到 OpenCode 支持的 effort 值
 * OpenCode 不支持 'max'，映射到 'high'
 */
function mapOpenCodeEffort(
  effort?: 'low' | 'medium' | 'high' | 'max',
): 'low' | 'medium' | 'high' | undefined {
  if (!effort) return undefined
  if (effort === 'max') return 'high'
  return effort
}

/**
 * 构建 OpenCode 的 reasoning 配置对象
 * @param body 聊天请求体
 * @returns reasoning 配置对象，如果无需配置则返回 undefined
 */
function buildOpenCodeReasoning(
  body: ChatBody,
): Record<string, unknown> | undefined {
  const reasoning: Record<string, unknown> = {}
  const effort = mapOpenCodeEffort(body.effort)
  if (effort) {
    reasoning.effort = effort
  }
  if (body.thinkingMode === 'enabled') {
    reasoning.enabled = true
  } else if (body.thinkingMode === 'disabled') {
    reasoning.enabled = false
  }
  if (typeof body.thinkingBudgetTokens === 'number' && body.thinkingBudgetTokens > 0) {
    reasoning.budgetTokens = body.thinkingBudgetTokens
  }
  return Object.keys(reasoning).length > 0 ? reasoning : undefined
}

/**
 * 使用 thinking 配置调用 OpenCode prompt
 * 如果 reasoning 选项被拒绝，自动回退到不带 reasoning 的调用
 *
 * @param ocClient OpenCode 客户端实例
 * @param basePayload 基础请求负载
 * @param body 聊天请求体（用于提取 thinking 配置）
 * @returns prompt 调用结果
 */
async function promptOpenCodeWithThinking(
  ocClient: any,
  basePayload: Record<string, unknown>,
  body: ChatBody,
): Promise<{ data: any; error: any }> {
  const reasoning = buildOpenCodeReasoning(body)
  if (!reasoning) {
    return await ocClient.session.prompt(basePayload)
  }

  // 尝试带 reasoning 选项调用
  const enhanced = { ...basePayload, reasoning }
  const firstTry = await ocClient.session.prompt(enhanced)
  if (!firstTry.error) {
    return firstTry
  }

  // 如果 reasoning 选项被拒绝，回退到不带 reasoning 的调用
  console.warn('[AI] OpenCode reasoning options rejected, retrying without reasoning.')
  return await ocClient.session.prompt(basePayload)
}

/**
 * 通过 Codex CLI 进行流式聊天
 *
 * 处理流程：
 * 1. 将图片附件保存到临时文件
 * 2. 调用 Codex CLI 执行
 * 3. 返回完整响应（非流式）
 *
 * @param body 聊天请求体
 * @param model 模型标识符
 * @returns SSE 流式响应
 */
function streamViaCodex(body: ChatBody, model?: string) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping', content: '' })}\n\n`))
        } catch { /* stream already closed */ }
      }, KEEPALIVE_INTERVAL_MS)

      let attachTempDir: string | undefined
      try {
        // 将图片附件保存到临时文件供 Codex CLI 使用
        const attachments = getLastUserAttachments(body)
        const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user')
        const prompt = (lastUserMsg?.content ?? '').trim()
          || (attachments.length > 0 ? 'Analyze the attached image and answer the user.' : '')
        let imageFiles: string[] | undefined
        if (attachments.length > 0) {
          const saved = await saveAttachmentsToTempFiles(attachments)
          attachTempDir = saved.tempDir
          imageFiles = saved.files
        }

        // 调用 Codex CLI 执行
        const result = await runCodexExec(prompt, {
          model,
          systemPrompt: body.system,
          thinkingMode: body.thinkingMode,
          thinkingBudgetTokens: body.thinkingBudgetTokens,
          effort: body.effort,
          imageFiles,
        })

        clearInterval(pingTimer)
        if (result.error) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', content: result.error })}\n\n`),
          )
          return
        }

        if (result.text) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text', content: result.text })}\n\n`),
          )
        }

        // 发送完成信号
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done', content: '' })}\n\n`),
        )
      } catch (error) {
        const content = error instanceof Error ? error.message : 'Unknown error'
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', content })}\n\n`),
        )
      } finally {
        // 清理资源
        clearInterval(pingTimer)
        if (attachTempDir) {
          rm(attachTempDir, { recursive: true, force: true }).catch(() => {})
        }
        controller.close()
      }
    },
  })

  return new Response(stream)
}

/**
 * 通过 OpenCode SDK 进行流式聊天
 * 连接到运行中的 OpenCode 服务器
 *
 * 处理流程：
 * 1. 获取或创建 OpenCode 客户端
 * 2. 创建新会话
 * 3. 注入系统提示作为上下文
 * 4. 发送用户消息（支持图片附件）
 * 5. 返回完整响应（非流式）
 *
 * @param body 聊天请求体
 * @param model 模型标识符（格式: providerID/modelID）
 * @returns SSE 流式响应
 */
function streamViaOpenCode(body: ChatBody, model?: string) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping', content: '' })}\n\n`))
        } catch { /* stream already closed */ }
      }, KEEPALIVE_INTERVAL_MS)

      let ocServer: { close(): void } | undefined
      try {
        const { getOpencodeClient } = await import('../../utils/opencode-client')
        const oc = await getOpencodeClient()
        const ocClient = oc.client
        ocServer = oc.server

        // 为此对话创建一个新会话
        const { data: session, error: sessionError } = await ocClient.session.create({
          title: 'OpenPencil Chat',
        })
        if (sessionError || !session) {
          throw new Error('Failed to create OpenCode session')
        }

        // 注入系统提示作为上下文（不触发 AI 回复）
        await ocClient.session.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: 'text', text: body.system }],
        })

        // 从最后一条用户消息构建 prompt
        const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user')
        const prompt = lastUserMsg?.content ?? ''

        const parsed = parseOpenCodeModel(model)

        // 构建 parts 数组，如果有图片附件则添加
        const attachments = getLastUserAttachments(body)
        const parts: Array<Record<string, unknown>> = [
          ...attachments.map((a) => ({
            type: 'image',
            url: `data:${a.mediaType};base64,${a.data}`,
          })),
          { type: 'text', text: prompt || 'Analyze these images.' },
        ]

        // 发送 prompt 并等待完整响应
        const promptPayload: Record<string, unknown> = {
          sessionID: session.id,
          ...(parsed ? { model: parsed } : {}),
          parts,
        }

        const { data: result, error: promptError } = await promptOpenCodeWithThinking(
          ocClient,
          promptPayload,
          body,
        )

        if (promptError) {
          throw new Error('OpenCode prompt failed')
        }

        // 从响应 parts 中提取文本
        clearInterval(pingTimer)
        if (result?.parts) {
          for (const part of result.parts) {
            if (part.type === 'text' && 'text' in part) {
              const data = JSON.stringify({ type: 'text', content: part.text })
              controller.enqueue(encoder.encode(`data: ${data}\n\n`))
            }
          }
        }

        // 发送完成信号
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done', content: '' })}\n\n`),
        )
      } catch (error) {
        const content = error instanceof Error ? error.message : 'Unknown error'
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', content })}\n\n`),
        )
      } finally {
        // 释放 OpenCode 服务器资源
        const { releaseOpencodeServer } = await import('../../utils/opencode-client')
        releaseOpencodeServer(ocServer)
        clearInterval(pingTimer)
        controller.close()
      }
    },
  })

  return new Response(stream)
}

/**
 * 将通用 effort 映射到 Copilot SDK 的 ReasoningEffort
 * Copilot 使用 'xhigh' 代替 'max'
 */
function mapCopilotReasoningEffort(
  effort?: 'low' | 'medium' | 'high' | 'max',
): 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  if (!effort) return undefined
  if (effort === 'max') return 'xhigh'
  return effort
}

/**
 * 通过 GitHub Copilot SDK 进行流式聊天
 *
 * 处理流程：
 * 1. 使用独立的 copilot 二进制文件（避免 Bun 的 node:sqlite 兼容问题）
 * 2. 创建流式会话
 * 3. 订阅消息增量事件
 * 4. 等待完成
 *
 * @param body 聊天请求体
 * @param model 模型标识符
 * @returns SSE 流式响应
 */
function streamViaCopilot(body: ChatBody, model?: string) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping', content: '' })}\n\n`))
        } catch { /* stream already closed */ }
      }, KEEPALIVE_INTERVAL_MS)

      let copilotClient: { stop(): Promise<unknown> } | undefined
      try {
        const { CopilotClient, approveAll } = await import('@github/copilot-sdk')
        // 使用独立的 copilot 二进制文件，避免 Bun 的 node:sqlite 兼容问题
        const { resolveCopilotCli } = await import('../../utils/copilot-client')
        const cliPath = resolveCopilotCli()
        const client = new CopilotClient({
          autoStart: true,
          ...(cliPath ? { cliPath } : {}),
        })
        copilotClient = client
        await client.start()

        // 创建流式会话
        const session = await client.createSession({
          ...(model ? { model } : {}),
          streaming: true,
          onPermissionRequest: approveAll,  // 自动批准所有权限请求
          systemMessage: { mode: 'replace', content: body.system },
          ...(body.effort ? { reasoningEffort: mapCopilotReasoningEffort(body.effort) } : {}),
        })

        const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user')
        const prompt = lastUserMsg?.content ?? ''

        // 订阅流式增量消息事件
        session.on('assistant.message_delta', (event) => {
          clearInterval(pingTimer)
          const deltaContent = (event as any).data?.deltaContent ?? ''
          if (deltaContent) {
            const data = JSON.stringify({ type: 'text', content: deltaContent })
            try {
              controller.enqueue(encoder.encode(`data: ${data}\n\n`))
            } catch { /* stream closed */ }
          }
        })

        // 等待完成（超时120秒）
        await session.sendAndWait({ prompt }, 120_000)
        await session.destroy()

        // 发送完成信号
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done', content: '' })}\n\n`),
        )
      } catch (error) {
        const content = error instanceof Error ? error.message : 'Unknown error'
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', content })}\n\n`),
        )
      } finally {
        // 清理资源
        clearInterval(pingTimer)
        if (copilotClient) {
          copilotClient.stop().catch(() => {})
        }
        controller.close()
      }
    },
  })

  return new Response(stream)
}
