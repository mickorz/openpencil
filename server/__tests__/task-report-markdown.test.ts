import { describe, expect, it } from 'vitest'
import {
  buildTaskReportMarkdown,
  sanitizeFileName,
} from '../utils/task-report-markdown'

describe('sanitizeFileName', () => {
  it('removes Windows-invalid filename characters', () => {
    expect(sanitizeFileName('task: image/reference*modal?')).toBe('task image reference modal')
  })

  it('falls back to task when the title is empty', () => {
    expect(sanitizeFileName('   ')).toBe('task')
  })
})

describe('buildTaskReportMarkdown', () => {
  it('renders task input, raw output, parsed result, and sections', () => {
    const markdown = buildTaskReportMarkdown({
      title: 'backpack-modal',
      mode: 'design',
      taskInput: 'Generate a backpack modal from the reference image.',
      provider: 'openai',
      model: 'o3',
      rawOutput: 'raw model output',
      parsedResult: '{"id":"page"}',
      sections: [
        {
          title: 'Orchestrator Plan',
          input: 'planner input',
          rawOutput: 'planner raw',
          parsedResult: '{"rootFrame":{"id":"page"}}',
        },
      ],
    }, '2026-03-12T12:34:56.000Z')

    expect(markdown).toContain('# AI Task Report')
    expect(markdown).toContain('## Task Input')
    expect(markdown).toContain('Generate a backpack modal from the reference image.')
    expect(markdown).toContain('## Model Raw Output')
    expect(markdown).toContain('raw model output')
    expect(markdown).toContain('## Parsed Result')
    expect(markdown).toContain('## Orchestrator Plan')
    expect(markdown).toContain('### Model Raw Output')
  })
})
