<script setup lang="ts">
import { message } from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LoginUserVO } from '@/types/user'
import type { UserLongTermMemory, UserPetState } from '@/types/userMemory'
import {
  deleteUserMemory,
  getUserPetState,
  listUserMemories,
  rebuildUserMemories,
  renameUserPet,
} from '@/api/userMemory'

const props = defineProps<{
  currentUser: LoginUserVO | null
}>()

const emit = defineEmits<{
  (event: 'request-login'): void
}>()

const STORAGE_KEY = 'cloud-cold-pet-position'
const FAB_SIZE = 66
const EDGE_PADDING = 12
const PANEL_GAP = 14
const ACTION_LOCK_MS = 1000
const panelOpen = ref(false)
const dragging = ref(false)
const loading = ref(false)
const actionLoading = ref(false)
const state = ref<UserPetState | null>(null)
const memories = ref<UserLongTermMemory[]>([])
const feedback = ref('')
const petNameDraft = ref('')
const position = ref({ x: 24, y: 24 })
let dragPointerId: number | null = null
let dragOffsetX = 0
let dragOffsetY = 0

const isLoggedIn = computed(() => props.currentUser !== null)
const petMood = computed(() => state.value?.petMood || 'idle')
const petName = computed(() => state.value?.petName || '小冷')
const widgetStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}))
const panelStyle = computed(() => {
  if (typeof window === 'undefined') {
    return {
      left: `${FAB_SIZE + PANEL_GAP}px`,
      top: '0px',
    }
  }

  const panelWidth = Math.min(360, window.innerWidth - EDGE_PADDING * 2)
  const panelHeight = Math.min(window.innerHeight * 0.7, 680)
  const preferredRight = position.value.x + FAB_SIZE + PANEL_GAP
  const canPlaceRight = preferredRight + panelWidth <= window.innerWidth - EDGE_PADDING
  const left = canPlaceRight
    ? FAB_SIZE + PANEL_GAP
    : -panelWidth - PANEL_GAP

  const minTopOffset = EDGE_PADDING - position.value.y
  const maxTopOffset = window.innerHeight - EDGE_PADDING - panelHeight - position.value.y
  const top = Math.min(Math.max(0, minTopOffset), maxTopOffset)

  return {
    left: `${left}px`,
    top: `${top}px`,
  }
})
const learningLabel = computed(() => {
  if (petMood.value === 'learning') {
    return `正在整理记忆，还有 ${state.value?.pendingConversationCount ?? 0} 个会话待处理`
  }
  if (petMood.value === 'updated') {
    return '刚刚学到了新东西'
  }
  return ''
})

const memoryTypeLabelMap: Record<string, string> = {
  USER_PROFILE: '用户信息',
  FACT: '客观事实',
  PREFERENCE: '行为偏好',
}

watch(
  () => props.currentUser?.id ?? null,
  async (userId) => {
    if (!userId) {
      state.value = null
      memories.value = []
      panelOpen.value = false
      return
    }
    await refreshState()
  },
  { immediate: true },
)

onMounted(() => {
  restorePosition()
})

onBeforeUnmount(() => {
  if (dragPointerId !== null) {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerUp)
  }
})

async function refreshState() {
  if (!isLoggedIn.value) {
    return
  }
  loading.value = true
  feedback.value = ''
  try {
    const [petState, allMemories] = await Promise.all([getUserPetState(), listUserMemories()])
    state.value = petState
    memories.value = allMemories
    petNameDraft.value = petState.petName
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : '加载宠物状态失败，请稍后再试。'
  } finally {
    loading.value = false
  }
}

function openPanel() {
  if (!isLoggedIn.value) {
    emit('request-login')
    return
  }
  panelOpen.value = !panelOpen.value
  if (panelOpen.value && !state.value) {
    void refreshState()
  }
}

function onPointerDown(event: PointerEvent) {
  if ((event.target as HTMLElement | null)?.closest('.pet-panel')) {
    return
  }
  dragging.value = true
  dragPointerId = event.pointerId
  dragOffsetX = event.clientX - position.value.x
  dragOffsetY = event.clientY - position.value.y
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging.value) {
    return
  }
  const nextX = Math.min(
    Math.max(EDGE_PADDING, event.clientX - dragOffsetX),
    Math.max(EDGE_PADDING, window.innerWidth - FAB_SIZE - EDGE_PADDING),
  )
  const nextY = Math.min(
    Math.max(EDGE_PADDING, event.clientY - dragOffsetY),
    Math.max(EDGE_PADDING, window.innerHeight - FAB_SIZE - EDGE_PADDING),
  )
  position.value = { x: nextX, y: nextY }
}

function handlePointerUp() {
  dragging.value = false
  dragPointerId = null
  persistPosition()
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
}

function persistPosition() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position.value))
}

function restorePosition() {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return
  }
  try {
    const parsed = JSON.parse(raw) as { x?: number; y?: number }
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      position.value = { x: parsed.x, y: parsed.y }
    }
  } catch {
    // ignore invalid local cache
  }
}

async function handleRename() {
  const nextName = petNameDraft.value.trim()
  if (!nextName) {
    feedback.value = '请输入宠物名称。'
    return
  }
  actionLoading.value = true
  feedback.value = ''
  try {
    await renameUserPet(nextName)
    await refreshState()
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : '修改宠物名称失败，请稍后再试。'
  } finally {
    actionLoading.value = false
  }
}

async function handleRebuild() {
  const start = Date.now()
  actionLoading.value = true
  feedback.value = ''
  try {
    await rebuildUserMemories()
    feedback.value = '已经开始主动整理长期记忆。'
    await refreshState()
  } catch (error) {
    const nextMessage = error instanceof Error ? error.message : '主动重建长期记忆失败，请稍后再试。'
    if (nextMessage.includes('5 分钟内最多主动重建一次长期记忆')) {
      void message.warning({
        content: nextMessage,
        duration: 2,
      })
    } else {
      feedback.value = nextMessage
    }
  } finally {
    const elapsed = Date.now() - start
    if (elapsed < ACTION_LOCK_MS) {
      await new Promise((resolve) => window.setTimeout(resolve, ACTION_LOCK_MS - elapsed))
    }
    actionLoading.value = false
  }
}

async function handleDeleteMemory(memoryId: string) {
  actionLoading.value = true
  feedback.value = ''
  try {
    await deleteUserMemory(memoryId)
    await refreshState()
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : '删除记忆失败，请稍后再试。'
  } finally {
    actionLoading.value = false
  }
}
function formatMemoryType(memoryType: string) {
  return memoryTypeLabelMap[memoryType] ?? memoryType
}
</script>

<template>
  <div
    class="pet-widget"
    :style="widgetStyle"
  >
    <button
      class="pet-fab"
      :class="[petMood, { dragging }]"
      type="button"
      @pointerdown="onPointerDown"
      @click="openPanel"
    >
      <span class="pet-core">
        <span class="pet-cloud">
          <span class="pet-cloud-eye pet-cloud-eye-left"></span>
          <span class="pet-cloud-eye pet-cloud-eye-right"></span>
          <span class="pet-cloud-blush pet-cloud-blush-left"></span>
          <span class="pet-cloud-blush pet-cloud-blush-right"></span>
          <span class="pet-cloud-mouth"></span>
        </span>
      </span>
    </button>

    <transition name="pet-panel-fade">
      <section v-if="panelOpen" class="pet-panel" :style="panelStyle">
        <div class="pet-panel-head">
          <div>
            <p class="pet-kicker">个人宠物</p>
            <h3>{{ petName }}</h3>
            <p v-if="learningLabel" class="pet-subtitle">{{ learningLabel }}</p>
          </div>
          <button class="pet-close" type="button" @click="panelOpen = false">×</button>
        </div>

        <div v-if="!isLoggedIn" class="pet-empty">
          登录后，宠物会开始沉淀你的长期记忆。
        </div>

        <template v-else>
          <div class="pet-stats">
            <div class="pet-stat">
              <span>记忆条数</span>
              <strong>{{ state?.memoryCount ?? 0 }}</strong>
            </div>
            <div class="pet-stat">
              <span>待处理会话</span>
              <strong>{{ state?.pendingConversationCount ?? 0 }}</strong>
            </div>
          </div>

          <div class="pet-actions">
            <button class="pet-action primary" type="button" :disabled="actionLoading" @click="handleRebuild">
              主动学习
            </button>
          </div>

          <label class="pet-rename">
            <span>宠物名称</span>
            <div class="pet-rename-row">
              <input v-model="petNameDraft" type="text" maxlength="20" placeholder="给它起个名字" />
              <button class="pet-mini-btn" type="button" :disabled="actionLoading" @click="handleRename">保存</button>
            </div>
          </label>

          <div class="pet-highlight-card">
            <p class="pet-section-title">它已经记住</p>
            <ul v-if="state?.memoryHighlights?.length" class="pet-highlight-list">
              <li v-for="highlight in state.memoryHighlights" :key="highlight">{{ highlight }}</li>
            </ul>
            <p v-else class="pet-empty-inline">还在慢慢认识你。</p>
          </div>

          <div class="pet-memory-list-wrap">
            <div class="pet-memory-head">
              <p class="pet-section-title">最近的长期记忆</p>
              <button class="pet-mini-btn ghost" type="button" :disabled="loading" @click="refreshState">刷新</button>
            </div>
            <div v-if="loading" class="pet-empty-inline">正在读取宠物记忆...</div>
            <div v-else-if="memories.length === 0" class="pet-empty-inline">还没有沉淀出长期记忆。</div>
            <div v-else class="pet-memory-list">
              <article v-for="memory in memories.slice(0, 8)" :key="memory.id" class="pet-memory-card">
                <div class="pet-memory-top">
                  <span class="pet-memory-type">{{ formatMemoryType(memory.memoryType) }}</span>
                  <button class="pet-memory-delete" type="button" :disabled="actionLoading" @click="handleDeleteMemory(memory.id)">
                    删除
                  </button>
                </div>
                <h4>{{ memory.title || memory.summary }}</h4>
                <p>{{ memory.content }}</p>
                <div class="pet-memory-meta">
                  <span v-if="memory.sourceConversationIds?.length">来源会话 {{ memory.sourceConversationIds.length }}</span>
                  <span v-if="memory.sourceHistoryCount">来源消息 {{ memory.sourceHistoryCount }}</span>
                  <span v-if="memory.lastRetrievedAt">最近命中 {{ new Date(memory.lastRetrievedAt).toLocaleString() }}</span>
                </div>
              </article>
            </div>
          </div>

          <p v-if="feedback" class="pet-feedback">{{ feedback }}</p>
        </template>
      </section>
    </transition>
  </div>
</template>

<style scoped>
.pet-widget {
  position: fixed;
  z-index: 55;
  width: 66px;
  height: 66px;
}

.pet-fab {
  position: relative;
  width: 66px;
  height: 66px;
  border: none;
  border-radius: 1.35rem;
  background:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.2) 26%),
    linear-gradient(145deg, rgba(39, 79, 144, 0.96), rgba(111, 153, 238, 0.92));
  box-shadow:
    0 18px 38px rgba(32, 56, 105, 0.22),
    inset 0 0 0 1px rgba(255, 255, 255, 0.35);
  cursor: grab;
  display: grid;
  place-items: center;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    filter 0.2s ease;
}

.pet-fab:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow:
    0 22px 42px rgba(31, 53, 99, 0.24),
    inset 0 0 0 1px rgba(255, 255, 255, 0.38);
}

.pet-fab.dragging {
  cursor: grabbing;
  transform: scale(1.04);
}

.pet-fab.learning {
  animation: pet-pulse 1.6s ease-in-out infinite;
}

.pet-fab.updated {
  filter: saturate(1.12);
}

.pet-fab.disabled {
  background:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.16) 26%),
    linear-gradient(145deg, rgba(122, 133, 152, 0.92), rgba(175, 183, 198, 0.9));
}

.pet-core {
  width: 46px;
  height: 40px;
  display: grid;
  place-items: center;
}

.pet-cloud {
  position: relative;
  width: 40px;
  height: 24px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffffff, #eef6ff);
  box-shadow:
    0 8px 18px rgba(29, 53, 102, 0.18),
    inset 0 -2px 0 rgba(191, 214, 243, 0.72);
}

.pet-cloud::before,
.pet-cloud::after {
  content: '';
  position: absolute;
  bottom: 7px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffffff, #eef6ff);
}

.pet-cloud::before {
  left: 4px;
  width: 15px;
  height: 15px;
}

.pet-cloud::after {
  right: 4px;
  width: 18px;
  height: 18px;
}

.pet-cloud-eye,
.pet-cloud-blush,
.pet-cloud-mouth {
  position: absolute;
  z-index: 1;
}

.pet-cloud-eye {
  top: 11px;
  width: 4px;
  height: 6px;
  border-radius: 999px;
  background: #35527f;
}

.pet-cloud-eye-left {
  left: 13px;
}

.pet-cloud-eye-right {
  right: 13px;
}

.pet-cloud-blush {
  top: 15px;
  width: 7px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 173, 194, 0.75);
}

.pet-cloud-blush-left {
  left: 6px;
}

.pet-cloud-blush-right {
  right: 6px;
}

.pet-cloud-mouth {
  left: 50%;
  top: 16px;
  width: 8px;
  height: 4px;
  border-bottom: 2px solid #35527f;
  border-radius: 0 0 999px 999px;
  transform: translateX(-50%);
}

.pet-panel {
  position: absolute;
  width: min(360px, calc(100vw - 2rem));
  max-height: min(70vh, 680px);
  overflow: auto;
  border-radius: 1.4rem;
  padding: 1rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(246, 250, 255, 0.94));
  border: 1px solid rgba(208, 218, 234, 0.88);
  box-shadow: 0 30px 60px rgba(32, 55, 103, 0.18);
  backdrop-filter: blur(22px);
}

.pet-panel-fade-enter-active,
.pet-panel-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.pet-panel-fade-enter-from,
.pet-panel-fade-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.pet-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}

.pet-kicker {
  margin: 0 0 0.12rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: #7b8aa3;
  letter-spacing: 0.08em;
}

.pet-panel-head h3 {
  margin: 0;
  font: 700 1.12rem/1.1 'Avenir Next', 'PingFang SC', sans-serif;
  color: #1b2d47;
}

.pet-subtitle {
  margin: 0.22rem 0 0;
  font-size: 0.82rem;
  color: #65748c;
  line-height: 1.45;
}

.pet-close,
.pet-mini-btn,
.pet-action,
.pet-memory-delete {
  border: none;
  cursor: pointer;
}

.pet-close {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: rgba(233, 239, 249, 0.96);
  color: #4f607a;
  font-size: 1.1rem;
}

.pet-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.62rem;
  margin-bottom: 0.78rem;
}

.pet-stat {
  border-radius: 1rem;
  padding: 0.8rem 0.86rem;
  background: linear-gradient(180deg, rgba(244, 248, 255, 0.98), rgba(235, 241, 251, 0.98));
  border: 1px solid rgba(213, 223, 238, 0.84);
  display: grid;
  gap: 0.2rem;
}

.pet-stat span {
  font-size: 0.74rem;
  color: #76849b;
}

.pet-stat strong {
  font-size: 1.12rem;
  color: #203350;
}

.pet-actions {
  display: flex;
  gap: 0.55rem;
  margin-bottom: 0.85rem;
}

.pet-action {
  flex: 1;
  min-height: 38px;
  border-radius: 0.9rem;
  background: rgba(235, 240, 248, 0.96);
  color: #30435f;
  font-weight: 600;
}

.pet-action.primary {
  background: linear-gradient(135deg, #1e4277, #4f7ed2);
  color: #fff;
  box-shadow: 0 14px 24px rgba(44, 76, 138, 0.18);
}

.pet-rename {
  display: grid;
  gap: 0.34rem;
  margin-bottom: 0.9rem;
}

.pet-rename span,
.pet-section-title {
  font-size: 0.76rem;
  font-weight: 700;
  color: #677791;
  letter-spacing: 0.04em;
}

.pet-rename-row {
  display: flex;
  gap: 0.48rem;
}

.pet-rename-row input {
  flex: 1;
  min-width: 0;
  min-height: 38px;
  border-radius: 0.9rem;
  border: 1px solid rgba(209, 219, 233, 0.9);
  background: rgba(255, 255, 255, 0.96);
  padding: 0 0.82rem;
  outline: none;
}

.pet-rename-row input:focus {
  border-color: rgba(110, 146, 209, 0.94);
  box-shadow: 0 0 0 4px rgba(110, 146, 209, 0.12);
}

.pet-mini-btn {
  min-width: 62px;
  padding: 0 0.78rem;
  border-radius: 0.9rem;
  background: #edf2fb;
  color: #385178;
  font-weight: 600;
}

.pet-mini-btn.ghost {
  background: transparent;
  border: 1px solid rgba(208, 217, 232, 0.88);
}

.pet-highlight-card,
.pet-memory-card {
  border-radius: 1rem;
  border: 1px solid rgba(216, 225, 239, 0.85);
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 12px 26px rgba(49, 71, 117, 0.06);
}

.pet-highlight-card {
  padding: 0.82rem 0.9rem;
  margin-bottom: 0.9rem;
}

.pet-highlight-list {
  margin: 0.55rem 0 0;
  padding-left: 1.15rem;
  display: grid;
  gap: 0.34rem;
  color: #334861;
  font-size: 0.84rem;
  line-height: 1.5;
}

.pet-memory-list-wrap {
  display: grid;
  gap: 0.6rem;
}

.pet-memory-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
}

.pet-memory-list {
  display: grid;
  gap: 0.6rem;
}

.pet-memory-card {
  padding: 0.82rem 0.9rem;
}

.pet-memory-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  margin-bottom: 0.38rem;
}

.pet-memory-type {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #6b7f9d;
}

.pet-memory-card h4 {
  margin: 0 0 0.25rem;
  font-size: 0.92rem;
  color: #223651;
}

.pet-memory-card p {
  margin: 0;
  color: #4f5f76;
  font-size: 0.83rem;
  line-height: 1.5;
}

.pet-memory-meta {
  margin-top: 0.55rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  color: #7a879a;
  font-size: 0.72rem;
}

.pet-memory-delete {
  background: transparent;
  color: #9a4f4f;
  font-size: 0.76rem;
}

.pet-empty,
.pet-empty-inline,
.pet-feedback {
  font-size: 0.82rem;
  line-height: 1.5;
}

.pet-empty,
.pet-empty-inline {
  color: #74839a;
}

.pet-feedback {
  margin: 0.78rem 0 0;
  color: #34598c;
}

@keyframes pet-pulse {
  0%,
  100% {
    transform: scale(1);
    box-shadow:
      0 18px 38px rgba(32, 56, 105, 0.22),
      inset 0 0 0 1px rgba(255, 255, 255, 0.35);
  }
  50% {
    transform: scale(1.03);
    box-shadow:
      0 22px 44px rgba(33, 61, 116, 0.26),
      0 0 0 10px rgba(82, 124, 204, 0.1),
      inset 0 0 0 1px rgba(255, 255, 255, 0.35);
  }
}
</style>
