import type { ChatConversation, ChatConversationDeleteRequest, ChatMemoryHistory } from '@/types/chat'
import { requestJson } from '@/api/request'

export function createConversation() {
  return requestJson<string>('/chatConversation/create', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function listMyConversations() {
  return requestJson<ChatConversation[]>('/chatConversation/list/my', {
    method: 'GET',
    headers: {},
  })
}

export function getConversation(conversationId: string) {
  return requestJson<ChatConversation>(
    `/chatConversation/get?conversationId=${encodeURIComponent(conversationId)}`,
    {
      method: 'GET',
      headers: {},
    },
  )
}

export function deleteConversation(payload: ChatConversationDeleteRequest) {
  return requestJson<boolean>('/chatConversation/delete', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateConversationSkills(conversationId: string, selectedSkills: string[]) {
  return requestJson<boolean>('/chatConversation/update/skills', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      selectedSkills,
    }),
  })
}

export function listHistoryByConversation(conversationId: string) {
  return requestJson<ChatMemoryHistory[]>(
    `/chatMemory/history/list/conversation?conversationId=${encodeURIComponent(conversationId)}`,
    {
      method: 'GET',
      headers: {},
    },
  )
}
