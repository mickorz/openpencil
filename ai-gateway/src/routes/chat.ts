/**
 * POST /api/chat 路由 (SSE 流式)
 *
 * 流式聊天接口，通过 Server-Sent Events 返回增量文本
 *
 * chatRoute(app)
 *   |-- 解析 ChatRequest body
 *   |-- 验证 provider / model / system / messages
 *   |-- 设置 SSE 响应头
 *   |-- 创建 keepAlive 心跳 (15s)
 *   |-- for await (provider.chat()) yield SSE 事件
 *   |-- done/error 时结束并清理心跳
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { getProvider } from '../providers/index.js'
import type { ChatRequest } from '../providers/base-provider.js'
import { formatSSE, createKeepAlive } from '../utils/sse.js'

export async function chatRoute(app: FastifyInstance) {
  app.post('/api/chat', async (req, reply: FastifyReply) => {
    const body = req.body as Partial<ChatRequest>

    // 验证必填字段
    if (!body.provider || typeof body.provider !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: provider' })
    }
    if (!body.model || typeof body.model !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: model' })
    }
    if (!body.system || typeof body.system !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: system' })
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.status(400).send({ error: 'Missing required field: messages' })
    }

    // 查找 provider
    const provider = getProvider(body.provider)
    if (!provider) {
      return reply.status(400).send({ error: `Provider "${body.provider}" not found` })
    }

    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    // 创建心跳保活
    const keepAlive = createKeepAlive(() => {
      reply.raw.write(formatSSE({ type: 'ping', content: '' }))
    }, 15_000)

    try {
      // 流式输出 provider.chat() 产生的事件
      for await (const event of provider.chat(body as ChatRequest, body.model)) {
        reply.raw.write(formatSSE(event))
      }
      // 发送 done 事件
      reply.raw.write(formatSSE({ type: 'done', content: '' }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reply.raw.write(formatSSE({ type: 'error', content: message }))
    } finally {
      keepAlive.stop()
      reply.raw.end()
    }
  })
}
