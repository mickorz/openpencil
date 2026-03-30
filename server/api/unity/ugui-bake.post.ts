import { defineEventHandler, readBody, setResponseHeaders } from 'h3'

interface ProxyBakeBody {
  json: string
  url?: string
}

const DEFAULT_UNITY_BAKE_URL = 'http://127.0.0.1:7777/'
const LOOPBACK_HOST_PATTERN = /^127(?:\.\d{1,3}){3}$/

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '[::1]'
    || LOOPBACK_HOST_PATTERN.test(normalized)
}

export function resolveUnityBakeTarget(url?: string): { ok: true; url: string } | { ok: false; message: string } {
  const rawUrl = url?.trim() || DEFAULT_UNITY_BAKE_URL

  try {
    const parsed = new URL(rawUrl)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isLoopbackHostname(parsed.hostname)) {
      return {
        ok: false,
        message: 'Unity 代理地址只允许指向本机服务',
      }
    }

    return {
      ok: true,
      url: parsed.toString(),
    }
  } catch {
    return {
      ok: false,
      message: 'Unity 代理地址格式无效',
    }
  }
}

export function validateUnityBakeJson(json: string | undefined): { ok: true; value: string } | { ok: false; message: string } {
  const rawJson = json?.trim()

  if (!rawJson) {
    return {
      ok: false,
      message: '请求体缺少 json 字段',
    }
  }

  try {
    const parsed = JSON.parse(rawJson)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        message: 'json 必须是有效的 JSON 对象字符串',
      }
    }

    return {
      ok: true,
      value: rawJson,
    }
  } catch {
    return {
      ok: false,
      message: 'json 必须是有效的 JSON 对象字符串',
    }
  }
}

export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { 'Content-Type': 'application/json' })

  const body = await readBody<ProxyBakeBody>(event)
  const jsonResult = validateUnityBakeJson(body?.json)
  if (!jsonResult.ok) {
    return new Response(JSON.stringify({ success: false, message: jsonResult.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const targetResult = resolveUnityBakeTarget(body?.url)
  if (!targetResult.ok) {
    return new Response(JSON.stringify({ success: false, message: targetResult.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const response = await fetch(targetResult.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: jsonResult.value,
    })

    const rawText = await response.text()
    let payload: Record<string, unknown>

    try {
      payload = rawText ? JSON.parse(rawText) as Record<string, unknown> : {}
    } catch {
      payload = {
        success: response.ok,
        message: rawText || 'Unity 服务返回了非 JSON 响应',
      }
    }

    return new Response(JSON.stringify(payload), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法连接到 Unity 服务'
    return new Response(JSON.stringify({ success: false, message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
