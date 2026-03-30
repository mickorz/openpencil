/**
 * POST /api/connect 路由
 *
 * 连接指定 provider，检测 CLI 可用性并获取模型列表
 *
 * connectRoute(app)
 *   |-- 解析 body.agent
 *   |-- getProvider(agent) 查找 provider
 *   |-- provider.connect() 获取模型列表
 *   |-- 返回 ConnectResult
 */

import type { FastifyInstance } from 'fastify'
import { getProvider, listProviders } from '../providers/index.js'

export async function connectRoute(app: FastifyInstance) {
  app.post('/api/connect', async (req, reply) => {
    const { agent } = req.body as { agent?: string }

    // 验证 agent 参数
    if (!agent || typeof agent !== 'string') {
      return reply.status(400).send({
        error: 'Missing required field: agent',
      })
    }

    // 查找 provider
    const provider = getProvider(agent)
    if (!provider) {
      const available = listProviders()
      return reply.status(400).send({
        error: `Agent "${agent}" is not available. Available: ${available.join(', ') || 'none'}`,
      })
    }

    // 调用 connect 获取模型列表
    const result = await provider.connect()
    return reply.send(result)
  })
}
