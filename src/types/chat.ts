export interface ChatConversation {
  id: number
  userId: number
  conversationId: string
  title: string
  lastActiveTime?: string
  createTime?: string
  updateTime?: string
}

export interface ChatConversationDeleteRequest {
  conversationId: string
}

export interface ChatMemoryHistory {
  id: number
  userId: number
  conversationId: string
  content: string
  messageType: string
  createTime?: string
  updateTime?: string
}
