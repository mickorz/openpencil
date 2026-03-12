import { describe, expect, it, vi } from 'vitest'
import {
  parseOrchestratorResponse,
  resolveOrchestratorPlan,
} from '../orchestrator-plan-parser'

describe('parseOrchestratorResponse', () => {
  it('parses plain JSON planner output', () => {
    const raw = JSON.stringify({
      rootFrame: {
        id: 'page',
        name: 'Page',
        width: 375,
        height: 812,
        layout: 'vertical',
      },
      subtasks: [
        {
          id: 'modal',
          label: 'Backpack Modal',
          region: { width: 375, height: 320 },
        },
      ],
    })

    const plan = parseOrchestratorResponse(raw)

    expect(plan?.rootFrame.id).toBe('page')
    expect(plan?.subtasks).toHaveLength(1)
    expect(plan?.styleGuide).toBeTruthy()
  })

  it('parses JSON wrapped in markdown fences', () => {
    const raw = [
      '```json',
      JSON.stringify({
        rootFrame: {
          id: 'page',
          name: 'Page',
          width: 1200,
          height: 0,
          layout: 'vertical',
        },
        subtasks: [
          {
            id: 'hero',
            label: 'Hero',
            region: { width: 1200, height: 480 },
          },
        ],
      }),
      '```',
    ].join('\n')

    const plan = parseOrchestratorResponse(raw)

    expect(plan?.subtasks[0]?.id).toBe('hero')
  })
})

describe('resolveOrchestratorPlan', () => {
  it('falls back to heuristic plan when planner output is not valid JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const plan = resolveOrchestratorPlan(
      'I think this should have a nice hero and some cards.',
      '参考图片生成背包弹窗',
    )

    expect(plan.rootFrame.id).toBe('page')
    expect(plan.subtasks.length).toBeGreaterThan(0)
    expect(warnSpy).toHaveBeenCalledOnce()

    warnSpy.mockRestore()
  })
})
