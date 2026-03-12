import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export interface TaskReportAttachmentPayload {
  name: string
  mediaType: string
  size?: number
}

export interface TaskReportSectionPayload {
  title: string
  input?: string
  rawOutput?: string
  parsedResult?: string
  error?: string
}

export interface TaskReportPayload {
  title: string
  mode: string
  taskInput: string
  provider?: string
  model?: string
  createdAt?: string
  attachments?: TaskReportAttachmentPayload[]
  rawOutput?: string
  parsedResult?: string
  error?: string
  sections?: TaskReportSectionPayload[]
}

export interface TaskReportRecord extends TaskReportPayload {
  reportId: string
  filePath: string
  createdAt: string
}

const taskReportStore = new Map<string, TaskReportRecord>()

export async function startTaskReportMarkdown(
  payload: TaskReportPayload,
  rootDir = process.cwd(),
): Promise<TaskReportRecord> {
  const createdAt = payload.createdAt ?? new Date().toISOString()
  const dateSegment = createdAt.slice(0, 10)
  const timeSegment = createdAt.slice(11, 19).replace(/:/g, '-')
  const fileName = `${timeSegment}-${sanitizeFileName(payload.title || 'task')}.md`
  const dir = join(rootDir, 'TaskReports', dateSegment)
  const filePath = join(dir, fileName)

  await mkdir(dir, { recursive: true })

  const record: TaskReportRecord = {
    ...payload,
    reportId: randomUUID(),
    filePath,
    createdAt,
  }

  taskReportStore.set(record.reportId, record)
  await writeTaskReportRecord(record)
  return record
}

export async function updateTaskReportMarkdown(
  reportId: string,
  patch: Partial<TaskReportPayload>,
): Promise<TaskReportRecord> {
  const existing = taskReportStore.get(reportId)
  if (!existing) {
    throw new Error(`Task report not found: ${reportId}`)
  }

  const record: TaskReportRecord = {
    ...existing,
    ...patch,
    reportId: existing.reportId,
    filePath: existing.filePath,
    createdAt: existing.createdAt,
  }

  taskReportStore.set(reportId, record)
  await writeTaskReportRecord(record)
  return record
}

export function buildTaskReportMarkdown(
  payload: TaskReportPayload,
  createdAt = payload.createdAt ?? new Date().toISOString(),
): string {
  const lines: string[] = [
    '# AI Task Report',
    '',
    `- Title: ${payload.title || 'task'}`,
    `- Time: ${createdAt}`,
    `- Mode: ${payload.mode || 'unknown'}`,
    `- Provider: ${payload.provider || 'unknown'}`,
    `- Model: ${payload.model || 'unknown'}`,
    '',
    '## Task Input',
    '',
    '```text',
    payload.taskInput || '',
    '```',
  ]

  if (payload.attachments && payload.attachments.length > 0) {
    lines.push('', '## Attachments', '', '| Name | Media Type | Size |', '| --- | --- | --- |')
    for (const attachment of payload.attachments) {
      lines.push(
        `| ${escapeTableCell(attachment.name)} | ${escapeTableCell(attachment.mediaType)} | ${attachment.size ?? ''} |`,
      )
    }
  }

  if (payload.rawOutput) {
    lines.push('', '## Model Raw Output', '', '```text', payload.rawOutput, '```')
  }

  if (payload.parsedResult) {
    lines.push('', '## Parsed Result', '', '```json', payload.parsedResult, '```')
  }

  if (payload.error) {
    lines.push('', '## Error', '', '```text', payload.error, '```')
  }

  for (const section of payload.sections ?? []) {
    lines.push('', `## ${section.title}`)
    if (section.input) {
      lines.push('', '### Task Input', '', '```text', section.input, '```')
    }
    if (section.rawOutput) {
      lines.push('', '### Model Raw Output', '', '```text', section.rawOutput, '```')
    }
    if (section.parsedResult) {
      lines.push('', '### Parsed Result', '', '```json', section.parsedResult, '```')
    }
    if (section.error) {
      lines.push('', '### Error', '', '```text', section.error, '```')
    }
  }

  lines.push('')
  return lines.join('\n')
}

export function sanitizeFileName(input: string): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)

  return cleaned.length > 0 ? cleaned : 'task'
}

async function writeTaskReportRecord(record: TaskReportRecord): Promise<void> {
  await writeFile(record.filePath, buildTaskReportMarkdown(record, record.createdAt), 'utf8')
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}
