import { BaseProvider } from './base-provider.js'
import type { ProviderConfig } from '../config.js'

export class CopilotProvider extends BaseProvider {
  readonly name = 'copilot'
  constructor(config: ProviderConfig) { super(config) }
  async connect(): Promise<never> { throw new Error('Not implemented') }
  async *chat(): AsyncGenerator<never> { throw new Error('Not implemented') }
  async generate(): Promise<never> { throw new Error('Not implemented') }
}
