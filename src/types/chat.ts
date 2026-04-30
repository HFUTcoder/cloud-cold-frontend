import type { RetrievedKnowledgeImage } from '@/types/agent'

export interface ChatConversation {
  id: number
  userId: number
  conversationId: string
  title: string
  selectedSkillList?: string[]
  selectedKnowledgeId?: number
  selectedKnowledgeName?: string
  lastActiveTime?: string
  createTime?: string
  updateTime?: string
}

export interface ChatConversationDeleteRequest {
  conversationId: string
}

export interface ChatMemoryHistory {
  id: number
  conversationId: string
  content: string
  messageType: string
  createTime?: string
  updateTime?: string
  retrievedImages?: RetrievedKnowledgeImage[]
}
