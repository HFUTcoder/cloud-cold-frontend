<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { createKnowledge, deleteKnowledge, listMyKnowledgeByPage, updateKnowledge } from '@/api/knowledge'
import {
  deleteDocument,
  getDocumentPreviewUrl,
  listDocumentsByKnowledge,
  uploadDocument,
} from '@/api/document'
import type { DocumentVO } from '@/types/document'
import type { KnowledgeVO } from '@/types/knowledge'
import type { LoginUserVO } from '@/types/user'

const props = defineProps<{
  currentUser: LoginUserVO | null
}>()

const emit = defineEmits<{
  (event: 'request-login'): void
  (event: 'exit'): void
}>()

type EditorMode = 'create' | 'edit'

const knowledgeList = ref<KnowledgeVO[]>([])
const documents = ref<DocumentVO[]>([])
const selectedKnowledgeId = ref<number | null>(null)
const knowledgeLoading = ref(false)
const documentLoading = ref(false)
const actionLoading = ref(false)
const uploading = ref(false)
const uploadInputRef = ref<HTMLInputElement | null>(null)
const feedbackMessage = ref('')
const feedbackTone = ref<'success' | 'error' | 'neutral'>('neutral')
const showEditor = ref(false)
const editorMode = ref<EditorMode>('create')
const editorSubmitting = ref(false)
const showPreview = ref(false)
const previewLoading = ref(false)
const previewDocumentName = ref('')
const previewUrl = ref('')
const editorForm = ref({
  id: 0,
  knowledgeName: '',
  description: '',
})

const isLoggedIn = computed(() => props.currentUser !== null)
const selectedKnowledge = computed(() =>
  knowledgeList.value.find((item) => item.id === selectedKnowledgeId.value) ?? null,
)
const indexedCount = computed(
  () => documents.value.filter((item) => item.indexStatus === 'INDEXED').length,
)
const failedCount = computed(
  () => documents.value.filter((item) => item.indexStatus === 'FAILED').length,
)
const pendingCount = computed(
  () => documents.value.filter((item) => item.indexStatus === 'PENDING' || item.indexStatus === 'INDEXING').length,
)
const sortedDocuments = computed(() =>
  [...documents.value].sort((left, right) => {
    const leftTime = new Date(left.updateTime || left.createTime || 0).getTime()
    const rightTime = new Date(right.updateTime || right.createTime || 0).getTime()
    return rightTime - leftTime
  }),
)

watch(
  () => props.currentUser?.id ?? null,
  async (userId) => {
    if (!userId) {
      knowledgeList.value = []
      documents.value = []
      selectedKnowledgeId.value = null
      clearFeedback()
      return
    }
    await loadKnowledges()
  },
  { immediate: true },
)

function clearFeedback() {
  feedbackMessage.value = ''
  feedbackTone.value = 'neutral'
}

function setFeedback(message: string, tone: 'success' | 'error' | 'neutral' = 'neutral') {
  feedbackMessage.value = message
  feedbackTone.value = tone
}

function ensureLoggedIn(): boolean {
  if (isLoggedIn.value) {
    return true
  }
  emit('request-login')
  return false
}

async function loadKnowledges(preferredKnowledgeId?: number | null) {
  if (!isLoggedIn.value) {
    return
  }

  knowledgeLoading.value = true
  clearFeedback()
  try {
    const page = await listMyKnowledgeByPage({
      pageNum: 1,
      pageSize: 100,
      sortField: 'updateTime',
      sortOrder: 'descend',
    })
    knowledgeList.value = page.records ?? []

    const desiredId =
      preferredKnowledgeId && knowledgeList.value.some((item) => item.id === preferredKnowledgeId)
        ? preferredKnowledgeId
        : selectedKnowledgeId.value && knowledgeList.value.some((item) => item.id === selectedKnowledgeId.value)
          ? selectedKnowledgeId.value
          : knowledgeList.value[0]?.id ?? null

    selectedKnowledgeId.value = desiredId
    if (desiredId) {
      await loadDocuments(desiredId)
    } else {
      documents.value = []
    }
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : '加载知识库失败，请稍后再试。', 'error')
  } finally {
    knowledgeLoading.value = false
  }
}

async function loadDocuments(knowledgeId: number) {
  if (!knowledgeId) {
    documents.value = []
    return
  }

  documentLoading.value = true
  try {
    documents.value = await listDocumentsByKnowledge(knowledgeId)
  } catch (error) {
    documents.value = []
    setFeedback(error instanceof Error ? error.message : '加载文档列表失败，请稍后再试。', 'error')
  } finally {
    documentLoading.value = false
  }
}

async function selectKnowledge(knowledgeId: number) {
  if (knowledgeId === selectedKnowledgeId.value) {
    return
  }
  selectedKnowledgeId.value = knowledgeId
  clearFeedback()
  await loadDocuments(knowledgeId)
}

function openCreateEditor() {
  if (!ensureLoggedIn()) {
    return
  }
  editorMode.value = 'create'
  editorForm.value = {
    id: 0,
    knowledgeName: '',
    description: '',
  }
  showEditor.value = true
}

function openEditEditor() {
  if (!selectedKnowledge.value) {
    return
  }
  editorMode.value = 'edit'
  editorForm.value = {
    id: selectedKnowledge.value.id,
    knowledgeName: selectedKnowledge.value.knowledgeName,
    description: selectedKnowledge.value.description ?? '',
  }
  showEditor.value = true
}

function closeEditor() {
  if (editorSubmitting.value) {
    return
  }
  showEditor.value = false
}

async function submitEditor() {
  if (!ensureLoggedIn()) {
    return
  }
  const knowledgeName = editorForm.value.knowledgeName.trim()
  if (!knowledgeName) {
    setFeedback('请输入知识库名称。', 'error')
    return
  }

  editorSubmitting.value = true
  clearFeedback()
  try {
    if (editorMode.value === 'create') {
      const knowledgeId = await createKnowledge({
        knowledgeName,
        description: editorForm.value.description.trim() || undefined,
      })
      await loadKnowledges(knowledgeId)
      setFeedback('知识库已创建，可以开始上传文档。', 'success')
    } else {
      await updateKnowledge({
        id: editorForm.value.id,
        knowledgeName,
        description: editorForm.value.description.trim() || undefined,
      })
      await loadKnowledges(editorForm.value.id)
      setFeedback('知识库信息已更新。', 'success')
    }
    showEditor.value = false
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : '保存知识库失败，请稍后再试。', 'error')
  } finally {
    editorSubmitting.value = false
  }
}

async function removeKnowledge() {
  if (!selectedKnowledge.value) {
    return
  }
  if (!window.confirm(`确定删除知识库「${selectedKnowledge.value.knowledgeName}」吗？相关文档也会一并删除。`)) {
    return
  }

  actionLoading.value = true
  clearFeedback()
  try {
    const removedId = selectedKnowledge.value.id
    await deleteKnowledge(removedId)
    await loadKnowledges()
    if (selectedKnowledgeId.value === removedId) {
      documents.value = []
    }
    setFeedback('知识库已删除。', 'success')
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : '删除知识库失败，请稍后再试。', 'error')
  } finally {
    actionLoading.value = false
  }
}

function triggerUpload() {
  if (!ensureLoggedIn()) {
    return
  }
  if (!selectedKnowledge.value || uploading.value) {
    return
  }
  uploadInputRef.value?.click()
}

async function handleUploadChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''

  if (!file || !selectedKnowledge.value) {
    return
  }

  uploading.value = true
  clearFeedback()
  try {
    await uploadDocument(selectedKnowledge.value.id, file)
    await loadKnowledges(selectedKnowledge.value.id)
    setFeedback(`文档「${file.name}」已上传并完成入库。`, 'success')
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : '上传文档失败，请稍后再试。', 'error')
  } finally {
    uploading.value = false
  }
}

async function removeDocumentItem(document: DocumentVO) {
  if (!window.confirm(`确定删除文档「${document.documentName}」吗？删除后不可恢复。`)) {
    return
  }

  actionLoading.value = true
  clearFeedback()
  try {
    await deleteDocument(document.id)
    if (selectedKnowledge.value) {
      await loadKnowledges(selectedKnowledge.value.id)
    }
    setFeedback('文档已删除。', 'success')
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : '删除文档失败，请稍后再试。', 'error')
  } finally {
    actionLoading.value = false
  }
}

async function openDocumentPreview(document: DocumentVO) {
  previewDocumentName.value = document.documentName
  previewUrl.value = ''
  showPreview.value = true
  previewLoading.value = true
  clearFeedback()

  try {
    previewUrl.value = await getDocumentPreviewUrl(document.id)
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : '加载文档预览失败，请稍后再试。', 'error')
    showPreview.value = false
  } finally {
    previewLoading.value = false
  }
}

function closePreview() {
  showPreview.value = false
  previewLoading.value = false
  previewDocumentName.value = ''
  previewUrl.value = ''
}

async function refreshCurrentKnowledge() {
  if (!selectedKnowledge.value) {
    await loadKnowledges()
    return
  }
  await loadKnowledges(selectedKnowledge.value.id)
}

function formatDateTime(value?: string) {
  if (!value) {
    return '暂无记录'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatFileSize(size?: number) {
  if (!size || size <= 0) {
    return '未知大小'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function statusLabel(status: DocumentVO['indexStatus']) {
  switch (status) {
    case 'INDEXED':
      return '已就绪'
    case 'INDEXING':
      return '入库中'
    case 'FAILED':
      return '失败'
    default:
      return '待处理'
  }
}

function statusDescription(document: DocumentVO) {
  switch (document.indexStatus) {
    case 'INDEXED':
      return '文档已处理完成，可以在当前知识库中使用'
    case 'INDEXING':
      return `开始处理：${formatDateTime(document.indexStartTime)}`
    case 'FAILED':
      return document.indexErrorMessage || '本次入库失败，请检查文件内容或稍后重试'
    default:
      return '文档已上传，正在准备中'
  }
}
</script>

<template>
  <div class="knowledge-workspace">
    <div class="workspace-hero">
      <div class="hero-copy">
        <p class="hero-kicker">Knowledge Base Console</p>
        <h2>把文档装进一个能长期工作的知识库。</h2>
        <p class="hero-text">
          在这里集中管理知识库、上传资料，并随时查看每份文档的处理状态。
        </p>
      </div>
      <div class="hero-actions">
        <button class="hero-btn primary" type="button" @click="openCreateEditor">新建知识库</button>
        <button class="hero-btn" type="button" @click="emit('exit')">返回对话</button>
      </div>
    </div>

    <template v-if="!isLoggedIn">
      <section class="login-state">
        <div class="login-card">
          <p class="login-kicker">受保护的工作区</p>
          <h3>登录后才能创建知识库并上传文档。</h3>
          <p>知识库与文档会绑定到当前账号，方便后续持续维护和使用。</p>
          <button class="hero-btn primary" type="button" @click="emit('request-login')">立即登录</button>
        </div>
      </section>
    </template>

    <template v-else>
      <div v-if="feedbackMessage" class="feedback-banner" :class="feedbackTone">
        {{ feedbackMessage }}
      </div>

      <div class="workspace-grid">
        <aside class="knowledge-rail">
          <div class="rail-header">
            <div>
              <p class="rail-kicker">我的知识库</p>
              <h3>{{ knowledgeList.length }} 个空间</h3>
            </div>
            <button class="icon-btn" type="button" title="刷新知识库" @click="loadKnowledges(selectedKnowledgeId)">
              ↻
            </button>
          </div>

          <div v-if="knowledgeLoading && knowledgeList.length === 0" class="rail-placeholder">
            正在加载知识库...
          </div>

          <div v-else-if="knowledgeList.length === 0" class="rail-empty">
            <p>还没有知识库。</p>
            <button class="ghost-action" type="button" @click="openCreateEditor">创建第一个知识库</button>
          </div>

          <div v-else class="knowledge-list">
            <button
              v-for="item in knowledgeList"
              :key="item.id"
              type="button"
              class="knowledge-card"
              :class="{ active: selectedKnowledgeId === item.id }"
              @click="selectKnowledge(item.id)"
            >
              <div class="knowledge-card-top">
                <span class="knowledge-name">{{ item.knowledgeName }}</span>
                <span class="knowledge-count">{{ item.documentCount }} 份</span>
              </div>
              <p class="knowledge-desc">{{ item.description || '暂未填写知识库说明' }}</p>
              <p class="knowledge-meta">最近更新：{{ formatDateTime(item.lastDocumentUploadTime || item.updateTime) }}</p>
            </button>
          </div>
        </aside>

        <section class="knowledge-stage">
          <template v-if="selectedKnowledge">
            <div class="stage-top">
              <div>
                <p class="stage-kicker">当前空间</p>
                <h3>{{ selectedKnowledge.knowledgeName }}</h3>
                <p class="stage-desc">{{ selectedKnowledge.description || '建议为知识库补充说明，方便团队更快理解这个空间的用途。' }}</p>
              </div>
              <div class="stage-actions">
                <button class="stage-btn" type="button" :disabled="actionLoading" @click="openEditEditor">编辑</button>
                <button class="stage-btn" type="button" :disabled="actionLoading" @click="refreshCurrentKnowledge">刷新</button>
                <button class="stage-btn danger" type="button" :disabled="actionLoading" @click="removeKnowledge">删除</button>
              </div>
            </div>

            <div class="metric-grid">
              <article class="metric-card">
                <span class="metric-label">文档总数</span>
                <strong>{{ selectedKnowledge.documentCount }}</strong>
              </article>
              <article class="metric-card">
                <span class="metric-label">已完成</span>
                <strong>{{ indexedCount }}</strong>
              </article>
              <article class="metric-card warn">
                <span class="metric-label">等待 / 处理中</span>
                <strong>{{ pendingCount }}</strong>
              </article>
              <article class="metric-card danger">
                <span class="metric-label">失败文档</span>
                <strong>{{ failedCount }}</strong>
              </article>
            </div>

            <div class="upload-panel">
              <div class="document-panel-head upload-panel-head">
                <div class="upload-copy">
                  <p class="rail-kicker">文档入库</p>
                </div>
              </div>
              <div class="upload-actions">
                <input
                  ref="uploadInputRef"
                  type="file"
                  class="hidden-input"
                  accept=".pdf,application/pdf"
                  @change="handleUploadChange"
                />
                <div class="upload-action-card">
                  <button class="hero-btn primary upload-primary-btn" type="button" :disabled="uploading" @click="triggerUpload">
                    {{ uploading ? '上传中...' : '上传 PDF 到当前知识库' }}
                  </button>
                  <p class="upload-note">支持中文文件名</p>
                </div>
              </div>
            </div>

            <div class="document-panel">
              <div class="document-panel-head">
                <div>
                  <p class="rail-kicker">文档清单</p>
                </div>
                <span v-if="documentLoading" class="panel-loading">同步中...</span>
              </div>

              <div v-if="documentLoading && documents.length === 0" class="document-empty">
                正在加载文档...
              </div>

              <div v-else-if="documents.length === 0" class="document-empty">
                <p>当前知识库还没有文档。</p>
                <button class="ghost-action" type="button" @click="triggerUpload">上传第一份文档</button>
              </div>

              <div v-else class="document-list">
                <article v-for="document in sortedDocuments" :key="document.id" class="document-card">
                  <div class="document-main">
                    <div class="document-title-row">
                      <h5>{{ document.documentName }}</h5>
                      <span class="status-pill" :class="document.indexStatus.toLowerCase()">
                        {{ statusLabel(document.indexStatus) }}
                      </span>
                    </div>
                    <p class="document-detail">{{ statusDescription(document) }}</p>
                    <div class="document-meta">
                      <span>{{ document.fileType?.toUpperCase() || 'FILE' }}</span>
                      <span>{{ formatFileSize(document.fileSize) }}</span>
                      <span>上传于 {{ formatDateTime(document.createTime) }}</span>
                    </div>
                    <div v-if="document.indexStatus === 'FAILED' && document.indexErrorMessage" class="document-error">
                      {{ document.indexErrorMessage }}
                    </div>
                  </div>

                  <div class="document-actions">
                    <button class="stage-btn" type="button" @click="openDocumentPreview(document)">
                      查看原文件
                    </button>
                    <button
                      class="stage-btn danger"
                      type="button"
                      :disabled="actionLoading"
                      @click="removeDocumentItem(document)"
                    >
                      删除
                    </button>
                  </div>
                </article>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="stage-empty">
              <p class="stage-kicker">准备开始</p>
              <h3>先创建一个知识库，再把文档放进来。</h3>
              <p>你可以按业务域、客户项目、产品模块或资料来源来划分知识库。</p>
              <button class="hero-btn primary" type="button" @click="openCreateEditor">创建知识库</button>
            </div>
          </template>
        </section>
      </div>
    </template>

    <div v-if="showPreview" class="modal-mask preview-mask" @click="closePreview">
      <div class="preview-card" @click.stop>
        <div class="preview-head">
          <div>
            <p class="rail-kicker">文档预览</p>
            <h3>{{ previewDocumentName }}</h3>
          </div>
          <button class="icon-btn" type="button" @click="closePreview">×</button>
        </div>
        <div v-if="previewLoading" class="preview-loading">正在加载文档内容...</div>
        <div v-else-if="previewUrl" class="preview-body">
          <iframe :src="previewUrl" class="preview-frame" title="文档预览" />
        </div>
        <div v-else class="preview-loading">暂时无法预览当前文档。</div>
      </div>
    </div>

    <div v-if="showEditor" class="modal-mask" @click="closeEditor">
      <div class="editor-card" @click.stop>
        <p class="rail-kicker">{{ editorMode === 'create' ? '新建知识库' : '编辑知识库' }}</p>
        <h3>{{ editorMode === 'create' ? '定义一个新的文档空间' : '更新知识库的展示信息' }}</h3>
        <label class="editor-field">
          <span>知识库名称</span>
          <input v-model="editorForm.knowledgeName" type="text" maxlength="60" placeholder="例如：售后知识库 / 产品手册 / 项目复盘" />
        </label>
        <label class="editor-field">
          <span>知识库说明</span>
          <textarea
            v-model="editorForm.description"
            rows="4"
            maxlength="300"
            placeholder="简单描述这个知识库放什么文档，后续团队使用时会更容易辨认。"
          />
        </label>
        <div class="editor-actions">
          <button class="stage-btn" type="button" @click="closeEditor">取消</button>
          <button class="hero-btn primary" type="button" :disabled="editorSubmitting" @click="submitEditor">
            {{ editorSubmitting ? '保存中...' : '确认保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.knowledge-workspace {
  display: grid;
  gap: 1.1rem;
}

.workspace-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) auto;
  gap: 1rem;
  padding: 1.3rem 1.45rem;
  border: 1px solid #e6ebf5;
  border-radius: 1.6rem;
  background:
    radial-gradient(circle at top left, rgba(103, 156, 255, 0.16), transparent 40%),
    linear-gradient(135deg, #fbfdff 0%, #f4f8ff 52%, #fff8ef 100%);
  box-shadow: 0 24px 60px rgba(33, 52, 91, 0.08);
}

.hero-kicker,
.rail-kicker,
.stage-kicker,
.upload-kicker,
.login-kicker {
  font: 700 0.72rem/1 'Avenir Next', 'PingFang SC', sans-serif;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6a7b97;
}

.hero-copy h2,
.login-card h3,
.stage-empty h3,
.editor-card h3 {
  margin-top: 0.45rem;
  font: 700 2rem/1.08 'Avenir Next', 'PingFang SC', sans-serif;
  color: #10203c;
  letter-spacing: -0.04em;
}

.hero-text,
.login-card p,
.stage-desc,
.upload-copy p,
.metric-card p,
.document-detail,
.document-meta,
.stage-empty p,
.knowledge-desc,
.knowledge-meta {
  color: #667182;
  line-height: 1.6;
}

.hero-text {
  max-width: 56rem;
  margin-top: 0.7rem;
  font-size: 0.95rem;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.7rem;
}

.hero-btn,
.stage-btn,
.ghost-action,
.icon-btn {
  border: 1px solid #dbe3ef;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
  color: #1d2840;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.hero-btn:hover,
.stage-btn:hover,
.ghost-action:hover,
.icon-btn:hover {
  transform: translateY(-1px);
  border-color: #bcc9dd;
}

.hero-btn:disabled,
.stage-btn:disabled,
.ghost-action:disabled,
.icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

.hero-btn {
  padding: 0.7rem 1.15rem;
  font-weight: 700;
}

.hero-btn.primary {
  background: linear-gradient(135deg, #163567 0%, #214f93 100%);
  border-color: #163567;
  color: #fff;
  box-shadow: 0 14px 32px rgba(26, 61, 117, 0.22);
}

.login-state {
  padding: 0.2rem 0 0.8rem;
}

.login-card,
.stage-empty {
  padding: 2rem;
  border-radius: 1.5rem;
  border: 1px dashed #d3dbe8;
  background:
    linear-gradient(180deg, rgba(249, 251, 255, 0.98), rgba(255, 255, 255, 0.98)),
    #fff;
  text-align: center;
}

.login-card h3,
.stage-empty h3 {
  font-size: 1.8rem;
}

.login-card p,
.stage-empty p {
  margin: 0.8rem auto 1.2rem;
  max-width: 38rem;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
  gap: 1rem;
  min-height: 0;
}

.knowledge-rail,
.knowledge-stage {
  border-radius: 1.45rem;
  border: 1px solid #e7ecf4;
  background: #ffffff;
  box-shadow: 0 18px 46px rgba(31, 44, 79, 0.06);
}

.knowledge-rail {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.rail-header,
.document-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.rail-header h3,
.document-panel-head h4,
.stage-top h3,
.upload-copy h4 {
  margin-top: 0.35rem;
  font: 700 1.2rem/1.18 'Avenir Next', 'PingFang SC', sans-serif;
  color: #17243a;
}

.icon-btn {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
}

.rail-placeholder,
.rail-empty,
.document-empty {
  border-radius: 1.15rem;
  border: 1px dashed #d8e1ee;
  background: #f7faff;
  color: #687487;
  padding: 1.05rem;
}

.rail-empty,
.document-empty {
  display: grid;
  gap: 0.8rem;
  justify-items: start;
}

.knowledge-list {
  display: grid;
  gap: 0.75rem;
  overflow: auto;
  padding-right: 0.1rem;
}

.knowledge-card {
  border: 1px solid #e4eaf3;
  border-radius: 1.15rem;
  background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
  padding: 0.95rem;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.knowledge-card:hover {
  transform: translateY(-2px);
  border-color: #cad6ea;
  box-shadow: 0 16px 28px rgba(46, 78, 136, 0.08);
}

.knowledge-card.active {
  border-color: #8eb0eb;
  box-shadow: 0 16px 30px rgba(86, 123, 196, 0.14);
  background:
    linear-gradient(135deg, rgba(232, 241, 255, 0.92), rgba(255, 252, 246, 0.98));
}

.knowledge-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.knowledge-name {
  font-weight: 700;
  color: #182741;
}

.knowledge-count {
  color: #5f7394;
  font-size: 0.82rem;
}

.knowledge-desc {
  margin-top: 0.45rem;
  font-size: 0.88rem;
  min-height: 2.8em;
}

.knowledge-meta {
  margin-top: 0.65rem;
  font-size: 0.77rem;
}

.knowledge-stage {
  padding: 1rem;
  display: grid;
  gap: 1rem;
}

.stage-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  padding: 1.1rem 1.15rem;
  border-radius: 1.2rem;
  background: linear-gradient(180deg, #fcfdff 0%, #f8fbff 100%);
  border: 1px solid #e6ebf4;
}

.stage-actions,
.upload-actions {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.stage-btn {
  padding: 0.64rem 0.95rem;
  font-size: 0.86rem;
}

.stage-btn.danger {
  color: #9e2d2d;
  border-color: #f0d5d5;
  background: #fff9f9;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.8rem;
}

.metric-card {
  padding: 1rem;
  border-radius: 1.15rem;
  border: 1px solid #e6ecf5;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
}

.metric-card.warn {
  background: linear-gradient(180deg, #fffdf7 0%, #fff8ea 100%);
}

.metric-card.danger {
  background: linear-gradient(180deg, #fffafb 0%, #fff2f4 100%);
}

.metric-label {
  display: inline-block;
  color: #72819a;
  font-size: 0.8rem;
}

.metric-card strong {
  display: block;
  margin-top: 0.45rem;
  font: 700 2rem/1 'Avenir Next', 'PingFang SC', sans-serif;
  color: #15243b;
}

.metric-card p {
  margin-top: 0.48rem;
  font-size: 0.84rem;
}

.upload-panel {
  border-radius: 1.2rem;
  border: 1px solid #e7ecf4;
  background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
  padding: 1rem;
  display: grid;
  gap: 0.9rem;
}

.upload-panel-head {
  align-items: center;
}

.upload-copy {
  display: flex;
  align-items: center;
}

.upload-actions {
  justify-content: flex-start;
}

.upload-action-card {
  width: 100%;
  padding: 1rem;
  border-radius: 1.15rem;
  border: 1px dashed rgba(184, 198, 223, 0.95);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(245, 249, 255, 0.96));
  display: grid;
  gap: 0.72rem;
  justify-items: stretch;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
}

.upload-primary-btn {
  width: 100%;
  min-height: 46px;
  justify-content: center;
  font-size: 0.92rem;
  letter-spacing: 0.01em;
}

.hidden-input {
  display: none;
}

.upload-note,
.panel-loading {
  color: #6d7c91;
  font-size: 0.8rem;
}

.upload-note {
  text-align: center;
}

.document-panel {
  border-radius: 1.2rem;
  border: 1px solid #e7ecf4;
  background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
  padding: 1rem;
  display: grid;
  gap: 0.9rem;
}

.document-list {
  display: grid;
  gap: 0.75rem;
}

.document-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  padding: 1rem;
  border-radius: 1.05rem;
  border: 1px solid #e7ecf4;
  background: #fff;
}

.document-title-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
}

.document-title-row h5 {
  font-size: 1rem;
  color: #182640;
}

.status-pill {
  border-radius: 999px;
  padding: 0.28rem 0.65rem;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.status-pill.pending {
  background: #f2f5fb;
  color: #596d8e;
}

.status-pill.indexing {
  background: #fff4db;
  color: #9b6400;
}

.status-pill.indexed {
  background: #e7f7ec;
  color: #1d7d43;
}

.status-pill.failed {
  background: #ffe9ed;
  color: #b33c5c;
}

.document-detail {
  margin-top: 0.45rem;
  font-size: 0.9rem;
}

.document-meta {
  margin-top: 0.65rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  font-size: 0.8rem;
}

.document-error {
  margin-top: 0.7rem;
  padding: 0.75rem 0.85rem;
  border-radius: 0.9rem;
  background: #fff5f7;
  color: #9f3552;
  font-size: 0.82rem;
  line-height: 1.5;
}

.document-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.feedback-banner {
  border-radius: 1rem;
  padding: 0.85rem 1rem;
  font-size: 0.9rem;
  border: 1px solid transparent;
}

.feedback-banner.success {
  background: #edf8f1;
  border-color: #c9e9d3;
  color: #24693f;
}

.feedback-banner.error {
  background: #fff4f6;
  border-color: #f0d3db;
  color: #a23b56;
}

.feedback-banner.neutral {
  background: #f5f8fc;
  border-color: #dde6f1;
  color: #4e627f;
}

.ghost-action {
  padding: 0.55rem 0.9rem;
  font-size: 0.84rem;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(13, 20, 34, 0.34);
  display: grid;
  place-items: center;
  z-index: 60;
  padding: 1rem;
}

.preview-mask {
  align-items: stretch;
}

.preview-card {
  width: min(1180px, 100%);
  min-height: min(82vh, 920px);
  max-height: 82vh;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 0.9rem;
  padding: 1.2rem;
  border-radius: 1.4rem;
  border: 1px solid #e5ebf4;
  background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
  box-shadow: 0 28px 70px rgba(19, 34, 63, 0.18);
}

.preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.preview-head h3 {
  margin-top: 0.35rem;
  font: 700 1.24rem/1.18 'Avenir Next', 'PingFang SC', sans-serif;
  color: #17243a;
}

.preview-loading {
  min-height: 220px;
  display: grid;
  place-items: center;
  border-radius: 1rem;
  border: 1px dashed #d7e0ed;
  background: #f8fbff;
  color: #6b7a8f;
  font-size: 0.92rem;
}

.preview-body {
  min-height: 0;
  border-radius: 1rem;
  overflow: hidden;
  border: 1px solid #dfe6f1;
  background: #eef3fb;
}

.preview-frame {
  width: 100%;
  height: 100%;
  min-height: 65vh;
  border: 0;
  background: #eef3fb;
}

.editor-card {
  width: min(560px, 100%);
  padding: 1.35rem;
  border-radius: 1.35rem;
  border: 1px solid #e5ebf4;
  background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
  box-shadow: 0 28px 70px rgba(19, 34, 63, 0.18);
}

.editor-field {
  margin-top: 1rem;
  display: grid;
  gap: 0.45rem;
}

.editor-field span {
  font-size: 0.84rem;
  color: #566579;
}

.editor-field input,
.editor-field textarea {
  width: 100%;
  border-radius: 0.95rem;
  border: 1px solid #d9e2ef;
  padding: 0.85rem 0.95rem;
  font: inherit;
  color: #1c2940;
  background: #fff;
  resize: vertical;
}

.editor-field input:focus,
.editor-field textarea:focus {
  outline: none;
  border-color: #7da2dc;
  box-shadow: 0 0 0 4px rgba(106, 143, 210, 0.12);
}

.editor-actions {
  margin-top: 1.2rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.7rem;
}

.knowledge-workspace {
  position: relative;
  isolation: isolate;
}

.knowledge-workspace::before {
  content: '';
  position: absolute;
  inset: 0 auto auto 4%;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: rgba(120, 157, 235, 0.12);
  filter: blur(22px);
  z-index: -1;
}

.workspace-hero {
  position: relative;
  overflow: hidden;
  border-color: rgba(198, 213, 238, 0.72);
  background:
    radial-gradient(circle at top left, rgba(116, 161, 247, 0.2), transparent 34%),
    radial-gradient(circle at 88% 20%, rgba(255, 209, 141, 0.2), transparent 30%),
    linear-gradient(135deg, rgba(251, 253, 255, 0.94) 0%, rgba(242, 247, 255, 0.94) 48%, rgba(255, 251, 242, 0.96) 100%);
  box-shadow: 0 30px 64px rgba(30, 52, 96, 0.08);
}

.workspace-hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(120deg, rgba(255, 255, 255, 0.26), transparent 34%, transparent 66%, rgba(255, 255, 255, 0.22));
  pointer-events: none;
}

.hero-copy h2,
.login-card h3,
.stage-empty h3,
.editor-card h3 {
  color: #13243f;
  letter-spacing: -0.05em;
  text-shadow: 0 12px 34px rgba(105, 133, 185, 0.14);
}

.hero-text,
.login-card p,
.stage-desc,
.upload-copy p,
.metric-card p,
.document-detail,
.document-meta,
.stage-empty p,
.knowledge-desc,
.knowledge-meta {
  color: #66768d;
}

.hero-btn,
.stage-btn,
.ghost-action,
.icon-btn {
  border-color: rgba(205, 217, 233, 0.88);
  box-shadow: 0 12px 24px rgba(33, 52, 91, 0.05);
}

.hero-btn:hover,
.stage-btn:hover,
.ghost-action:hover,
.icon-btn:hover {
  box-shadow: 0 16px 28px rgba(45, 67, 114, 0.08);
}

.hero-btn.primary {
  background: linear-gradient(135deg, #17335f 0%, #2a5aa5 100%);
  box-shadow: 0 18px 32px rgba(30, 59, 117, 0.2);
}

.knowledge-rail,
.knowledge-stage {
  position: relative;
  border-color: rgba(212, 221, 236, 0.82);
  background: rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(18px);
  box-shadow: 0 24px 52px rgba(30, 45, 79, 0.07);
}

.knowledge-rail::before,
.knowledge-stage::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 1px solid rgba(255, 255, 255, 0.48);
  pointer-events: none;
}

.knowledge-card {
  border-color: rgba(214, 223, 237, 0.86);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 250, 255, 0.94));
  box-shadow: 0 14px 28px rgba(43, 65, 108, 0.05);
}

.knowledge-card.active {
  border-color: rgba(135, 168, 226, 0.88);
  box-shadow: 0 18px 34px rgba(57, 90, 153, 0.12);
}

.stage-top,
.upload-panel,
.document-panel,
.rail-placeholder,
.rail-empty,
.document-empty,
.metric-card {
  border-color: rgba(214, 223, 237, 0.82);
  box-shadow: 0 14px 30px rgba(38, 57, 93, 0.04);
}

.stage-top,
.upload-panel {
  background:
    linear-gradient(180deg, rgba(253, 254, 255, 0.96) 0%, rgba(247, 250, 255, 0.96) 100%);
}

.metric-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 251, 255, 0.94));
}

.metric-card.warn {
  background: linear-gradient(180deg, rgba(255, 252, 244, 0.98), rgba(255, 247, 230, 0.98));
}

.metric-card.danger {
  background: linear-gradient(180deg, rgba(255, 249, 251, 0.98), rgba(255, 241, 245, 0.98));
}

.metric-card strong {
  text-shadow: 0 10px 26px rgba(98, 127, 176, 0.12);
}

.document-card {
  border-color: rgba(217, 225, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(249, 251, 255, 0.96));
  box-shadow: 0 14px 28px rgba(38, 57, 93, 0.05);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.document-card:hover {
  transform: translateY(-2px);
  border-color: rgba(181, 198, 225, 0.96);
  box-shadow: 0 20px 34px rgba(48, 72, 122, 0.08);
}

.status-pill.pending {
  background: linear-gradient(180deg, #f3f6fb, #eaf0f8);
}

.status-pill.indexing {
  background: linear-gradient(180deg, #fff5de, #ffedd0);
}

.status-pill.indexed {
  background: linear-gradient(180deg, #eaf9ef, #dff4e7);
}

.status-pill.failed {
  background: linear-gradient(180deg, #ffeef2, #ffe1e8);
}

.feedback-banner {
  box-shadow: 0 12px 24px rgba(38, 57, 93, 0.05);
}

.preview-card,
.editor-card {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px);
}

@media (max-width: 1180px) {
  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 860px) {
  .workspace-hero,
  .stage-top,
  .upload-panel {
    grid-template-columns: 1fr;
  }

  .hero-actions,
  .stage-actions,
  .upload-actions {
    align-items: flex-start;
    justify-content: flex-start;
  }

  .upload-action-card {
    width: 100%;
  }

  .document-card {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .hero-copy h2,
  .login-card h3,
  .stage-empty h3,
  .editor-card h3 {
    font-size: 1.52rem;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .document-meta {
    flex-direction: column;
    gap: 0.32rem;
  }
}
</style>
