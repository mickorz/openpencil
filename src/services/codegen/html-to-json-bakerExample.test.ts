// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { collectBakeWarnings, findTopLevelBakeRoots, resolveBakedNodeText, rgbToHex } from './html-to-json-baker'

describe('html-to-json-baker helpers', () => {
  it('finds a single top-level bake root', () => {
    document.body.innerHTML = `
      <div data-u-type="div" data-u-name="root">
        <div data-u-type="button" data-u-name="submitBtn"></div>
      </div>
    `

    const roots = findTopLevelBakeRoots(document)

    expect(roots).toHaveLength(1)
    expect(roots[0].getAttribute('data-u-name')).toBe('root')
  })

  it('collects structural warnings for invalid nodes', () => {
    document.body.innerHTML = `
      <div data-u-type="div" data-u-name="root">
        <div data-u-type="unknown" data-u-name="duplicateName"></div>
        <div data-u-type="scroll" data-u-name="duplicateName" data-u-dir="x"></div>
        <div data-u-type="dropdown" data-u-name="qualityDropdown"></div>
        <div data-u-type="input" data-u-name="emailInput"></div>
        <div data-u-name="missingType"></div>
      </div>
    `

    const root = document.querySelector<HTMLElement>('[data-u-name="root"]')
    if (!root) throw new Error('root not found in test')

    const warnings = collectBakeWarnings(root).map((item) => item.message)

    expect(warnings.some((message) => message.includes('重复的 data-u-name'))).toBe(true)
    expect(warnings.some((message) => message.includes('未识别的 data-u-type'))).toBe(true)
    expect(warnings.some((message) => message.includes('data-u-dir'))).toBe(true)
    expect(warnings.some((message) => message.includes('dropdown'))).toBe(true)
    expect(warnings.some((message) => message.includes('input'))).toBe(true)
    expect(warnings.some((message) => message.includes('只填写了 data-u-name 或 data-u-type'))).toBe(true)
  })

  it('converts rgb and rgba colors to hex', () => {
    expect(rgbToHex('rgb(255, 0, 0)')).toBe('#ff0000')
    expect(rgbToHex('rgba(255, 0, 0, 0.5)')).toBe('#ff000080')
    expect(rgbToHex('transparent')).toBe('#FFFFFF00')
  })

  it('does not copy descendant text into container nodes', () => {
    document.body.innerHTML = `
      <div data-u-type="div" data-u-name="root">
        <div data-u-type="text" data-u-name="titleText">Hello World</div>
      </div>
    `

    const root = document.querySelector<HTMLElement>('[data-u-name="root"]')
    const text = document.querySelector<HTMLElement>('[data-u-name="titleText"]')
    if (!root || !text) throw new Error('test nodes not found')

    expect(resolveBakedNodeText(root, 'div')).toBe('')
    expect(resolveBakedNodeText(text, 'text')).toBe('Hello World')
  })

  it('keeps control labels for interactive nodes', () => {
    document.body.innerHTML = `
      <button data-u-type="button" data-u-name="submitBtn">
        <span>Submit Form</span>
      </button>
    `

    const button = document.querySelector<HTMLElement>('[data-u-name="submitBtn"]')
    if (!button) throw new Error('button not found in test')

    expect(resolveBakedNodeText(button, 'button')).toBe('Submit Form')
  })
})
