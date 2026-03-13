import type { UnityNodeType } from './html-unity-keyword-rules'

export const UNITY_HTML_EXPORT_CONFIG = {
  rootWidth: 1920,
  rootHeight: 1080,
  defaultSliderValue: '0.5',
  defaultDropdownOptions: ['Option 1', 'Option 2', 'Option 3'] as const,
} as const

export const STRUCTURE_RULE_ORDER: readonly UnityNodeType[] = [
  'toggle',
  'dropdown',
  'input',
  'button',
  'slider',
  'scroll',
] as const

export const STRUCTURE_RULE_CONFIG = {
  iconLikeMaxSize: 48,
  button: {
    exactTextCount: 1,
    maxChildren: 3,
    maxWidth: 420,
    minHeight: 28,
    maxHeight: 88,
  },
  input: {
    minWidth: 160,
    minHeight: 32,
    maxHeight: 72,
    maxChildren: 4,
    minWideWidth: 240,
    minIconCount: 1,
  },
  dropdown: {
    minWidth: 160,
    minHeight: 32,
    maxHeight: 84,
    minOptions: 2,
    maxOptions: 12,
    minIconCount: 1,
  },
  toggle: {
    minWidth: 80,
    minHeight: 20,
    maxHeight: 64,
    minTextCount: 1,
    maxChildren: 3,
    centerOffset: 2,
    trackMaxWidthFactor: 2,
    trackMaxWidthFallback: 80,
    trackMaxHeightFallback: 40,
  },
  slider: {
    minWidth: 120,
    maxHeight: 48,
    minWidthToHeightRatio: 3,
    maxChildren: 3,
  },
  scroll: {
    minChildren: 4,
    minWidth: 160,
    minHeight: 120,
  },
} as const
