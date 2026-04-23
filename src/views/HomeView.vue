<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { callAgentStream, resumeAgentStream } from '@/api/agent'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listHistoryByConversation,
  listMyConversations,
  updateConversationSkills,
} from '@/api/chat'
import { getHitlCheckpoint, resolveHitlCheckpoint } from '@/api/hitl'
import { listSkills } from '@/api/skill'
import { getLoginUser, userLogin, userLogout, userRegister } from '@/api/user'
import type {
  AgentCallRequest,
  AgentErrorPayload,
  AgentFinalAnswerPayload,
  AgentHitlInterruptPayload,
  AgentStreamEvent,
  AgentThinkingStepPayload,
  PendingToolCall,
} from '@/types/agent'
import type { ChatConversation, ChatMemoryHistory } from '@/types/chat'
import type { HitlCheckpointResolveRequest } from '@/types/hitl'
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
}

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

interface HitlArgumentEditor {
  value: JsonValue | null
  parseError: string
}

interface HitlArgumentSpecRecord {
  type?: string
  defaultValue?: JsonValue
}

interface HitlArgumentField {
  path: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'null'
  value: JsonPrimitive
}

const chatRef = ref<HTMLElement | null>(null)
const modeMenuRef = ref<HTMLElement | null>(null)
const skillMenuRef = ref<HTMLElement | null>(null)
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
const skills = ref<SkillMetadataVO[]>([])
const hoveredSkillName = ref('')
const selectedSkillName = ref('')

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
const hoveredSkill = computed(() => {
  const name = hoveredSkillName.value || selectedSkillName.value
  return skills.value.find((item) => item.name === name)
})

function resolveSelectedSkills(conversation: ChatConversation | undefined): string[] {
  if (!conversation) {
    return []
  }
  if (Array.isArray(conversation.selectedSkillList) && conversation.selectedSkillList.length > 0) {
    return conversation.selectedSkillList
  }
  if (conversation.selectedSkills) {
    try {
      const parsed = JSON.parse(conversation.selectedSkills)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean)
      }
    } catch {
      return []
    }
  }
  return []
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
    selectedSkillName.value = ''
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '新建会话失败，请稍后再试。'
  }
}

function toggleModeMenu() {
  showSkillMenu.value = false
  showModeMenu.value = !showModeMenu.value
}

async function toggleSkillMenu() {
  showModeMenu.value = false
  showSkillMenu.value = !showSkillMenu.value
  if (!showSkillMenu.value) {
    return
  }
  await loadSkills()
  hoveredSkillName.value = selectedSkillName.value
}

function chooseMode(nextMode: 'fast' | 'thinking') {
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
      } else {
        await syncActiveConversationDetail(activeConversationId.value)
      }
    } else if (!keepCurrentSelection) {
      selectedSkillName.value = ''
    }
  } finally {
    conversationLoading.value = false
  }
}

async function syncActiveConversationDetail(conversationId: string) {
  if (!conversationId) {
    selectedSkillName.value = ''
    return
  }
  try {
    const detail = await getConversation(conversationId)
    conversations.value = conversations.value.map((item) =>
      item.conversationId === conversationId ? { ...item, ...detail } : item,
    )
    selectedSkillName.value = resolveSelectedSkills(detail)[0] || ''
  } catch {
    const active = conversations.value.find((item) => item.conversationId === conversationId)
    selectedSkillName.value = resolveSelectedSkills(active)[0] || ''
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

  const allFields = flattenArgumentFields(editor.value)
  const hasStructuredArguments = allFields.some(
    (field) => field.path.startsWith('arguments.') || field.path.startsWith('arguments['),
  )

  if (hasStructuredArguments) {
    return allFields
      .filter((field) => field.path.startsWith('arguments.') || field.path.startsWith('arguments['))
      .map((field) => ({
        ...field,
        label: field.label.replace(/^arguments(\.|\[)/, (_value, token: string) => (token === '[' ? '[' : '')),
      }))
  }

  return allFields.filter((field) => field.path !== 'skillName' && field.path !== 'scriptPath')
}

function updateHitlArgumentField(toolId: string, field: HitlArgumentField, rawValue: string | boolean) {
  const editor = hitlArgumentEditors.value[toolId]
  if (!editor || editor.value === null) {
    return
  }

  let nextValue: JsonPrimitive = rawValue as JsonPrimitive
  if (field.type === 'number') {
    const numeric = Number(rawValue)
    nextValue = Number.isNaN(numeric) ? 0 : numeric
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
  return JSON.stringify(editor.value)
}

function updateHitlFeedback(id: string, patch: Partial<PendingToolCall>) {
  hitlFeedbacks.value = hitlFeedbacks.value.map((item) => (item.id === id ? { ...item, ...patch } : item))
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
    hitlFeedbacks.value.map((tool) => [tool.id, parseToolArguments(tool.arguments)]),
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
  const assistantMessage = interruptedAssistantMessage.value
  if (!assistantMessage) {
    authError.value = '会话状态异常，请重新发起提问。'
    return
  }

  try {
    agentRunStatus.value = 'resolving'
    const payload: HitlCheckpointResolveRequest = {
      interruptId: currentInterruptId.value,
      feedbacks: hitlFeedbacks.value.map((item) => ({
        id: item.id,
        name: item.name,
        arguments: serializeToolArguments(item.id),
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
    interruptedAssistantMessage.value = null
    currentInterruptId.value = ''
    hitlToolCalls.value = []
    hitlFeedbacks.value = []
    hitlArgumentEditors.value = {}
    activeAssistantMessage.value = null
    controller.value = null
    agentRunStatus.value = 'finished'
    void loadConversations(false)
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '处理审批失败，请稍后重试。'
    agentRunStatus.value = 'error'
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
          <div v-if="selectedSkillName" class="selected-skill-chip">
            已绑定 Skill：{{ selectedSkillName }}
          </div>
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

              <div ref="skillMenuRef" class="skill-picker">
                <button class="mode-trigger skill-trigger" type="button" @click.stop="toggleSkillMenu">
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
        <p class="logout-desc">请确认以下工具调用，再继续 Agent 执行。</p>
        <div class="hitl-list">
          <div v-for="tool in hitlFeedbacks" :key="tool.id" class="hitl-item">
            <p class="hitl-desc">{{ displayHitlDescription(tool.description) }}</p>
            <div class="hitl-meta" v-if="getLockedToolMeta(tool.id).skillName">
              <p v-if="getLockedToolMeta(tool.id).skillName">技能：{{ getLockedToolMeta(tool.id).skillName }}</p>
            </div>
            <label class="field">
              <span>处理结果</span>
              <select
                :value="tool.result || 'APPROVED'"
                @change="
                  updateHitlFeedback(tool.id, {
                    result: ($event.target as HTMLSelectElement).value as PendingToolCall['result'],
                  })
                "
              >
                <option value="APPROVED">同意执行</option>
                <option value="REJECTED">拒绝执行</option>
                <option value="EDIT">修改参数后执行</option>
              </select>
            </label>
            <p v-if="hitlArgumentEditors[tool.id]?.parseError" class="error-tip hitl-error-inline">
              {{ hitlArgumentEditors[tool.id]?.parseError }}
            </p>
            <div v-else class="hitl-arg-grid">
              <template v-if="getHitlArgumentFields(tool.id).length > 0">
                <label
                  v-for="field in getHitlArgumentFields(tool.id)"
                  :key="`${tool.id}-${field.path}`"
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
                          tool.id,
                          field,
                          ($event.target as HTMLInputElement).value,
                        )
                      "
                    />
                    <input
                      v-else-if="field.type === 'number'"
                      :value="String(field.value ?? 0)"
                      type="number"
                      @input="
                        updateHitlArgumentField(
                          tool.id,
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
                          tool.id,
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
                          tool.id,
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
  position: relative;
  width: min(920px, calc(100% - 4px));
  margin: 0 auto;
  border: 1px solid #111;
  border-radius: 1.45rem;
  background: #fff;
  box-shadow: 0 3px 18px rgba(0, 0, 0, 0.05);
  padding: 0.66rem 0.78rem 0.58rem;
}

.selected-skill-chip {
  position: absolute;
  top: -1.1rem;
  left: 0.85rem;
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
  gap: 0.45rem;
}

.skill-list {
  border-right: 1px solid #ececf2;
  padding-right: 0.45rem;
  max-height: 240px;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 0.3rem;
}

.skill-item {
  border: 1px solid #ececf2;
  background: #fff;
  border-radius: 0.65rem;
  text-align: left;
  padding: 0.45rem 0.52rem;
  font-size: 0.82rem;
  cursor: pointer;
}

.skill-item:hover,
.skill-item.active {
  border-color: #1f2937;
}

.skill-item.unbind {
  color: #9a3a3a;
}

.skill-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.skill-desc {
  padding: 0.45rem 0.55rem;
  color: #5c6472;
  font-size: 0.82rem;
  line-height: 1.5;
}

.skill-hint {
  color: #98a0ad;
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

.hitl-card {
  width: min(680px, calc(100% - 2rem));
}

.hitl-list {
  max-height: 360px;
  overflow: auto;
  display: grid;
  gap: 0.65rem;
}

.hitl-item {
  border: 1px solid #e6e6eb;
  border-radius: 0.75rem;
  padding: 0.65rem;
}

.hitl-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: #22242a;
}

.hitl-desc {
  margin-top: 0.2rem;
  margin-bottom: 0.35rem;
  font-size: 0.8rem;
  color: #6a7280;
}

.hitl-meta {
  margin: 0 0 0.45rem;
  display: grid;
  gap: 0.15rem;
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

  .selected-skill-chip {
    left: 0.45rem;
  }

  .auth-btn {
    padding: 0 0.72rem;
  }
}
</style>
