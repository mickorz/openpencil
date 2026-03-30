/**
 * Codex Provider - 通过 Codex CLI 桥接 OpenAI Codex
 *
 * CodexProvider
 *   |-- connect()              检测 CLI 可用性 + 获取模型列表
 *   |     |-- which/where 查找 codex
 *   |     |-- codex --version 验证
 *   |     |-- 读取 ~/.codex/models_cache.json 获取模型列表
 *   |     └-- 返回 ConnectResult (models.provider = 'openai')
 *   |
 *   |-- chat(req, model?)      伪流式聊天 (AsyncGenerator<SSEEvent>)
 *   |     |-- runCodexExec 等完成
 *   |     |-- yield 全部文本
 *   |     └-- 处理图片附件 (saveAttachmentsToTempFiles)
 *   |
 *   |-- generate(req, model?)  非流式生成 (Promise)
 *   |     |-- 直接调用 runCodexExec
 *   |     └-- 处理图片附件
 *   └-- buildUserPrompt()      从消息列表构建用户 prompt
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import {
  BaseProvider,
  type ChatRequest,
  type ConnectResult,
  type SSEEvent,
  type ModelInfo,
} from './base-provider.js'
import type { ProviderConfig } from '../config.js'
import {
  runCodexExec,
  resolveCodexEffort,
  buildPrompt,
  filterCodexEnv,
  type CodexExecOptions,
} from '../utils/codex-client.js'
import { saveAttachmentsToTempFiles, cleanupDir } from '../utils/temp-files.js'

const isWindows = platform() === 'win32'

export class CodexProvider extends BaseProvider {
  readonly name = 'codex'

  constructor(config: ProviderConfig) {
    super(config)
  }

  /**
   * 检测 Codex CLI 可用性并获取支持的模型列表
   *
   * 流程：
   * 1. which/where 查找 codex 可执行文件
   * 2. codex --version 验证可正常运行
   * 3. 读取 ~/.codex/models_cache.json 获取模型列表
   * 4. 映射为 ModelInfo[]（provider 设为 'openai'）
   */
  async connect(): Promise<ConnectResult> {
    // 步骤 1：查找 codex CLI
    const codexPath = this.resolveCodexCli()
    if (!codexPath) {
      return {
        connected: false,
        models: [],
        notInstalled: true,
        error: 'Codex CLI not found in PATH',
      }
    }

    // 步骤 2：验证版本
    try {
      execSync('codex --version', {
        encoding: 'utf-8',
        timeout: 5000,
      })
    } catch (err) {
      return {
        connected: false,
        models: [],
        error: `Codex CLI found but failed to run: ${err instanceof Error ? err.message : 'unknown error'}`,
      }
    }

    // 步骤 3：读取模型缓存文件
    try {
      const models = this.loadModelsCache()
      return { connected: true, models }
    } catch {
      // 缓存文件不存在或损坏，返回空模型列表（连接成功）
      return { connected: true, models: [] }
    }
  }

  /**
   * 伪流式聊天 - 调用 runCodexExec 等完成后 yield 全部文本
   *
   * 图片附件通过 saveAttachmentsToTempFiles 保存到临时文件，
   * 再通过 imageFiles 传入 runCodexExec
   */
  async *chat(req: ChatRequest, model?: string): AsyncGenerator<SSEEvent> {
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
    const userContent = lastUserMsg?.content ?? ''
    const attachments = lastUserMsg?.attachments ?? []

    let attachTempDir: string | undefined

    try {
      let prompt = buildPrompt(req.system, userContent)
      let imageFiles: string[] | undefined

      // 处理图片附件
      if (attachments.length > 0) {
        const saved = await saveAttachmentsToTempFiles(attachments, true)
        attachTempDir = saved.tempDir
        imageFiles = saved.files
      }

      const effort = resolveCodexEffort(req.thinkingMode, req.effort)
      const options: CodexExecOptions = {
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(imageFiles ? { imageFiles } : {}),
        env: filterCodexEnv(process.env as Record<string, string | undefined>),
        timeoutMs: this.config.timeoutMs,
      }

      const result = await runCodexExec(prompt, options)

      if (result.error) {
        yield { type: 'error', content: result.error }
      } else if (result.text) {
        yield { type: 'text', content: result.text }
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      if (attachTempDir) {
        await cleanupDir(attachTempDir).catch(() => {})
      }
    }
  }

  /**
   * 非流式生成 - 直接调用 runCodexExec 返回结果
   *
   * 处理图片附件逻辑与 chat 相同
   */
  async generate(
    req: ChatRequest,
    model?: string,
  ): Promise<{ text?: string; error?: string }> {
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
    const userContent = lastUserMsg?.content ?? ''
    const attachments = lastUserMsg?.attachments ?? []

    let attachTempDir: string | undefined

    try {
      let prompt = buildPrompt(req.system, userContent)
      let imageFiles: string[] | undefined

      if (attachments.length > 0) {
        const saved = await saveAttachmentsToTempFiles(attachments, true)
        attachTempDir = saved.tempDir
        imageFiles = saved.files
      }

      const effort = resolveCodexEffort(req.thinkingMode, req.effort)
      const options: CodexExecOptions = {
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(imageFiles ? { imageFiles } : {}),
        env: filterCodexEnv(process.env as Record<string, string | undefined>),
        timeoutMs: this.config.timeoutMs,
      }

      const result = await runCodexExec(prompt, options)

      if (result.error) {
        return { error: result.error }
      }
      return { text: result.text ?? '' }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      if (attachTempDir) {
        await cleanupDir(attachTempDir).catch(() => {})
      }
    }
  }

  /**
   * 通过 which/where 查找 codex CLI 路径
   */
  private resolveCodexCli(): string | undefined {
    try {
      const cmd = isWindows ? 'where codex' : 'which codex 2>/dev/null'
      const output = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim()

      const firstLine = output.split(/\r?\n/)[0]?.trim()
      return firstLine || undefined
    } catch {
      return undefined
    }
  }

  /**
   * 从 ~/.codex/models_cache.json 读取模型列表
   *
   * 文件格式预期为 JSON 数组：
   * [{ "id": "o4-mini", "name": "o4-mini", ... }, ...]
   */
  private loadModelsCache(): ModelInfo[] {
    const cachePath = join(homedir(), '.codex', 'models_cache.json')
    if (!existsSync(cachePath)) return []

    const raw = readFileSync(cachePath, 'utf-8')
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>

    if (!Array.isArray(parsed)) return []

    return parsed.map((m) => ({
      value: String(m['id'] ?? m['value'] ?? ''),
      displayName: String(m['name'] ?? m['displayName'] ?? m['id'] ?? ''),
      description: String(m['description'] ?? ''),
      provider: 'openai',
    }))
  }
}
