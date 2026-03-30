import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ServerConfig {
  port: number
  host: string
}

export interface ProviderConfig {
  enabled: boolean
  timeoutMs?: number
  debugLog?: boolean
  port?: number
  /** cwd 允许的基础目录白名单 */
  allowedCwdDirs?: string[]
}

export interface LoggingConfig {
  level: 'info' | 'warn' | 'error'
}

export interface AppConfig {
  server: ServerConfig
  providers: {
    claude?: ProviderConfig
    codex?: ProviderConfig
    opencode?: ProviderConfig
    copilot?: ProviderConfig
  }
  logging: LoggingConfig
}

const DEFAULT_CONFIG: AppConfig = {
  server: { port: 4000, host: '127.0.0.1' },
  providers: {
    claude: { enabled: false },
    codex: { enabled: false },
    opencode: { enabled: false },
    copilot: { enabled: false },
  },
  logging: { level: 'info' },
}

export function loadConfig(configPath: string): AppConfig {
  try {
    const resolvedPath = resolve(configPath)
    const raw = readFileSync(resolvedPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      server: { ...DEFAULT_CONFIG.server, ...parsed.server },
      providers: { ...DEFAULT_CONFIG.providers, ...parsed.providers },
      logging: { ...DEFAULT_CONFIG.logging, ...parsed.logging },
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}
