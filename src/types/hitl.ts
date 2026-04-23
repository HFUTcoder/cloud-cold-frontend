import type { PendingToolCall } from '@/types/agent'

export interface HitlCheckpointResolveRequest {
  interruptId: string
  feedbacks: PendingToolCall[]
}

export interface HitlCheckpointVO {
  id: number
  conversationId: string
  interruptId: string
  agentType?: string
  pendingToolCalls?: PendingToolCall[]
  checkpointMessages?: unknown[]
  context?: Record<string, unknown>
  feedbacks?: PendingToolCall[]
  status?: string
  resolvedTime?: string
  createTime?: string
  updateTime?: string
}
