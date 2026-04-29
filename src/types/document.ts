import type { DocumentIndexStatus } from '@/constants/document'

export interface DocumentVO {
  id: number
  userId: number
  knowledgeId: number
  documentName: string
  documentUrl?: string
  objectName?: string
  documentSource?: string
  fileType?: string
  contentType?: string
  fileSize?: number
  indexStatus: DocumentIndexStatus
  chunkCount?: number
  indexErrorMessage?: string
  indexStartTime?: string
  indexEndTime?: string
  createTime?: string
  updateTime?: string
}
