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

    // 验证 skill 相关可选字段
    if (body.cwd !== undefined && typeof body.cwd !== 'string') {
      return reply.status(400).send({ error: 'Field "cwd" must be a string' })
    }
    if (body.settingSources !== undefined) {
      if (!Array.isArray(body.settingSources)) {
        return reply.status(400).send({ error: 'Field "settingSources" must be an array' })
      }
      const valid = ['user', 'project', 'local']
      for (const src of body.settingSources) {
        if (!valid.includes(src as string)) {
          return reply.status(400).send({ error: `Invalid settingSource "${String(src)}". Must be one of: ${valid.join(', ')}` })
        }
      }
    }
    if (body.plugins !== undefined) {
      if (!Array.isArray(body.plugins)) {
        return reply.status(400).send({ error: 'Field "plugins" must be an array' })
      }
      for (const p of body.plugins) {
        if (!p || typeof p !== 'object' || (p as Record<string, unknown>).type !== 'local' || typeof (p as Record<string, unknown>).path !== 'string') {
          return reply.status(400).send({ error: 'Each plugin must have { type: "local", path: string }' })
        }
      }
    }
    if (body.outputFormat !== undefined) {
      if (!body.outputFormat || typeof body.outputFormat !== 'object' || (body.outputFormat as Record<string, unknown>).type !== 'json_schema' || typeof (body.outputFormat as Record<string, unknown>).schema !== 'object') {
        return reply.status(400).send({ error: 'Field "outputFormat" must be { type: "json_schema", schema: {...} }' })
      }
    }
    if (body.allowedTools !== undefined && !Array.isArray(body.allowedTools)) {
      return reply.status(400).send({ error: 'Field "allowedTools" must be a string array' })
    }
    if (body.disallowedTools !== undefined && !Array.isArray(body.disallowedTools)) {
      return reply.status(400).send({ error: 'Field "disallowedTools" must be a string array' })
    }
    if (body.maxTurns !== undefined && (typeof body.maxTurns !== 'number' || body.maxTurns < 1 || body.maxTurns > 50)) {
      return reply.status(400).send({ error: 'Field "maxTurns" must be a number between 1 and 50' })
    }

    // 查找 provider
    const provider = getProvider(body.provider)
    if (!provider) {
      return reply.status(400).send({ error: `Provider "${body.provider}" not found` })
    }

    // 前置校验 - 在进入业务逻辑之前拦截参数错误
    try {
      provider.validateRequest(body as Partial<GenerateRequest>)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(400).send({ error: message })
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
