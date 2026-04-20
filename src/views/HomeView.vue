<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { callAgentStream } from '@/api/agent'
import {
  createConversation,
  deleteConversation,
  listHistoryByConversation,
  listMyConversations,
} from '@/api/chat'
import { getLoginUser, userLogin, userLogout, userRegister } from '@/api/user'
import type { AgentCallRequest } from '@/types/agent'
import type { ChatConversation, ChatMemoryHistory } from '@/types/chat'
import type { LoginUserVO } from '@/types/user'

type ChatRole = 'user' | 'assistant'
type AuthModalType = 'none' | 'register' | 'login' | 'logout' | 'deleteConversation'

interface ChatMessage {
  id: number
  role: ChatRole
  content: string
  thinkingContent?: string
  finalContent?: string
  thinkingPreviewText?: string
  thinkingPreviewSeq?: number
  thinkingExpanded?: boolean
  thinkingDone?: boolean
  pending?: boolean
}

const chatRef = ref<HTMLElement | null>(null)
const modeMenuRef = ref<HTMLElement | null>(null)
const inputValue = ref('')
const mode = ref<'fast' | 'thinking'>('fast')
const showModeMenu = ref(false)
const sidebarCollapsed = ref(false)
const loading = ref(false)
const authLoading = ref(false)
const authError = ref('')
const authModal = ref<AuthModalType>('none')
const controller = ref<AbortController | null>(null)
const messageId = ref(0)
const currentUser = ref<LoginUserVO | null>(null)
const streamChunkBuffer = ref('')
const streamRafId = ref<number | null>(null)
const activeAssistantMessage = ref<ChatMessage | null>(null)
const streamThinkingBuffer = ref('')
const streamFinalBuffer = ref('')
const thinkingPreviewQueue = ref<string[]>([])
const thinkingPreviewRemainder = ref('')
const thinkingPreviewTimerId = ref<number | null>(null)

const loginForm = ref({
  userAccount: '',
  userPassword: '',
})

const registerForm = ref({
  userAccount: '',
  userPassword: '',
  checkPassword: '',
})

const messages = ref<ChatMessage[]>([])
const conversations = ref<ChatConversation[]>([])
const activeConversationId = ref('')
const conversationLoading = ref(false)
const historyLoading = ref(false)
const deletingConversationId = ref('')
const pendingDeleteConversationId = ref('')

const starterPrompts = [
  '如何利用 AI Agent 优化日常办公自动化流程？',
  '解释过程模式在项目管理中的作用',
  '帮我规划一份新的前端项目结构',
  '解释这段报错并给出修复方案',
  '把接口文档转换成前端调用代码',
  '给我一份高可维护的代码评审清单',
]

const modeOptions: Array<{ label: string; value: 'fast' | 'thinking'; desc: string }> = [
  { label: '快速', value: 'fast', desc: '适用于大部分情况' },
  { label: '思考', value: 'thinking', desc: '擅长解决更难的问题' },
]

const hasMessages = computed(() => messages.value.length > 0)
const canSubmit = computed(() => inputValue.value.trim().length > 0 && !loading.value)
const modeLabel = computed(() => (mode.value === 'fast' ? '快速' : '思考'))
const isLoggedIn = computed(() => currentUser.value !== null)
const userLabel = computed(() => currentUser.value?.userName || currentUser.value?.userAccount || '')
const activeConversationTitle = computed(() => {
  if (!activeConversationId.value) {
    return '新对话'
  }
  const active = conversations.value.find((item) => item.conversationId === activeConversationId.value)
  return active?.title || '新对话'
})

function scrollToBottom() {
  nextTick(() => {
    if (!chatRef.value) {
      return
    }
    chatRef.value.scrollTop = chatRef.value.scrollHeight
  })
}

function appendMessage(role: ChatRole, content: string, pending = false): ChatMessage {
  const message: ChatMessage = {
    id: ++messageId.value,
    role,
    content,
    pending,
  }
  messages.value.push(message)
  scrollToBottom()
  return message
}

function appendAssistantMessage(): ChatMessage {
  const message: ChatMessage = {
    id: ++messageId.value,
    role: 'assistant',
    content: '',
    thinkingContent: '',
    finalContent: '',
    thinkingPreviewText: '',
    thinkingPreviewSeq: 0,
    thinkingExpanded: false,
    thinkingDone: false,
    pending: true,
  }
  messages.value.push(message)
  scrollToBottom()
  return message
}

function normalizeMessageType(type: string | undefined): string {
  return (type || '').toUpperCase()
}

function mapHistoryToMessages(historyList: ChatMemoryHistory[]): ChatMessage[] {
  const result: ChatMessage[] = []
  for (const item of historyList) {
    const type = normalizeMessageType(item.messageType)
    if (type === 'USER') {
      result.push({
        id: ++messageId.value,
        role: 'user',
        content: item.content || '',
      })
      continue
    }
    if (type === 'ASSISTANT') {
      result.push({
        id: ++messageId.value,
        role: 'assistant',
        content: '',
        thinkingContent: '',
        finalContent: item.content || '',
        thinkingPreviewText: '',
        thinkingPreviewSeq: 0,
        thinkingExpanded: false,
        thinkingDone: true,
      })
    }
  }
  return result
}

function fillPrompt(prompt: string) {
  inputValue.value = prompt
}

async function startNewChat() {
  controller.value?.abort()
  resetStreamState()
  controller.value = null
  loading.value = false
  inputValue.value = ''
  messages.value = []

  if (!isLoggedIn.value) {
    activeConversationId.value = ''
    return
  }

  try {
    const conversationId = await createConversation()
    activeConversationId.value = conversationId
    await loadConversations(false)
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '新建会话失败，请稍后再试。'
  }
}

function toggleModeMenu() {
  showModeMenu.value = !showModeMenu.value
}

function chooseMode(nextMode: 'fast' | 'thinking') {
  mode.value = nextMode
  showModeMenu.value = false
}

function openAuthModal(type: AuthModalType) {
  authModal.value = type
  authError.value = ''
}

function closeAuthModal() {
  if (authLoading.value) {
    return
  }
  authModal.value = 'none'
  authError.value = ''
}

async function submitRegister() {
  const { userAccount, userPassword, checkPassword } = registerForm.value
  if (!userAccount.trim() || !userPassword || !checkPassword) {
    authError.value = '请完整填写账号、密码、确认密码。'
    return
  }
  if (userPassword !== checkPassword) {
    authError.value = '两次输入的密码不一致。'
    return
  }

  authLoading.value = true
  authError.value = ''
  try {
    await userRegister({
      userAccount: userAccount.trim(),
      userPassword,
      checkPassword,
    })
    loginForm.value.userAccount = userAccount.trim()
    loginForm.value.userPassword = ''
    authModal.value = 'login'
    authError.value = '注册成功，请登录。'
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '注册失败，请稍后再试。'
  } finally {
    authLoading.value = false
  }
}

async function submitLogin() {
  const { userAccount, userPassword } = loginForm.value
  if (!userAccount.trim() || !userPassword) {
    authError.value = '请输入账号和密码。'
    return
  }

  authLoading.value = true
  authError.value = ''
  try {
    const data = await userLogin({
      userAccount: userAccount.trim(),
      userPassword,
    })
    currentUser.value = data
    authModal.value = 'none'
    await loadConversations(false)
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '登录失败，请稍后再试。'
  } finally {
    authLoading.value = false
  }
}

async function confirmLogout() {
  authLoading.value = true
  authError.value = ''
  try {
    await userLogout()
    currentUser.value = null
    conversations.value = []
    activeConversationId.value = ''
    authModal.value = 'none'
    startNewChat()
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '注销失败，请稍后再试。'
  } finally {
    authLoading.value = false
  }
}

async function loadConversations(keepCurrentSelection = true) {
  if (!isLoggedIn.value) {
    conversations.value = []
    activeConversationId.value = ''
    return
  }

  conversationLoading.value = true
  try {
    const list = await listMyConversations()
    conversations.value = list

    if (keepCurrentSelection && activeConversationId.value) {
      const exists = list.some((item) => item.conversationId === activeConversationId.value)
      if (!exists) {
        activeConversationId.value = ''
        messages.value = []
      }
    }
  } finally {
    conversationLoading.value = false
  }
}

async function loadConversationHistory(conversationId: string) {
  if (!conversationId) {
    messages.value = []
    return
  }

  historyLoading.value = true
  try {
    const history = await listHistoryByConversation(conversationId)
    messages.value = mapHistoryToMessages(history)
    scrollToBottom()
  } catch (error) {
    messages.value = []
    authError.value = error instanceof Error ? error.message : '加载历史失败，请稍后再试。'
  } finally {
    historyLoading.value = false
  }
}

async function switchConversation(conversationId: string) {
  if (!conversationId || conversationId === activeConversationId.value) {
    return
  }
  activeConversationId.value = conversationId
  await loadConversationHistory(conversationId)
}

async function removeConversation(conversationId: string) {
  if (!conversationId || deletingConversationId.value) {
    return
  }
  pendingDeleteConversationId.value = conversationId
  openAuthModal('deleteConversation')
}

async function confirmDeleteConversation() {
  if (!pendingDeleteConversationId.value || deletingConversationId.value) {
    return
  }

  deletingConversationId.value = pendingDeleteConversationId.value
  authLoading.value = true
  authError.value = ''
  try {
    await deleteConversation({ conversationId: pendingDeleteConversationId.value })
    conversations.value = conversations.value.filter(
      (item) => item.conversationId !== pendingDeleteConversationId.value,
    )
    if (activeConversationId.value === pendingDeleteConversationId.value) {
      activeConversationId.value = ''
      messages.value = []
    }
    pendingDeleteConversationId.value = ''
    authModal.value = 'none'
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '删除会话失败，请稍后再试。'
  } finally {
    deletingConversationId.value = ''
    authLoading.value = false
  }
}

async function submitQuestion() {
  const question = inputValue.value.trim()
  if (!question || loading.value) {
    return
  }

  if (!isLoggedIn.value) {
    openAuthModal('login')
    return
  }

  if (!activeConversationId.value) {
    try {
      activeConversationId.value = await createConversation()
      await loadConversations(false)
    } catch (error) {
      authError.value = error instanceof Error ? error.message : '创建会话失败，请稍后再试。'
      return
    }
  }

  inputValue.value = ''
  appendMessage('user', question)

  const assistantMessage = appendAssistantMessage()
  activeAssistantMessage.value = assistantMessage
  streamChunkBuffer.value = ''
  streamThinkingBuffer.value = ''
  streamFinalBuffer.value = ''

  const payload: AgentCallRequest = {
    question,
    mode: mode.value,
    conversationId: activeConversationId.value,
  }

  loading.value = true
  controller.value = new AbortController()

  try {
    await callAgentStream(
      payload,
      {
        onMessage(chunk) {
          pushStreamChunk(sanitizeThinkingChunk(chunk))
        },
        onError(errorText) {
          const content = `[错误] ${errorText}`
          if (!assistantMessage.finalContent && !streamFinalBuffer.value) {
            pushFinalChunk(content)
          } else {
            pushFinalChunk(`\n\n${content}`)
          }
        },
      },
      controller.value.signal,
    )

    await waitForStreamDrain()
    assistantMessage.thinkingDone = true
    if (!assistantMessage.finalContent?.trim() && !assistantMessage.thinkingContent?.trim()) {
      assistantMessage.finalContent = '已完成本次回答。'
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '请求失败，请稍后再试。'
    if (!assistantMessage.finalContent) {
      pushFinalChunk(errorMessage)
    } else {
      pushFinalChunk(`\n\n${errorMessage}`)
    }
    await waitForStreamDrain()
    assistantMessage.thinkingDone = true
  } finally {
    assistantMessage.pending = false
    loading.value = false
    controller.value = null
    activeAssistantMessage.value = null
    void loadConversations(false)
  }
}

function stopGeneration() {
  controller.value?.abort()
  resetStreamState()
  controller.value = null
  loading.value = false
}

function handleEnter(event: KeyboardEvent) {
  if (event.isComposing) {
    return
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void submitQuestion()
  }
}

function handleGlobalClick(event: MouseEvent) {
  if (!showModeMenu.value || !modeMenuRef.value) {
    return
  }
  const target = event.target as Node | null
  if (target && !modeMenuRef.value.contains(target)) {
    showModeMenu.value = false
  }
}

function runStreamFrame() {
  const target = activeAssistantMessage.value
  if (!target || (streamThinkingBuffer.value.length === 0 && streamFinalBuffer.value.length === 0)) {
    streamRafId.value = null
    return
  }

  if (streamThinkingBuffer.value.length > 0) {
    const batchSize = Math.max(1, Math.min(4, Math.ceil(streamThinkingBuffer.value.length / 24)))
    target.thinkingContent = (target.thinkingContent || '') + streamThinkingBuffer.value.slice(0, batchSize)
    streamThinkingBuffer.value = streamThinkingBuffer.value.slice(batchSize)
  } else {
    const batchSize = Math.max(1, Math.min(4, Math.ceil(streamFinalBuffer.value.length / 24)))
    target.finalContent = (target.finalContent || '') + streamFinalBuffer.value.slice(0, batchSize)
    streamFinalBuffer.value = streamFinalBuffer.value.slice(batchSize)
    target.thinkingDone = true
  }

  scrollToBottom()
  streamRafId.value = window.requestAnimationFrame(runStreamFrame)
}

function pushStreamChunk(chunk: string) {
  if (!chunk) {
    return
  }

  const target = activeAssistantMessage.value
  if (chunk.includes('[思考过程]')) {
    const thinkingText = formatThinkingChunk(chunk)
    if (thinkingText) {
      streamThinkingBuffer.value += thinkingText
      if (target) {
        ingestThinkingPreview(target, thinkingText)
      }
    }
  } else {
    pushFinalChunk(chunk)
  }

  if (target && !target.thinkingContent && streamThinkingBuffer.value.length > 0) {
    target.thinkingContent = streamThinkingBuffer.value.slice(0, 1)
    streamThinkingBuffer.value = streamThinkingBuffer.value.slice(1)
    scrollToBottom()
  }

  if (streamRafId.value === null) {
    streamRafId.value = window.requestAnimationFrame(runStreamFrame)
  }
}

function pushFinalChunk(chunk: string) {
  if (!chunk) {
    return
  }
  const target = activeAssistantMessage.value
  streamFinalBuffer.value += chunk

  if (target && !target.finalContent && streamFinalBuffer.value.length > 0) {
    target.finalContent = streamFinalBuffer.value.slice(0, 1)
    streamFinalBuffer.value = streamFinalBuffer.value.slice(1)
    target.thinkingDone = true
    scrollToBottom()
  }
}

function sanitizeThinkingChunk(chunk: string): string {
  if (!chunk) {
    return ''
  }

  // 兼容旧版后端的思考输出，过滤开发态字段，保留用户可读过程。
  let sanitized = chunk
    .replace(/\[思考过程\]\s+/g, '[思考过程] ')
    .replace(/^\s*success:\s*.*$/gim, '')
    .replace(/^\s*error:\s*N\/A\s*$/gim, '')
    .replace(/^\s*error:\s*null\s*$/gim, '')
    .replace(/^\s*output:\s*/gim, '')
    .replace(/^\s*-\s*taskId:\s*.*$/gim, '')
    .replace(/^\s*taskId:\s*.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')

  if (!sanitized.trim()) {
    return ''
  }

  return sanitized
}

function formatThinkingChunk(chunk: string): string {
  const stripped = chunk
    .replace(/^\[思考过程\](?:\[[^\]]+])?\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return stripped ? `${stripped}\n\n` : ''
}

async function waitForStreamDrain() {
  while (streamThinkingBuffer.value.length > 0 || streamFinalBuffer.value.length > 0 || streamRafId.value !== null) {
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
}

function resetStreamState() {
  if (streamRafId.value !== null) {
    window.cancelAnimationFrame(streamRafId.value)
    streamRafId.value = null
  }
  if (thinkingPreviewTimerId.value !== null) {
    window.clearTimeout(thinkingPreviewTimerId.value)
    thinkingPreviewTimerId.value = null
  }
  streamChunkBuffer.value = ''
  streamThinkingBuffer.value = ''
  streamFinalBuffer.value = ''
  thinkingPreviewQueue.value = []
  thinkingPreviewRemainder.value = ''
  activeAssistantMessage.value = null
}

function toggleThinking(message: ChatMessage) {
  message.thinkingExpanded = !message.thinkingExpanded
}

function thinkingPreview(message: ChatMessage): string {
  if (!message.thinkingPreviewText) {
    return ''
  }
  return message.thinkingPreviewText
}

function ingestThinkingPreview(message: ChatMessage, thinkingText: string) {
  const normalized = thinkingText.replace(/\r/g, '')
  if (!normalized.trim()) {
    return
  }

  thinkingPreviewRemainder.value += normalized
  const tokens = thinkingPreviewRemainder.value.split(/[。！？；、\n]+/)
  thinkingPreviewRemainder.value = tokens.pop() ?? ''

  for (const token of tokens) {
    const sentence = token.replace(/\s+/g, ' ').trim()
    if (sentence) {
      thinkingPreviewQueue.value.push(sentence)
    }
  }

  if (thinkingPreviewTimerId.value === null) {
    showNextThinkingPreview(message)
  }
}

function showNextThinkingPreview(message: ChatMessage) {
  const nextSentence = thinkingPreviewQueue.value.shift()
  if (!nextSentence) {
    thinkingPreviewTimerId.value = null
    return
  }

  message.thinkingPreviewText = nextSentence
  message.thinkingPreviewSeq = (message.thinkingPreviewSeq || 0) + 1
  thinkingPreviewTimerId.value = window.setTimeout(() => {
    if (message.thinkingDone) {
      thinkingPreviewTimerId.value = null
      return
    }
    showNextThinkingPreview(message)
  }, 420)
}

async function fetchCurrentUser() {
  try {
    currentUser.value = await getLoginUser()
    await loadConversations(false)
  } catch {
    currentUser.value = null
    conversations.value = []
    activeConversationId.value = ''
  }
}

onMounted(() => {
  window.addEventListener('click', handleGlobalClick)
  void fetchCurrentUser()
})

onBeforeUnmount(() => {
  controller.value?.abort()
  resetStreamState()
  window.removeEventListener('click', handleGlobalClick)
})
</script>

<template>
  <div class="doubao-shell" :class="{ collapsed: sidebarCollapsed }">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-icon" aria-label="Cloud Cold">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7.4 17h9.2a4 4 0 0 0 .1-8a5 5 0 0 0-9.7 1.3A3.6 3.6 0 0 0 7.4 17z"
              fill="currentColor"
            />
          </svg>
        </div>
        <div>
          <p class="brand-title">Cloud Cold</p>
          <p class="brand-subtitle">Made By ShenChen</p>
        </div>
      </div>

      <button class="new-chat-btn" type="button" @click="startNewChat">+ 新建会话</button>

      <div class="nav-group">
        <p class="nav-title">会话列表</p>
        <div v-if="!isLoggedIn" class="conversation-empty">登录后可查看会话</div>
        <div v-else-if="conversationLoading" class="conversation-empty">会话加载中...</div>
        <div v-else-if="conversations.length === 0" class="conversation-empty">暂无会话</div>
        <button
          v-for="conversation in conversations"
          :key="conversation.conversationId"
          class="conversation-item"
          :class="{ active: activeConversationId === conversation.conversationId }"
          type="button"
          @click="switchConversation(conversation.conversationId)"
        >
          <span class="conversation-title">{{ conversation.title || '新会话' }}</span>
          <span
            class="conversation-delete"
            role="button"
            tabindex="0"
            @click.stop="removeConversation(conversation.conversationId)"
          >
            {{ deletingConversationId === conversation.conversationId ? '...' : '×' }}
          </span>
        </button>
      </div>
    </aside>

    <main class="chat-main">
      <header class="topbar">
        <button class="top-icon-btn" type="button" @click="sidebarCollapsed = !sidebarCollapsed">
          <span class="bars"></span>
        </button>
        <div class="top-center">
          <h1>{{ activeConversationTitle }}</h1>
          <p>内容由 AI 生成，请仔细甄别</p>
        </div>
        <div class="top-right-actions">
          <template v-if="!isLoggedIn">
            <button class="auth-btn secondary" type="button" @click="openAuthModal('register')">注册</button>
            <button class="auth-btn primary" type="button" @click="openAuthModal('login')">登录</button>
          </template>
          <template v-else>
            <div class="user-chip">{{ userLabel }}</div>
          </template>
        </div>
      </header>

      <section ref="chatRef" class="chat-panel" :class="{ empty: !hasMessages }">
        <div class="chat-content">
          <div v-if="historyLoading" class="history-loading">正在加载会话历史...</div>
          <template v-if="hasMessages">
            <article
              v-for="message in messages"
              :key="message.id"
              class="message-row"
              :class="message.role"
            >
              <div class="message-bubble">
                <p class="role-tag">{{ message.role === 'user' ? '你' : '助手' }}</p>
                <template v-if="message.role === 'assistant'">
                  <div v-if="message.thinkingContent" class="thinking-box">
                    <button class="thinking-header" type="button" @click="toggleThinking(message)">
                      <span class="thinking-title">{{ message.thinkingDone ? '已完成思考' : '思考中...' }}</span>
                      <span
                        v-if="!message.thinkingExpanded && !message.thinkingDone"
                        class="thinking-preview-wrap"
                      >
                        <span :key="message.thinkingPreviewSeq" class="thinking-preview-track">
                          {{ thinkingPreview(message) }}
                        </span>
                      </span>
                      <span class="thinking-arrow" :class="{ expanded: message.thinkingExpanded }">›</span>
                    </button>
                    <div v-if="message.thinkingExpanded" class="thinking-body">
                      {{ message.thinkingContent }}
                    </div>
                  </div>
                  <p v-if="message.finalContent" class="message-content">{{ message.finalContent }}</p>
                </template>
                <template v-else>
                  <p class="message-content">{{ message.content }}</p>
                </template>
                <p v-if="message.pending" class="typing">正在生成...</p>
              </div>
            </article>
          </template>

          <template v-else>
            <div class="empty-state">
              <h2>有什么我能帮你的吗？</h2>
              <div class="suggestion-grid">
                <button
                  v-for="prompt in starterPrompts"
                  :key="prompt"
                  type="button"
                  class="suggestion-chip"
                  @click="fillPrompt(prompt)"
                >
                  {{ prompt }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </section>

      <footer class="composer-wrap">
        <div class="composer">
          <textarea
            v-model="inputValue"
            class="composer-input"
            placeholder="发消息..."
            @keydown="handleEnter"
          />
          <div class="composer-toolbar">
            <div class="left-tools">
              <button class="tool-btn" type="button" aria-label="更多">+</button>

              <div ref="modeMenuRef" class="mode-picker">
                <button class="mode-trigger" type="button" @click.stop="toggleModeMenu">
                  <span>⚡ {{ modeLabel }}</span>
                  <span class="arrow">›</span>
                </button>

                <div v-if="showModeMenu" class="mode-dropdown">
                  <button
                    v-for="item in modeOptions"
                    :key="item.value"
                    type="button"
                    class="mode-item"
                    :class="{ active: mode === item.value }"
                    @click="chooseMode(item.value)"
                  >
                    <div class="mode-item-main">{{ item.label }}</div>
                    <div class="mode-item-desc">{{ item.desc }}</div>
                  </button>
                </div>
              </div>
            </div>

            <div class="right-tools">
              <button v-if="loading" type="button" class="send-btn ghost" @click="stopGeneration">
                停止
              </button>
              <button type="button" class="send-btn" :disabled="!canSubmit" @click="submitQuestion">
                发送
              </button>
            </div>
          </div>
        </div>
      </footer>
    </main>

    <button
      v-if="isLoggedIn"
      type="button"
      class="logout-floating"
      @click="openAuthModal('logout')"
    >
      退出登录
    </button>

    <div v-if="authModal !== 'none'" class="modal-mask" @click="closeAuthModal">
      <div class="modal-card" @click.stop>
        <template v-if="authModal === 'register'">
          <h3>注册账号</h3>
          <label class="field">
            <span>账号</span>
            <input v-model="registerForm.userAccount" type="text" placeholder="请输入账号" />
          </label>
          <label class="field">
            <span>密码</span>
            <input v-model="registerForm.userPassword" type="password" placeholder="请输入密码" />
          </label>
          <label class="field">
            <span>确认密码</span>
            <input v-model="registerForm.checkPassword" type="password" placeholder="请再次输入密码" />
          </label>
          <p v-if="authError" class="error-tip">{{ authError }}</p>
          <div class="modal-actions">
            <button class="text-btn" type="button" @click="closeAuthModal">取消</button>
            <button class="solid-btn" type="button" :disabled="authLoading" @click="submitRegister">
              {{ authLoading ? '提交中...' : '确认注册' }}
            </button>
          </div>
        </template>

        <template v-else-if="authModal === 'login'">
          <h3>登录账号</h3>
          <label class="field">
            <span>账号</span>
            <input v-model="loginForm.userAccount" type="text" placeholder="请输入账号" />
          </label>
          <label class="field">
            <span>密码</span>
            <input v-model="loginForm.userPassword" type="password" placeholder="请输入密码" />
          </label>
          <p v-if="authError" class="error-tip">{{ authError }}</p>
          <div class="modal-actions">
            <button class="text-btn" type="button" @click="openAuthModal('register')">去注册</button>
            <button class="solid-btn" type="button" :disabled="authLoading" @click="submitLogin">
              {{ authLoading ? '登录中...' : '确认登录' }}
            </button>
          </div>
        </template>

        <template v-else-if="authModal === 'logout'">
          <h3>退出登录</h3>
          <p class="logout-desc">确定退出登录？</p>
          <p v-if="authError" class="error-tip">{{ authError }}</p>
          <div class="modal-actions">
            <button class="text-btn" type="button" @click="closeAuthModal">取消</button>
            <button class="solid-btn" type="button" :disabled="authLoading" @click="confirmLogout">
              {{ authLoading ? '处理中...' : '确认退出' }}
            </button>
          </div>
        </template>

        <template v-else>
          <h3>删除会话</h3>
          <p class="logout-desc">确定删除该会话？删除后将无法恢复。</p>
          <p v-if="authError" class="error-tip">{{ authError }}</p>
          <div class="modal-actions">
            <button class="text-btn" type="button" @click="closeAuthModal">取消</button>
            <button class="solid-btn" type="button" :disabled="authLoading" @click="confirmDeleteConversation">
              {{ authLoading ? '处理中...' : '确认删除' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.doubao-shell {
  --bg: #f5f5f6;
  --panel: #ffffff;
  --line: #e3e3e6;
  --text: #171717;
  --muted: #8c8c92;
  min-height: 100vh;
  display: grid;
  grid-template-columns: 270px 1fr;
  background: var(--bg);
  color: var(--text);
  transition: grid-template-columns 0.22s ease;
}

.doubao-shell.collapsed {
  grid-template-columns: 1fr;
}

.doubao-shell.collapsed .sidebar {
  display: none;
}

.sidebar {
  border-right: 1px solid var(--line);
  background: #f7f7f8;
  padding: 1.2rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow: hidden;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.35rem;
}

.brand-icon {
  width: 2rem;
  height: 2rem;
  border-radius: 0.7rem;
  background: #111;
  color: #fff;
  display: grid;
  place-items: center;
}

.brand-icon svg {
  width: 1.2rem;
  height: 1.2rem;
}

.brand-title {
  font: 700 1rem/1.1 'Avenir Next', 'PingFang SC', sans-serif;
}

.brand-subtitle {
  margin-top: 0.12rem;
  color: var(--muted);
  font-size: 0.75rem;
}

.new-chat-btn,
.quick-prompt-btn {
  border: 1px solid var(--line);
  background: #fff;
  color: #262626;
  border-radius: 0.8rem;
  text-align: left;
  transition: all 0.2s ease;
}

.new-chat-btn {
  padding: 0.68rem 0.82rem;
  font-weight: 600;
}

.new-chat-btn:hover,
.quick-prompt-btn:hover {
  border-color: #cfcfd4;
  transform: translateY(-1px);
}

.nav-group {
  display: grid;
  gap: 0.5rem;
}

.nav-title {
  color: var(--muted);
  font-size: 0.76rem;
  padding: 0 0.15rem;
}

.quick-prompt-btn {
  padding: 0.65rem 0.68rem;
  font-size: 0.83rem;
  line-height: 1.35;
}

.conversation-empty {
  color: #8d8d95;
  font-size: 0.8rem;
  padding: 0.35rem 0.3rem;
}

.conversation-item {
  border: 1px solid var(--line);
  background: #fff;
  color: #222;
  border-radius: 0.75rem;
  padding: 0.52rem 0.6rem;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  cursor: pointer;
}

.conversation-item.active {
  border-color: #111;
}

.conversation-title {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conversation-delete {
  color: #8b8b92;
  font-size: 0.95rem;
  line-height: 1;
}

.conversation-delete:hover {
  color: #2f2f33;
}

.chat-main {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-width: 0;
  height: 100vh;
  background: #fff;
}

.topbar {
  height: 64px;
  border-bottom: 1px solid var(--line);
  display: grid;
  grid-template-columns: 48px 1fr auto;
  align-items: center;
  padding: 0 0.7rem;
  background: #fff;
}

.top-icon-btn {
  width: 34px;
  height: 34px;
  border: 1px solid #d8d8dc;
  border-radius: 999px;
  background: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.top-icon-btn:hover {
  background: #f3f3f5;
  border-color: #c7c7ce;
  transform: translateY(-1px);
}

.bars {
  position: relative;
  display: inline-block;
  width: 14px;
  height: 2px;
  background: #404047;
  border-radius: 999px;
}

.bars::before,
.bars::after {
  content: '';
  position: absolute;
  left: 0;
  width: 14px;
  height: 2px;
  background: #404047;
  border-radius: 999px;
}

.bars::before {
  top: -5px;
}

.bars::after {
  top: 5px;
}

.top-center {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transform: translateY(4px);
  text-align: center;
}

.top-center h1 {
  font: 600 0.9rem/1.15 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  color: #4f4f57;
}

.top-center p {
  margin-top: 0.08rem;
  font-size: 0.72rem;
  color: #b0b0b6;
  line-height: 1.15;
}

.top-right-actions {
  min-width: 132px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.45rem;
}

.auth-btn {
  border-radius: 999px;
  border: 1px solid #d8d8dc;
  background: #fff;
  color: #2c2c31;
  font-size: 0.82rem;
  height: 32px;
  padding: 0 0.9rem;
  cursor: pointer;
}

.auth-btn.primary {
  background: #151518;
  border-color: #151518;
  color: #fff;
}

.user-chip {
  border-radius: 999px;
  border: 1px solid #dadadd;
  background: #fff;
  color: #33333a;
  padding: 0.35rem 0.72rem;
  font-size: 0.78rem;
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-panel {
  overflow: auto;
  padding: 1.2rem 1.2rem 0.8rem;
  background: #fff;
}

.chat-panel.empty {
  padding-bottom: 8rem;
}

.chat-content {
  width: min(920px, calc(100% - 4px));
  margin: 0 auto;
}

.history-loading {
  color: #8e8e96;
  font-size: 0.85rem;
  margin-bottom: 0.8rem;
}

.empty-state {
  max-width: 100%;
  width: 100%;
  text-align: center;
  padding-top: max(8vh, 3rem);
}

.empty-state h2 {
  font: 700 2.9rem/1.2 'Avenir Next', 'PingFang SC', sans-serif;
  letter-spacing: -0.02em;
}

.suggestion-grid {
  margin-top: 1.5rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.65rem;
}

.suggestion-chip {
  border: none;
  border-radius: 0.72rem;
  background: #ececee;
  color: #323235;
  padding: 0.58rem 0.9rem;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.suggestion-chip:hover {
  background: #e3e3e6;
}

.message-row {
  display: flex;
  margin-bottom: 0.85rem;
}

.message-row.user {
  justify-content: flex-end;
}

.message-bubble {
  max-width: 92%;
  padding: 0.75rem 0.95rem;
  border-radius: 0.9rem;
  border: 1px solid var(--line);
  background: #fff;
}

.message-row.assistant .message-bubble {
  width: 100%;
  max-width: 100%;
}

.message-row.user .message-bubble {
  background: #f7f7f8;
  border-color: #d8d8dc;
  color: #222;
}

.role-tag {
  font-size: 0.75rem;
  opacity: 0.75;
  margin-bottom: 0.2rem;
}

.message-content {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: 0.95rem;
}

.thinking-box {
  border: 1px solid #e1e1e6;
  border-radius: 0.75rem;
  background: #fafafc;
  margin-bottom: 0.62rem;
  overflow: hidden;
}

.thinking-header {
  width: 100%;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.52rem 0.68rem;
  color: #4b5563;
  font-size: 0.84rem;
  cursor: pointer;
}

.thinking-title {
  flex: 0 0 auto;
}

.thinking-preview-wrap {
  display: block;
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  height: 1.25rem;
  color: #6b7280;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 14%, black 86%, transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0, black 14%, black 86%, transparent 100%);
}

.thinking-preview-track {
  display: block;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  line-height: 1.25rem;
  animation: thinking-vertical-once 0.32s ease-out;
}

.thinking-arrow {
  flex: 0 0 auto;
  font-size: 1rem;
  color: #7b7f89;
  transform: rotate(90deg);
  transition: transform 0.2s ease;
}

.thinking-arrow.expanded {
  transform: rotate(-90deg);
}

.thinking-body {
  border-top: 1px solid #ececf0;
  padding: 0.55rem 0.68rem 0.62rem;
  white-space: pre-wrap;
  color: #5f6470;
  font-size: 0.84rem;
  line-height: 1.55;
  max-height: 14rem;
  overflow: auto;
}

@keyframes thinking-vertical-once {
  from {
    transform: translateY(85%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.typing {
  margin-top: 0.3rem;
  font-size: 0.8rem;
  color: #71717a;
}

.composer-wrap {
  padding: 0 1rem 1rem;
  background: #fff;
}

.composer {
  width: min(920px, calc(100% - 4px));
  margin: 0 auto;
  border: 1px solid #111;
  border-radius: 1.45rem;
  background: #fff;
  box-shadow: 0 3px 18px rgba(0, 0, 0, 0.05);
  padding: 0.66rem 0.78rem 0.58rem;
}

.composer-input {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  min-height: 44px;
  max-height: 112px;
  padding: 0.35rem 0.38rem;
  font: 500 1rem/1.45 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  color: #1e1e1f;
  background: transparent;
}

.composer-input::placeholder {
  color: #b2b2b8;
}

.composer-toolbar {
  margin-top: 0.28rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
}

.left-tools {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.tool-btn {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 999px;
  background: #f0f0f2;
  color: #26262a;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.mode-picker {
  position: relative;
}

.mode-trigger {
  height: 34px;
  border: none;
  border-radius: 999px;
  background: #efeff1;
  color: #242428;
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  padding: 0 0.78rem;
  cursor: pointer;
  font-size: 1rem;
}

.arrow {
  font-size: 1.15rem;
  line-height: 1;
  color: #7d7d83;
}

.mode-dropdown {
  position: absolute;
  left: 0;
  bottom: calc(100% + 0.5rem);
  width: 225px;
  border: 1px solid #dddddf;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
  padding: 0.4rem;
  z-index: 20;
}

.mode-item {
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 0.7rem;
  text-align: left;
  padding: 0.5rem 0.58rem;
  cursor: pointer;
}

.mode-item:hover {
  background: #f3f3f4;
}

.mode-item.active {
  background: #f0f0f2;
}

.mode-item-main {
  font-size: 1rem;
  color: #202024;
}

.mode-item-desc {
  margin-top: 0.12rem;
  font-size: 0.82rem;
  color: #8e8e95;
}

.right-tools {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.send-btn {
  border: none;
  height: 34px;
  min-width: 62px;
  border-radius: 999px;
  background: #111;
  color: #fff;
  font-size: 0.92rem;
  padding: 0 0.86rem;
  cursor: pointer;
}

.send-btn:disabled {
  background: #bcbcc2;
  cursor: not-allowed;
}

.send-btn.ghost {
  background: #f0f0f3;
  color: #2c2c30;
}

.logout-floating {
  position: fixed;
  left: 1rem;
  bottom: 1rem;
  border: 1px solid #d8d8dd;
  border-radius: 999px;
  background: #fff;
  color: #2f2f35;
  padding: 0.45rem 0.88rem;
  font-size: 0.82rem;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
  z-index: 30;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 24, 0.25);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  z-index: 60;
}

.modal-card {
  width: min(420px, calc(100% - 2rem));
  border: 1px solid #dbdbe0;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.18);
  padding: 1rem;
}

.modal-card h3 {
  font-size: 1rem;
  color: #202024;
  margin-bottom: 0.8rem;
}

.field {
  display: grid;
  gap: 0.35rem;
  margin-bottom: 0.7rem;
}

.field span {
  font-size: 0.82rem;
  color: #66666f;
}

.field input {
  border: 1px solid #dddde3;
  border-radius: 0.72rem;
  padding: 0.58rem 0.7rem;
  font-size: 0.9rem;
  outline: none;
}

.field input:focus {
  border-color: #a3a3ad;
}

.error-tip {
  font-size: 0.8rem;
  color: #ca3a3a;
  margin: 0.3rem 0 0.5rem;
  min-height: 1rem;
}

.logout-desc {
  color: #494952;
  margin-bottom: 0.7rem;
}

.modal-actions {
  margin-top: 0.3rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.text-btn,
.solid-btn {
  border-radius: 0.7rem;
  height: 34px;
  padding: 0 0.9rem;
  cursor: pointer;
  font-size: 0.84rem;
}

.text-btn {
  border: 1px solid #dddde2;
  background: #fff;
  color: #3a3a41;
}

.solid-btn {
  border: 1px solid #111;
  background: #111;
  color: #fff;
}

.solid-btn:disabled {
  background: #9c9ca3;
  border-color: #9c9ca3;
  cursor: not-allowed;
}

@media (max-width: 960px) {
  .doubao-shell,
  .doubao-shell.collapsed {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .topbar {
    grid-template-columns: 42px 1fr auto;
  }

  .top-right-actions {
    min-width: 0;
  }

  .empty-state h2 {
    font-size: 2rem;
  }

  .composer-wrap {
    padding: 0 0.55rem 0.7rem;
  }

  .composer {
    width: 100%;
  }

  .auth-btn {
    padding: 0 0.72rem;
  }
}
</style>
