export interface UnityBakeResponse {
  success: boolean
  canvasName?: string
  rootName?: string
  message: string
}

async function parseUnityBakeResponse(response: Response): Promise<UnityBakeResponse> {
  const rawText = await response.text()

  if (!rawText.trim()) {
    return {
      success: false,
      message: 'Unity 代理返回了空响应',
    }
  }

  try {
    return JSON.parse(rawText) as UnityBakeResponse
  } catch {
    return {
      success: false,
      message: rawText.trim() || 'Unity 代理返回了非 JSON 响应',
    }
  }
}

export async function sendJsonToUnity(json: string): Promise<UnityBakeResponse> {
  const response = await fetch('/api/unity/ugui-bake', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ json }),
  })

  const payload = await parseUnityBakeResponse(response)
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || '发送到 Unity 失败')
  }

  return payload
}
