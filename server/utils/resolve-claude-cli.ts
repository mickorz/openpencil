import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, extname, join } from 'node:path'

const isWindows = platform() === 'win32'

interface NormalizeClaudeCliPathOptions {
  isWindows?: boolean
  existsSyncFn?: (path: string) => boolean
}

export function normalizeClaudeCliPath(
  candidate: string | undefined,
  options: NormalizeClaudeCliPathOptions = {},
): string | undefined {
  if (!candidate) return undefined

  const exists = options.existsSyncFn ?? existsSync
  const windows = options.isWindows ?? isWindows

  if (!exists(candidate)) return undefined
  if (!windows) return candidate

  const extension = extname(candidate).toLowerCase()
  if (extension === '.exe' || extension === '.js') return candidate

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

function pickFirstClaudeCli(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = normalizeClaudeCliPath(candidate)
    if (normalized) return normalized
  }
  return undefined
}

/**
 * Resolve the absolute path to the standalone `claude` binary.
 *
 * When Nitro bundles @anthropic-ai/claude-agent-sdk, the SDK's internal
 * `import.meta.url`-based resolution to find its own `cli.js` breaks.
 * Instead we locate the standalone native binary and pass it via
 * `pathToClaudeCodeExecutable` — the SDK detects non-.js paths as native
 * binaries and spawns them directly (no `node` wrapper needed).
 */
export function resolveClaudeCli(): string | undefined {
  // 1. Try PATH lookup
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
  } catch { /* not in PATH */ }

  // 2. Common install locations
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
