/**
 * Claude Agent 环境变量构建器
 *
 * buildClaudeAgentEnv()
 *   ├─> 读取 ~/.claude/settings.json 中的 env 字段
 *   ├─> 合并 process.env（process.env 优先）
 *   ├─> 删除 CLAUDECODE（防止嵌套调用）
 *   ├─> 验证 ANTHROPIC_CUSTOM_HEADERS 是合法 JSON，否则删除
 *   ├─> ANTHROPIC_AUTH_TOKEN 映射到 ANTHROPIC_API_KEY
 *   └─> normalizeEnvValue() 处理非 string 值
 *         ├─> string 直接用（空字符串跳过）
 *         ├─> number / boolean -> String()
 *         └─> 其他类型跳过
 *
 * getClaudeAgentDebugFilePath()
 *   └─> 返回调试日志路径或 undefined
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type EnvLike = Record<string, string | undefined>

/** Claude CLI 的 settings.json 类型定义 */
interface ClaudeSettings {
  env?: Record<string, unknown>
}

/**
 * 将 settings.json 中的值规范化为字符串
 *
 * - string: 直接返回（空字符串跳过）
 * - number / boolean: 转为字符串
 * - 其他类型（object、数组等）: 跳过，返回 undefined
 */
export function normalizeEnvValue(value: unknown): string | undefined {
  if (value == null) return undefined

  if (typeof value === 'string') {
    // 空字符串跳过，避免引发问题
    if (value.trim() === '') return undefined
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  // 对象、数组等类型跳过，防止生成无效的 header
  return undefined
}

/**
 * 读取 ~/.claude/settings.json 中的 env 字段
 */
function readClaudeSettingsEnv(): EnvLike {
  try {
    const path = join(homedir(), '.claude', 'settings.json')
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as ClaudeSettings
    if (!parsed.env || typeof parsed.env !== 'object') return {}

    const env: EnvLike = {}
    for (const [key, value] of Object.entries(parsed.env)) {
      const normalized = normalizeEnvValue(value)
      if (normalized !== undefined) {
        env[key] = normalized
      }
    }
    return env
  } catch {
    return {}
  }
}

/**
 * 验证字符串是否为合法 JSON
 */
function isValidJson(str: string): boolean {
  try {
    JSON.parse(str)
    return true
  } catch {
    return false
  }
}

/**
 * 构建 Claude Agent SDK 所需的环境变量
 *
 * 优先级：process.env > ~/.claude/settings.json env
 *
 * 处理逻辑：
 * 1. 合并 settings.json 和 process.env（process.env 优先）
 * 2. 验证 ANTHROPIC_CUSTOM_HEADERS 是否为合法 JSON，无效则删除
 * 3. ANTHROPIC_AUTH_TOKEN 映射到 ANTHROPIC_API_KEY（如未设置）
 * 4. 删除 CLAUDECODE 防止嵌套调用
 */
export function buildClaudeAgentEnv(): EnvLike {
  const fromSettings = readClaudeSettingsEnv()
  const fromProcess = process.env as EnvLike

  const merged: EnvLike = {
    ...fromSettings,
    ...fromProcess,
  }

  // 验证 ANTHROPIC_CUSTOM_HEADERS 必须是合法 JSON，否则删除以防止 header 错误
  if (merged.ANTHROPIC_CUSTOM_HEADERS) {
    if (!isValidJson(merged.ANTHROPIC_CUSTOM_HEADERS)) {
      delete merged.ANTHROPIC_CUSTOM_HEADERS
    }
  }

  // 兼容处理：如果未设置 ANTHROPIC_API_KEY 但有 ANTHROPIC_AUTH_TOKEN，则映射
  const authToken = merged.ANTHROPIC_AUTH_TOKEN
  if (authToken && !merged.ANTHROPIC_API_KEY) {
    merged.ANTHROPIC_API_KEY = authToken
  }

  // 删除 CLAUDECODE，避免在 Claude 终端中嵌套调用导致异常
  delete merged.CLAUDECODE

  return merged
}

/**
 * 获取 Claude Agent 调试日志文件路径
 *
 * 将日志输出到可写的临时目录，避免在受限环境下 ~/.claude/debug 不可写导致崩溃。
 *
 * @returns 调试日志路径，或创建失败时返回 undefined
 */
export function getClaudeAgentDebugFilePath(): string | undefined {
  try {
    const dir = join('/tmp', 'ai-gateway-claude-debug')
    mkdirSync(dir, { recursive: true })
    return join(dir, 'claude-agent.log')
  } catch {
    return undefined
  }
}
