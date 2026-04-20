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
  mode: string
  /**
   * 会话 id（可选）
   */
  conversationId?: string
}

export type AgentSseEventName = 'message' | 'error' | string

export interface AgentSseEvent {
  event: AgentSseEventName
  data: string
}

export interface AgentStreamHandlers {
  onOpen?: () => void
  onMessage?: (data: string) => void
  onError?: (error: string) => void
  onEvent?: (event: AgentSseEvent) => void
  onComplete?: () => void
}
