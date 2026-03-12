import type { OrchestratorPlan } from './ai-types'
import type { StyleGuide } from './ai-types'
import { buildFallbackPlanFromPrompt } from './orchestrator-prompt-optimizer'

export function resolveOrchestratorPlan(
  raw: string,
  fallbackPrompt: string,
): OrchestratorPlan {
  const parsed = parseOrchestratorResponse(raw)
  if (parsed) {
    return parsed
  }

  console.warn(
    '[Orchestrator] Failed to parse planner JSON, using fallback plan.',
    raw.slice(0, 600),
  )

  return buildFallbackPlanFromPrompt(fallbackPrompt)
}

export function parseOrchestratorResponse(raw: string): OrchestratorPlan | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const direct = tryParsePlan(trimmed)
  if (direct) return direct

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) {
    const fenced = tryParsePlan(fenceMatch[1].trim())
    if (fenced) return fenced
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const braced = tryParsePlan(trimmed.slice(firstBrace, lastBrace + 1))
    if (braced) return braced
  }

  return null
}

function tryParsePlan(text: string): OrchestratorPlan | null {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>
    if (!obj.rootFrame || typeof obj.rootFrame !== 'object') return null
    if (!Array.isArray(obj.subtasks) || obj.subtasks.length === 0) return null

    const rf = obj.rootFrame as Record<string, unknown>
    if (!rf.id || !rf.width || rf.height == null) return null

    for (const st of obj.subtasks as Record<string, unknown>[]) {
      if (!st.id || !st.region) return null
    }

    const plan = obj as unknown as OrchestratorPlan
    attachStyleGuideFallback(plan, obj)
    return plan
  } catch {
    return null
  }
}

function attachStyleGuideFallback(
  plan: OrchestratorPlan,
  raw: Record<string, unknown>,
): void {
  if (raw.styleGuide && typeof raw.styleGuide === 'object') {
    const sg = raw.styleGuide as Record<string, unknown>
    if (sg.palette && typeof sg.palette === 'object' && sg.fonts && typeof sg.fonts === 'object') {
      plan.styleGuide = sg as unknown as StyleGuide
    }
  }

  if (plan.styleGuide) return

  const bg = (plan.rootFrame.fill as Array<{ color?: string }> | undefined)?.[0]?.color ?? '#F8FAFC'
  plan.styleGuide = {
    palette: {
      background: bg,
      surface: '#FFFFFF',
      text: '#0F172A',
      secondary: '#64748B',
      accent: '#6366F1',
      accent2: '#8B5CF6',
      border: '#E2E8F0',
    },
    fonts: { heading: 'Space Grotesk', body: 'Inter' },
    aesthetic: 'clean modern',
  }
}
