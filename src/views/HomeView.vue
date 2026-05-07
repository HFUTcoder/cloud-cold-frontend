<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { AGENT_MODE_LABELS, AGENT_MODES, type AgentMode } from '@/constants/agent'
import KnowledgeWorkspace from '@/components/knowledge/KnowledgeWorkspace.vue'
import PetMemoryWidget from '@/components/pet/PetMemoryWidget.vue'
import { callAgentStream, resumeAgentStream } from '@/api/agent'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listHistoryByConversation,
  listMyConversations,
  updateConversationKnowledge,
  updateConversationSkills,
} from '@/api/chat'
import { getHitlCheckpoint, resolveHitlCheckpoint } from '@/api/hitl'
import { listMyKnowledgeByPage } from '@/api/knowledge'
import { listSkills } from '@/api/skill'
import { getLoginUser, userLogin, userLogout, userRegister } from '@/api/user'
import type {
  AgentCallRequest,
  AgentErrorPayload,
  AgentFinalAnswerPayload,
  AgentHitlInterruptPayload,
  AgentKnowledgeRetrievalPayload,
  AgentStreamEvent,
  AgentThinkingStepPayload,
  PendingToolCall,
  RetrievedKnowledgeImage,
} from '@/types/agent'
import type { ChatConversation, ChatMemoryHistory } from '@/types/chat'
import type { HitlCheckpointResolveRequest } from '@/types/hitl'
import type { KnowledgeVO } from '@/types/knowledge'
import type { SkillMetadataVO } from '@/types/skill'
import type { LoginUserVO } from '@/types/user'

type ChatRole = 'user' | 'assistant'
type AuthModalType = 'none' | 'register' | 'login' | 'logout' | 'deleteConversation'
type AgentRunStatus = 'idle' | 'calling' | 'interrupted' | 'resolving' | 'resuming' | 'finished' | 'error'

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
  retrievedImages?: RetrievedKnowledgeImage[]
}

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

interface HitlArgumentEditor {
  value: JsonValue | null
  parseError: string
}

interface HitlArgumentSpecRecord {
  name?: string
  displayName?: string
  type?: string
  required?: boolean
  defaultValue?: JsonValue
}

interface HitlArgumentField {
  path: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'null'
  value: JsonPrimitive
  required?: boolean
}

const chatRef = ref<HTMLElement | null>(null)
const modeMenuRef = ref<HTMLElement | null>(null)
const skillMenuRef = ref<HTMLElement | null>(null)
const knowledgeAskMenuRef = ref<HTMLElement | null>(null)
const composerInputRef = ref<HTMLTextAreaElement | null>(null)
const inputValue = ref('')
const mode = ref<AgentMode>(AGENT_MODES.FAST)
const showModeMenu = ref(false)
const sidebarCollapsed = ref(false)
const knowledgeQaMode = ref(false)
const loading = ref(false)
const authLoading = ref(false)
const authError = ref('')
const authModal = ref<AuthModalType>('none')
const controller = ref<AbortController | null>(null)
const messageId = ref(0)
const currentUser = ref<LoginUserVO | null>(null)
const streamRafId = ref<number | null>(null)
const activeAssistantMessage = ref<ChatMessage | null>(null)
const streamThinkingBuffer = ref('')
const streamFinalBuffer = ref('')
const thinkingPreviewQueue = ref<string[]>([])
const thinkingPreviewRemainder = ref('')
const thinkingPreviewTimerId = ref<number | null>(null)
const agentRunStatus = ref<AgentRunStatus>('idle')
const currentInterruptId = ref('')
const showHitlModal = ref(false)
const hitlToolCalls = ref<PendingToolCall[]>([])
const hitlFeedbacks = ref<PendingToolCall[]>([])
const hitlArgumentEditors = ref<Record<string, HitlArgumentEditor>>({})
const interruptedAssistantMessage = ref<ChatMessage | null>(null)
const showRetrievedImagePreview = ref(false)
const retrievedImagePreviewUrl = ref('')
const retrievedImagePreviewTitle = ref('')

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
const showSkillMenu = ref(false)
const skillListLoading = ref(false)
const skillBindingLoading = ref(false)
const showKnowledgeAskMenu = ref(false)
const knowledgeAskListLoading = ref(false)
const knowledgeBindingLoading = ref(false)
const skills = ref<SkillMetadataVO[]>([])
const knowledgeOptions = ref<KnowledgeVO[]>([])
const hoveredSkillName = ref('')
const selectedSkillName = ref('')
const selectedKnowledgeId = ref<number | null>(null)
const selectedKnowledgeName = ref('')

const starterPrompts = [
  '如何利用 AI Agent 优化日常办公自动化流程？',
  '解释过程模式在项目管理中的作用',
  '帮我规划一份新的前端项目结构',
  '解释这段报错并给出修复方案',
  '把接口文档转换成前端调用代码',
  '给我一份高可维护的代码评审清单',
]

const modeOptions: Array<{ label: string; value: AgentMode; desc: string }> = [
  { label: AGENT_MODE_LABELS[AGENT_MODES.FAST], value: AGENT_MODES.FAST, desc: '适用于大部分情况' },
  { label: AGENT_MODE_LABELS[AGENT_MODES.THINKING], value: AGENT_MODES.THINKING, desc: '擅长解决更难的问题' },
]

const hasMessages = computed(() => messages.value.length > 0)
const canSubmit = computed(() => inputValue.value.trim().length > 0 && !loading.value)
const modeLabel = computed(() => AGENT_MODE_LABELS[mode.value] ?? AGENT_MODE_LABELS[AGENT_MODES.FAST])
const isLoggedIn = computed(() => currentUser.value !== null)
const userLabel = computed(() => currentUser.value?.userName || currentUser.value?.userAccount || '')
const activeConversationTitle = computed(() => {
  if (!activeConversationId.value) {
    return '新对话'
  }
  const active = conversations.value.find((item) => item.conversationId === activeConversationId.value)
  return active?.title || '新对话'
})
const pageTitle = computed(() => (knowledgeQaMode.value ? '知识库工作台' : activeConversationTitle.value))
const pageSubtitle = computed(() =>
  knowledgeQaMode.value ? '上传文档、查看状态与整理知识库' : '内容由 AI 生成，请仔细甄别',
)
const hoveredSkill = computed(() => {
  const name = hoveredSkillName.value || selectedSkillName.value
  return skills.value.find((item) => item.name === name)
})

const orderedListPattern = /^\s*\d+\.\s+/
const unorderedListPattern = /^\s*[-*+]\s+/
const headingPattern = /^(#{1,6})\s+(.*)$/
const fencePattern = /^```([\w-]*)\s*$/
const quotePattern = /^\s*>\s?/
const hrPattern = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/

function resolveSelectedSkills(conversation: ChatConversation | undefined): string[] {
  if (!conversation) {
    return []
  }
  if (Array.isArray(conversation.selectedSkillList) && conversation.selectedSkillList.length > 0) {
    return conversation.selectedSkillList
  }
  return []
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) {
    return ''
  }
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return trimmed
  }
  return ''
}

function renderMarkdownInline(source: string): string {
  const placeholders: string[] = []
  const store = (html: string) => {
    const token = `@@MD_TOKEN_${placeholders.length}@@`
    placeholders.push(html)
    return token
  }

  let output = source

  output = output.replace(/`([^`\n]+)`/g, (_, code: string) => store(`<code>${escapeHtml(code)}</code>`))
  output = output.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => {
    const safeUrl = sanitizeUrl(url)
    if (!safeUrl) {
      return `${label} (${url})`
    }
    return store(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`,
    )
  })

  output = escapeHtml(output)
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  output = output.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  output = output.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  output = output.replace(/(^|[^\w\\])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  output = output.replace(/(^|[^\w\\])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')

  return output.replace(/@@MD_TOKEN_(\d+)@@/g, (_, index: string) => placeholders[Number(index)] ?? '')
}

function collectParagraph(lines: string[], start: number): { html: string; nextIndex: number } {
  const buffer: string[] = []
  let index = start

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      break
    }
    if (
      fencePattern.test(line) ||
      headingPattern.test(line) ||
      orderedListPattern.test(line) ||
      unorderedListPattern.test(line) ||
      quotePattern.test(line) ||
      hrPattern.test(line)
    ) {
      break
    }
    buffer.push(line.trimEnd())
    index += 1
  }

  const html = `<p>${buffer.map((line) => renderMarkdownInline(line)).join('<br />')}</p>`
  return { html, nextIndex: index }
}

function renderMarkdown(source: string | undefined): string {
  if (!source?.trim()) {
    return ''
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const fenceMatch = line.match(fencePattern)
    if (fenceMatch) {
      const language = fenceMatch[1]?.trim()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : ''
      blocks.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    const headingMatch = line.match(headingPattern)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6)
      blocks.push(`<h${level}>${renderMarkdownInline(headingMatch[2].trim())}</h${level}>`)
      index += 1
      continue
    }

    if (hrPattern.test(line)) {
      blocks.push('<hr />')
      index += 1
      continue
    }

    if (quotePattern.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && quotePattern.test(lines[index])) {
        quoteLines.push(lines[index].replace(quotePattern, ''))
        index += 1
      }
      blocks.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`)
      continue
    }

    if (unorderedListPattern.test(line)) {
      const items: string[] = []
      while (index < lines.length && unorderedListPattern.test(lines[index])) {
        items.push(`<li>${renderMarkdownInline(lines[index].replace(unorderedListPattern, '').trim())}</li>`)
        index += 1
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (orderedListPattern.test(line)) {
      const items: string[] = []
      while (index < lines.length && orderedListPattern.test(lines[index])) {
        items.push(`<li>${renderMarkdownInline(lines[index].replace(orderedListPattern, '').trim())}</li>`)
        index += 1
      }
      blocks.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    const paragraph = collectParagraph(lines, index)
    blocks.push(paragraph.html)
    index = paragraph.nextIndex
  }

  return blocks.join('')
}

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
    retrievedImages: [],
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
        retrievedImages: Array.isArray(item.retrievedImages) ? item.retrievedImages : [],
      })
    }
  }
  return result
}

function fillPrompt(prompt: string) {
  inputValue.value = prompt
}

function removeKnowledgeQuestionPrefix(text: string) {
  return text.replace(/^请根据(?:.+?)?知识库回答：/, '')
}

async function startNewChat() {
  knowledgeQaMode.value = false
  controller.value?.abort()
  resetStreamState()
  controller.value = null
  loading.value = false
  inputValue.value = ''
  messages.value = []
  selectedSkillName.value = ''
  selectedKnowledgeId.value = null
  selectedKnowledgeName.value = ''

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

function showKnowledgeQaPanel() {
  showModeMenu.value = false
  showSkillMenu.value = false
  knowledgeQaMode.value = true
}

function showChatPanel() {
  knowledgeQaMode.value = false
}

function toggleModeMenu() {
  showSkillMenu.value = false
  showKnowledgeAskMenu.value = false
  showModeMenu.value = !showModeMenu.value
}

async function toggleSkillMenu() {
  showModeMenu.value = false
  showKnowledgeAskMenu.value = false
  showSkillMenu.value = !showSkillMenu.value
  if (!showSkillMenu.value) {
    return
  }
  await loadSkills()
  hoveredSkillName.value = selectedSkillName.value
}

async function toggleKnowledgeAskMenu() {
  if (!isLoggedIn.value) {
    openAuthModal('login')
    return
  }
  showModeMenu.value = false
  showSkillMenu.value = false
  showKnowledgeAskMenu.value = !showKnowledgeAskMenu.value
  if (!showKnowledgeAskMenu.value) {
    return
  }
  await loadKnowledgeOptions()
}

function chooseMode(nextMode: AgentMode) {
  mode.value = nextMode
  showModeMenu.value = false
}

async function loadSkills() {
  if (skills.value.length > 0) {
    return
  }
  skillListLoading.value = true
  try {
    skills.value = await listSkills()
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '加载 skill 列表失败，请稍后再试。'
  } finally {
    skillListLoading.value = false
  }
}

async function loadKnowledgeOptions() {
  knowledgeAskListLoading.value = true
  try {
    const page = await listMyKnowledgeByPage({
      pageNum: 1,
      pageSize: 100,
      sortField: 'updateTime',
      sortOrder: 'descend',
    })
    knowledgeOptions.value = page.records ?? []
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '加载知识库列表失败，请稍后再试。'
    knowledgeOptions.value = []
  } finally {
    knowledgeAskListLoading.value = false
  }
}

async function bindKnowledge(knowledge: KnowledgeVO) {
  if (!isLoggedIn.value) {
    openAuthModal('login')
    return
  }
  if (knowledgeBindingLoading.value) {
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

  knowledgeBindingLoading.value = true
  authError.value = ''
  try {
    await updateConversationKnowledge(activeConversationId.value, knowledge.id)
    selectedKnowledgeId.value = knowledge.id
    selectedKnowledgeName.value = knowledge.knowledgeName
    inputValue.value = removeKnowledgeQuestionPrefix(inputValue.value)
    conversations.value = conversations.value.map((item) =>
      item.conversationId === activeConversationId.value
        ? {
            ...item,
            selectedKnowledgeId: knowledge.id,
            selectedKnowledgeName: knowledge.knowledgeName,
          }
        : item,
    )
    showKnowledgeAskMenu.value = false
    nextTick(() => {
      composerInputRef.value?.focus()
    })
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '绑定知识库失败，请稍后再试。'
  } finally {
    knowledgeBindingLoading.value = false
  }
}

async function unbindKnowledge() {
  if (!activeConversationId.value || knowledgeBindingLoading.value) {
    return
  }
  knowledgeBindingLoading.value = true
  authError.value = ''
  try {
    await updateConversationKnowledge(activeConversationId.value, null)
    selectedKnowledgeId.value = null
    selectedKnowledgeName.value = ''
    conversations.value = conversations.value.map((item) =>
      item.conversationId === activeConversationId.value
        ? {
            ...item,
            selectedKnowledgeId: undefined,
            selectedKnowledgeName: undefined,
          }
        : item,
    )
    showKnowledgeAskMenu.value = false
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '解除知识库绑定失败，请稍后再试。'
  } finally {
    knowledgeBindingLoading.value = false
  }
}

async function bindSkill(skillName: string) {
  if (!isLoggedIn.value) {
    openAuthModal('login')
    return
  }
  if (!activeConversationId.value) {
    authError.value = '请先新建会话或发送消息后再绑定 skill。'
    return
  }
  if (skillBindingLoading.value) {
    return
  }

  skillBindingLoading.value = true
  authError.value = ''
  try {
    await updateConversationSkills(activeConversationId.value, [skillName])
    selectedSkillName.value = skillName
    conversations.value = conversations.value.map((item) =>
      item.conversationId === activeConversationId.value
        ? { ...item, selectedSkillList: [skillName] }
        : item,
    )
    showSkillMenu.value = false
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '绑定 skill 失败，请稍后再试。'
  } finally {
    skillBindingLoading.value = false
  }
}

async function unbindSkill() {
  if (!activeConversationId.value || skillBindingLoading.value) {
    return
  }
  skillBindingLoading.value = true
  authError.value = ''
  try {
    await updateConversationSkills(activeConversationId.value, [])
    selectedSkillName.value = ''
    conversations.value = conversations.value.map((item) =>
      item.conversationId === activeConversationId.value
        ? { ...item, selectedSkillList: [] }
        : item,
    )
    showSkillMenu.value = false
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '解除 skill 绑定失败，请稍后再试。'
  } finally {
    skillBindingLoading.value = false
  }
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
    selectedSkillName.value = ''
    selectedKnowledgeId.value = null
    selectedKnowledgeName.value = ''
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
    selectedSkillName.value = ''
    selectedKnowledgeId.value = null
    selectedKnowledgeName.value = ''
    return
  }

  conversationLoading.value = true
  try {
    const list = await listMyConversations()
    conversations.value = list

    if (activeConversationId.value) {
      const exists = list.some((item) => item.conversationId === activeConversationId.value)
      if (!exists) {
        activeConversationId.value = ''
        messages.value = []
        selectedSkillName.value = ''
        selectedKnowledgeId.value = null
        selectedKnowledgeName.value = ''
      } else {
        await syncActiveConversationDetail(activeConversationId.value)
      }
    } else if (!keepCurrentSelection) {
      selectedSkillName.value = ''
      selectedKnowledgeId.value = null
      selectedKnowledgeName.value = ''
    }
  } finally {
    conversationLoading.value = false
  }
}

async function syncActiveConversationDetail(conversationId: string) {
  if (!conversationId) {
    selectedSkillName.value = ''
    selectedKnowledgeId.value = null
    selectedKnowledgeName.value = ''
    return
  }
  try {
    const detail = await getConversation(conversationId)
    conversations.value = conversations.value.map((item) =>
      item.conversationId === conversationId ? { ...item, ...detail } : item,
    )
    selectedSkillName.value = resolveSelectedSkills(detail)[0] || ''
    selectedKnowledgeId.value = detail.selectedKnowledgeId ?? null
    selectedKnowledgeName.value = detail.selectedKnowledgeName || ''
  } catch {
    const active = conversations.value.find((item) => item.conversationId === conversationId)
    selectedSkillName.value = resolveSelectedSkills(active)[0] || ''
    selectedKnowledgeId.value = active?.selectedKnowledgeId ?? null
    selectedKnowledgeName.value = active?.selectedKnowledgeName || ''
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
  knowledgeQaMode.value = false
  activeConversationId.value = conversationId
  await syncActiveConversationDetail(conversationId)
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
      selectedSkillName.value = ''
      selectedKnowledgeId.value = null
      selectedKnowledgeName.value = ''
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

function toThinkingText(payload: AgentThinkingStepPayload): string {
  const stage = payload.stage ? `[${payload.stage}] ` : ''
  const title = payload.title?.trim() || 'Thinking'
  const content = payload.content?.trim() || ''
  return content ? `${stage}${title}\n${content}\n\n` : `${stage}${title}\n\n`
}

function ensureToolCallArgumentsString(value: string): string {
  if (!value) {
    return ''
  }
  return value
}

function parseToolArguments(value: string): HitlArgumentEditor {
  const raw = ensureToolCallArgumentsString(value).trim()
  if (!raw) {
    return { value: {}, parseError: '' }
  }
  try {
    const parsed = JSON.parse(raw) as JsonValue
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const parsedRecord = parsed as Record<string, JsonValue>
      const nestedArguments = parsedRecord.arguments
      if (typeof nestedArguments === 'string') {
        try {
          parsedRecord.arguments = JSON.parse(nestedArguments) as JsonValue
        } catch {
          // ignore: keep original string when nested JSON parsing fails
        }
      }
      const argumentSpecs = parsedRecord.argumentSpecs
      if (argumentSpecs && typeof argumentSpecs === 'object' && !Array.isArray(argumentSpecs)) {
        const specRecord = argumentSpecs as Record<string, HitlArgumentSpecRecord>
        const currentArguments =
          parsedRecord.arguments && typeof parsedRecord.arguments === 'object' && !Array.isArray(parsedRecord.arguments)
            ? { ...(parsedRecord.arguments as Record<string, JsonValue>) }
            : {}
        for (const [argumentName, spec] of Object.entries(specRecord)) {
          if (currentArguments[argumentName] !== undefined) {
            continue
          }
          if (spec && Object.prototype.hasOwnProperty.call(spec, 'defaultValue')) {
            currentArguments[argumentName] = spec.defaultValue ?? null
            continue
          }
          const typeHint = (spec?.type || '').toLowerCase()
          if (typeHint === 'number') {
            currentArguments[argumentName] = 0
          } else if (typeHint === 'boolean') {
            currentArguments[argumentName] = false
          } else {
            currentArguments[argumentName] = ''
          }
        }
        parsedRecord.arguments = currentArguments
      }
    }
    return { value: parsed, parseError: '' }
  } catch {
    return { value: null, parseError: 'arguments 不是合法 JSON，无法结构化展示。' }
  }
}

function parsePath(path: string): Array<string | number> {
  const normalized = path.replace(/\[(\d+)\]/g, '.$1')
  return normalized
    .split('.')
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment))
}

function setValueByPath(source: JsonValue, path: string, nextValue: JsonPrimitive): JsonValue {
  const tokens = parsePath(path)
  if (tokens.length === 0) {
    return nextValue
  }

  const cloned: JsonValue =
    source === null
      ? {}
      : Array.isArray(source)
        ? [...source]
        : typeof source === 'object'
          ? { ...source }
          : {}

  let cursor: JsonValue = cloned
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]
    const nextToken = tokens[index + 1]
    const nextContainer: JsonValue = typeof nextToken === 'number' ? [] : {}

    if (Array.isArray(cursor)) {
      const arrayToken = typeof token === 'number' ? token : Number(token)
      const current: JsonValue | undefined = cursor[arrayToken]
      const value: JsonValue =
        current === null
          ? nextContainer
          : Array.isArray(current)
            ? [...current]
            : typeof current === 'object'
              ? { ...current }
              : nextContainer
      cursor[arrayToken] = value
      cursor = value
      continue
    }

    if (cursor && typeof cursor === 'object') {
      const objectToken = String(token)
      const current: JsonValue | undefined = (cursor as Record<string, JsonValue>)[objectToken]
      const value: JsonValue =
        current === null
          ? nextContainer
          : Array.isArray(current)
            ? [...current]
            : typeof current === 'object'
              ? { ...current }
              : nextContainer
      ;(cursor as Record<string, JsonValue>)[objectToken] = value
      cursor = value
    }
  }

  const lastToken = tokens[tokens.length - 1]
  if (Array.isArray(cursor)) {
    const arrayToken = typeof lastToken === 'number' ? lastToken : Number(lastToken)
    cursor[arrayToken] = nextValue
  } else if (cursor && typeof cursor === 'object') {
    ;(cursor as Record<string, JsonValue>)[String(lastToken)] = nextValue
  }
  return cloned
}

function flattenArgumentFields(value: JsonValue, path = '', label = 'arguments'): HitlArgumentField[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return []
    }
    return value.flatMap((item, index) => {
      const nextPath = path ? `${path}[${index}]` : `[${index}]`
      const nextLabel = `${label}[${index}]`
      return flattenArgumentFields(item, nextPath, nextLabel)
    })
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return []
    }
    return entries.flatMap(([key, item]) => {
      const nextPath = path ? `${path}.${key}` : key
      const nextLabel = path ? `${label}.${key}` : key
      return flattenArgumentFields(item, nextPath, nextLabel)
    })
  }

  let fieldType: HitlArgumentField['type'] = 'string'
  if (typeof value === 'number') {
    fieldType = 'number'
  } else if (typeof value === 'boolean') {
    fieldType = 'boolean'
  } else if (value === null) {
    fieldType = 'null'
  }
  return [{ path, label, type: fieldType, value }]
}

function isJsonRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getLockedToolMeta(toolId: string): { skillName: string } {
  const editor = hitlArgumentEditors.value[toolId]
  const fallback = { skillName: '' }
  if (!editor || editor.value === null || !isJsonRecord(editor.value)) {
    return fallback
  }
  const skillName = typeof editor.value.skillName === 'string' ? editor.value.skillName : ''
  return { skillName }
}

function getHitlArgumentFields(toolId: string): HitlArgumentField[] {
  const editor = hitlArgumentEditors.value[toolId]
  if (!editor || editor.value === null) {
    return []
  }

  const rootRecord = isJsonRecord(editor.value) ? editor.value : null
  const argumentSpecs =
    rootRecord && isJsonRecord(rootRecord.argumentSpecs)
      ? (rootRecord.argumentSpecs as Record<string, HitlArgumentSpecRecord>)
      : {}

  const allFields = flattenArgumentFields(editor.value)
  const hasStructuredArguments = allFields.some(
    (field) => field.path.startsWith('arguments.') || field.path.startsWith('arguments['),
  )

  if (hasStructuredArguments) {
    const structuredFields = allFields.filter(
      (field) => field.path.startsWith('arguments.') || field.path.startsWith('arguments['),
    )
    const structuredFieldMap = new Map(structuredFields.map((field) => [field.path, field]))
    const orderedFields: HitlArgumentField[] = []

    for (const [argumentName, spec] of Object.entries(argumentSpecs)) {
      const path = `arguments.${argumentName}`
      const field = structuredFieldMap.get(path)
      if (!field) {
        continue
      }
      orderedFields.push({
        ...field,
        type: resolveHitlFieldType(field.value, spec),
        label: resolveHitlArgumentLabel(argumentName, argumentSpecs),
        required: Boolean(spec?.required),
      })
      structuredFieldMap.delete(path)
    }

    for (const field of structuredFieldMap.values()) {
      const fallbackLabel = field.label.replace(/^arguments(\.|\[)/, (_value, token: string) => (token === '[' ? '[' : ''))
      orderedFields.push({
        ...field,
        label: resolveHitlArgumentLabel(fallbackLabel, argumentSpecs),
        required: false,
      })
    }

    return orderedFields
  }

  return allFields.filter((field) => field.path !== 'skillName' && field.path !== 'scriptPath')
}

function resolveHitlFieldType(
  value: JsonPrimitive,
  spec?: HitlArgumentSpecRecord,
): HitlArgumentField['type'] {
  const typeHint = (spec?.type || '').trim().toLowerCase()
  if (typeHint === 'number' || typeHint === 'integer' || typeHint === 'float' || typeHint === 'double') {
    return 'number'
  }
  if (typeHint === 'boolean') {
    return 'boolean'
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'number') {
    return 'number'
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  return 'string'
}

function resolveHitlArgumentLabel(
  fallbackLabel: string,
  argumentSpecs: Record<string, HitlArgumentSpecRecord>,
): string {
  const topLevelKey = fallbackLabel.split('.')[0]?.replace(/\[.*$/, '') || fallbackLabel
  const spec = argumentSpecs[topLevelKey]
  if (!spec) {
    return fallbackLabel
  }
  const displayName = (spec.displayName || spec.name || '').trim()
  return displayName || fallbackLabel
}

function updateHitlArgumentField(toolId: string, field: HitlArgumentField, rawValue: string | boolean) {
  const editor = hitlArgumentEditors.value[toolId]
  if (!editor || editor.value === null) {
    return
  }

  let nextValue: JsonPrimitive = rawValue as JsonPrimitive
  if (field.type === 'number') {
    const textValue = String(rawValue).trim()
    if (!textValue) {
      nextValue = null
    } else {
      const numeric = Number(textValue)
      nextValue = Number.isNaN(numeric) ? null : numeric
    }
  } else if (field.type === 'boolean') {
    nextValue = rawValue === true || rawValue === 'true'
  } else if (field.type === 'null') {
    nextValue = rawValue === '' ? null : String(rawValue)
  } else {
    nextValue = String(rawValue)
  }

  hitlArgumentEditors.value = {
    ...hitlArgumentEditors.value,
    [toolId]: {
      ...editor,
      value: setValueByPath(editor.value, field.path, nextValue),
    },
  }
}

function serializeToolArguments(toolId: string): string {
  const editor = hitlArgumentEditors.value[toolId]
  if (!editor) {
    return '{}'
  }
  if (editor.parseError || editor.value === null) {
    throw new Error('存在无法解析的 arguments，请检查后再提交。')
  }
  validateHitlArguments(editor.value)
  return JSON.stringify(editor.value)
}

function validateHitlArguments(value: JsonValue) {
  if (!isJsonRecord(value)) {
    return
  }
  const argumentSpecs =
    isJsonRecord(value.argumentSpecs)
      ? (value.argumentSpecs as Record<string, HitlArgumentSpecRecord>)
      : {}
  const argumentsRecord =
    isJsonRecord(value.arguments)
      ? (value.arguments as Record<string, JsonValue>)
      : {}

  for (const [argumentName, spec] of Object.entries(argumentSpecs)) {
    if (!spec?.required) {
      continue
    }
    const currentValue = argumentsRecord[argumentName]
    const emptyString = typeof currentValue === 'string' && currentValue.trim() === ''
    if (currentValue === null || currentValue === undefined || emptyString) {
      const label = (spec.displayName || spec.name || argumentName).trim() || argumentName
      throw new Error(`${label}不能为空，请补充后再提交。`)
    }
  }
}

function updateHitlFeedback(id: string, patch: Partial<PendingToolCall>) {
  hitlFeedbacks.value = hitlFeedbacks.value.map((item) => (buildHitlToolKey(item.id) === id ? { ...item, ...patch } : item))
}

function buildHitlToolKey(toolId: string): string {
  return `${currentInterruptId.value}:${toolId}`
}

function displayHitlDescription(description?: string): string {
  const text = (description || '').trim()
  if (!text) {
    return '待确认工具调用'
  }
  if (text.includes('该工具需要用户手动确认。已锁定结构化 toolName 和 arguments。')) {
    return '请确认后继续执行'
  }
  return text
}

async function openHitlModal(interruptId: string, payload: AgentHitlInterruptPayload, assistantMessage: ChatMessage) {
  let pendingToolCalls = Array.isArray(payload.pendingToolCalls) ? payload.pendingToolCalls : []
  if (pendingToolCalls.length === 0 && interruptId) {
    try {
      const checkpoint = await getHitlCheckpoint(interruptId)
      pendingToolCalls = Array.isArray(checkpoint.pendingToolCalls) ? checkpoint.pendingToolCalls : []
    } catch {
      // ignore and fallback to empty-state handling below
    }
  }

  if (pendingToolCalls.length === 0) {
    authError.value = '未获取到待确认工具调用，请重新发起问题或重试。'
    showHitlModal.value = false
    assistantMessage.pending = false
    assistantMessage.thinkingDone = true
    agentRunStatus.value = 'error'
    return
  }

  authError.value = ''
  hitlToolCalls.value = pendingToolCalls
  hitlFeedbacks.value = pendingToolCalls.map((tool) => ({
    ...tool,
    arguments: ensureToolCallArgumentsString(tool.arguments),
    result: 'APPROVED',
  }))
  hitlArgumentEditors.value = Object.fromEntries(
    hitlFeedbacks.value.map((tool) => [buildHitlToolKey(tool.id), parseToolArguments(tool.arguments)]),
  )
  interruptedAssistantMessage.value = assistantMessage
  assistantMessage.pending = false
  assistantMessage.thinkingDone = false
  showHitlModal.value = true
  agentRunStatus.value = 'interrupted'
}

function handleAgentEvent(event: AgentStreamEvent, assistantMessage: ChatMessage) {
  if (event.conversationId) {
    activeConversationId.value = event.conversationId
  }

  const eventData = (event.data || {}) as Record<string, unknown>

  switch (event.type) {
    case 'thinking_step': {
      const payload = eventData as AgentThinkingStepPayload
      const text = toThinkingText(payload)
      pushThinkingChunk(text)
      break
    }
    case 'assistant_delta': {
      const content = typeof eventData.content === 'string' ? eventData.content : ''
      if (content) {
        pushFinalChunk(content)
      }
      break
    }
    case 'final_answer': {
      const payload = eventData as AgentFinalAnswerPayload
      if (payload.content) {
        mergeFinalAnswerChunk(payload.content)
      }
      assistantMessage.thinkingDone = true
      agentRunStatus.value = 'finished'
      break
    }
    case 'hitl_interrupt': {
      const payload = eventData as AgentHitlInterruptPayload
      currentInterruptId.value = event.interruptId || ''
      void openHitlModal(currentInterruptId.value, payload, assistantMessage)
      break
    }
    case 'knowledge_retrieval': {
      const payload = eventData as AgentKnowledgeRetrievalPayload
      assistantMessage.retrievedImages = Array.isArray(payload.images) ? payload.images : []
      scrollToBottom()
      break
    }
    case 'error': {
      const payload = eventData as AgentErrorPayload
      const message = payload.message || '调用失败'
      pushFinalChunk(`\n\n[错误] ${message}`)
      assistantMessage.pending = false
      assistantMessage.thinkingDone = true
      agentRunStatus.value = 'error'
      break
    }
    default:
      // 兜底兼容：如果后端新增事件但仍携带 content，前端也应可展示。
      if (typeof eventData.content === 'string' && eventData.content) {
        pushFinalChunk(eventData.content)
      }
      break
  }
}

function openRetrievedImagePreview(image: RetrievedKnowledgeImage) {
  if (!image.imageUrl) {
    return
  }
  retrievedImagePreviewUrl.value = image.imageUrl
  retrievedImagePreviewTitle.value = image.documentName || ''
  showRetrievedImagePreview.value = true
}

function closeRetrievedImagePreview() {
  showRetrievedImagePreview.value = false
  retrievedImagePreviewUrl.value = ''
  retrievedImagePreviewTitle.value = ''
}

function mergeFinalAnswerChunk(fullContent: string) {
  const currentRendered = activeAssistantMessage.value?.finalContent || ''
  const currentBuffered = streamFinalBuffer.value
  const currentTotal = `${currentRendered}${currentBuffered}`

  // 没有增量内容时，直接按完整答案追加
  if (!currentTotal) {
    pushFinalChunk(fullContent)
    return
  }

  // 常见情况：delta 已经部分输出，final_answer 给出完整文本，只补齐剩余部分
  if (fullContent.startsWith(currentTotal)) {
    const remain = fullContent.slice(currentTotal.length)
    if (remain) {
      pushFinalChunk(remain)
    }
    return
  }

  // 若当前内容已覆盖 final_answer（例如最后一帧已到），不再重复追加
  if (currentTotal.startsWith(fullContent)) {
    return
  }

  // 兜底：以 final_answer 为准进行覆盖，避免出现重复/错乱
  if (activeAssistantMessage.value) {
    activeAssistantMessage.value.finalContent = fullContent
    streamFinalBuffer.value = ''
    scrollToBottom()
  }
}

function pushThinkingChunk(chunk: string) {
  if (!chunk) {
    return
  }
  const target = activeAssistantMessage.value
  streamThinkingBuffer.value += chunk
  if (target) {
    ingestThinkingPreview(target, chunk)
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

async function resolveAndResume() {
  if (!currentInterruptId.value || hitlFeedbacks.value.length === 0) {
    authError.value = '当前没有可处理的中断任务。'
    return
  }
  const submittedInterruptId = currentInterruptId.value
  const assistantMessage = interruptedAssistantMessage.value
  if (!assistantMessage) {
    authError.value = '会话状态异常，请重新发起提问。'
    return
  }

  try {
    agentRunStatus.value = 'resolving'
    const payload: HitlCheckpointResolveRequest = {
      interruptId: submittedInterruptId,
      feedbacks: hitlFeedbacks.value.map((item) => ({
        id: item.id,
        name: item.name,
        arguments: serializeToolArguments(buildHitlToolKey(item.id)),
        result: item.result || 'APPROVED',
        description: item.description || '',
      })),
    }
    await resolveHitlCheckpoint(payload)

    showHitlModal.value = false
    agentRunStatus.value = 'resuming'
    assistantMessage.pending = true
    activeAssistantMessage.value = assistantMessage
    controller.value = new AbortController()

    await resumeAgentStream(
      { interruptId: currentInterruptId.value },
      {
        onAgentEvent(event) {
          handleAgentEvent(event, assistantMessage)
        },
        onTransportError(message) {
          pushFinalChunk(`\n\n[错误] ${message}`)
          agentRunStatus.value = 'error'
        },
      },
      controller.value.signal,
    )

    await waitForStreamDrain()
    assistantMessage.pending = false
    assistantMessage.thinkingDone = true
    activeAssistantMessage.value = null
    controller.value = null
    if (currentInterruptId.value && currentInterruptId.value !== submittedInterruptId) {
      return
    }
    interruptedAssistantMessage.value = null
    currentInterruptId.value = ''
    hitlToolCalls.value = []
    hitlFeedbacks.value = []
    hitlArgumentEditors.value = {}
    agentRunStatus.value = 'finished'
    void loadConversations(false)
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '处理审批失败，请稍后重试。'
    agentRunStatus.value = 'error'
  }
}

async function submitQuestion() {
  const question = removeKnowledgeQuestionPrefix(inputValue.value.trim()).trim()
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
  interruptedAssistantMessage.value = null
  currentInterruptId.value = ''
  showHitlModal.value = false
  hitlToolCalls.value = []
  hitlFeedbacks.value = []
  hitlArgumentEditors.value = {}
  streamThinkingBuffer.value = ''
  streamFinalBuffer.value = ''

  const payload: AgentCallRequest = {
    question,
    mode: mode.value,
    conversationId: activeConversationId.value,
  }

  loading.value = true
  agentRunStatus.value = 'calling'
  controller.value = new AbortController()

  try {
    await callAgentStream(
      payload,
      {
        onAgentEvent(event) {
          handleAgentEvent(event, assistantMessage)
        },
        onTransportError(message) {
          pushFinalChunk(`\n\n[错误] ${message}`)
          agentRunStatus.value = 'error'
        },
      },
      controller.value.signal,
    )

    await waitForStreamDrain()
    const interrupted = Boolean(currentInterruptId.value)
    if (!interrupted) {
      assistantMessage.thinkingDone = true
    }
    if (!interrupted && !assistantMessage.finalContent?.trim() && !assistantMessage.thinkingContent?.trim()) {
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
    agentRunStatus.value = 'error'
  } finally {
    const interrupted = Boolean(currentInterruptId.value)
    if (!interrupted) {
      assistantMessage.pending = false
      activeAssistantMessage.value = null
      controller.value = null
      loading.value = false
      if (agentRunStatus.value === 'calling') {
        agentRunStatus.value = 'finished'
      }
      void loadConversations(false)
    } else {
      loading.value = false
    }
  }
}

function stopGeneration() {
  controller.value?.abort()
  resetStreamState()
  controller.value = null
  loading.value = false
  agentRunStatus.value = 'idle'
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
  const target = event.target as Node | null

  if (showModeMenu.value && modeMenuRef.value && target && !modeMenuRef.value.contains(target)) {
    showModeMenu.value = false
  }

  if (showSkillMenu.value && skillMenuRef.value && target && !skillMenuRef.value.contains(target)) {
    showSkillMenu.value = false
  }

  if (
    showKnowledgeAskMenu.value &&
    knowledgeAskMenuRef.value &&
    target &&
    !knowledgeAskMenuRef.value.contains(target)
  ) {
    showKnowledgeAskMenu.value = false
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

  if (streamRafId.value === null) {
    streamRafId.value = window.requestAnimationFrame(runStreamFrame)
  }
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
    selectedSkillName.value = ''
    selectedKnowledgeId.value = null
    selectedKnowledgeName.value = ''
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
          <span class="brand-cloud">
            <span class="brand-cloud-eye brand-cloud-eye-left"></span>
            <span class="brand-cloud-eye brand-cloud-eye-right"></span>
            <span class="brand-cloud-blush brand-cloud-blush-left"></span>
            <span class="brand-cloud-blush brand-cloud-blush-right"></span>
            <span class="brand-cloud-mouth"></span>
          </span>
        </div>
        <div class="brand-copy">
          <p class="brand-title">Cloud Cold</p>
          <p class="brand-subtitle">Made By ShenChen</p>
        </div>
      </div>

      <button
        class="knowledge-chat-btn"
        :class="{ active: knowledgeQaMode }"
        type="button"
        @click="knowledgeQaMode ? showChatPanel() : showKnowledgeQaPanel()"
      >
        {{ knowledgeQaMode ? '返回对话' : '知识库工作台' }}
      </button>
      <button class="new-chat-btn" type="button" @click="startNewChat">+ 新建会话</button>

      <div class="nav-group">
        <p class="nav-title">会话列表</p>
        <div class="conversation-list-scroll">
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
      </div>
    </aside>

    <main class="chat-main">
      <header class="topbar">
        <div class="top-left-actions">
          <button class="top-icon-btn" type="button" @click="sidebarCollapsed = !sidebarCollapsed">
            <span class="bars"></span>
          </button>
        </div>
        <div class="top-center">
          <h1>{{ pageTitle }}</h1>
          <p>{{ pageSubtitle }}</p>
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

      <section ref="chatRef" class="chat-panel" :class="{ empty: !hasMessages || knowledgeQaMode }">
        <div class="chat-content">
          <div v-if="historyLoading && !knowledgeQaMode" class="history-loading">正在加载会话历史...</div>
          <template v-if="knowledgeQaMode">
            <KnowledgeWorkspace
              :current-user="currentUser"
              @request-login="openAuthModal('login')"
              @exit="showChatPanel"
            />
          </template>
          <template v-else-if="hasMessages">
            <article
              v-for="message in messages"
              :key="message.id"
              class="message-row"
              :class="message.role"
            >
              <div class="message-bubble">
                <p class="role-tag">{{ message.role === 'user' ? '你' : '助手' }}</p>
                <template v-if="message.role === 'assistant'">
                  <div
                    v-if="message.retrievedImages && message.retrievedImages.length > 0"
                    class="retrieved-image-panel"
                  >
                    <div class="retrieved-image-head">
                      <span class="retrieved-image-title">知识库命中图片</span>
                      <span class="retrieved-image-count">{{ message.retrievedImages.length }} 张</span>
                    </div>
                    <div class="retrieved-image-grid">
                      <button
                        v-for="image in message.retrievedImages"
                        :key="image.imageId || image.imageUrl"
                        class="retrieved-image-card"
                        type="button"
                        @click="openRetrievedImagePreview(image)"
                      >
                        <div class="retrieved-image-frame">
                          <img
                            v-if="image.imageUrl"
                            :src="image.imageUrl"
                            :alt="image.documentName || '知识库命中图片'"
                            class="retrieved-image"
                          />
                        </div>
                        <div class="retrieved-image-body">
                          <p v-if="image.documentName" class="retrieved-image-doc">{{ image.documentName }}</p>
                        </div>
                      </button>
                    </div>
                  </div>
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
                  <div
                    v-if="message.finalContent"
                    class="message-content markdown-content"
                    v-html="renderMarkdown(message.finalContent)"
                  />
                </template>
                <template v-else>
                  <div class="message-content markdown-content" v-html="renderMarkdown(message.content)" />
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

      <footer v-if="!knowledgeQaMode" class="composer-wrap">
        <div class="composer">
          <div v-if="selectedSkillName || selectedKnowledgeName" class="selected-binding-chips">
            <div v-if="selectedSkillName" class="selected-skill-chip">
              已绑定 Skill：{{ selectedSkillName }}
            </div>
            <div v-if="selectedKnowledgeName" class="selected-knowledge-chip">
              已绑定知识库：{{ selectedKnowledgeName }}
            </div>
          </div>
          <textarea
            ref="composerInputRef"
            v-model="inputValue"
            class="composer-input"
            placeholder="发消息..."
            @keydown="handleEnter"
          />
          <div class="composer-toolbar">
            <div class="left-tools">
              <button class="tool-btn" type="button" aria-label="更多">+</button>

              <div ref="modeMenuRef" class="mode-picker">
                <button class="mode-trigger mode-trigger-mode" type="button" @click.stop="toggleModeMenu">
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

              <div ref="skillMenuRef" class="skill-picker">
                <button class="mode-trigger mode-trigger-skill skill-trigger" type="button" @click.stop="toggleSkillMenu">
                  <span>🧩 Skill</span>
                  <span class="arrow">›</span>
                </button>

                <div v-if="showSkillMenu" class="skill-dropdown">
                  <div class="skill-list">
                    <button
                      class="skill-item unbind"
                      type="button"
                      :disabled="!selectedSkillName || skillBindingLoading || !activeConversationId"
                      @click="unbindSkill"
                    >
                      {{ skillBindingLoading ? '处理中...' : '解除绑定' }}
                    </button>
                    <button
                      v-for="skill in skills"
                      :key="skill.name"
                      type="button"
                      class="skill-item"
                      :class="{ active: selectedSkillName === skill.name }"
                      @mouseenter="hoveredSkillName = skill.name"
                      @focus="hoveredSkillName = skill.name"
                      @click="bindSkill(skill.name)"
                    >
                      {{ skill.name }}
                    </button>
                    <div v-if="skillListLoading" class="skill-hint">加载中...</div>
                  </div>
                  <div class="skill-desc">
                    <p v-if="hoveredSkill">{{ hoveredSkill.description || '暂无描述' }}</p>
                    <p v-else class="skill-hint">鼠标悬浮查看 Skill 描述</p>
                  </div>
                </div>
              </div>

              <div ref="knowledgeAskMenuRef" class="knowledge-ask-picker">
                <button
                  class="mode-trigger mode-trigger-knowledge knowledge-ask-trigger"
                  type="button"
                  @click.stop="toggleKnowledgeAskMenu"
                >
                  <span>📚 知识库问答</span>
                  <span class="arrow">›</span>
                </button>

                <div v-if="showKnowledgeAskMenu" class="knowledge-ask-dropdown">
                  <button
                    class="knowledge-ask-item unbind"
                    type="button"
                    :disabled="!selectedKnowledgeId || knowledgeBindingLoading || !activeConversationId"
                    @click="unbindKnowledge"
                  >
                    {{ knowledgeBindingLoading ? '处理中...' : '解除绑定' }}
                  </button>
                  <div v-if="knowledgeAskListLoading" class="knowledge-ask-hint">加载中...</div>
                  <div v-else-if="knowledgeOptions.length === 0" class="knowledge-ask-hint">
                    暂无知识库，请先创建
                  </div>
                  <button
                    v-for="knowledge in knowledgeOptions"
                    :key="knowledge.id"
                    type="button"
                    class="knowledge-ask-item"
                    :class="{ active: selectedKnowledgeId === knowledge.id }"
                    @click="bindKnowledge(knowledge)"
                  >
                    <span class="knowledge-ask-item-title">{{ knowledge.knowledgeName }}</span>
                    <span class="knowledge-ask-item-meta">{{ knowledge.documentCount }} 份文档</span>
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

    <div v-if="showHitlModal" class="modal-mask">
      <div class="modal-card hitl-card" @click.stop>
        <h3>人工确认执行</h3>
        <div class="hitl-list">
          <div v-for="tool in hitlFeedbacks" :key="buildHitlToolKey(tool.id)" class="hitl-item">
            <p class="hitl-desc">{{ displayHitlDescription(tool.description) }}</p>
            <div class="hitl-meta" v-if="getLockedToolMeta(buildHitlToolKey(tool.id)).skillName">
              <p v-if="getLockedToolMeta(buildHitlToolKey(tool.id)).skillName">技能：{{ getLockedToolMeta(buildHitlToolKey(tool.id)).skillName }}</p>
            </div>
            <label class="field">
              <span>处理结果</span>
              <select
                :value="tool.result || 'APPROVED'"
                @change="
                  updateHitlFeedback(buildHitlToolKey(tool.id), {
                    result: ($event.target as HTMLSelectElement).value as PendingToolCall['result'],
                  })
                "
              >
                <option value="APPROVED">同意执行</option>
                <option value="REJECTED">拒绝执行</option>
                <option value="EDIT">修改参数后执行</option>
              </select>
            </label>
            <p v-if="hitlArgumentEditors[buildHitlToolKey(tool.id)]?.parseError" class="error-tip hitl-error-inline">
              {{ hitlArgumentEditors[buildHitlToolKey(tool.id)]?.parseError }}
            </p>
            <div v-else class="hitl-arg-grid">
              <template v-if="getHitlArgumentFields(buildHitlToolKey(tool.id)).length > 0">
                <label
                  v-for="field in getHitlArgumentFields(buildHitlToolKey(tool.id))"
                  :key="`${buildHitlToolKey(tool.id)}-${field.path}`"
                  class="field hitl-field"
                >
                  <span>{{ field.label }}</span>
                  <template v-if="(tool.result || 'APPROVED') === 'EDIT'">
                    <input
                      v-if="field.type === 'string'"
                      :value="String(field.value ?? '')"
                      type="text"
                      @input="
                        updateHitlArgumentField(
                          buildHitlToolKey(tool.id),
                          field,
                          ($event.target as HTMLInputElement).value,
                        )
                      "
                    />
                    <input
                      v-else-if="field.type === 'number'"
                      :value="field.value === null ? '' : String(field.value)"
                      type="number"
                      @input="
                        updateHitlArgumentField(
                          buildHitlToolKey(tool.id),
                          field,
                          ($event.target as HTMLInputElement).value,
                        )
                      "
                    />
                    <select
                      v-else-if="field.type === 'boolean'"
                      :value="String(field.value)"
                      @change="
                        updateHitlArgumentField(
                          buildHitlToolKey(tool.id),
                          field,
                          ($event.target as HTMLSelectElement).value === 'true',
                        )
                      "
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                    <input
                      v-else
                      :value="field.value === null ? '' : String(field.value)"
                      type="text"
                      placeholder="留空表示 null"
                      @input="
                        updateHitlArgumentField(
                          buildHitlToolKey(tool.id),
                          field,
                          ($event.target as HTMLInputElement).value,
                        )
                      "
                    />
                  </template>
                  <div v-else class="hitl-readonly-value">
                    {{ field.value === null ? 'null' : String(field.value) }}
                  </div>
                </label>
              </template>
              <p v-else class="hitl-empty-args">该工具 arguments 为空对象。</p>
            </div>
          </div>
        </div>
        <p v-if="authError" class="error-tip">{{ authError }}</p>
        <div class="modal-actions">
          <button class="solid-btn" type="button" :disabled="agentRunStatus === 'resolving'" @click="resolveAndResume">
            {{ agentRunStatus === 'resolving' ? '提交中...' : '提交并继续' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showRetrievedImagePreview" class="modal-mask" @click="closeRetrievedImagePreview">
      <div class="preview-card retrieved-image-preview-card" @click.stop>
        <div class="preview-head">
          <div>
            <p class="retrieved-image-preview-kicker">知识库命中图片</p>
            <h3 v-if="retrievedImagePreviewTitle">{{ retrievedImagePreviewTitle }}</h3>
          </div>
          <button class="top-icon-btn" type="button" @click="closeRetrievedImagePreview">×</button>
        </div>
        <div class="retrieved-image-preview-body">
          <img
            v-if="retrievedImagePreviewUrl"
            :src="retrievedImagePreviewUrl"
            :alt="retrievedImagePreviewTitle || '知识库命中图片'"
            class="retrieved-image-preview"
          />
        </div>
      </div>
    </div>

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

    <PetMemoryWidget :current-user="currentUser" @request-login="openAuthModal('login')" />
  </div>
</template>

<style scoped>
.doubao-shell {
  --bg: #f5f5f6;
  --panel: #ffffff;
  --line: #e3e3e6;
  --text: #171717;
  --muted: #8c8c92;
  height: 100vh;
  min-height: 100vh;
  display: grid;
  grid-template-columns: 270px 1fr;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
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
  height: 100vh;
  padding: 1.2rem 0.9rem;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 1rem;
  overflow: hidden;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.82rem;
  padding: 0.45rem 0.42rem 0.6rem;
}

.brand-icon {
  width: 2.55rem;
  height: 2.55rem;
  border-radius: 0.95rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(239, 246, 255, 0.86));
  display: grid;
  place-items: center;
  border: 1px solid rgba(217, 227, 240, 0.92);
}

.brand-copy {
  min-width: 0;
}

.brand-title {
  margin: 0;
  font: 700 1.02rem/1.1 'Avenir Next', 'PingFang SC', sans-serif;
}

.brand-subtitle {
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.74rem;
  line-height: 1.45;
}

.knowledge-chat-btn,
.new-chat-btn,
.quick-prompt-btn {
  border: 1px solid var(--line);
  background: #fff;
  color: #262626;
  border-radius: 0.8rem;
  text-align: left;
  transition: all 0.2s ease;
}

.knowledge-chat-btn {
  padding: 0.65rem 0.82rem;
  font-weight: 600;
  background: #f0f6ff;
  border-color: #cadcff;
}

.knowledge-chat-btn.active {
  background: #14213b;
  border-color: #14213b;
  color: #fff;
  box-shadow: 0 14px 28px rgba(20, 33, 59, 0.16);
}

.new-chat-btn {
  padding: 0.68rem 0.82rem;
  font-weight: 600;
}

.knowledge-chat-btn:hover,
.new-chat-btn:hover,
.quick-prompt-btn:hover {
  border-color: #cfcfd4;
  transform: translateY(-1px);
}

.nav-group {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 0.5rem;
}

.conversation-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-right: 0.1rem;
}

.conversation-list-scroll::-webkit-scrollbar {
  width: 6px;
}

.conversation-list-scroll::-webkit-scrollbar-thumb {
  background: #d6d6dc;
  border-radius: 999px;
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
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 0.7rem;
  background: #fff;
}

.top-left-actions {
  justify-self: start;
  display: flex;
  align-items: center;
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
  min-width: 0;
  justify-self: end;
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

.kb-action-grid {
  margin-top: 1.5rem;
  display: flex;
  justify-content: center;
  gap: 0.75rem;
}

.kb-action-btn {
  border: 1px solid #dcdce3;
  border-radius: 0.8rem;
  background: #fff;
  color: #2f2f34;
  padding: 0.62rem 1.2rem;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.kb-action-btn:hover {
  border-color: #c9c9d1;
  background: #f8f8fa;
  transform: translateY(-1px);
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
  line-height: 1.6;
  font-size: 0.95rem;
}

.markdown-content :deep(*) {
  box-sizing: border-box;
}

.markdown-content :deep(p) {
  margin: 0;
}

.markdown-content :deep(p + p) {
  margin-top: 0.8rem;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin: 1rem 0 0.5rem;
  line-height: 1.3;
  font-weight: 700;
  color: #18304f;
}

.markdown-content :deep(h1) {
  font-size: 1.35rem;
}

.markdown-content :deep(h2) {
  font-size: 1.2rem;
}

.markdown-content :deep(h3) {
  font-size: 1.08rem;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0.75rem 0;
  padding-left: 1.4rem;
}

.markdown-content :deep(li + li) {
  margin-top: 0.32rem;
}

.markdown-content :deep(blockquote) {
  margin: 0.85rem 0;
  padding: 0.2rem 0 0.2rem 0.85rem;
  border-left: 3px solid rgba(105, 135, 191, 0.45);
  color: #56657b;
  background: rgba(244, 248, 255, 0.7);
  border-radius: 0 0.7rem 0.7rem 0;
}

.markdown-content :deep(pre) {
  margin: 0.85rem 0;
  padding: 0.85rem 0.95rem;
  overflow-x: auto;
  border-radius: 0.9rem;
  background: #172235;
  color: #eef4ff;
  box-shadow: inset 0 0 0 1px rgba(118, 144, 191, 0.18);
}

.markdown-content :deep(code) {
  font-family: 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 0.88em;
}

.markdown-content :deep(:not(pre) > code) {
  padding: 0.12rem 0.35rem;
  border-radius: 0.45rem;
  background: rgba(28, 45, 77, 0.08);
  color: #1e3960;
}

.markdown-content :deep(pre code) {
  display: block;
  white-space: pre;
}

.markdown-content :deep(a) {
  color: #2d67bc;
  text-decoration: underline;
  text-decoration-color: rgba(45, 103, 188, 0.35);
  text-underline-offset: 0.16rem;
}

.markdown-content :deep(strong) {
  font-weight: 700;
}

.markdown-content :deep(em) {
  font-style: italic;
}

.markdown-content :deep(del) {
  text-decoration-thickness: 1.5px;
}

.markdown-content :deep(hr) {
  margin: 1rem 0;
  border: none;
  border-top: 1px solid rgba(190, 201, 220, 0.8);
}

.retrieved-image-panel {
  border: 1px solid rgba(217, 225, 239, 0.9);
  border-radius: 0.95rem;
  background: linear-gradient(180deg, rgba(248, 251, 255, 0.96), rgba(241, 246, 255, 0.94));
  margin-bottom: 0.72rem;
  padding: 0.75rem;
}

.retrieved-image-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.68rem;
}

.retrieved-image-title {
  font-size: 0.84rem;
  font-weight: 700;
  color: #2a4268;
}

.retrieved-image-count {
  font-size: 0.75rem;
  color: #6e7f98;
}

.retrieved-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 220px));
  justify-content: center;
  gap: 0.6rem;
}

.retrieved-image-card {
  display: grid;
  gap: 0.42rem;
  color: inherit;
  border: 1px solid rgba(203, 214, 232, 0.9);
  border-radius: 0.88rem;
  background: rgba(255, 255, 255, 0.92);
  padding: 0.44rem;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
  width: 100%;
  max-width: 220px;
}

.retrieved-image-card:hover {
  transform: translateY(-2px);
  border-color: rgba(154, 179, 220, 0.96);
  box-shadow: 0 16px 26px rgba(51, 78, 130, 0.08);
}

.retrieved-image-frame {
  aspect-ratio: 4 / 3;
  border-radius: 0.62rem;
  overflow: hidden;
  background: #eef3fb;
}

.retrieved-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.retrieved-image-body {
  display: grid;
  gap: 0.2rem;
}

.retrieved-image-doc {
  font-size: 0.72rem;
  font-weight: 700;
  color: #314967;
}

.retrieved-image-preview-card {
  width: min(960px, calc(100% - 2rem));
  max-height: 86vh;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 0.9rem;
}

.retrieved-image-preview-kicker {
  font-size: 0.76rem;
  font-weight: 700;
  color: #6d7f99;
  letter-spacing: 0.08em;
}

.retrieved-image-preview-body {
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: auto;
  border-radius: 1rem;
  background: #eef3fb;
}

.retrieved-image-preview {
  max-width: 100%;
  max-height: 72vh;
  object-fit: contain;
  display: block;
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
  position: relative;
  width: min(920px, calc(100% - 4px));
  margin: 0 auto;
  border: 1px solid #111;
  border-radius: 1.45rem;
  background: #fff;
  box-shadow: 0 3px 18px rgba(0, 0, 0, 0.05);
  padding: 0.66rem 0.78rem 0.58rem;
}

.selected-binding-chips {
  position: absolute;
  top: -1.1rem;
  left: 0.85rem;
  display: flex;
  align-items: center;
  gap: 0.42rem;
}

.selected-skill-chip,
.selected-knowledge-chip {
  border: 1px solid #dcdde4;
  background: #fff;
  border-radius: 999px;
  padding: 0.14rem 0.58rem;
  font-size: 0.76rem;
  color: #4b5563;
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

.skill-picker {
  position: relative;
}

.knowledge-ask-picker {
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

.skill-trigger {
  min-width: 96px;
}

.knowledge-ask-trigger {
  min-width: 148px;
  background: #eef5ff;
  color: #173a6a;
}

.knowledge-ask-dropdown {
  position: absolute;
  left: 0;
  bottom: calc(100% + 0.5rem);
  width: 248px;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #dddddf;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
  padding: 0.4rem;
  display: grid;
  gap: 0.32rem;
  z-index: 21;
}

.knowledge-ask-dropdown::-webkit-scrollbar,
.skill-list::-webkit-scrollbar {
  width: 6px;
}

.knowledge-ask-dropdown::-webkit-scrollbar-thumb,
.skill-list::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(157, 173, 197, 0.85), rgba(129, 147, 174, 0.85));
  border-radius: 999px;
}

.knowledge-ask-hint {
  padding: 0.8rem 0.82rem;
  color: #768397;
  font-size: 0.82rem;
  line-height: 1.45;
  border-radius: 0.86rem;
  background: linear-gradient(180deg, rgba(244, 248, 253, 0.98), rgba(239, 244, 251, 0.98));
  border: 1px dashed rgba(204, 214, 229, 0.88);
}

.knowledge-ask-item {
  width: 100%;
  border-radius: 0.8rem;
  color: #2a2a30;
  display: grid;
  gap: 0.2rem;
  text-align: left;
  padding: 0.72rem 0.78rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.knowledge-ask-item:hover {
  background: #edf3ff;
}

.knowledge-ask-item.active {
  background: #e7efff;
}

.knowledge-ask-item.unbind {
  color: #8c2f39;
}

.knowledge-ask-item-title {
  font-size: 0.88rem;
  font-weight: 600;
}

.knowledge-ask-item-meta {
  font-size: 0.76rem;
  color: #7f8088;
}

.arrow {
  font-size: 1.15rem;
  line-height: 1;
  color: #8390a3;
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
  padding: 0.48rem;
  z-index: 20;
  display: grid;
  gap: 0.36rem;
}

.skill-dropdown {
  position: absolute;
  left: 0;
  bottom: calc(100% + 0.5rem);
  width: 420px;
  border: 1px solid #dddddf;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
  padding: 0.5rem;
  z-index: 21;
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 0.5rem;
}

.skill-list {
  border-right: 1px solid rgba(230, 234, 241, 0.95);
  padding-right: 0.5rem;
  max-height: 240px;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 0.3rem;
}

.skill-item {
  border-radius: 0.65rem;
  text-align: left;
  padding: 0.45rem 0.52rem;
  font-size: 0.82rem;
  cursor: pointer;
}

.skill-item:hover,
.skill-item.active {
  border-color: rgba(114, 147, 205, 0.96);
  background: linear-gradient(135deg, rgba(236, 243, 255, 0.98), rgba(249, 251, 255, 0.98));
}

.skill-item.unbind {
  color: #9a3a3a;
  background: linear-gradient(180deg, rgba(255, 249, 249, 0.98), rgba(255, 243, 243, 0.98));
}

.skill-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.skill-desc {
  padding: 0.7rem 0.72rem;
  color: #5c6472;
  font-size: 0.82rem;
  line-height: 1.5;
  border-radius: 0.86rem;
  background: linear-gradient(180deg, rgba(247, 250, 255, 0.98), rgba(242, 246, 252, 0.96));
  border: 1px solid rgba(227, 232, 241, 0.92);
}

.skill-hint {
  color: #98a0ad;
}

.mode-item {
  width: 100%;
  border-radius: 0.7rem;
  text-align: left;
  padding: 0.68rem 0.74rem;
  cursor: pointer;
}

.mode-item:hover {
  background: linear-gradient(180deg, rgba(248, 251, 255, 0.98), rgba(240, 245, 252, 0.98));
}

.mode-item.active {
  border-color: rgba(121, 154, 214, 0.95);
  background: linear-gradient(135deg, rgba(234, 242, 255, 0.98), rgba(247, 250, 255, 0.98));
}

.mode-item-main {
  font-size: 1rem;
  font-weight: 600;
  color: #202024;
}

.mode-item-desc {
  margin-top: 0.22rem;
  font-size: 0.82rem;
  color: #8e8e95;
  line-height: 1.45;
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
  padding: 0.9rem;
}

.modal-card h3 {
  font-size: 1rem;
  color: #202024;
  margin-bottom: 0.55rem;
  line-height: 1.2;
}

.hitl-card {
  width: min(680px, calc(100% - 2rem));
}

.hitl-list {
  max-height: 360px;
  overflow: auto;
  display: grid;
  gap: 0.5rem;
}

.hitl-item {
  border: 1px solid #e6e6eb;
  border-radius: 0.75rem;
  padding: 0.56rem 0.6rem;
}

.hitl-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: #22242a;
}

.hitl-desc {
  margin-top: 0;
  margin-bottom: 0.28rem;
  font-size: 0.8rem;
  color: #6a7280;
  line-height: 1.45;
}

.hitl-meta {
  margin: 0 0 0.35rem;
  display: grid;
  gap: 0.12rem;
  font-size: 0.78rem;
  color: #52525b;
}

.hitl-arg-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.hitl-field {
  margin-bottom: 0;
}

.hitl-error-inline {
  margin: 0.3rem 0 0.2rem;
  min-height: auto;
}

.hitl-empty-args {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: #7a7f8a;
}

.hitl-readonly-value {
  border: 1px solid #ececf2;
  border-radius: 0.72rem;
  min-height: 36px;
  padding: 0.52rem 0.7rem;
  font-size: 0.9rem;
  color: #3a3a41;
  background: #f8f8fa;
  display: flex;
  align-items: center;
}

.field {
  display: grid;
  gap: 0.28rem;
  margin-bottom: 0.55rem;
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

.field select {
  border: 1px solid #dddde3;
  border-radius: 0.72rem;
  padding: 0.48rem 0.62rem;
  font-size: 0.86rem;
  outline: none;
  background: #fff;
}

.field input:focus {
  border-color: #a3a3ad;
}

.field select:focus {
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
  margin-top: 0.18rem;
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

.doubao-shell {
  --bg: #edf3fa;
  --panel: rgba(255, 255, 255, 0.72);
  --line: rgba(153, 170, 196, 0.26);
  --text: #142234;
  --muted: #73829b;
  position: relative;
  isolation: isolate;
  background:
    radial-gradient(circle at 0% 0%, rgba(111, 154, 245, 0.2), transparent 24%),
    radial-gradient(circle at 100% 12%, rgba(255, 196, 123, 0.2), transparent 28%),
    linear-gradient(135deg, #edf3fa 0%, #f7faff 40%, #fffdf7 100%);
}

.doubao-shell::before,
.doubao-shell::after {
  content: '';
  position: absolute;
  z-index: -1;
  pointer-events: none;
  filter: blur(24px);
  opacity: 0.85;
}

.doubao-shell::before {
  width: 280px;
  height: 280px;
  left: -100px;
  top: -80px;
  border-radius: 50%;
  background: rgba(112, 151, 230, 0.22);
}

.doubao-shell::after {
  width: 320px;
  height: 320px;
  right: -120px;
  bottom: -80px;
  border-radius: 50%;
  background: rgba(255, 208, 142, 0.18);
}

.sidebar {
  position: relative;
  border-right: 1px solid rgba(203, 214, 230, 0.55);
  background:
    linear-gradient(180deg, rgba(252, 253, 255, 0.9) 0%, rgba(244, 248, 255, 0.82) 100%);
  backdrop-filter: blur(22px);
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.48);
}

.brand {
  position: relative;
  padding: 0.4rem 0.3rem 0.68rem;
}

.brand-icon {
  box-shadow:
    0 14px 28px rgba(28, 55, 110, 0.14),
    inset 0 -2px 0 rgba(198, 216, 241, 0.78);
}

.brand-title {
  color: #12213a;
  letter-spacing: -0.02em;
}

.brand-subtitle {
  color: #7988a3;
}

.brand-cloud {
  position: relative;
  width: 1.75rem;
  height: 1.02rem;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffffff, #eef6ff);
}

.brand-cloud::before,
.brand-cloud::after {
  content: '';
  position: absolute;
  bottom: 0.2rem;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffffff, #eef6ff);
}

.brand-cloud::before {
  left: 0.18rem;
  width: 0.64rem;
  height: 0.64rem;
}

.brand-cloud::after {
  right: 0.16rem;
  width: 0.76rem;
  height: 0.76rem;
}

.brand-cloud-eye,
.brand-cloud-blush,
.brand-cloud-mouth {
  position: absolute;
  z-index: 1;
}

.brand-cloud-eye {
  top: 0.46rem;
  width: 0.12rem;
  height: 0.2rem;
  border-radius: 999px;
  background: #37517d;
}

.brand-cloud-eye-left {
  left: 0.56rem;
}

.brand-cloud-eye-right {
  right: 0.56rem;
}

.brand-cloud-blush {
  top: 0.63rem;
  width: 0.28rem;
  height: 0.14rem;
  border-radius: 999px;
  background: rgba(255, 174, 196, 0.8);
}

.brand-cloud-blush-left {
  left: 0.26rem;
}

.brand-cloud-blush-right {
  right: 0.26rem;
}

.brand-cloud-mouth {
  left: 50%;
  top: 0.62rem;
  width: 0.34rem;
  height: 0.16rem;
  border-bottom: 2px solid #37517d;
  border-radius: 0 0 999px 999px;
  transform: translateX(-50%);
}

.knowledge-chat-btn,
.new-chat-btn,
.quick-prompt-btn,
.conversation-item {
  box-shadow: 0 10px 22px rgba(43, 63, 108, 0.04);
}

.knowledge-chat-btn,
.new-chat-btn,
.quick-prompt-btn {
  border-color: rgba(199, 209, 225, 0.72);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(247, 250, 255, 0.92));
}

.knowledge-chat-btn {
  background: linear-gradient(135deg, rgba(232, 241, 255, 0.96), rgba(251, 246, 235, 0.98));
  border-color: rgba(165, 188, 230, 0.62);
  color: #15335f;
}

.knowledge-chat-btn.active {
  background: linear-gradient(135deg, #18335e 0%, #2a579f 100%);
  border-color: rgba(33, 73, 138, 0.9);
  color: #fff;
}

.new-chat-btn {
  color: #1f2d42;
}

.conversation-list-scroll {
  padding-top: 0.18rem;
  padding-right: 0.25rem;
}

.conversation-list-scroll::-webkit-scrollbar {
  width: 7px;
}

.conversation-list-scroll::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(146, 163, 191, 0.75), rgba(117, 135, 165, 0.75));
}

.conversation-item {
  position: relative;
  border-color: rgba(207, 216, 229, 0.8);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(249, 251, 255, 0.94));
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.conversation-item:hover {
  transform: translateY(-1px);
  border-color: rgba(171, 191, 223, 0.88);
  box-shadow: 0 14px 24px rgba(47, 76, 136, 0.08);
}

.conversation-item.active {
  border-color: rgba(79, 120, 192, 0.75);
  background: linear-gradient(135deg, rgba(235, 243, 255, 0.98), rgba(255, 253, 247, 0.98));
  box-shadow: 0 16px 28px rgba(53, 84, 145, 0.11);
}

.conversation-item.active::before {
  content: '';
  position: absolute;
  inset: 0.4rem auto 0.4rem 0.42rem;
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, #2f65bd 0%, #84a9ea 100%);
}

.conversation-item.active .conversation-title {
  padding-left: 0.4rem;
}

.chat-main {
  background: transparent;
}

.topbar {
  position: relative;
  border-bottom: 1px solid rgba(202, 213, 229, 0.58);
  background: rgba(250, 252, 255, 0.72);
  backdrop-filter: blur(20px);
}

.topbar::after {
  content: '';
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(161, 176, 199, 0.65) 18%, rgba(161, 176, 199, 0.65) 82%, transparent 100%);
}

.top-icon-btn,
.auth-btn,
.user-chip {
  border-color: rgba(204, 214, 228, 0.8);
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(12px);
}

.top-icon-btn:hover {
  background: rgba(247, 250, 255, 0.96);
}

.top-center {
  transform: translateY(2px);
}

.top-center h1 {
  font: 700 0.98rem/1.15 'Avenir Next', 'PingFang SC', sans-serif;
  color: #23344d;
  letter-spacing: -0.02em;
}

.top-center p {
  color: #8a97aa;
}

.auth-btn.primary {
  background: linear-gradient(135deg, #18345f 0%, #2857a0 100%);
  border-color: #18345f;
  box-shadow: 0 12px 24px rgba(33, 63, 122, 0.18);
}

.user-chip {
  color: #2d3b52;
  box-shadow: 0 10px 24px rgba(45, 62, 96, 0.08);
}

.chat-panel {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.1), transparent 16%),
    transparent;
}

.chat-content {
  position: relative;
}

.empty-state h2 {
  color: #15243b;
  letter-spacing: -0.04em;
  text-shadow: 0 12px 32px rgba(98, 125, 176, 0.14);
}

.suggestion-chip {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(237, 242, 249, 0.96));
  border: 1px solid rgba(214, 222, 235, 0.85);
  color: #314157;
  box-shadow: 0 12px 26px rgba(41, 59, 103, 0.05);
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.suggestion-chip:hover {
  background: linear-gradient(180deg, rgba(255, 255, 255, 1), rgba(240, 245, 252, 1));
  border-color: rgba(165, 184, 214, 0.92);
  box-shadow: 0 16px 30px rgba(55, 82, 136, 0.09);
  transform: translateY(-2px);
}

.message-bubble {
  border-color: rgba(216, 224, 237, 0.82);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(250, 252, 255, 0.94));
  box-shadow: 0 16px 28px rgba(38, 55, 97, 0.05);
}

.message-row.assistant .message-bubble {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(246, 249, 255, 0.92));
}

.message-row.user .message-bubble {
  background: linear-gradient(135deg, rgba(235, 243, 255, 0.92), rgba(255, 249, 239, 0.92));
  border-color: rgba(187, 205, 233, 0.9);
  box-shadow: 0 18px 30px rgba(53, 79, 130, 0.09);
}

.role-tag {
  color: #728097;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.thinking-box {
  border-color: rgba(217, 225, 239, 0.88);
  background: linear-gradient(180deg, rgba(250, 252, 255, 0.96), rgba(243, 246, 252, 0.94));
}

.thinking-header {
  color: #4e5f77;
}

.thinking-body {
  border-top-color: rgba(224, 229, 237, 0.9);
  color: #5a6678;
}

.composer-wrap {
  background: linear-gradient(180deg, transparent 0%, rgba(244, 248, 253, 0.88) 42%, rgba(244, 248, 253, 0.98) 100%);
}

.composer {
  border: 1px solid rgba(194, 208, 229, 0.88);
  border-radius: 1.6rem;
  background: rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(18px);
  box-shadow: 0 24px 44px rgba(41, 63, 110, 0.1);
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;
}

.composer:focus-within {
  border-color: rgba(117, 154, 218, 0.95);
  box-shadow:
    0 26px 48px rgba(40, 67, 121, 0.12),
    0 0 0 4px rgba(117, 154, 218, 0.12);
  transform: translateY(-1px);
}

.selected-skill-chip,
.selected-knowledge-chip {
  border-color: rgba(212, 219, 233, 0.92);
  background: rgba(255, 255, 255, 0.94);
  color: #53637c;
  box-shadow: 0 10px 22px rgba(43, 60, 101, 0.06);
}

.composer-input {
  color: #1b2a3f;
}

.composer-input::placeholder {
  color: #9eaaba;
}

.tool-btn,
.mode-trigger,
.send-btn.ghost {
  background: linear-gradient(180deg, rgba(247, 249, 252, 0.98), rgba(236, 241, 248, 0.98));
  border: 1px solid rgba(208, 217, 231, 0.86);
  box-shadow: 0 10px 20px rgba(38, 54, 91, 0.04);
}

.tool-btn {
  display: grid;
  place-items: center;
  color: #324257;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.tool-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(171, 188, 214, 0.96);
  box-shadow: 0 14px 24px rgba(51, 76, 128, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(239, 244, 251, 0.98));
}

.mode-trigger {
  position: relative;
  height: 38px;
  padding: 0 0.92rem;
  font-size: 0.88rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: #223146;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease,
    color 0.18s ease;
}

.mode-trigger:hover {
  transform: translateY(-1px);
  border-color: rgba(166, 184, 211, 0.94);
  box-shadow: 0 14px 26px rgba(52, 76, 128, 0.08);
}

.mode-trigger-mode {
  background: linear-gradient(135deg, rgba(240, 246, 255, 1), rgba(248, 251, 255, 0.98));
  color: #224168;
}

.mode-trigger-skill {
  background: linear-gradient(135deg, rgba(242, 248, 239, 0.98), rgba(255, 250, 240, 0.98));
  color: #2f4c40;
}

.knowledge-ask-trigger {
  background: linear-gradient(135deg, rgba(232, 241, 255, 1), rgba(255, 248, 233, 0.98));
  border-color: rgba(173, 190, 220, 0.95);
  color: #173a6a;
  box-shadow: 0 12px 22px rgba(71, 104, 168, 0.09);
}

.mode-dropdown,
.knowledge-ask-dropdown,
.skill-dropdown {
  border-color: rgba(213, 220, 232, 0.92);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(18px);
  box-shadow: 0 24px 44px rgba(24, 40, 75, 0.15);
}

.knowledge-ask-item,
.mode-item,
.skill-item {
  border: 1px solid rgba(221, 227, 236, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(245, 248, 252, 0.94));
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.knowledge-ask-item:hover,
.mode-item:hover,
.skill-item:hover {
  transform: translateY(-1px);
  border-color: rgba(177, 194, 220, 0.96);
  box-shadow: 0 12px 22px rgba(52, 78, 130, 0.08);
}

.knowledge-ask-item.active {
  border-color: rgba(145, 171, 220, 0.98);
  background: linear-gradient(180deg, rgba(236, 243, 255, 0.98), rgba(227, 237, 255, 0.96));
}

.send-btn {
  background: linear-gradient(135deg, #18345f 0%, #2a579f 100%);
  box-shadow: 0 14px 28px rgba(34, 63, 121, 0.2);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    filter 0.18s ease;
}

.send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 18px 32px rgba(31, 62, 126, 0.25);
  filter: saturate(1.05);
}

.logout-floating {
  border-color: rgba(208, 216, 228, 0.86);
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(16px);
}

.modal-mask {
  background: rgba(20, 27, 42, 0.24);
  backdrop-filter: blur(8px);
}

.modal-card {
  border-color: rgba(219, 224, 234, 0.86);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(18px);
  box-shadow: 0 28px 64px rgba(18, 32, 62, 0.2);
}

.hitl-item,
.hitl-readonly-value,
.field input,
.field select,
.text-btn,
.solid-btn {
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.field input,
.field select {
  background: rgba(255, 255, 255, 0.94);
}

.field input:focus,
.field select:focus {
  box-shadow: 0 0 0 4px rgba(113, 148, 214, 0.12);
}

.solid-btn {
  background: linear-gradient(135deg, #18345f 0%, #2857a0 100%);
  border-color: #18345f;
  box-shadow: 0 12px 24px rgba(32, 58, 112, 0.16);
}

@media (max-width: 960px) {
  .doubao-shell,
  .doubao-shell.collapsed {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
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

  .skill-dropdown {
    width: min(92vw, 420px);
    left: -40px;
    grid-template-columns: 1fr;
  }

  .skill-list {
    border-right: none;
    border-bottom: 1px solid #ececf2;
    padding-right: 0;
    padding-bottom: 0.45rem;
  }

  .hitl-arg-grid {
    grid-template-columns: 1fr;
  }

  .selected-binding-chips {
    left: 0.45rem;
  }

  .auth-btn {
    padding: 0 0.72rem;
  }
}
</style>
