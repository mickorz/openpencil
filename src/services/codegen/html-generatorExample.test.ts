import { describe, expect, it } from 'vitest'
import type { PenNode } from '@/types/pen'
import { generateHTMLCode } from './html-generator'

describe('generateHTMLCode', () => {
  it('exports a Unity DSL root with inline styles', () => {
    const nodes: PenNode[] = [
      {
        id: 'hero-frame',
        type: 'frame',
        name: 'Hero Frame',
        x: 40,
        y: 60,
        width: 800,
        height: 400,
        fill: [{ type: 'solid', color: '#ffffff' }],
        children: [
          {
            id: 'title-node',
            type: 'text',
            name: 'Title Txt',
            content: 'Welcome Back',
            x: 32,
            y: 24,
            fontSize: 40,
            fontWeight: 700,
            fill: [{ type: 'solid', color: '#111827' }],
          },
        ],
      },
    ]

    const { html, css } = generateHTMLCode(nodes)

    expect(css).toBe('')
    expect(html).toContain('data-u-type="div" data-u-name="root"')
    expect(html).toContain('style="position: relative; width: 1920px; height: 1080px; overflow: hidden;"')
    expect(html).toContain('data-u-name="heroFrame"')
    expect(html).toContain('data-u-name="titleTxt"')
    expect(html).toContain('data-u-type="text"')
    expect(html).not.toContain('class=')
    expect(html).not.toContain('<style>')
  })

  it('maps semantic controls to Unity DSL tags and attributes', () => {
    const nodes: PenNode[] = [
      {
        id: 'login-btn',
        type: 'frame',
        name: 'Login Btn',
        role: 'button',
        x: 100,
        y: 120,
        width: 240,
        height: 56,
        fill: [{ type: 'solid', color: '#2563EB' }],
        children: [
          {
            id: 'login-btn-text',
            type: 'text',
            name: 'Label Txt',
            content: 'Sign In',
            fontSize: 24,
            fill: [{ type: 'solid', color: '#ffffff' }],
          },
        ],
      },
      {
        id: 'settings-dropdown',
        type: 'frame',
        name: 'Quality Dropdown',
        role: 'dropdown',
        x: 420,
        y: 120,
        width: 320,
        height: 56,
        children: [
          {
            id: 'low-option',
            type: 'text',
            name: 'Low Option',
            content: 'Low',
            fontSize: 20,
          },
          {
            id: 'high-option',
            type: 'text',
            name: 'High Option',
            content: 'High',
            fontSize: 20,
          },
        ],
      },
      {
        id: 'list-scroll',
        type: 'frame',
        name: 'List Scroll',
        role: 'scroll',
        x: 100,
        y: 240,
        width: 400,
        height: 300,
        layout: 'vertical',
        children: [],
      },
      {
        id: 'volume-slider',
        type: 'frame',
        name: 'Volume Slider 80%',
        role: 'slider',
        x: 100,
        y: 580,
        width: 400,
        height: 24,
        fill: [{ type: 'solid', color: '#D1D5DB' }],
      },
    ]

    const { html } = generateHTMLCode(nodes)

    expect(html).toContain('<button type="button" data-u-type="button" data-u-name="loginBtn"')
    expect(html).toContain('>Sign In</button>')
    expect(html).toContain('<select data-u-type="dropdown" data-u-name="qualityDropdown"')
    expect(html).toContain('<option>Low</option>')
    expect(html).toContain('<option>High</option>')
    expect(html).toContain('data-u-type="scroll" data-u-name="listScroll" data-u-dir="v"')
    expect(html).toContain('data-u-type="slider" data-u-name="volumeSlider80" data-u-value="0.8"')
  })

  it('infers input placeholder and toggle state from semantic hints', () => {
    const nodes: PenNode[] = [
      {
        id: 'search-bar',
        type: 'frame',
        name: 'Search Bar',
        role: 'search-bar',
        x: 80,
        y: 80,
        width: 420,
        height: 48,
        children: [],
      },
      {
        id: 'news-toggle-enabled',
        type: 'frame',
        name: 'News Toggle Enabled',
        role: 'toggle',
        enabled: true,
        x: 80,
        y: 160,
        width: 220,
        height: 40,
        children: [
          {
            id: 'news-toggle-label',
            type: 'text',
            name: 'News Label',
            content: 'Enable News',
            fontSize: 18,
          },
        ],
      },
      {
        id: 'top-carousel',
        type: 'frame',
        name: 'Top Carousel',
        role: 'scroll',
        x: 80,
        y: 240,
        width: 600,
        height: 220,
        layout: 'horizontal',
        children: [],
      },
    ]

    const { html } = generateHTMLCode(nodes)

    expect(html).toContain('<input type="search" placeholder="Search" data-u-type="input" data-u-name="searchBar"')
    expect(html).toContain('data-u-type="toggle" data-u-name="newsToggleEnabled" data-u-checked="true"')
    expect(html).toContain('>Enable News</div>')
    expect(html).toContain('data-u-type="scroll" data-u-name="topCarousel" data-u-dir="h"')
  })

  it('infers common controls from node structure without relying on role', () => {
    const nodes: PenNode[] = [
      {
        id: 'primary-action',
        type: 'frame',
        name: 'Primary Action',
        x: 60,
        y: 80,
        width: 220,
        height: 52,
        fill: [{ type: 'solid', color: '#111827' }],
        children: [
          {
            id: 'primary-action-label',
            type: 'text',
            name: 'Primary Action Label',
            content: 'Continue',
            fontSize: 18,
            fill: [{ type: 'solid', color: '#ffffff' }],
          },
        ],
      },
      {
        id: 'email-field-shell',
        type: 'frame',
        name: 'Email Field Shell',
        x: 60,
        y: 160,
        width: 360,
        height: 48,
        fill: [{ type: 'solid', color: '#ffffff' }],
        stroke: {
          thickness: 1,
          fill: [{ type: 'solid', color: '#d1d5db' }],
        },
        layout: 'horizontal',
        children: [
          {
            id: 'email-icon',
            type: 'path',
            name: 'Mail Icon',
            d: 'M2 4h20v16H2z',
            width: 20,
            height: 20,
            fill: [{ type: 'solid', color: '#6b7280' }],
          },
          {
            id: 'email-placeholder',
            type: 'text',
            name: 'Email Placeholder',
            content: 'Email',
            fontSize: 16,
            fill: [{ type: 'solid', color: '#9ca3af' }],
          },
        ],
      },
      {
        id: 'sound-switch',
        type: 'frame',
        name: 'Sound Switch',
        x: 60,
        y: 240,
        width: 220,
        height: 40,
        children: [
          {
            id: 'sound-toggle-thumb',
            type: 'ellipse',
            name: 'Sound Toggle Thumb',
            width: 24,
            height: 24,
            fill: [{ type: 'solid', color: '#22c55e' }],
          },
          {
            id: 'sound-toggle-label',
            type: 'text',
            name: 'Sound Toggle Label',
            content: 'Sound',
            fontSize: 16,
          },
        ],
      },
      {
        id: 'progress-track',
        type: 'frame',
        name: 'Progress Track',
        x: 60,
        y: 320,
        width: 320,
        height: 16,
        fill: [{ type: 'solid', color: '#d1d5db' }],
        children: [
          {
            id: 'progress-fill',
            type: 'frame',
            name: 'Progress Fill',
            width: 180,
            height: 16,
            fill: [{ type: 'solid', color: '#2563eb' }],
          },
          {
            id: 'progress-thumb',
            type: 'ellipse',
            name: 'Progress Thumb',
            width: 16,
            height: 16,
            fill: [{ type: 'solid', color: '#ffffff' }],
          },
        ],
      },
      {
        id: 'gallery-rail',
        type: 'frame',
        name: 'Gallery Rail',
        x: 60,
        y: 380,
        width: 640,
        height: 180,
        children: [
          {
            id: 'gallery-card-1',
            type: 'frame',
            name: 'Gallery Card 1',
            x: 0,
            y: 0,
            width: 140,
            height: 160,
            fill: [{ type: 'solid', color: '#e5e7eb' }],
          },
          {
            id: 'gallery-card-2',
            type: 'frame',
            name: 'Gallery Card 2',
            x: 160,
            y: 0,
            width: 140,
            height: 160,
            fill: [{ type: 'solid', color: '#e5e7eb' }],
          },
          {
            id: 'gallery-card-3',
            type: 'frame',
            name: 'Gallery Card 3',
            x: 320,
            y: 0,
            width: 140,
            height: 160,
            fill: [{ type: 'solid', color: '#e5e7eb' }],
          },
          {
            id: 'gallery-card-4',
            type: 'frame',
            name: 'Gallery Card 4',
            x: 480,
            y: 0,
            width: 140,
            height: 160,
            fill: [{ type: 'solid', color: '#e5e7eb' }],
          },
        ],
      },
    ]

    const { html } = generateHTMLCode(nodes)

    expect(html).toContain('<button type="button" data-u-type="button" data-u-name="primaryAction"')
    expect(html).toContain('<input type="email" placeholder="Email" data-u-type="input" data-u-name="emailFieldShell"')
    expect(html).toContain('data-u-type="toggle" data-u-name="soundSwitch"')
    expect(html).toContain('>Sound')
    expect(html).toContain('data-u-name="soundToggleThumb"')
    expect(html).toContain('data-u-type="slider" data-u-name="progressTrack" data-u-value="0.563"')
    expect(html).toContain('data-u-type="scroll" data-u-name="galleryRail" data-u-dir="h"')
  })

  it('infers nested dropdown and toggle templates from child structure', () => {
    const nodes: PenNode[] = [
      {
        id: 'quality-picker-shell',
        type: 'frame',
        name: 'Quality Picker Shell',
        x: 80,
        y: 80,
        width: 320,
        height: 52,
        fill: [{ type: 'solid', color: '#ffffff' }],
        stroke: {
          thickness: 1,
          fill: [{ type: 'solid', color: '#d1d5db' }],
        },
        children: [
          {
            id: 'quality-display-row',
            type: 'frame',
            name: 'Quality Display Row',
            width: 320,
            height: 52,
            layout: 'horizontal',
            children: [
              {
                id: 'quality-display-text',
                type: 'text',
                name: 'Quality Display Text',
                content: 'Medium',
                fontSize: 16,
              },
              {
                id: 'quality-display-arrow',
                type: 'path',
                name: 'Chevron Down',
                d: 'M4 6l8 8 8-8',
                width: 16,
                height: 16,
                fill: [{ type: 'solid', color: '#6b7280' }],
              },
            ],
          },
          {
            id: 'quality-options-panel',
            type: 'frame',
            name: 'Quality Options Panel',
            y: 60,
            width: 320,
            height: 144,
            children: [
              {
                id: 'quality-option-low',
                type: 'text',
                name: 'Quality Option Low',
                content: 'Low',
                fontSize: 16,
              },
              {
                id: 'quality-option-medium',
                type: 'text',
                name: 'Quality Option Medium',
                content: 'Medium',
                fontSize: 16,
              },
              {
                id: 'quality-option-high',
                type: 'text',
                name: 'Quality Option High',
                content: 'High',
                fontSize: 16,
              },
            ],
          },
        ],
      },
      {
        id: 'alert-toggle-shell',
        type: 'frame',
        name: 'Alert Toggle Shell',
        x: 80,
        y: 180,
        width: 240,
        height: 44,
        layout: 'horizontal',
        children: [
          {
            id: 'alert-toggle-track',
            type: 'frame',
            name: 'Alert Toggle Track',
            width: 52,
            height: 28,
            fill: [{ type: 'solid', color: '#22c55e' }],
            children: [
              {
                id: 'alert-toggle-thumb',
                type: 'ellipse',
                name: 'Alert Toggle Thumb',
                x: 24,
                y: 2,
                width: 24,
                height: 24,
                fill: [{ type: 'solid', color: '#ffffff' }],
              },
            ],
          },
          {
            id: 'alert-toggle-text-wrap',
            type: 'frame',
            name: 'Alert Toggle Text Wrap',
            width: 160,
            height: 28,
            children: [
              {
                id: 'alert-toggle-text',
                type: 'text',
                name: 'Alert Toggle Text',
                content: 'Email Alerts',
                fontSize: 16,
              },
            ],
          },
        ],
      },
    ]

    const { html } = generateHTMLCode(nodes)

    expect(html).toContain('<select data-u-type="dropdown" data-u-name="qualityPickerShell"')
    expect(html).toContain('<option>Low</option>')
    expect(html).toContain('<option>Medium</option>')
    expect(html).toContain('<option>High</option>')
    expect(html).toContain('data-u-type="toggle" data-u-name="alertToggleShell" data-u-checked="true"')
    expect(html).toContain('Email Alerts')
  })
})
