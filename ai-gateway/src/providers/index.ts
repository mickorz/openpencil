import type { AppConfig } from '../config.js'
import type { BaseProvider } from './base-provider.js'

const registry = new Map<string, BaseProvider>()

export async function registerProviders(config: AppConfig): Promise<void> {
  registry.clear()

  if (config.providers.claude?.enabled) {
    const { ClaudeProvider } = await import('./claude-provider.js')
    registry.set('claude', new ClaudeProvider(config.providers.claude))
  }
  if (config.providers.codex?.enabled) {
    const { CodexProvider } = await import('./codex-provider.js')
    registry.set('codex', new CodexProvider(config.providers.codex))
  }
  if (config.providers.opencode?.enabled) {
    const { OpenCodeProvider } = await import('./opencode-provider.js')
    registry.set('opencode', new OpenCodeProvider(config.providers.opencode))
  }
  if (config.providers.copilot?.enabled) {
    const { CopilotProvider } = await import('./copilot-provider.js')
    registry.set('copilot', new CopilotProvider(config.providers.copilot))
  }
}

export function getProvider(name: string): BaseProvider | undefined {
  return registry.get(name)
}

export function listProviders(): string[] {
  return Array.from(registry.keys())
}
