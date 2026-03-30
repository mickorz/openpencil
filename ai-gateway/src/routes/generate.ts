/**
 * POST /api/generate 路由 (JSON)
 *
 * 非流式生成接口，返回完整生成结果
 *
 * generateRoute(app)
 *   |-- 解析 GenerateRequest body
 *   |-- 验证 provider / model / system / messages
 *   |-- provider.generate() 获取结果
 *   |-- 返回 JSON 结果
 */

import type { FastifyInstance } from 'fastify'
import { getProvider } from '../providers/index.js'
import type { GenerateRequest } from '../providers/base-provider.js'

export async function generateRoute(app: FastifyInstance) {
  app.post('/api/generate', async (req, reply) => {
    const body = req.body as Partial<GenerateRequest>

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

    try {
      // 调用 provider.generate 获取结果
      const result = await provider.generate(body as GenerateRequest, body.model)
      return reply.send(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: message })
    }
  })
}
