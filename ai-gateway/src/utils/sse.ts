import type { SSEEvent } from '../providers/base-provider.js'

export const ALLOWED_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

export function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export function resolveMediaExtension(mediaType: string): string {
  return ALLOWED_MEDIA_TYPES.has(mediaType) ? mediaType.split('/')[1] : 'png'
}

export function createKeepAlive(
  tick: () => void,
  intervalMs = 15_000,
): { stop: () => void } {
  const timer = setInterval(tick, intervalMs)
  return {
    stop() {
      clearInterval(timer)
    },
  }
}
