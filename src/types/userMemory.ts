export interface UserLongTermMemory {
  id: string
  status?: string
  memoryType: string
  title: string
  content: string
  summary: string
  confidence?: number
  importance?: number
  sourceConversationIds?: string[]
  sourceHistoryCount?: number
  lastRetrievedAt?: string
  lastReinforcedAt?: string
  updatedAt?: string
}

export interface UserPetState {
  enabled: boolean
  petName: string
  petMood: 'idle' | 'learning' | 'updated' | 'disabled' | string
  memoryCount: number
  pendingRounds: number
  lastLearnedAt?: string | null
  memoryHighlights: string[]
  recentMemories: UserLongTermMemory[]
}
