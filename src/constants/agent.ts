export const AGENT_MODES = {
  FAST: 'fast',
  THINKING: 'thinking',
  EXPERT: 'expert',
} as const

export type AgentMode = (typeof AGENT_MODES)[keyof typeof AGENT_MODES]

export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  [AGENT_MODES.FAST]: '快速',
  [AGENT_MODES.THINKING]: '思考',
  [AGENT_MODES.EXPERT]: '专家',
}
