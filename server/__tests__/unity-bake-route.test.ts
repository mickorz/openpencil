import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockEvent } from 'h3'
import handler, { resolveUnityBakeTarget, validateUnityBakeJson } from '../api/unity/ugui-bake.post'

async function readJsonResponse(response: unknown): Promise<Record<string, unknown>> {
  if (!(response instanceof Response)) {
    throw new Error('handler did not return a Response instance')
  }

  return await response.json() as Record<string, unknown>
}

describe('resolveUnityBakeTarget', () => {
  it('accepts loopback Unity addresses', () => {
    expect(resolveUnityBakeTarget('http://127.0.0.1:7777/')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:7777/',
    })

    expect(resolveUnityBakeTarget('http://localhost:9000/bake')).toEqual({
      ok: true,
      url: 'http://localhost:9000/bake',
    })
  })

  it('rejects non loopback proxy targets', () => {
    expect(resolveUnityBakeTarget('https://example.com/unity')).toEqual({
      ok: false,
      message: 'Unity 代理地址只允许指向本机服务',
    })
  })
})

describe('validateUnityBakeJson', () => {
  it('accepts a JSON object string', () => {
    expect(validateUnityBakeJson('{"name":"root","type":"div"}')).toEqual({
      ok: true,
      value: '{"name":"root","type":"div"}',
    })
  })

  it('rejects empty or invalid JSON payloads', () => {
    expect(validateUnityBakeJson('')).toEqual({
      ok: false,
      message: '请求体缺少 json 字段',
    })

    expect(validateUnityBakeJson('not-json')).toEqual({
      ok: false,
      message: 'json 必须是有效的 JSON 对象字符串',
    })

    expect(validateUnityBakeJson('["root"]')).toEqual({
      ok: false,
      message: 'json 必须是有效的 JSON 对象字符串',
    })
  })
})

describe('unity bake route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards valid JSON to the local Unity service', async () => {
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

    const event = mockEvent('http://localhost/api/unity/ugui-bake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        json: '{"name":"root","type":"div"}',
      }),
    })

    const response = await handler(event)
    const payload = await readJsonResponse(response)

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7777/', expect.objectContaining({
      method: 'POST',
      body: '{"name":"root","type":"div"}',
    }))
    expect(payload.success).toBe(true)
    expect(payload.canvasName).toBe('UGUIHttpCanvas_01')
  })

  it('rejects invalid JSON before contacting Unity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const event = mockEvent('http://localhost/api/unity/ugui-bake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        json: 'not-json',
      }),
    })

    const response = await handler(event)
    const payload = await readJsonResponse(response)

    expect((response as Response).status).toBe(400)
    expect(payload.message).toBe('json 必须是有效的 JSON 对象字符串')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non loopback proxy URLs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const event = mockEvent('http://localhost/api/unity/ugui-bake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        json: '{"name":"root","type":"div"}',
        url: 'https://example.com/unity',
      }),
    })

    const response = await handler(event)
    const payload = await readJsonResponse(response)

    expect((response as Response).status).toBe(400)
    expect(payload.message).toBe('Unity 代理地址只允许指向本机服务')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('converts Unity non JSON responses into JSON payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    )

    const event = mockEvent('http://localhost/api/unity/ugui-bake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        json: '{"name":"root","type":"div"}',
      }),
    })

    const response = await handler(event)
    const payload = await readJsonResponse(response)

    expect((response as Response).status).toBe(502)
    expect(payload.success).toBe(false)
    expect(payload.message).toBe('Bad Gateway')
  })
})
