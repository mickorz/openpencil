/**
 * Claude CLI 路径解析器
 *
 * normalizeClaudeCliPath()  验证候选路径是否可用
 *   ├─> 空字符串           -> undefined
 *   ├─> existsSync 检查    -> 不存在则 undefined
 *   ├─> Unix 平台          -> 存在即返回
 *   └─> Windows 平台
 *         ├─> .exe / .js   -> 直接返回
 *         ├─> npm shim     -> 查找 node_modules/@anthropic-ai/claude-code/cli.js
 *         └─> 无法解析     -> undefined
 *
 * resolveClaudeCli()        自动查找 claude CLI
 *   ├─> 1. which/where 查 PATH
 *   └─> 2. 常见安装路径逐个尝试
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, extname, join } from 'node:path'

const isWindows = platform() === 'win32'

/** normalizeClaudeCliPath 的可注入选项，便于测试 */
export interface NormalizeClaudeCliPathOptions {
  /** 是否为 Windows 平台（默认自动检测） */
  isWindows?: boolean
  /** 文件存在性检查函数（默认使用 node:fs 的 existsSync） */
  existsSyncFn?: (path: string) => boolean
}

/**
 * 验证候选路径是否为可用的 claude CLI
 *
 * @param candidate - 候选路径
 * @param options - 可注入选项（用于测试 mock）
 * @returns 可用的 CLI 路径，或 undefined
 */
export function normalizeClaudeCliPath(
  candidate: string | undefined,
  options: NormalizeClaudeCliPathOptions = {},
): string | undefined {
  // 空字符串或 undefined 直接返回
  if (!candidate) return undefined

  const exists = options.existsSyncFn ?? existsSync
  const windows = options.isWindows ?? isWindows

  // 文件不存在则返回 undefined
  if (!exists(candidate)) return undefined

  // Unix 平台：存在即返回
  if (!windows) return candidate

  // Windows 平台：.exe 或 .js 文件直接返回
  const extension = extname(candidate).toLowerCase()
  if (extension === '.exe' || extension === '.js') return candidate

  // Windows 平台：npm shim 查找实际的 cli.js
  const cliJsPath = join(
    dirname(candidate),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'cli.js',
  )

  if (exists(cliJsPath)) {
    return cliJsPath
  }

  return undefined
}

/**
 * 从候选路径列表中选取第一个可用的 claude CLI 路径
 */
function pickFirstClaudeCli(
  candidates: string[],
  options?: NormalizeClaudeCliPathOptions,
): string | undefined {
  for (const candidate of candidates) {
    const normalized = normalizeClaudeCliPath(candidate, options)
    if (normalized) return normalized
  }
  return undefined
}

/**
 * 自动查找 claude CLI 的绝对路径
 *
 * 查找策略：
 * 1. 先通过 which/where 在 PATH 中查找
 * 2. 再检查各平台常见安装路径
 *
 * @returns 可用的 CLI 路径，或 undefined
 */
export function resolveClaudeCli(): string | undefined {
  // 步骤 1：通过 PATH 查找
  try {
    const cmd = isWindows ? 'where claude' : 'which claude 2>/dev/null'
    const matches = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 3000,
    })
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const resolved = pickFirstClaudeCli(matches)
    if (resolved) return resolved
  } catch {
    // claude 不在 PATH 中，继续尝试其他路径
  }

  // 步骤 2：检查常见安装路径
  const candidates = isWindows
    ? [
        join(process.env.LOCALAPPDATA || '', 'Programs', 'claude-code', 'claude.exe'),
        join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
        join(homedir(), '.claude', 'local', 'claude.exe'),
        join(homedir(), 'AppData', 'Local', 'Programs', 'claude-code', 'claude.exe'),
        join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        join(process.env.APPDATA || '', 'npm', 'claude'),
        join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      ]
    : [
        join(homedir(), '.local', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
      ]

  return pickFirstClaudeCli(candidates)
}
