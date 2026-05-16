<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { AgentMultiAgentStepPayload } from '@/types/agent'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  visible: boolean
  expanded: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

interface PlanTask {
  id: string
  toolName: string
  order: number
  summary: string
}

interface WorkerState {
  workerId: string
  taskId: string
  description: string
  status: 'running' | 'completed' | 'failed'
  content: string
  summary: string
  expanded: boolean
}

const STORAGE_KEY = 'cloud-cold-ma-panel-position'
const PANEL_WIDTH = 380
const EDGE_PADDING = 12

const plan = ref<PlanTask[]>([])
const workers = ref<WorkerState[]>([])
const dragging = ref(false)
const position = ref({ x: -1, y: -1 })
let dragPointerId: number | null = null
let dragOffsetX = 0
let dragOffsetY = 0

watch(() => props.expanded, (val) => {
  if (val) initPosition()
})

function processEvent(evt: AgentMultiAgentStepPayload) {
  if (!evt?.event) return

  switch (evt.event) {
    case 'plan': {
      if (evt.planData) {
        try {
          plan.value = JSON.parse(evt.planData) as PlanTask[]
        } catch {
          plan.value = []
        }
      }
      break
    }
    case 'worker_start': {
      if (evt.workerId) {
        workers.value.push({
          workerId: evt.workerId,
          taskId: evt.taskId || '',
          description: evt.description || evt.taskId || '',
          status: 'running',
          content: '',
          summary: '',
          expanded: false,
        })
      }
      break
    }
    case 'worker_delta': {
      const w = workers.value.find(
        (w) => w.workerId === evt.workerId && w.taskId === evt.taskId,
      )
      if (w && evt.content) {
        w.content += evt.content
      }
      break
    }
    case 'worker_result': {
      const w = workers.value.find(
        (w) => w.workerId === evt.workerId && w.taskId === evt.taskId,
      )
      if (w) {
        w.status = evt.success ? 'completed' : 'failed'
        w.summary = evt.summary || evt.content || ''
      }
      break
    }
  }
}

function initPosition() {
  if (position.value.x >= 0) return
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      position.value.x = parsed.x
      position.value.y = parsed.y
      clampPosition()
      return
    } catch { /* ignore */ }
  }
  position.value.x = window.innerWidth - PANEL_WIDTH - EDGE_PADDING
  position.value.y = 120
}

function clampPosition() {
  position.value.x = Math.max(EDGE_PADDING, Math.min(position.value.x, window.innerWidth - PANEL_WIDTH - EDGE_PADDING))
  position.value.y = Math.max(EDGE_PADDING, Math.min(position.value.y, window.innerHeight - EDGE_PADDING))
}

function savePosition() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: position.value.x, y: position.value.y }))
}

function onPanelPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.ma-panel-header')) return

  initPosition()
  dragging.value = true
  dragPointerId = event.pointerId
  dragOffsetX = event.clientX - position.value.x
  dragOffsetY = event.clientY - position.value.y
  ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== dragPointerId) return
  position.value.x = event.clientX - dragOffsetX
  position.value.y = event.clientY - dragOffsetY
  clampPosition()
}

function handlePointerUp(event: PointerEvent) {
  if (event.pointerId !== dragPointerId) return
  dragging.value = false
  dragPointerId = null
  savePosition()
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
}

const panelStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}))

const orders = computed(() => {
  const set = new Set(plan.value.map((t) => t.order))
  return [...set].sort((a, b) => a - b)
})

function tasksByOrder(order: number): PlanTask[] {
  return plan.value.filter((t) => t.order === order)
}

function getWorkerForTask(taskId: string): WorkerState | undefined {
  return workers.value.find((w) => w.taskId === taskId)
}

function statusIcon(taskId: string): string {
  const w = getWorkerForTask(taskId)
  if (!w) return ''
  switch (w.status) {
    case 'running': return '🔄'
    case 'completed': return '✓'
    case 'failed': return '✗'
  }
}

function statusClass(taskId: string): string {
  const w = getWorkerForTask(taskId)
  if (!w) return 'status-waiting'
  return `status-${w.status}`
}

function toggleWorker(worker: WorkerState) {
  worker.expanded = !worker.expanded
}

function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text || ''
  return text.slice(0, max) + '…'
}

defineExpose({
  handleEvent(payload: AgentMultiAgentStepPayload) {
    processEvent(payload)
  },
  reset() {
    plan.value = []
    workers.value = []
  },
})
</script>

<template>
  <div
    v-if="visible && expanded && plan.length > 0"
    class="ma-float-panel"
    :style="panelStyle"
    @pointerdown="onPanelPointerDown"
  >
    <div class="ma-panel-header">
      <span class="ma-panel-title">多智能体协作</span>
      <button class="ma-panel-close" type="button" @click="emit('close')">✕</button>
    </div>

    <div class="ma-panel-body">
      <div class="ma-plan-section">
        <div class="ma-section-title">任务拆解</div>
        <div v-for="order in orders" :key="order" class="ma-order-group">
          <div class="ma-order-label">Order {{ order }}</div>
          <div
            v-for="task in tasksByOrder(order)"
            :key="task.id"
            class="ma-task-item"
          >
            <span :class="['ma-task-status', statusClass(task.id)]">
              {{ statusIcon(task.id) }}
            </span>
            <span class="ma-task-summary">{{ truncate(task.summary || task.toolName, 30) }}</span>
          </div>
        </div>
      </div>

      <div v-if="workers.length > 0" class="ma-workers-section">
        <div class="ma-section-title">Worker 执行 ({{ workers.length }})</div>
        <div
          v-for="worker in workers"
          :key="`${worker.workerId}-${worker.taskId}-${workers.indexOf(worker)}`"
          class="ma-worker-item"
        >
          <div
            class="ma-worker-header"
            :class="`worker-${worker.status}`"
            @click="toggleWorker(worker)"
          >
            <span class="ma-worker-status">
              {{ worker.status === 'running' ? '🔄' : worker.status === 'completed' ? '✓' : '✗' }}
            </span>
            <span class="ma-worker-id">{{ worker.workerId }}</span>
            <span class="ma-worker-desc">{{ truncate(worker.description, 24) }}</span>
            <span class="ma-worker-toggle">{{ worker.expanded ? '▾' : '▸' }}</span>
          </div>
          <div v-if="worker.expanded" class="ma-worker-body">
            <div class="ma-worker-output" v-html="renderMarkdown(worker.content || worker.summary) || '输出为空'"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ma-float-panel {
  position: fixed;
  width: 380px;
  max-height: 520px;
  border-radius: 10px;
  border: 1px solid #e0e0e0;
  background: #fff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  z-index: 900;
  user-select: none;
}

.ma-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #f0f0f0;
  cursor: grab;
  background: #fafafa;
  border-radius: 10px 10px 0 0;
  flex-shrink: 0;
}

.ma-panel-header:active {
  cursor: grabbing;
}

.ma-panel-title {
  font-weight: 600;
  font-size: 14px;
  color: #1677ff;
}

.ma-panel-close {
  width: 26px;
  height: 26px;
  border: none;
  background: none;
  font-size: 14px;
  color: #999;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.ma-panel-close:hover {
  background: #f0f0f0;
  color: #333;
}

.ma-panel-body {
  overflow-y: auto;
  padding: 10px 14px;
  font-size: 12px;
  flex: 1;
}

.ma-section-title {
  font-weight: 600;
  color: #888;
  margin-bottom: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ma-order-group {
  margin-bottom: 4px;
}

.ma-order-label {
  font-size: 10px;
  color: #bbb;
  margin-bottom: 2px;
  margin-left: 4px;
}

.ma-task-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 12px;
}

.ma-task-status {
  width: 18px;
  text-align: center;
  font-size: 11px;
  flex-shrink: 0;
}

.status-waiting { color: #bbb; }
.status-running { color: #1677ff; }
.status-completed { color: #52c41a; }
.status-failed { color: #ff4d4f; }

.ma-task-summary {
  color: #444;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ma-workers-section {
  margin-top: 8px;
  border-top: 1px solid #f0f0f0;
  padding-top: 6px;
}

.ma-worker-item {
  margin-bottom: 3px;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid #f0f0f0;
}

.ma-worker-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 7px;
  cursor: pointer;
  background: #fafafa;
  font-size: 11px;
}

.ma-worker-header:hover {
  background: #f0f5ff;
}

.worker-running { border-left: 3px solid #1677ff; }
.worker-completed { border-left: 3px solid #52c41a; }
.worker-failed { border-left: 3px solid #ff4d4f; }

.ma-worker-status {
  width: 14px;
  text-align: center;
  flex-shrink: 0;
  font-size: 10px;
}

.ma-worker-id {
  font-weight: 600;
  color: #1677ff;
  flex-shrink: 0;
  font-size: 10px;
}

.ma-worker-desc {
  color: #666;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}

.ma-worker-toggle {
  color: #bbb;
  font-size: 9px;
  flex-shrink: 0;
}

.ma-worker-body {
  padding: 6px 8px;
  background: #fff;
  border-top: 1px solid #f0f0f0;
}

.ma-worker-output {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: #555;
  max-height: 160px;
  overflow-y: auto;
  word-break: break-word;
}
</style>
