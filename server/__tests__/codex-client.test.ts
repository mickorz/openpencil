import { describe, expect, it } from 'vitest'
import { buildCodexExecArgs, buildPrompt } from '../utils/codex-client'

describe('buildPrompt', () => {
  it('keeps user prompt concise when no system prompt is provided', () => {
    expect(buildPrompt(undefined, 'analyze this image')).toBe('analyze this image')
  })

  it('combines system and user prompt without embedding attachment paths', () => {
    expect(buildPrompt('Follow the rules', 'analyze this image')).toBe(
      [
        'SYSTEM INSTRUCTIONS:',
        'Follow the rules',
        '',
        'USER REQUEST:',
        'analyze this image',
      ].join('\n'),
    )
  })
})

describe('buildCodexExecArgs', () => {
  it('uses stdin marker instead of appending the full prompt to argv', () => {
    const args = buildCodexExecArgs('C:\\temp\\last-message.txt', {
      model: 'o3',
      effort: 'high',
    })

    expect(args).toContain('--model')
    expect(args).toContain('o3')
    expect(args).toContain('--config')
    expect(args).toContain('model_reasoning_effort="high"')
    expect(args[args.length - 1]).toBe('-')
  })

  it('passes image files through Codex CLI image flags', () => {
    const args = buildCodexExecArgs('C:\\temp\\last-message.txt', {
      imageFiles: ['C:\\temp\\0.png', 'C:\\temp\\1.png'],
    })

    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--output-last-message',
      'C:\\temp\\last-message.txt',
      '--image',
      'C:\\temp\\0.png',
      '--image',
      'C:\\temp\\1.png',
      '-',
    ])
  })
})
