import { requestJson } from '@/api/request'
import type {
  KnowledgeAddRequest,
  KnowledgeQueryRequest,
  KnowledgeUpdateRequest,
  KnowledgeVO,
  PageResult,
} from '@/types/knowledge'

export function createKnowledge(payload: KnowledgeAddRequest) {
  return requestJson<number>('/knowledge/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateKnowledge(payload: KnowledgeUpdateRequest) {
  return requestJson<boolean>('/knowledge/update', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteKnowledge(id: number) {
  return requestJson<boolean>('/knowledge/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

export function listMyKnowledgeByPage(payload: KnowledgeQueryRequest) {
  return requestJson<PageResult<KnowledgeVO>>('/knowledge/list/page/my', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
