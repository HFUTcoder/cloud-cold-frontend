import type { AgentMode } from '@/constants/agent'

/**
 * 对应后端 AgentCallRequest
 */
export interface AgentCallRequest {
  /**
   * 用户问题
   */
  question: string
  /**
   * 工作模式
   */
  mode: AgentMode
  /**
   * 会话 id（可选）
   */
  conversationId?: string
}

export interface AgentResumeRequest {
  interruptId: string
}

export type AgentEventType =
  | 'thinking_step'
  | 'assistant_delta'
  | 'final_answer'
  | 'hitl_interrupt'
  | 'knowledge_retrieval'
  | 'error'

export interface AgentThinkingStepPayload {
  stage?: string
  title?: string
  content?: string
}

export interface PendingToolCall {
  id: string
  name: string
  arguments: string
  result: 'APPROVED' | 'REJECTED' | 'EDIT' | null
  description?: string
}

export interface AgentHitlInterruptPayload {
  agentType?: string
  pendingToolCalls?: PendingToolCall[]
  status?: string
}

export interface AgentFinalAnswerPayload {
  content?: string
}

export interface RetrievedKnowledgeImage {
  imageId?: string
  imageUrl?: string
  pageNumber?: number
  documentId?: string
  documentName?: string
}

export interface AgentKnowledgeRetrievalPayload {
  images?: RetrievedKnowledgeImage[]
  count?: number
}

export interface AgentErrorPayload {
  /** 错误码，对齐后端 ErrorCode 枚举（如 50000 = SYSTEM_ERROR） */
  code?: number
  message?: string
  /** 错误详情，可能包含堆栈或上下文 */
  detail?: string
}

export interface AgentStreamEvent {
  type: AgentEventType | string
  conversationId?: string
  interruptId?: string
  data?:
    | AgentThinkingStepPayload
    | AgentHitlInterruptPayload
    | AgentFinalAnswerPayload
    | AgentKnowledgeRetrievalPayload
    | AgentErrorPayload
}

export interface AgentStreamHandlers {
  onOpen?: () => void
  onAgentEvent?: (event: AgentStreamEvent) => void
  onTransportError?: (error: string) => void
  onComplete?: () => void
}
