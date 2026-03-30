import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendJsonToUnity } from './unity-bake-client'

describe('sendJsonToUnity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts baked json to the local proxy and returns the Unity response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        canvasName: 'UGUIHttpCanvas_01',
        rootName: 'root',
        message: 'ok',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await sendJsonToUnity('{"name":"root"}')

    expect(fetchMock).toHaveBeenCalledWith('/api/unity/ugui-bake', expect.objectContaining({
      method: 'POST',
    }))
    expect(result.success).toBe(true)
    expect(result.canvasName).toBe('UGUIHttpCanvas_01')
    expect(result.rootName).toBe('root')
  })

  it('throws when the Unity proxy reports a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        success: false,
        message: 'Unity server is offline',
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(sendJsonToUnity('{"name":"root"}')).rejects.toThrow('Unity server is offline')
  })

  it('throws a readable error when the proxy returns non JSON text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    )

    await expect(sendJsonToUnity('{"name":"root"}')).rejects.toThrow('Bad Gateway')
  })
})
