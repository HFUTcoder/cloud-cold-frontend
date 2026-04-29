import type { BaseResponse } from '@/types/user'

const DEFAULT_API_BASE_URL = '/api'
const LOCAL_BACKEND_PORT = '8081'

function resolveDefaultApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_API_BASE_URL
  }

  const { hostname, port, protocol } = window.location
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1'
  if (!isLocalHost || port === LOCAL_BACKEND_PORT) {
    return DEFAULT_API_BASE_URL
  }

  return `${protocol}//${hostname}:${LOCAL_BACKEND_PORT}${DEFAULT_API_BASE_URL}`
}

export function buildApiUrl(path: string): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  const baseUrl = configuredBaseUrl || resolveDefaultApiBaseUrl()
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function parseResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text()
  let result: BaseResponse<T>

  try {
    result = JSON.parse(rawText) as BaseResponse<T>
  } catch {
    const snippet = rawText.replace(/\s+/g, ' ').trim().slice(0, 120)
    throw new Error(
      `接口返回了非 JSON 内容，可能前端请求到了错误地址。状态：${response.status} ${response.statusText}。响应片段：${snippet}`,
    )
  }

  if (!response.ok || result.code !== 0) {
    throw new Error(result.message || `请求失败: ${response.status}`)
  }
  return result.data
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  return parseResponse<T>(response)
}

export async function requestForm<T>(path: string, formData: FormData, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    body: formData,
    ...init,
  })

  return parseResponse<T>(response)
}
