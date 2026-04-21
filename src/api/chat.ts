import type { ChatConversation, ChatConversationDeleteRequest, ChatMemoryHistory } from '@/types/chat'
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

export function createConversation() {
  return request<string>('/chatConversation/create', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function listMyConversations() {
  return request<ChatConversation[]>('/chatConversation/list/my', {
    method: 'GET',
    headers: {},
  })
}

export function deleteConversation(payload: ChatConversationDeleteRequest) {
  return request<boolean>('/chatConversation/delete', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateConversationSkills(conversationId: string, selectedSkills: string[]) {
  return request<boolean>('/chatConversation/update/skills', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      selectedSkills,
    }),
  })
}

export function listHistoryByConversation(conversationId: string) {
  return request<ChatMemoryHistory[]>(
    `/chatMemory/history/list/conversation?conversationId=${encodeURIComponent(conversationId)}`,
    {
      method: 'GET',
      headers: {},
    },
  )
}
