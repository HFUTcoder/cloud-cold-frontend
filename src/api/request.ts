import type { BaseResponse } from '@/types/user'

const DEFAULT_API_BASE_URL = '/api'

export function buildApiUrl(path: string): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  const baseUrl = configuredBaseUrl || DEFAULT_API_BASE_URL
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function parseResponse<T>(response: Response): Promise<T> {
  const result = (await response.json()) as BaseResponse<T>
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
