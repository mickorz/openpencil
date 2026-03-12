import type { AITaskReportTrace, ChatAttachment } from './ai-types'

interface TaskReportPayload {
  title: string
  mode: string
  taskInput: string
  provider?: string
  model?: string
  attachments?: ChatAttachment[]
  rawOutput?: string
  parsedResult?: string
  error?: string
  sections?: AITaskReportTrace['sections']
}

interface TaskReportHandle {
  reportId: string
  filePath: string
  createdAt: string
}

export async function startTaskReport(
  payload: TaskReportPayload,
): Promise<TaskReportHandle> {
  const response = await fetch('/api/ai/task-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'start',
      payload: serializePayload(payload),
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to start task report: ${response.status}`)
  }

  const data = await response.json() as TaskReportHandle & { success: boolean }
  if (!data.success) {
    throw new Error('Failed to start task report')
  }

  return {
    reportId: data.reportId,
    filePath: data.filePath,
    createdAt: data.createdAt,
  }
}

export async function updateTaskReport(
  reportId: string,
  patch: Partial<TaskReportPayload>,
): Promise<void> {
  const response = await fetch('/api/ai/task-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'update',
      reportId,
      patch: serializePayload(patch),
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to update task report: ${response.status}`)
  }
}

function serializePayload<T extends Partial<TaskReportPayload>>(payload: T): Record<string, unknown> {
  return {
    ...payload,
    attachments: payload.attachments?.map((attachment) => ({
      name: attachment.name,
      mediaType: attachment.mediaType,
      size: attachment.size,
    })),
  }
}
