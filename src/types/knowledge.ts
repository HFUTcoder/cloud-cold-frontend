export interface PageResult<T> {
  pageNumber: number
  pageSize: number
  totalRow: number
  totalPage?: number
  records: T[]
}

export interface KnowledgeVO {
  id: number
  userId: number
  knowledgeName: string
  description?: string
  documentCount: number
  lastDocumentUploadTime?: string
  createTime?: string
  updateTime?: string
}

export interface KnowledgeAddRequest {
  knowledgeName: string
  description?: string
}

export interface KnowledgeUpdateRequest {
  id: number
  knowledgeName: string
  description?: string
}

export interface KnowledgeQueryRequest {
  pageNum: number
  pageSize: number
  sortField?: string
  sortOrder?: string
  id?: number
  knowledgeName?: string
  description?: string
}
