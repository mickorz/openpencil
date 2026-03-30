/**
 * OpenCode 客户端管理器
 *
 * 管理与 OpenCode 服务端的连接生命周期：
 *
 * getOpencodeClient()
 *   |-- createOpencodeClient()     尝试连接已运行的服务
 *   |     |-- 成功 -> { client, server: undefined }
 *   |     └-- 失败 -> 降级到临时服务
 *   |
 *   |-- createOpencode({ port: 0 })   启动随机端口的临时服务
 *   |     |-- 加入 activeServers 追踪
 *   |     └-- { client, server }
 *   |
 *   └-- 返回 { client, server }
 *
 * releaseOpencodeServer(server)
 *   |-- server.close()            停止服务
 *   |-- activeServers.delete()    移除追踪
 *   └-- 清理完成
 *
 * 进程退出清理:
 *   beforeExit / SIGTERM / SIGINT
 *   └-- 遍历 activeServers 执行 close()
 */

const activeServers = new Set<{ close(): void }>()

/** 进程退出时清理所有已启动的 OpenCode 服务 */
function cleanup() {
  for (const server of activeServers) {
    try { server.close() } catch { /* 忽略清理错误 */ }
  }
  activeServers.clear()
}

process.on('beforeExit', cleanup)
process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)

/**
 * 获取 OpenCode 客户端连接
 *
 * 优先尝试连接已运行的服务 (createOpencodeClient)，
 * 失败则启动临时随机端口服务 (createOpencode)。
 * 使用动态 import 加载 @opencode-ai/sdk。
 */
export async function getOpencodeClient(): Promise<{
  client: OpencodeClient
  server: { close(): void } | undefined
}> {
  const { createOpencodeClient, createOpencode } = await import('@opencode-ai/sdk')

  // 先尝试连接已运行的服务
  try {
    const client = createOpencodeClient()
    await client.config.providers() // 探测连接是否可用
    return { client, server: undefined }
  } catch {
    // 没有已运行的服务，启动临时随机端口服务
    const oc = await createOpencode({ port: 0 })
    activeServers.add(oc.server)
    return { client: oc.client, server: oc.server }
  }
}

/**
 * 释放 OpenCode 服务实例
 *
 * 停止并移除追踪的服务。仅对由本模块启动的服务有效。
 */
export function releaseOpencodeServer(server: { close(): void } | undefined): void {
  if (!server) return
  try { server.close() } catch { /* 忽略清理错误 */ }
  activeServers.delete(server)
}

/**
 * 以下为 OpenCode SDK 类型声明
 * 与 src/types/opencode-sdk.d.ts 保持一致
 */
interface OpencodeClient {
  config: {
    providers(options?: unknown): Promise<{
      data: {
        providers: OpencodeProvider[]
        default: Record<string, string>
      }
      error: unknown
    }>
  }
  session: {
    create(options?: {
      body?: { parentID?: string; title?: string }
    }): Promise<{
      data: OpencodeSession | undefined
      error: unknown
    }>
    prompt(options: {
      path: { id: string }
      body: {
        model?: { providerID: string; modelID: string }
        noReply?: boolean
        parts: Array<{ type: string; text: string }>
      }
    }): Promise<{
      data:
        | {
            info: Record<string, unknown>
            parts: Array<{ type: string; text?: string } & Record<string, unknown>>
          }
        | undefined
      error: unknown
    }>
  }
}

interface OpencodeProvider {
  id: string
  name: string
  models: Record<string, OpencodeModel>
}

interface OpencodeModel {
  id: string
  name: string
  providerID: string
}

interface OpencodeSession {
  id: string
  title: string
}
