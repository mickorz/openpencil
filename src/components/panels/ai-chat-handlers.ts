import { useState, useCallback } from 'react'
import { nanoid } from 'nanoid'
import { useAIStore } from '@/stores/ai-store'
import { useCanvasStore } from '@/stores/canvas-store'
import { useDocumentStore } from '@/stores/document-store'
import { streamChat } from '@/services/ai/ai-service'
import { CHAT_SYSTEM_PROMPT } from '@/services/ai/ai-prompts'
import {
  generateDesign,
  generateDesignModification,
  animateNodesToCanvas,
  extractAndApplyDesignModification,
} from '@/services/ai/design-generator'
import { trimChatHistory } from '@/services/ai/context-optimizer'
import type { AITaskReportTrace, ChatMessage as ChatMessageType } from '@/services/ai/ai-types'
import { CHAT_STREAM_THINKING_CONFIG } from '@/services/ai/ai-runtime-config'
import { startTaskReport, updateTaskReport } from '@/services/ai/task-report-service'

/** Intent classification prompt — lightweight LLM call to determine message routing */
const CLASSIFY_PROMPT = `You are a UI design tool assistant. Classify the user's message intent.
Reply with EXACTLY one of these tags, nothing else:
- DESIGN — user wants to create, generate, or modify any UI element, component, screen, or page
- CHAT — user is asking a question, seeking help, or having a conversation`

/** Classify user intent via a lightweight LLM call instead of hardcoded keyword matching */
async function classifyIntent(
  text: string,
  model: string,
  provider?: string,
): Promise<{ isDesign: boolean }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)

    const response = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: CLASSIFY_PROMPT,
        message: text,
        model,
        provider,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) throw new Error('classify failed')
    const data = await response.json()
    const upper = (data.text ?? '').trim().toUpperCase()

    return { isDesign: upper.includes('DESIGN') }
  } catch {
    // Fallback: in a design tool, default to design mode
    return { isDesign: true }
  }
}

export function buildContextString(): string {
  const selectedIds = useCanvasStore.getState().selection.selectedIds
  const { getFlatNodes, document: doc } = useDocumentStore.getState()
  const flatNodes = getFlatNodes()

  const parts: string[] = []

  if (flatNodes.length > 0) {
    const summary = flatNodes
      .slice(0, 20)
      .map((n) => `${n.type}:${n.name ?? n.id}`)
      .join(', ')
    parts.push(`Document has ${flatNodes.length} nodes: ${summary}`)
  }

  if (selectedIds.length > 0) {
    const selectedNodes = selectedIds
      .map((id) => useDocumentStore.getState().getNodeById(id))
      .filter(Boolean)
    const selectedSummary = selectedNodes
      .map((n) => {
        const dims = 'width' in n! && 'height' in n!
          ? ` (${n!.width}x${n!.height})`
          : ''
        return `${n!.type}:${n!.name ?? n!.id}${dims}`
      })
      .join(', ')
    parts.push(`Selected: ${selectedSummary}`)
  }

  // Include variable summary so chat mode also knows about design tokens
  if (doc.variables && Object.keys(doc.variables).length > 0) {
    const varNames = Object.entries(doc.variables)
      .map(([n, d]) => `$${n}(${d.type})`)
      .join(', ')
    parts.push(`Variables: ${varNames}`)
  }

  return parts.length > 0 ? `\n\n[Canvas context: ${parts.join('. ')}]` : ''
}

function buildTaskReportTitle(messageText: string, hasAttachments: boolean): string {
  const base = messageText.trim() || (hasAttachments ? 'image-task' : 'task')
  return base.slice(0, 48)
}

/** Shared chat logic hook */
export function useChatHandlers() {
  const [input, setInput] = useState('')
  const messages = useAIStore((s) => s.messages)
  const isStreaming = useAIStore((s) => s.isStreaming)
  const model = useAIStore((s) => s.model)
  const availableModels = useAIStore((s) => s.availableModels)
  const isLoadingModels = useAIStore((s) => s.isLoadingModels)
  const addMessage = useAIStore((s) => s.addMessage)
  const updateLastMessage = useAIStore((s) => s.updateLastMessage)
  const setStreaming = useAIStore((s) => s.setStreaming)
  const handleSend = useCallback(
    async (text?: string) => {
      const messageText = text ?? input.trim()
      const pendingAttachments = useAIStore.getState().pendingAttachments
      const hasAttachments = pendingAttachments.length > 0
      if ((!messageText && !hasAttachments) || isStreaming || isLoadingModels || availableModels.length === 0) return

      setInput('')
      useAIStore.getState().clearPendingAttachments()

      // Determine context and mode
      const selectedIds = useCanvasStore.getState().selection.selectedIds
      const hasSelection = selectedIds.length > 0

      const context = buildContextString()
      const fullUserMessage = messageText + context

      const userMsg: ChatMessageType = {
        id: nanoid(),
        role: 'user',
        content: messageText || '',
        timestamp: Date.now(),
        ...(hasAttachments ? { attachments: pendingAttachments } : {}),
      }
      addMessage(userMsg)

      const assistantMsg: ChatMessageType = {
        id: nanoid(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      }
      addMessage(assistantMsg)
      setStreaming(true)

      // Set chat title if it's the first message
      if (messages.length === 0) {
        // Simple heuristic: Take first ~4 words or up to 25 chars
        const cleanText = messageText.replace(/^(Design|Create|Generate|Make)\s+/i, '')
        const words = cleanText.split(' ').slice(0, 4).join(' ')
        const title = words.length > 30 ? words.slice(0, 30) + '...' : words
        useAIStore.getState().setChatTitle(title || 'New Chat')
      }

      const chatHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      }))
      const currentProvider = useAIStore.getState().modelGroups.find((g) =>
        g.models.some((m) => m.value === model),
      )?.provider
      const reportTaskInput = fullUserMessage || (hasAttachments ? '[attachment only]' : '')
      const reportTitle = buildTaskReportTitle(messageText, hasAttachments)

      let accumulated = ''
      let appliedCount = 0
      let isDesign = false
      let taskMode: AITaskReportTrace['mode'] = 'chat'
      let taskTrace: AITaskReportTrace | null = null
      let taskError: string | undefined
      const reportSnapshot: {
        title: string
        mode: AITaskReportTrace['mode']
        taskInput: string
        provider?: string
        model?: string
        attachments: typeof pendingAttachments
        rawOutput?: string
        parsedResult?: string
        error?: string
        sections: AITaskReportTrace['sections']
      } = {
        title: reportTitle,
        mode: taskMode,
        taskInput: reportTaskInput,
        provider: currentProvider,
        model,
        attachments: pendingAttachments,
        sections: [
          {
            title: 'Task Result',
            input: reportTaskInput,
          },
        ],
      }
      let reportId: string | null = null
      let reportUpdateTimer: ReturnType<typeof setTimeout> | null = null
      let reportFlushChain = Promise.resolve()
      const reportStartPromise = startTaskReport(reportSnapshot)
        .then((handle) => {
          reportId = handle.reportId
          return handle
        })
        .catch((error) => {
          console.error('[task-report:start]', error)
          return null
        })

      const queueReportSync = (force = false) => {
        const run = async () => {
          const handle = await reportStartPromise
          if (!handle || !reportId) return
          await updateTaskReport(reportId, reportSnapshot)
        }

        if (force) {
          if (reportUpdateTimer) {
            clearTimeout(reportUpdateTimer)
            reportUpdateTimer = null
          }
          reportFlushChain = reportFlushChain.then(run).catch((error) => {
            console.error('[task-report:update]', error)
          })
          return
        }

        if (reportUpdateTimer) return
        reportUpdateTimer = setTimeout(() => {
          reportUpdateTimer = null
          reportFlushChain = reportFlushChain.then(run).catch((error) => {
            console.error('[task-report:update]', error)
          })
        }, 500)
      }

      const updateReportSnapshot = (
        patch: Partial<typeof reportSnapshot>,
        force = false,
      ) => {
        Object.assign(reportSnapshot, patch)
        queueReportSync(force)
      }

      const abortController = new AbortController()
      useAIStore.getState().setAbortController(abortController)

      try {
        // Classify intent via lightweight LLM call
        const classified = hasAttachments
          ? { isDesign: false }
          : await classifyIntent(
              messageText, model, currentProvider,
            )
        isDesign = classified.isDesign
        const isModification = isDesign && hasSelection
        taskMode = isModification ? 'design-modification' : (isDesign ? 'design' : 'chat')
        updateReportSnapshot({ mode: taskMode })

        if (isDesign) {
             if (isModification) {
               // --- MODIFICATION MODE ---
               const { getNodeById, document: modDoc } = useDocumentStore.getState()
               const selectedNodes = selectedIds.map(id => getNodeById(id)).filter(Boolean) as any[]

               // We update the UI to show we are working
               accumulated = '<step title="Checking guidelines">Analyzing modification request...</step>'
               updateLastMessage(accumulated)
               updateReportSnapshot({
                 rawOutput: accumulated,
                 sections: [
                   {
                     title: 'Task Result',
                     input: reportTaskInput,
                     rawOutput: accumulated,
                   },
                 ],
               })

               const { rawResponse, nodes, debugTrace } = await generateDesignModification(selectedNodes, messageText, {
                 variables: modDoc.variables,
                 themes: modDoc.themes,
                 model,
                 provider: currentProvider,
               }, abortController.signal)
               taskTrace = debugTrace
               accumulated = rawResponse
               updateLastMessage(accumulated)

               // Apply all changes
               const count = extractAndApplyDesignModification(JSON.stringify(nodes))
               appliedCount += count
             } else {
               // --- GENERATION MODE (animated) ---
               const doc = useDocumentStore.getState().document
               const concurrency = useAIStore.getState().concurrency
               const { rawResponse, nodes, debugTrace } = await generateDesign({
                 prompt: fullUserMessage,
                 model,
                 provider: currentProvider,
                 concurrency,
                 context: {
                   canvasSize: { width: 1200, height: 800 },
                   documentSummary: `Current selection: ${hasSelection ? selectedIds.length + ' items' : 'Empty'}`,
                   variables: doc.variables,
                   themes: doc.themes,
                 },
               }, {
                 animated: true,
                 onApplyPartial: (partialCount: number) => {
                   appliedCount += partialCount
                  },
                  onTextUpdate: (text: string) => {
                    accumulated = text
                    updateLastMessage(text)
                    updateReportSnapshot({
                      rawOutput: text,
                      sections: [
                        {
                          title: 'Task Result',
                          input: reportTaskInput,
                          rawOutput: text,
                        },
                      ],
                    })
                  },
                }, abortController.signal)
               taskTrace = debugTrace
               // Ensure final text is captured
               accumulated = rawResponse
               if (appliedCount === 0 && nodes.length > 0) {
                 animateNodesToCanvas(nodes)
                 appliedCount += nodes.length
               }
             }
        } else {
            // --- CHAT MODE ---
            chatHistory.push({
              role: 'user',
              content: fullUserMessage,
              ...(hasAttachments ? { attachments: pendingAttachments } : {}),
            })
            // Trim history to prevent unbounded context growth
            const trimmedHistory = trimChatHistory(chatHistory)
            let chatThinking = ''
            const getChatReportOutput = () =>
              chatThinking
                ? `<step title="Thinking">${chatThinking}</step>\n${accumulated}`
                : accumulated
            for await (const chunk of streamChat(
              CHAT_SYSTEM_PROMPT,
              trimmedHistory,
              model,
              CHAT_STREAM_THINKING_CONFIG,
              currentProvider,
              abortController.signal,
            )) {
               if (chunk.type === 'thinking') {
                 chatThinking += chunk.content
                 // Show thinking content as a collapsible step in the panel
                 const thinkingStep = `<step title="Thinking">${chatThinking}</step>`
                 updateLastMessage(thinkingStep + (accumulated ? '\n' + accumulated : ''))
                 updateReportSnapshot({
                   rawOutput: getChatReportOutput(),
                   sections: [
                     {
                       title: 'Task Result',
                       input: reportTaskInput,
                       rawOutput: getChatReportOutput(),
                     },
                   ],
                 })
               } else if (chunk.type === 'text') {
                 accumulated += chunk.content
                 // Keep thinking step visible above text content
                 const thinkingPrefix = chatThinking
                   ? `<step title="Thinking">${chatThinking}</step>\n`
                   : ''
                 updateLastMessage(thinkingPrefix + accumulated)
                 updateReportSnapshot({
                   rawOutput: getChatReportOutput(),
                   parsedResult: accumulated,
                   sections: [
                     {
                       title: 'Task Result',
                       input: reportTaskInput,
                       rawOutput: getChatReportOutput(),
                       parsedResult: accumulated,
                     },
                   ],
                 })
               } else if (chunk.type === 'error') {
                 accumulated += `\n\n**Error:** ${chunk.content}`
                 updateLastMessage(accumulated)
                 taskError = chunk.content
                 updateReportSnapshot({
                   rawOutput: getChatReportOutput(),
                   parsedResult: accumulated,
                   error: chunk.content,
                   sections: [
                     {
                       title: 'Task Result',
                       input: reportTaskInput,
                       rawOutput: getChatReportOutput(),
                       parsedResult: accumulated,
                       error: chunk.content,
                     },
                   ],
                 })
               }
            }
            taskTrace = {
              mode: 'chat',
              rawOutput: chatThinking
                ? `<step title="Thinking">${chatThinking}</step>\n${accumulated}`
                : accumulated,
              parsedResult: accumulated,
              sections: [
                {
                  title: 'Chat Response',
                  input: fullUserMessage,
                  rawOutput: chatThinking
                    ? `<step title="Thinking">${chatThinking}</step>\n${accumulated}`
                    : accumulated,
                  parsedResult: accumulated,
                },
              ],
            }
        }
      } catch (error) {
         // Silently handle user-initiated stop
         if (abortController.signal.aborted) {
           taskError = 'Task aborted by user.'
           // Keep partial content, don't show error
         } else {
           const errMsg = error instanceof Error ? error.message : 'Unknown error'
           taskError = errMsg
           accumulated += `\n\n**Error:** ${errMsg}`
           updateLastMessage(accumulated)
         }
         updateReportSnapshot({
           rawOutput: accumulated,
           parsedResult: accumulated,
           error: taskError,
           sections: [
             {
               title: 'Task Result',
               input: reportTaskInput,
               rawOutput: accumulated,
               parsedResult: accumulated,
               error: taskError,
             },
           ],
         })
      } finally {
         useAIStore.getState().setAbortController(null)
         setStreaming(false)
      }

      // Final update - mark as applied (hidden) so the "Apply" button doesn't show up
      if (isDesign && appliedCount > 0) {
        accumulated += `\n\n<!-- APPLIED -->`
      }

      // Force update the last message state to ensure sync
      useAIStore.setState((s) => {
        const msgs = [...s.messages]
        const last = msgs.find(m => m.id === assistantMsg.id)
        if (last) {
           last.content = accumulated
           last.isStreaming = false
        }
        return { messages: msgs }
      })

      const finalTrace = taskTrace ?? {
        mode: taskMode,
        rawOutput: accumulated,
        parsedResult: isDesign && appliedCount > 0 ? `Applied nodes: ${appliedCount}` : accumulated,
        sections: [
          {
            title: 'Task Result',
            input: fullUserMessage,
            rawOutput: accumulated,
            parsedResult: isDesign && appliedCount > 0 ? `Applied nodes: ${appliedCount}` : accumulated,
            error: taskError,
          },
        ],
      }

      updateReportSnapshot({
        title: reportTitle,
        mode: finalTrace.mode,
        taskInput: reportTaskInput,
        provider: currentProvider,
        model,
        attachments: pendingAttachments,
        rawOutput: finalTrace.rawOutput,
        parsedResult: finalTrace.parsedResult,
        error: taskError,
        sections: finalTrace.sections,
      }, true)

      void reportFlushChain.catch((error) => {
        console.error('[task-report:flush]', error)
      })
    },
    [input, isStreaming, isLoadingModels, model, availableModels, messages, addMessage, updateLastMessage, setStreaming],
  )

  return { input, setInput, handleSend, isStreaming }
}
