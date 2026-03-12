import { describe, expect, it } from 'vitest'
import { normalizeClaudeCliPath } from '../utils/resolve-claude-cli'

describe('normalizeClaudeCliPath', () => {
  it('maps Windows npm shim without extension to the real cli.js', () => {
    const shimPath = 'C:\\Users\\Test\\AppData\\Roaming\\npm\\claude'
    const cliJsPath = 'C:\\Users\\Test\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'
    const existingPaths = new Set([shimPath, cliJsPath])

    const resolved = normalizeClaudeCliPath(shimPath, {
      isWindows: true,
      existsSyncFn: (path) => existingPaths.has(path),
    })

    expect(resolved).toBe(cliJsPath)
  })

  it('maps Windows claude.cmd shim to the real cli.js', () => {
    const shimPath = 'C:\\Users\\Test\\AppData\\Roaming\\npm\\claude.cmd'
    const cliJsPath = 'C:\\Users\\Test\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'
    const existingPaths = new Set([shimPath, cliJsPath])

    const resolved = normalizeClaudeCliPath(shimPath, {
      isWindows: true,
      existsSyncFn: (path) => existingPaths.has(path),
    })

    expect(resolved).toBe(cliJsPath)
  })

  it('keeps a real Windows executable path unchanged', () => {
    const exePath = 'C:\\Users\\Test\\AppData\\Local\\Programs\\claude-code\\claude.exe'

    const resolved = normalizeClaudeCliPath(exePath, {
      isWindows: true,
      existsSyncFn: (path) => path === exePath,
    })

    expect(resolved).toBe(exePath)
  })

  it('rejects Windows shim paths when the backing cli.js is missing', () => {
    const shimPath = 'C:\\Users\\Test\\AppData\\Roaming\\npm\\claude'

    const resolved = normalizeClaudeCliPath(shimPath, {
      isWindows: true,
      existsSyncFn: (path) => path === shimPath,
    })

    expect(resolved).toBeUndefined()
  })

  it('keeps non-Windows paths unchanged', () => {
    const unixPath = '/usr/local/bin/claude'

    const resolved = normalizeClaudeCliPath(unixPath, {
      isWindows: false,
      existsSyncFn: (path) => path === unixPath,
    })

    expect(resolved).toBe(unixPath)
  })
})
