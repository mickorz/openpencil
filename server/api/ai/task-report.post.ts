import { defineEventHandler, readBody, setResponseHeaders } from 'h3'
import {
  type TaskReportPayload,
  startTaskReportMarkdown,
  updateTaskReportMarkdown,
} from '../../utils/task-report-markdown'

interface StartRequest {
  action: 'start'
  payload: TaskReportPayload
}

interface UpdateRequest {
  action: 'update'
  reportId: string
  patch: Partial<TaskReportPayload>
}

type TaskReportRequest = StartRequest | UpdateRequest

export default defineEventHandler(async (event) => {
  const body = await readBody<TaskReportRequest>(event)
  setResponseHeaders(event, { 'Content-Type': 'application/json' })

  if (!body?.action) {
    return { success: false, error: 'Missing action' }
  }

  if (body.action === 'start') {
    if (!body.payload?.taskInput?.trim()) {
      return { success: false, error: 'Missing taskInput' }
    }
    if (!body.payload?.title?.trim()) {
      return { success: false, error: 'Missing title' }
    }

    const record = await startTaskReportMarkdown(body.payload)
    return {
      success: true,
      reportId: record.reportId,
      filePath: record.filePath,
      createdAt: record.createdAt,
    }
  }

  if (!body.reportId?.trim()) {
    return { success: false, error: 'Missing reportId' }
  }

  const record = await updateTaskReportMarkdown(body.reportId, body.patch ?? {})
  return {
    success: true,
    reportId: record.reportId,
    filePath: record.filePath,
    createdAt: record.createdAt,
  }
})
