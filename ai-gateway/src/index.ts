import Fastify from 'fastify'
import { loadConfig } from './config.js'
import { registerProviders, listProviders } from './providers/index.js'
import { connectRoute } from './routes/connect.js'
import { chatRoute } from './routes/chat.js'
import { generateRoute } from './routes/generate.js'

/**
 * AI Gateway 启动入口
 *
 * Fastify()
 *   |-- loadConfig()          读取 config.json
 *   |-- registerProviders()   注册启用的 provider
 *   |-- registerRoutes()      注册 API 路由
 *   |-- listen()              启动 HTTP 服务
 */

async function main() {
  const config = loadConfig('config.json')

  const app = Fastify({ logger: false })

  await registerProviders(config)
  const activeProviders = listProviders()
  console.log(`[INFO] 已注册 ${activeProviders.length} 个 provider: ${activeProviders.join(', ')}`)

  app.register(connectRoute)
  app.register(chatRoute)
  app.register(generateRoute)

  app.get('/health', async () => ({
    status: 'ok',
    providers: activeProviders,
  }))

  const { port, host } = config.server
  await app.listen({ port, host })
  console.log(`[INFO] AI Gateway 服务已启动: http://${host}:${port}`)
  console.log(`[INFO] 健康检查: http://${host}:${port}/health`)
}

main().catch((err) => {
  console.error('[ERROR] 启动失败:', err)
  process.exit(1)
})
