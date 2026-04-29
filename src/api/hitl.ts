import type { HitlCheckpointResolveRequest, HitlCheckpointVO } from '@/types/hitl'
import { requestJson } from '@/api/request'

export function resolveHitlCheckpoint(payload: HitlCheckpointResolveRequest) {
  return requestJson<HitlCheckpointVO>('/hitl/checkpoint/resolve', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getHitlCheckpoint(interruptId: string) {
  return requestJson<HitlCheckpointVO>(
    `/hitl/checkpoint/get?interruptId=${encodeURIComponent(interruptId)}`,
  )
}
