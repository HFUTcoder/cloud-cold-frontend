import { requestForm, requestJson } from '@/api/request'
import type { DocumentVO } from '@/types/document'

export function uploadDocument(knowledgeId: number, file: File) {
  const formData = new FormData()
  formData.append('knowledgeId', String(knowledgeId))
  formData.append('file', file)
  return requestForm<DocumentVO>('/document/upload', formData, {
    method: 'POST',
  })
}

export function listDocumentsByKnowledge(knowledgeId: number) {
  return requestJson<DocumentVO[]>(
    `/document/list/by/knowledge?knowledgeId=${encodeURIComponent(String(knowledgeId))}`,
    {
      method: 'GET',
      headers: {},
    },
  )
}

export function deleteDocument(id: number) {
  return requestJson<boolean>('/document/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

export function getDocumentPreviewUrl(id: number) {
  return requestJson<string>(`/document/preview-url?id=${encodeURIComponent(String(id))}`, {
    method: 'GET',
    headers: {},
  })
}
