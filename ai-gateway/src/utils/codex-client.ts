/**
 * Codex CLI 客户端核心模块
 *
 * 提供与 OpenAI Codex CLI 交互的工具函数：
 *   |-- filterCodexEnv()           白名单过滤环境变量
 *   |-- buildPrompt()              构建 system + user 提示
 *   |-- buildCodexExecArgs()       构建 codex exec 参数
 *   |-- resolveCodexEffort()       映射 thinkingMode 到 codex effort
 *   |-- runCodexExec()             执行 codex 命令并收集结果
 *   |-- parseCodexJsonLine()       解析 JSON 行输出
 *   └-- extractCodexCliError()    从 stderr 提取错误信息
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---- 系统环境变量白名单 ----

const SYSTEM_ENV_WHITELIST = new Set([
  'PATH',
  'HOME',
  'TERM',
  'LANG',
  'SHELL',
  'TMPDIR',
  'SYSTEMROOT',
  'COMSPEC',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PATHEXT',
  'SYSTEMDRIVE',
  'TEMP',
  'TMP',
  'HOMEDRIVE',
  'HOMEPATH',
])

// 需要排除的提供商密钥前缀
const EXCLUDE_PREFIXES = ['ANTHROPIC_', 'AWS_', 'GITHUB_']

/**
 * 白名单过滤环境变量，保留系统变量和 Codex/OpenAI 相关变量
 *
 * - 保留系统变量: PATH, HOME, TERM 等
 * - 保留 OPENAI_ 前缀变量
 * - 保留 CODEX_ 前缀变量
 * - 删除其他提供商密钥 (ANTHROPIC_*, AWS_*, GITHUB_*)
 */
export function filterCodexEnv(env: Record<string, string | undefined>): Record<string, string> {
  const filtered: Record<string, string> = {}

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue

    const upper = key.toUpperCase()

    // 检查排除列表
    if (EXCLUDE_PREFIXES.some((prefix) => upper.startsWith(prefix))) {
      continue
    }

    // 系统白名单
    if (SYSTEM_ENV_WHITELIST.has(upper)) {
      filtered[key] = value
      continue
    }

    // OPENAI_ 和 CODEX_ 前缀
    if (upper.startsWith('OPENAI_') || upper.startsWith('CODEX_')) {
      filtered[key] = value
    }
  }

  return filtered
}

/**
 * 构建 codex exec 的 prompt
 *
 * - 无 system 时直接返回 userPrompt
 * - 有 system 时拼接为格式化的指令
 */
export function buildPrompt(systemPrompt: string, userPrompt: string): string {
  if (!systemPrompt) {
    return userPrompt
  }
  return `SYSTEM INSTRUCTIONS:\n${systemPrompt}\n\nUSER REQUEST:\n${userPrompt}`
}

/** codex exec 参数选项 */
export interface CodexExecOptions {
  /** 模型名称 */
  model?: string
  /** 推理强度 */
  effort?: 'low' | 'medium' | 'high' | 'max'
  /** 图片文件路径列表 */
  imageFiles?: string[]
  /** 环境变量 */
  env?: Record<string, string>
  /** 超时时间 (毫秒) */
  timeoutMs?: number
}

/**
 * 构建 codex exec 参数列表
 *
 * 基础参数: exec --json --skip-git-repo-check --sandbox read-only
 * 可选参数: --model, --config model_reasoning_effort, --image
 */
export function buildCodexExecArgs(outputPath: string, options: CodexExecOptions): string[] {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--output-last-message', outputPath,
    '-',
  ]

  if (options.model) {
    args.push('--model', options.model)
  }

  if (options.effort) {
    args.push('--config', `model_reasoning_effort="${options.effort}"`)
  }

  if (options.imageFiles && options.imageFiles.length > 0) {
    for (const file of options.imageFiles) {
      args.push('--image', file)
    }
  }

  return args
}

/**
 * 将 thinkingMode 和 effort 映射为 codex 支持的 effort 级别
 *
 * - disabled -> low
 * - enabled -> medium
 * - max -> high
 * - 其他直接返回 (low, medium, high)
 */
export function resolveCodexEffort(
  thinkingMode?: 'adaptive' | 'disabled' | 'enabled',
  effort?: 'low' | 'medium' | 'high' | 'max',
): 'low' | 'medium' | 'high' | undefined {
  if (effort) {
    if (effort === 'max') return 'high'
    return effort
  }

  if (thinkingMode) {
    switch (thinkingMode) {
      case 'disabled': return 'low'
      case 'enabled': return 'medium'
      // adaptive 不设置，让 codex 自行决定
      case 'adaptive': return undefined
    }
  }

  return undefined
}

/** runCodexExec 的返回结果 */
export interface CodexExecResult {
  text?: string
  error?: string
  exitCode: number | null
}

/**
 * 执行 codex exec 命令并收集结果
 *
 * 流程：
 * 1. mkdtemp 创建临时目录
 * 2. buildCodexExecArgs 构建参数
 * 3. spawn('codex', args) 执行
 * 4. stdout 按行解析 JSON (parseCodexJsonLine)
 * 5. 等进程退出，读取 outputPath 的内容
 * 6. 合并 stdout 解析文本和文件内容
 * 7. 清理临时目录
 */
export async function runCodexExec(
  userPrompt: string,
  options: CodexExecOptions,
): Promise<CodexExecResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ai-gateway-codex-'))
  const outputPath = join(tempDir, 'output.txt')

  try {
    const args = buildCodexExecArgs(outputPath, options)
    const env = options.env
      ? { ...filterCodexEnv(process.env as Record<string, string | undefined>), ...options.env }
      : filterCodexEnv(process.env as Record<string, string | undefined>)

    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const proc = spawn('codex', args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      // 将 prompt 写入 stdin
      proc.stdin.write(userPrompt)
      proc.stdin.end()

      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk.toString('utf-8'))
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString('utf-8'))
      })

      // 超时控制
      let timer: ReturnType<typeof setTimeout> | undefined
      if (options.timeoutMs) {
        timer = setTimeout(() => {
          proc.kill('SIGTERM')
          reject(new Error(`Codex exec timed out after ${options.timeoutMs}ms`))
        }, options.timeoutMs)
      }

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer)
        resolve(code)
      })

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer)
        reject(err)
      })
    })

    // 解析 stdout 中的文本
    const stdoutText = stdoutChunks.join('')
    const parsedTexts: string[] = []

    for (const line of stdoutText.split('\n')) {
      const parsed = parseCodexJsonLine(line)
      if (parsed.text) {
        parsedTexts.push(parsed.text)
      }
      if (parsed.error) {
        return { error: parsed.error, exitCode }
      }
    }

    // 尝试读取 output 文件内容
    let fileContent = ''
    try {
      fileContent = await readFile(outputPath, 'utf-8')
    } catch {
      // 文件不存在时忽略
    }

    // 合并结果：优先使用文件内容，补充 stdout 解析文本
    const text = (fileContent.trim() || parsedTexts.join('\n')).trim()

    if (exitCode !== 0 && !text) {
      const stderr = stderrChunks.join('')
      return { error: extractCodexCliError(stderr) || `Codex exited with code ${exitCode}`, exitCode }
    }

    return { text: text || undefined, exitCode }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      exitCode: null,
    }
  } finally {
    // 清理临时目录
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * 解析 codex stdout 中的 JSON 行
 *
 * 提取 text 或 error 字段
 */
export function parseCodexJsonLine(line: string): { text?: string; error?: string } {
  const trimmed = line.trim()
  if (!trimmed) return {}

  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>

    if (typeof obj['text'] === 'string') {
      return { text: obj['text'] }
    }
    if (typeof obj['error'] === 'string') {
      return { error: obj['error'] }
    }

    return {}
  } catch {
    // 非 JSON 行，当作纯文本返回
    return { text: trimmed }
  }
}

/**
 * 从 stderr 最后一行提取错误信息
 *
 * codex 错误通常在最后一行输出
 */
export function extractCodexCliError(stderr: string): string | undefined {
  const lines = stderr.trim().split('\n')
  if (lines.length === 0) return undefined

  const lastLine = lines[lines.length - 1].trim()
  return lastLine || undefined
}
