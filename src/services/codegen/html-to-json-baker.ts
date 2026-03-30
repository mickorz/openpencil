import { UNITY_HTML_EXPORT_CONFIG } from './html-unity-structure-rules'
import type { UnityNodeType } from './html-unity-keyword-rules'

export interface BakedUINode {
  name: string
  type: string
  dir: 'h' | 'v'
  value: number
  isChecked: boolean
  options: string[]
  x: number
  y: number
  width: number
  height: number
  color: string
  fontColor: string
  fontSize: number
  textAlign: string
  text: string
  children: BakedUINode[]
}

export interface BakeIssue {
  level: 'warning'
  message: string
}

export interface BakeResult {
  root: BakedUINode
  warnings: BakeIssue[]
}

const ALLOWED_TYPES = new Set<UnityNodeType>([
  'div',
  'image',
  'text',
  'button',
  'input',
  'scroll',
  'toggle',
  'slider',
  'dropdown',
])

function stripUnsafeTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '')
}

function injectBakeSandboxStyles(doc: Document): void {
  const styleElement = doc.createElement('style')
  styleElement.textContent = `
    html, body {
      margin: 0;
      padding: 0;
    }
    * {
      box-sizing: border-box !important;
    }
    [data-u-type] {
      min-width: 0;
      min-height: 0;
    }
  `
  doc.head.appendChild(styleElement)
}

function waitForLayout(win: Window): Promise<void> {
  return new Promise((resolve) => {
    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(() => resolve())
    })
  })
}

function safeParseNumber(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function resolveBakedNodeText(element: HTMLElement, uType?: string | null): string {
  const normalizedType = (uType ?? element.getAttribute('data-u-type') ?? '').trim().toLowerCase()
  const tagName = element.tagName.toLowerCase()

  if (normalizedType === 'div' || normalizedType === 'image' || normalizedType === 'scroll' || normalizedType === 'slider') {
    return ''
  }

  if (tagName === 'input') {
    const input = element as HTMLInputElement
    return (input.value || input.placeholder || '').trim()
  }

  if (tagName === 'select') {
    const select = element as HTMLSelectElement
    const selected = select.selectedOptions?.[0]?.textContent ?? ''
    if (selected.trim()) return selected.trim()
  }

  if (normalizedType === 'text' || normalizedType === 'button' || normalizedType === 'toggle') {
    return (element.innerText || element.textContent || '').trim()
  }

  return (element.innerText || element.textContent || '').trim()
}

function nextLayoutGroupName(counterRef: { value: number }): string {
  counterRef.value += 1
  return `layoutGroup${counterRef.value}`
}

function createLayoutGroup(children: BakedUINode[], counterRef: { value: number }): BakedUINode {
  return {
    name: nextLayoutGroupName(counterRef),
    type: 'div',
    dir: 'v',
    value: 0,
    isChecked: false,
    options: [],
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    color: '#FFFFFF00',
    fontColor: '#000000',
    fontSize: 14,
    textAlign: 'center',
    text: '',
    children,
  }
}

function traverseAndBake(
  element: HTMLElement,
  rootRect: DOMRect,
  win: Window,
  groupCounter: { value: number },
): BakedUINode | null {
  const uType = element.getAttribute('data-u-type')
  const uName = element.getAttribute('data-u-name')

  let nodeData: BakedUINode | null = null

  if (uType && uName) {
    const rect = element.getBoundingClientRect()
    const style = win.getComputedStyle(element)
    const relativeX = rect.left - rootRect.left
    const relativeY = rect.top - rootRect.top
    const dropdownOptions = uType === 'dropdown' && element.tagName.toLowerCase() === 'select'
      ? Array.from(element.querySelectorAll('option')).map((option) => (option.textContent || '').trim()).filter(Boolean)
      : []

    nodeData = {
      name: uName,
      type: uType,
      dir: element.getAttribute('data-u-dir') === 'h' ? 'h' : 'v',
      value: safeParseNumber(element.getAttribute('data-u-value'), parseFloat(UNITY_HTML_EXPORT_CONFIG.defaultSliderValue)),
      isChecked: element.getAttribute('data-u-checked') === 'true',
      options: dropdownOptions,
      x: Math.round(relativeX),
      y: Math.round(relativeY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      color: rgbToHex(style.backgroundColor),
      fontColor: rgbToHex(style.color),
      fontSize: Math.round(safeParseNumber(style.fontSize, 14)),
      textAlign: style.textAlign || 'center',
      text: resolveBakedNodeText(element, uType),
      children: [],
    }
  }

  const childrenData: BakedUINode[] = []
  for (let i = 0; i < element.children.length; i += 1) {
    const child = element.children[i] as HTMLElement
    if (element.tagName.toLowerCase() === 'select' && child.tagName.toLowerCase() === 'option') {
      continue
    }
    const bakedChild = traverseAndBake(child, rootRect, win, groupCounter)
    if (bakedChild) childrenData.push(bakedChild)
  }

  if (nodeData) {
    nodeData.children = childrenData
    return nodeData
  }

  if (childrenData.length === 1) return childrenData[0]
  if (childrenData.length > 1) return createLayoutGroup(childrenData, groupCounter)
  return null
}

export function rgbToHex(rgb: string): string {
  if (!rgb || rgb === 'rgba(0, 0, 0, 0)' || rgb === 'transparent') return '#FFFFFF00'
  if (/^#[0-9a-fA-F]{3,8}$/.test(rgb)) return rgb

  const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
  if (!match) return '#FFFFFF'

  const r = (`0${parseInt(match[1], 10).toString(16)}`).slice(-2)
  const g = (`0${parseInt(match[2], 10).toString(16)}`).slice(-2)
  const b = (`0${parseInt(match[3], 10).toString(16)}`).slice(-2)
  const a = match[4]
    ? (`0${Math.round(parseFloat(match[4]) * 255).toString(16)}`).slice(-2)
    : 'ff'

  return `#${r}${g}${b}${a === 'ff' ? '' : a}`
}

export function findTopLevelBakeRoots(doc: Document): HTMLElement[] {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>('[data-u-name][data-u-type]'))
  return candidates.filter((element) => !element.parentElement?.closest('[data-u-name][data-u-type]'))
}

export function collectBakeWarnings(root: HTMLElement): BakeIssue[] {
  const warnings: BakeIssue[] = []
  const nameCounts = new Map<string, number>()
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('[data-u-name], [data-u-type]'))]

  for (const node of nodes) {
    const uName = node.getAttribute('data-u-name')
    const uType = node.getAttribute('data-u-type')

    if (uName) {
      const nextCount = (nameCounts.get(uName) ?? 0) + 1
      nameCounts.set(uName, nextCount)
      if (nextCount === 2) {
        warnings.push({ level: 'warning', message: `发现重复的 data-u-name: ${uName}` })
      }
    }

    if ((uName && !uType) || (!uName && uType)) {
      warnings.push({ level: 'warning', message: '存在只填写了 data-u-name 或 data-u-type 的节点' })
    }

    if (uType && !ALLOWED_TYPES.has(uType as UnityNodeType)) {
      warnings.push({ level: 'warning', message: `发现未识别的 data-u-type: ${uType}` })
    }

    if (uType === 'scroll') {
      const dir = node.getAttribute('data-u-dir')
      if (dir && dir !== 'h' && dir !== 'v') {
        warnings.push({ level: 'warning', message: `scroll 节点 ${uName ?? ''} 的 data-u-dir 不是 h 或 v` })
      }
    }

    if (uType === 'dropdown' && node.tagName.toLowerCase() !== 'select') {
      warnings.push({ level: 'warning', message: `dropdown 节点 ${uName ?? ''} 没有使用 select 标签` })
    }

    if (uType === 'input' && node.tagName.toLowerCase() !== 'input') {
      warnings.push({ level: 'warning', message: `input 节点 ${uName ?? ''} 没有使用 input 标签` })
    }
  }

  return warnings
}

export async function bakeHTMLToJSON(html: string): Promise<BakeResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('HTML 坐标烘焙只能在浏览器环境运行')
  }

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = `${UNITY_HTML_EXPORT_CONFIG.rootWidth}px`
  iframe.style.height = `${UNITY_HTML_EXPORT_CONFIG.rootHeight}px`
  iframe.style.opacity = '0'
  iframe.style.pointerEvents = 'none'
  iframe.style.border = '0'

  document.body.appendChild(iframe)

  try {
    const sanitizedHTML = stripUnsafeTags(html)
    const frameDoc = iframe.contentDocument
    const frameWindow = iframe.contentWindow

    if (!frameDoc || !frameWindow) {
      throw new Error('无法创建 HTML 烘焙沙盒')
    }

    frameDoc.open()
    frameDoc.write(sanitizedHTML)
    frameDoc.close()
    injectBakeSandboxStyles(frameDoc)

    await waitForLayout(frameWindow)

    const roots = findTopLevelBakeRoots(frameDoc)
    if (roots.length === 0) {
      throw new Error('未找到带有 data-u-name 和 data-u-type 的根节点')
    }
    if (roots.length > 1) {
      throw new Error('检测到多个根节点，无法确定唯一烘焙基准')
    }

    const rootElement = roots[0]
    const rootRect = rootElement.getBoundingClientRect()

    if (Math.round(rootRect.width) > UNITY_HTML_EXPORT_CONFIG.rootWidth || Math.round(rootRect.height) > UNITY_HTML_EXPORT_CONFIG.rootHeight) {
      throw new Error(`根节点尺寸超限，当前为 ${Math.round(rootRect.width)}x${Math.round(rootRect.height)}`)
    }

    const groupCounter = { value: 0 }
    const rootNode = traverseAndBake(rootElement, rootRect, frameWindow, groupCounter)
    if (!rootNode) {
      throw new Error('烘焙失败，未生成有效 JSON 节点')
    }

    return {
      root: rootNode,
      warnings: collectBakeWarnings(rootElement),
    }
  } finally {
    iframe.remove()
  }
}
