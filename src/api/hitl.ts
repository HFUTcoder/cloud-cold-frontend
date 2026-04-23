import type { HitlCheckpointResolveRequest, HitlCheckpointVO } from '@/types/hitl'
import type { BaseResponse } from '@/types/user'

const DEFAULT_API_BASE_URL = '/api'

function buildApiUrl(path: string): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  const baseUrl = configuredBaseUrl || DEFAULT_API_BASE_URL
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const result = (await response.json()) as BaseResponse<T>
  if (!response.ok || result.code !== 0) {
    throw new Error(result.message || `请求失败: ${response.status}`)
  }
  return result.data
}

export function resolveHitlCheckpoint(payload: HitlCheckpointResolveRequest) {
  return request<HitlCheckpointVO>('/hitl/checkpoint/resolve', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getHitlCheckpoint(interruptId: string) {
  return request<HitlCheckpointVO>(`/hitl/checkpoint/get?interruptId=${encodeURIComponent(interruptId)}`)
}
