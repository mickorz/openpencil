import type { PenDocument, PenNode, ContainerProps, TextNode } from '@/types/pen'
import { getActivePageChildren } from '@/stores/document-tree-utils'
import type { PenFill, PenStroke, PenEffect, ShadowEffect } from '@/types/styles'
import { isVariableRef } from '@/variables/resolve-variables'
import { generateCSSVariables, variableNameToCSS } from '@/services/codegen/css-variables-generator'
import {
  DROPDOWN_OPTION_TEXT_CLEANUPS,
  HINT_TYPE_RULES,
  INPUT_PLACEHOLDER_RULES,
  INPUT_TYPE_RULES,
  ROLE_TYPE_RULES,
  SCROLL_DIRECTION_RULES,
  TOGGLE_FALSE_HINT_PATTERNS,
  TOGGLE_TRUE_HINT_PATTERNS,
  type UnityNodeType,
  type ValuePatternRule,
} from './html-unity-keyword-rules'
import {
  STRUCTURE_RULE_CONFIG,
  STRUCTURE_RULE_ORDER,
  UNITY_HTML_EXPORT_CONFIG,
} from './html-unity-structure-rules'

/**
 * Converts Pen nodes to Unity UI DSL HTML.
 * Each exported node uses `data-u-*` attributes and inline styles so the
 * resulting HTML can be parsed by downstream Unity tooling.
 */

interface HTMLExportOptions {
  rootName?: string
}

let fallbackNameCounter = 0

function resetFallbackNameCounter() {
  fallbackNameCounter = 0
}

function nextFallbackName(prefix: string): string {
  fallbackNameCounter += 1
  return `${prefix}${fallbackNameCounter}`
}

function varOrLiteral(value: string): string {
  if (isVariableRef(value)) {
    return `var(${variableNameToCSS(value.slice(1))})`
  }
  return value
}

function indent(depth: number): string {
  return '  '.repeat(depth)
}

function toCamelCase(value: string): string {
  const cleaned = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()

  if (!cleaned) return ''

  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase()
      if (index === 0) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

function normalizeNodeName(node: PenNode, fallbackPrefix: string): string {
  const candidates = [node.name, node.id, node.role, node.type]
  for (const candidate of candidates) {
    if (!candidate) continue
    const camel = toCamelCase(candidate)
    if (camel) return camel
  }
  return nextFallbackName(fallbackPrefix)
}

function baseHint(node: PenNode): string {
  return [node.name, node.role, node.id].filter(Boolean).join(' ').toLowerCase()
}

function matchesAnyPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function matchValueRule<T extends string>(
  text: string,
  rules: readonly ValuePatternRule<T>[],
): T | undefined {
  for (const rule of rules) {
    if (matchesAnyPattern(text, rule.patterns)) {
      return rule.value
    }
  }
  return undefined
}

function candidateTexts(node: PenNode): string[] {
  return [
    node.name,
    node.id,
    node.role,
    ...collectTextValues(nodeChildren(node)),
  ].filter((value): value is string => Boolean(value))
}

function combinedHint(node: PenNode): string {
  return candidateTexts(node).join(' ').toLowerCase()
}

function numericSize(value: number | string | undefined): number {
  return typeof value === 'number' ? value : 0
}

function nodeWidth(node: PenNode): number {
  return 'width' in node ? numericSize(node.width) : 0
}

function nodeHeight(node: PenNode): number {
  return 'height' in node ? numericSize(node.height) : 0
}

function nodeChildren(node: PenNode): PenNode[] {
  return 'children' in node && Array.isArray(node.children) ? node.children : []
}

function isContainerNode(node: PenNode): boolean {
  return node.type === 'frame' || node.type === 'rectangle' || node.type === 'group'
}

function isIconLikeNode(node: PenNode): boolean {
  if (node.type === 'path' || node.type === 'icon_font' || node.type === 'image' || node.type === 'ellipse') {
    return true
  }

  if (isContainerNode(node)) {
    const width = nodeWidth(node)
    const height = nodeHeight(node)
    if (width > 0 && height > 0 && Math.max(width, height) <= STRUCTURE_RULE_CONFIG.iconLikeMaxSize) {
      return true
    }
  }

  return false
}

function directIconLikeChildren(node: PenNode): PenNode[] {
  return nodeChildren(node).filter((child) => child.type !== 'text' && isIconLikeNode(child))
}

function hasVisualSurface(node: PenNode): boolean {
  if (!isContainerNode(node)) return false
  const hasFill = 'fill' in node && Array.isArray(node.fill) && node.fill.length > 0
  const hasStroke = 'stroke' in node && node.stroke !== undefined
  return hasFill || hasStroke
}

function isLikelyButton(node: PenNode): boolean {
  if (!isContainerNode(node)) return false

  const config = STRUCTURE_RULE_CONFIG.button
  const width = nodeWidth(node)
  const height = nodeHeight(node)
  const texts = directTextChildren(node)
  const icons = directIconLikeChildren(node)
  const children = nodeChildren(node)

  if (texts.length !== config.exactTextCount) return false
  if (children.length > config.maxChildren) return false
  if (width > config.maxWidth) return false
  if (height > 0 && (height < config.minHeight || height > config.maxHeight)) return false
  if (!hasVisualSurface(node) && icons.length === 0) return false

  return true
}

function isLikelyInput(node: PenNode): boolean {
  if (!isContainerNode(node)) return false

  const config = STRUCTURE_RULE_CONFIG.input
  const width = nodeWidth(node)
  const height = nodeHeight(node)
  const texts = directTextChildren(node)
  const icons = directIconLikeChildren(node)
  const children = nodeChildren(node)
  const hint = baseHint(node)

  if (width > 0 && width < config.minWidth) return false
  if (height > 0 && (height < config.minHeight || height > config.maxHeight)) return false
  if (!hasVisualSurface(node)) return false
  if (children.length > config.maxChildren) return false

  if (/(placeholder|hint|keyword)/.test(hint)) return true
  if (texts.length === 1 && icons.length >= config.minIconCount) return true
  if (texts.length === 1 && width >= config.minWideWidth) return true

  return false
}

function isLikelyDropdown(node: PenNode): boolean {
  if (!isContainerNode(node)) return false

  const config = STRUCTURE_RULE_CONFIG.dropdown
  const width = nodeWidth(node)
  const height = nodeHeight(node)
  const texts = uniqueStrings(collectReadableTextValues(node))
  const directTexts = directTextChildren(node)
  const icons = directIconLikeChildren(node)
  const optionContainer = findOptionContainer(node)

  if (height > 0 && (height < config.minHeight || height > config.maxHeight)) return false
  if (width > 0 && width < config.minWidth) return false

  if (optionContainer) return true
  if (texts.length >= config.minOptions && texts.length <= config.maxOptions) return true
  if (directTexts.length === 1 && icons.length >= config.minIconCount && hasVisualSurface(node)) return true

  return false
}

function isLikelyToggle(node: PenNode): boolean {
  if (!isContainerNode(node)) return false

  const config = STRUCTURE_RULE_CONFIG.toggle
  const width = nodeWidth(node)
  const height = nodeHeight(node)
  const texts = uniqueStrings(collectReadableTextValues(node))
  const icons = directIconLikeChildren(node)
  const children = nodeChildren(node)
  const track = findToggleTrackContainer(node)

  if (children.length === 0 || children.length > config.maxChildren) return false
  if (height > 0 && (height < config.minHeight || height > config.maxHeight)) return false
  if (width > 0 && width < config.minWidth) return false

  if (track && texts.length >= config.minTextCount) return true

  const hasSmallIndicator = icons.some((child) => {
    const childWidth = nodeWidth(child)
    const childHeight = nodeHeight(child)
    return (childWidth === 0 || childWidth <= Math.max(height, config.trackMaxHeightFallback))
      && (childHeight === 0 || childHeight <= Math.max(height, config.trackMaxHeightFallback))
  })

  return texts.length === config.minTextCount && hasSmallIndicator
}

function isLikelySlider(node: PenNode): boolean {
  if (!isContainerNode(node)) return false

  const config = STRUCTURE_RULE_CONFIG.slider
  const width = nodeWidth(node)
  const height = nodeHeight(node)
  const children = nodeChildren(node)
  const texts = collectTextValues(children)

  if (texts.length > 0) return false
  if (width <= 0 || height <= 0) return false
  if (width < config.minWidth || height > config.maxHeight) return false
  if (width < height * config.minWidthToHeightRatio) return false
  if (children.length > config.maxChildren) return false

  return true
}

function isLikelyScroll(node: PenNode): boolean {
  if (!isContainerNode(node)) return false

  const config = STRUCTURE_RULE_CONFIG.scroll
  const width = nodeWidth(node)
  const height = nodeHeight(node)
  const children = nodeChildren(node)
  const inferredDirection = inferChildAxisDirection(node)

  if (children.length < config.minChildren) return false
  if (width <= 0 || height <= 0) return false
  if (width < config.minWidth || height < config.minHeight) return false
  if ('layout' in node && (node.layout === 'horizontal' || node.layout === 'vertical')) return true
  if (inferredDirection) return true

  return false
}

function inferUnityType(node: PenNode): UnityNodeType {
  if (node.type === 'text') return 'text'
  if (node.type === 'image') return 'image'

  const role = node.role?.toLowerCase() ?? ''
  const hint = baseHint(node)

  const roleType = role ? matchValueRule(role, ROLE_TYPE_RULES) : undefined
  if (roleType) return roleType

  const hintType = hint ? matchValueRule(hint, HINT_TYPE_RULES) : undefined
  if (hintType) return hintType

  if (node.type === 'path' || node.type === 'icon_font') return 'image'

  for (const type of STRUCTURE_RULE_ORDER) {
    if (type === 'toggle' && isLikelyToggle(node)) return 'toggle'
    if (type === 'dropdown' && isLikelyDropdown(node)) return 'dropdown'
    if (type === 'input' && isLikelyInput(node)) return 'input'
    if (type === 'button' && isLikelyButton(node)) return 'button'
    if (type === 'slider' && isLikelySlider(node)) return 'slider'
    if (type === 'scroll' && isLikelyScroll(node)) return 'scroll'
  }

  return 'div'
}

function textTag(node: TextNode): string {
  const role = node.role?.toLowerCase() ?? ''
  if (role.includes('heading')) return 'h1'
  if (role.includes('subheading')) return 'h2'

  const size = node.fontSize ?? 16
  if (size >= 32) return 'h1'
  if (size >= 24) return 'h2'
  if (size >= 20) return 'h3'
  return 'p'
}

function fillToBackgroundCSS(fills: PenFill[] | undefined): Record<string, string> {
  if (!fills || fills.length === 0) return {}
  const fill = fills[0]
  if (fill.type === 'solid') {
    return { 'background-color': varOrLiteral(fill.color) }
  }
  if (fill.type === 'linear_gradient') {
    if (!fill.stops?.length) return {}
    const angle = fill.angle ?? 180
    const stops = fill.stops.map((s) => `${varOrLiteral(s.color)} ${Math.round(s.offset * 100)}%`).join(', ')
    return { background: `linear-gradient(${angle}deg, ${stops})` }
  }
  if (fill.type === 'radial_gradient') {
    if (!fill.stops?.length) return {}
    const stops = fill.stops.map((s) => `${varOrLiteral(s.color)} ${Math.round(s.offset * 100)}%`).join(', ')
    return { background: `radial-gradient(circle, ${stops})` }
  }
  return {}
}

function fillToTextCSS(fills: PenFill[] | undefined): Record<string, string> {
  if (!fills || fills.length === 0) return {}
  const fill = fills[0]
  if (fill.type === 'solid') {
    return { color: varOrLiteral(fill.color) }
  }
  return {}
}

function strokeToCSS(stroke: PenStroke | undefined): Record<string, string> {
  if (!stroke) return {}
  const css: Record<string, string> = {}
  if (typeof stroke.thickness === 'string' && isVariableRef(stroke.thickness)) {
    css['border-width'] = varOrLiteral(stroke.thickness)
  } else {
    const thickness = typeof stroke.thickness === 'number'
      ? stroke.thickness
      : stroke.thickness[0]
    css['border-width'] = `${thickness}px`
  }
  css['border-style'] = 'solid'
  if (stroke.fill && stroke.fill.length > 0) {
    const sf = stroke.fill[0]
    if (sf.type === 'solid') {
      css['border-color'] = varOrLiteral(sf.color)
    }
  }
  return css
}

function effectsToCSS(effects: PenEffect[] | undefined): Record<string, string> {
  if (!effects || effects.length === 0) return {}
  const shadows: string[] = []
  for (const effect of effects) {
    if (effect.type === 'shadow') {
      const s = effect as ShadowEffect
      const inset = s.inner ? 'inset ' : ''
      shadows.push(`${inset}${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${s.color}`)
    }
  }
  if (shadows.length > 0) {
    return { 'box-shadow': shadows.join(', ') }
  }
  return {}
}

function cornerRadiusToCSS(
  cr: number | [number, number, number, number] | undefined,
): Record<string, string> {
  if (cr === undefined) return {}
  if (typeof cr === 'number') {
    return cr === 0 ? {} : { 'border-radius': `${cr}px` }
  }
  return { 'border-radius': `${cr[0]}px ${cr[1]}px ${cr[2]}px ${cr[3]}px` }
}

function layoutToCSS(node: ContainerProps): Record<string, string> {
  const css: Record<string, string> = {}
  if (node.layout === 'vertical') {
    css.display = 'flex'
    css['flex-direction'] = 'column'
  } else if (node.layout === 'horizontal') {
    css.display = 'flex'
    css['flex-direction'] = 'row'
  }
  if (node.gap !== undefined) {
    if (typeof node.gap === 'string' && isVariableRef(node.gap)) {
      css.gap = varOrLiteral(node.gap)
    } else if (typeof node.gap === 'number') {
      css.gap = `${node.gap}px`
    }
  }
  if (node.padding !== undefined) {
    if (typeof node.padding === 'string' && isVariableRef(node.padding)) {
      css.padding = varOrLiteral(node.padding)
    } else if (typeof node.padding === 'number') {
      css.padding = `${node.padding}px`
    } else if (Array.isArray(node.padding)) {
      css.padding = node.padding.map((p) => `${p}px`).join(' ')
    }
  }
  if (node.justifyContent) {
    const map: Record<string, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
      space_between: 'space-between',
      space_around: 'space-around',
    }
    css['justify-content'] = map[node.justifyContent] ?? node.justifyContent
  }
  if (node.alignItems) {
    const map: Record<string, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
    }
    css['align-items'] = map[node.alignItems] ?? node.alignItems
  }
  if (node.clipContent) {
    css.overflow = 'hidden'
  }
  return css
}

function getTextContent(node: TextNode): string {
  if (typeof node.content === 'string') return node.content
  return node.content.map((segment) => segment.text).join('')
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sizeToCSS(
  width: number | string | undefined,
  height: number | string | undefined,
): Record<string, string> {
  const css: Record<string, string> = {}

  if (typeof width === 'number') {
    css.width = `${width}px`
  } else if (width === 'fill_container') {
    css.width = '100%'
  } else if (width === 'fit_content') {
    css.width = 'fit-content'
  } else if (typeof width === 'string' && isVariableRef(width)) {
    css.width = varOrLiteral(width)
  }

  if (typeof height === 'number') {
    css.height = `${height}px`
  } else if (height === 'fill_container') {
    css.height = '100%'
  } else if (height === 'fit_content') {
    css.height = 'fit-content'
  } else if (typeof height === 'string' && isVariableRef(height)) {
    css.height = varOrLiteral(height)
  }

  return css
}

function styleToString(css: Record<string, string>): string {
  const entries = Object.entries(css).filter(([, value]) => value !== '')
  if (entries.length === 0) return ''
  return entries.map(([key, value]) => `${key}: ${value};`).join(' ')
}

function buildCommonStyle(node: PenNode): Record<string, string> {
  const css: Record<string, string> = {}

  if ('width' in node || 'height' in node) {
    Object.assign(css, sizeToCSS(node.width, node.height))
  }

  if (node.x !== undefined || node.y !== undefined) {
    css.position = 'absolute'
    if (node.x !== undefined) css.left = `${node.x}px`
    if (node.y !== undefined) css.top = `${node.y}px`
  }

  if (node.opacity !== undefined && node.opacity !== 1) {
    if (typeof node.opacity === 'string' && isVariableRef(node.opacity)) {
      css.opacity = varOrLiteral(node.opacity)
    } else if (typeof node.opacity === 'number') {
      css.opacity = String(node.opacity)
    }
  }

  if (node.rotation) {
    css.transform = `rotate(${node.rotation}deg)`
  }

  return css
}

function directTextChildren(node: PenNode): TextNode[] {
  if (!('children' in node) || !Array.isArray(node.children)) return []
  return node.children.filter((child): child is TextNode => child.type === 'text')
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function nonTextChildren(node: PenNode): PenNode[] {
  if (!('children' in node) || !Array.isArray(node.children)) return []
  return node.children.filter((child) => child.type !== 'text')
}

function firstTextValue(nodes: PenNode[] | undefined): string | undefined {
  return collectTextValues(nodes).find(Boolean)
}

function collectTextValues(nodes: PenNode[] | undefined): string[] {
  if (!nodes) return []
  const values: string[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      const text = getTextContent(node).trim()
      if (text) values.push(text)
      continue
    }
    if ('children' in node && Array.isArray(node.children)) {
      values.push(...collectTextValues(node.children))
    }
  }
  return values
}

function collectReadableTextValues(node: PenNode, maxDepth = 2, depth = 0): string[] {
  const values: string[] = []
  for (const child of nodeChildren(node)) {
    if (child.type === 'text') {
      const text = getTextContent(child).trim()
      if (text) values.push(text)
      continue
    }

    if (depth >= maxDepth) continue
    if (isIconLikeNode(child)) continue

    const width = nodeWidth(child)
    const height = nodeHeight(child)
    if (width > 40 || height > 20 || isContainerNode(child)) {
      values.push(...collectReadableTextValues(child, maxDepth, depth + 1))
    }
  }

  return values
}

function findOptionContainer(node: PenNode): PenNode | null {
  for (const child of nodeChildren(node)) {
    if (!isContainerNode(child)) continue
    const texts = uniqueStrings(collectReadableTextValues(child))
    if (texts.length >= 2) return child
  }
  return null
}

function findToggleTrackContainer(node: PenNode): PenNode | null {
  const config = STRUCTURE_RULE_CONFIG.toggle
  const parentHeight = nodeHeight(node)
  for (const child of nodeChildren(node)) {
    if (!isContainerNode(child)) continue
    const width = nodeWidth(child)
    const height = nodeHeight(child)
    const indicators = directIconLikeChildren(child)
    if (indicators.length === 0) continue
    if (
      width > 0 &&
      width <= Math.max(parentHeight * config.trackMaxWidthFactor, config.trackMaxWidthFallback) &&
      height > 0 &&
      height <= Math.max(parentHeight, config.trackMaxHeightFallback)
    ) {
      return child
    }
  }
  return null
}

function directControlLabel(node: PenNode): string {
  const directLabel = directTextChildren(node)
    .map((child) => getTextContent(child).trim())
    .filter(Boolean)
    .join(' ')

  if (directLabel) return directLabel
  return ''
}

function humanizeCandidate(value: string): string {
  const withSpaces = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(btn|button|input|field|dropdown|toggle|slider|scroll|select)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return withSpaces
}

function fallbackControlLabel(node: PenNode, unityType: UnityNodeType): string {
  const nestedText = collectReadableTextValues(node).find(Boolean)
  if (nestedText) return nestedText

  const candidates = [node.name, node.role, node.id]
  for (const candidate of candidates) {
    if (!candidate) continue
    const humanized = humanizeCandidate(candidate)
    if (humanized) return humanized
  }

  const normalizedName = normalizeNodeName(node, inferUnityType(node))
  return humanizeCandidate(normalizedName) || unityType
}

function inferInputType(node: PenNode): string {
  return matchValueRule(combinedHint(node), INPUT_TYPE_RULES) ?? 'text'
}

function inferInputPlaceholder(node: PenNode, unityType: UnityNodeType): string {
  const direct = directControlLabel(node)
  if (direct) return direct

  const nested = firstTextValue('children' in node ? node.children : undefined)
  if (nested) return nested

  const placeholder = matchValueRule(combinedHint(node), INPUT_PLACEHOLDER_RULES)
  if (placeholder) return placeholder

  return fallbackControlLabel(node, unityType)
}

function inferToggleChecked(node: PenNode): string | undefined {
  if (typeof node.enabled === 'boolean') {
    return node.enabled ? 'true' : 'false'
  }

  const hint = combinedHint(node)
  if (matchesAnyPattern(hint, TOGGLE_TRUE_HINT_PATTERNS)) {
    return 'true'
  }
  if (matchesAnyPattern(hint, TOGGLE_FALSE_HINT_PATTERNS)) {
    return 'false'
  }

  const structural = inferToggleCheckedFromStructure(node)
  if (structural !== null) return structural ? 'true' : 'false'

  return undefined
}

function clampSliderValue(value: number): number {
  if (Number.isNaN(value)) return parseFloat(UNITY_HTML_EXPORT_CONFIG.defaultSliderValue)
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function formatSliderValue(value: number): string {
  const clamped = clampSliderValue(value)
  const fixed = clamped.toFixed(3)
  return fixed.replace(/\.?0+$/, '')
}

function inferSliderValue(node: PenNode): string {
  for (const candidate of candidateTexts(node)) {
    const text = String(candidate)
    const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/)
    if (percentMatch) {
      return formatSliderValue(parseFloat(percentMatch[1]) / 100)
    }

    const decimalMatch = text.match(/\b(0(?:\.\d+)?|1(?:\.0+)?)\b/)
    if (decimalMatch) {
      return formatSliderValue(parseFloat(decimalMatch[1]))
    }
  }

  const structural = inferSliderValueFromStructure(node)
  if (structural !== null) {
    return formatSliderValue(structural)
  }

  return UNITY_HTML_EXPORT_CONFIG.defaultSliderValue
}

function inferScrollDirection(node: PenNode): 'h' | 'v' {
  const hint = combinedHint(node)
  const configured = matchValueRule(hint, SCROLL_DIRECTION_RULES)
  if (configured) return configured
  if ('layout' in node && node.layout === 'horizontal') return 'h'
  const inferred = inferChildAxisDirection(node)
  if (inferred) return inferred
  return 'v'
}

function inferDropdownOptions(node: PenNode): string[] {
  const optionContainer = findOptionContainer(node)
  const rawValues = optionContainer
    ? collectReadableTextValues(optionContainer)
    : collectReadableTextValues(node)

  const options = uniqueStrings(rawValues)
    .map((value) => DROPDOWN_OPTION_TEXT_CLEANUPS
      .reduce((result, pattern) => result.replace(pattern, ''), value)
      .trim())
    .filter(Boolean)

  if (options.length > 0) return options
  return [...UNITY_HTML_EXPORT_CONFIG.defaultDropdownOptions]
}

function inferChildAxisDirection(node: PenNode): 'h' | 'v' | null {
  const children = nodeChildren(node)
  if (children.length < 2) return null

  const xPositions = children
    .map((child) => child.x)
    .filter((value): value is number => typeof value === 'number')
  const yPositions = children
    .map((child) => child.y)
    .filter((value): value is number => typeof value === 'number')

  if (xPositions.length < 2 || yPositions.length < 2) return null

  const xSpread = Math.max(...xPositions) - Math.min(...xPositions)
  const ySpread = Math.max(...yPositions) - Math.min(...yPositions)

  if (xSpread === 0 && ySpread === 0) return null
  return xSpread >= ySpread ? 'h' : 'v'
}

function inferSliderValueFromStructure(node: PenNode): number | null {
  const parentWidth = nodeWidth(node)
  if (parentWidth <= 0) return null

  const candidates = nodeChildren(node)
    .filter((child) => nodeWidth(child) > 0)
    .map((child) => nodeWidth(child))
    .filter((width) => width > 0 && width < parentWidth)

  if (candidates.length === 0) return null

  const bestWidth = Math.max(...candidates)
  return clampSliderValue(bestWidth / parentWidth)
}

function inferToggleCheckedFromStructure(node: PenNode): boolean | null {
  const config = STRUCTURE_RULE_CONFIG.toggle
  const parentWidth = nodeWidth(node)
  if (parentWidth <= 0) return null

  const track = findToggleTrackContainer(node)
  if (track) {
    const trackWidth = nodeWidth(track)
    const indicators = directIconLikeChildren(track)
    if (trackWidth > 0 && indicators.length > 0) {
      for (const indicator of indicators) {
        const indicatorWidth = nodeWidth(indicator)
        const indicatorX = indicator.x
        if (typeof indicatorX === 'number' && indicatorWidth > 0) {
          const center = indicatorX + indicatorWidth / 2
          if (center > trackWidth / 2 + config.centerOffset) return true
          if (center < trackWidth / 2 - config.centerOffset) return false
        }
      }
    }
  }

  const indicators = directIconLikeChildren(node)
  if (indicators.length === 0) return null

  for (const indicator of indicators) {
    const indicatorWidth = nodeWidth(indicator)
    const indicatorX = indicator.x
    if (typeof indicatorX === 'number' && indicatorWidth > 0) {
      const center = indicatorX + indicatorWidth / 2
      if (center > parentWidth / 2 + config.centerOffset) return true
      if (center < parentWidth / 2 - config.centerOffset) return false
    }
  }

  return null
}

function renderAttributes(
  attrs: Array<[string, string | undefined]>,
): string {
  return attrs
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${escapeHTML(String(value))}"`)
    .join('')
}

function renderContainerChildren(node: PenNode, depth: number): string {
  if (!('children' in node) || !Array.isArray(node.children) || node.children.length === 0) {
    return ''
  }
  return node.children
    .map((child) => generateNodeHTML(child, depth + 1))
    .join('\n')
}

function renderNonTextChildren(node: PenNode, depth: number): string {
  const children = nonTextChildren(node)
  if (children.length === 0) return ''
  return children
    .map((child) => generateNodeHTML(child, depth + 1))
    .join('\n')
}

function generateNodeHTML(node: PenNode, depth: number): string {
  const pad = indent(depth)
  const unityType = inferUnityType(node)
  const dataName = normalizeNodeName(node, unityType)
  const css = buildCommonStyle(node)

  switch (node.type) {
    case 'frame':
    case 'rectangle':
    case 'group': {
      Object.assign(css, fillToBackgroundCSS(node.fill))
      Object.assign(css, strokeToCSS(node.stroke))
      Object.assign(css, cornerRadiusToCSS(node.cornerRadius))
      Object.assign(css, effectsToCSS(node.effects))
      Object.assign(css, layoutToCSS(node))

      if (unityType === 'button') {
        css.cursor = 'pointer'
        const attrs = renderAttributes([
          ['type', 'button'],
          ['data-u-type', 'button'],
          ['data-u-name', dataName],
          ['style', styleToString(css)],
        ])
        const directLabel = directControlLabel(node)
        const extraChildren = renderNonTextChildren(node, depth)
        if (!extraChildren) {
          const label = escapeHTML(directLabel || fallbackControlLabel(node, unityType))
          return `${pad}<button${attrs}>${label}</button>`
        }
        if (directLabel) {
          const label = escapeHTML(directLabel)
          return `${pad}<button${attrs}>${label}\n${extraChildren}\n${pad}</button>`
        }
        return `${pad}<button${attrs}>\n${extraChildren}\n${pad}</button>`
      }

      if (unityType === 'input') {
        css['box-sizing'] = 'border-box'
        const attrs = renderAttributes([
          ['type', inferInputType(node)],
          ['placeholder', inferInputPlaceholder(node, unityType)],
          ['data-u-type', 'input'],
          ['data-u-name', dataName],
          ['style', styleToString(css)],
        ])
        return `${pad}<input${attrs} />`
      }

      if (unityType === 'dropdown') {
        css['box-sizing'] = 'border-box'
        const optionValues = inferDropdownOptions(node)
        const attrs = renderAttributes([
          ['data-u-type', 'dropdown'],
          ['data-u-name', dataName],
          ['style', styleToString(css)],
        ])
        const optionsHTML = optionValues
          .map((value) => `${indent(depth + 1)}<option>${escapeHTML(value)}</option>`)
          .join('\n')
        return `${pad}<select${attrs}>\n${optionsHTML}\n${pad}</select>`
      }

      if (unityType === 'toggle') {
        const checked = inferToggleChecked(node)
        const attrs = renderAttributes([
          ['data-u-type', 'toggle'],
          ['data-u-name', dataName],
          ['data-u-checked', checked],
          ['style', styleToString(css)],
        ])
        const directLabel = directControlLabel(node)
        const extraChildren = renderNonTextChildren(node, depth)
        if (!extraChildren) {
          const label = escapeHTML(directLabel || fallbackControlLabel(node, unityType))
          return `${pad}<div${attrs}>${label}</div>`
        }
        if (directLabel) {
          const label = escapeHTML(directLabel)
          return `${pad}<div${attrs}>${label}\n${extraChildren}\n${pad}</div>`
        }
        return `${pad}<div${attrs}>\n${extraChildren}\n${pad}</div>`
      }

      if (unityType === 'slider') {
        const attrs = renderAttributes([
          ['data-u-type', 'slider'],
          ['data-u-name', dataName],
          ['data-u-value', inferSliderValue(node)],
          ['style', styleToString(css)],
        ])
        return `${pad}<div${attrs}></div>`
      }

      if (unityType === 'scroll') {
        const attrs = renderAttributes([
          ['data-u-type', 'scroll'],
          ['data-u-name', dataName],
          ['data-u-dir', inferScrollDirection(node)],
          ['style', styleToString(css)],
        ])
        const childrenHTML = renderContainerChildren(node, depth)
        if (!childrenHTML) {
          return `${pad}<div${attrs}></div>`
        }
        return `${pad}<div${attrs}>\n${childrenHTML}\n${pad}</div>`
      }

      const attrs = renderAttributes([
        ['data-u-type', 'div'],
        ['data-u-name', dataName],
        ['style', styleToString(css)],
      ])
      const childrenHTML = renderContainerChildren(node, depth)
      if (!childrenHTML) {
        return `${pad}<div${attrs}></div>`
      }
      return `${pad}<div${attrs}>\n${childrenHTML}\n${pad}</div>`
    }

    case 'ellipse': {
      Object.assign(css, fillToBackgroundCSS(node.fill))
      Object.assign(css, strokeToCSS(node.stroke))
      Object.assign(css, effectsToCSS(node.effects))
      css['border-radius'] = '50%'
      const attrs = renderAttributes([
        ['data-u-type', 'div'],
        ['data-u-name', dataName],
        ['style', styleToString(css)],
      ])
      return `${pad}<div${attrs}></div>`
    }

    case 'text': {
      Object.assign(css, fillToTextCSS(node.fill))
      if (node.fontSize) css['font-size'] = `${node.fontSize}px`
      if (node.fontWeight) css['font-weight'] = String(node.fontWeight)
      if (node.fontStyle === 'italic') css['font-style'] = 'italic'
      if (node.textAlign) css['text-align'] = node.textAlign
      if (node.fontFamily) css['font-family'] = `'${node.fontFamily}', sans-serif`
      if (node.lineHeight) css['line-height'] = String(node.lineHeight)
      if (node.letterSpacing) css['letter-spacing'] = `${node.letterSpacing}px`
      if (node.textAlignVertical === 'middle') css['vertical-align'] = 'middle'
      else if (node.textAlignVertical === 'bottom') css['vertical-align'] = 'bottom'
      if (node.textGrowth === 'auto') css['white-space'] = 'nowrap'
      else if (node.textGrowth === 'fixed-width-height') css.overflow = 'hidden'
      const textDecorations: string[] = []
      if (node.underline) textDecorations.push('underline')
      if (node.strikethrough) textDecorations.push('line-through')
      if (textDecorations.length > 0) {
        css['text-decoration'] = textDecorations.join(' ')
      }
      Object.assign(css, effectsToCSS(node.effects))

      const tag = textTag(node)
      const attrs = renderAttributes([
        ['data-u-type', 'text'],
        ['data-u-name', dataName],
        ['style', styleToString(css)],
      ])
      return `${pad}<${tag}${attrs}>${escapeHTML(getTextContent(node))}</${tag}>`
    }

    case 'line': {
      const width = node.x2 !== undefined ? Math.abs(node.x2 - (node.x ?? 0)) : 0
      const thickness = node.stroke
        ? typeof node.stroke.thickness === 'number'
          ? node.stroke.thickness
          : typeof node.stroke.thickness === 'string'
            ? node.stroke.thickness
            : node.stroke.thickness[0]
        : 1

      if (typeof thickness === 'string' && isVariableRef(thickness)) {
        css.height = varOrLiteral(thickness)
      } else {
        css.height = `${thickness}px`
      }
      css.width = `${width}px`
      css['background-color'] = node.stroke?.fill?.[0]?.type === 'solid'
        ? varOrLiteral(node.stroke.fill[0].color)
        : '#000000'

      const attrs = renderAttributes([
        ['data-u-type', 'div'],
        ['data-u-name', dataName],
        ['style', styleToString(css)],
      ])
      return `${pad}<div${attrs}></div>`
    }

    case 'polygon':
    case 'path': {
      Object.assign(css, fillToBackgroundCSS(node.fill))
      Object.assign(css, strokeToCSS(node.stroke))
      Object.assign(css, effectsToCSS(node.effects))
      if (!css['background-color'] && !css.background) {
        css['background-color'] = 'rgba(0, 0, 0, 0.08)'
      }
      const attrs = renderAttributes([
        ['data-u-type', node.type === 'path' ? 'image' : 'div'],
        ['data-u-name', dataName],
        ['style', styleToString(css)],
      ])
      return `${pad}<div${attrs}></div>`
    }

    case 'image': {
      Object.assign(css, cornerRadiusToCSS(node.cornerRadius))
      Object.assign(css, effectsToCSS(node.effects))
      if (node.src) {
        css['background-image'] = `url('${node.src.replace(/'/g, "\\'")}')`
        css['background-position'] = 'center'
        css['background-repeat'] = 'no-repeat'
        css['background-size'] = node.objectFit === 'fit'
          ? 'contain'
          : node.objectFit === 'crop'
            ? 'cover'
            : '100% 100%'
      } else {
        css['background-color'] = '#D1D5DB'
      }
      const attrs = renderAttributes([
        ['data-u-type', 'image'],
        ['data-u-name', dataName],
        ['style', styleToString(css)],
      ])
      return `${pad}<div${attrs}></div>`
    }

    case 'icon_font': {
      const size = typeof node.width === 'number' ? node.width : 24
      css.width = `${size}px`
      css.height = `${size}px`
      if (node.fill?.[0]?.type === 'solid') {
        css['background-color'] = varOrLiteral(node.fill[0].color)
      } else {
        css['background-color'] = 'rgba(0, 0, 0, 0.08)'
      }
      const attrs = renderAttributes([
        ['data-u-type', 'image'],
        ['data-u-name', dataName],
        ['style', styleToString(css)],
      ])
      return `${pad}<div${attrs}></div>`
    }

    case 'ref':
      return `${pad}<!-- Ref: ${escapeHTML(node.ref)} -->`

    default:
      return `${pad}<!-- Unknown node -->`
  }
}

export function generateHTMLCode(
  nodes: PenNode[],
  options: HTMLExportOptions = {},
): { html: string; css: string } {
  resetFallbackNameCounter()

  const rootStyle = styleToString({
    position: 'relative',
    width: `${UNITY_HTML_EXPORT_CONFIG.rootWidth}px`,
    height: `${UNITY_HTML_EXPORT_CONFIG.rootHeight}px`,
    overflow: 'hidden',
  })

  const childrenHTML = nodes
    .map((node) => generateNodeHTML(node, 1))
    .join('\n')

  const rootName = toCamelCase(options.rootName ?? 'root') || 'root'
  const html = childrenHTML
    ? `<div data-u-type="div" data-u-name="${rootName}" style="${rootStyle}">\n${childrenHTML}\n</div>`
    : `<div data-u-type="div" data-u-name="${rootName}" style="${rootStyle}"></div>`

  return { html, css: '' }
}

export function generateHTMLFromDocument(
  doc: PenDocument,
  activePageId?: string | null,
): { html: string; css: string } {
  const children = activePageId !== undefined
    ? getActivePageChildren(doc, activePageId)
    : doc.children
  const result = generateHTMLCode(children)
  const varsCSS = doc.variables && Object.keys(doc.variables).length > 0
    ? generateCSSVariables(doc)
    : ''
  return {
    html: result.html,
    css: varsCSS,
  }
}
