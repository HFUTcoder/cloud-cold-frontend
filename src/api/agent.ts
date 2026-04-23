import type {
  AgentCallRequest,
  AgentResumeRequest,
  AgentStreamEvent,
  AgentStreamHandlers,
} from '@/types/agent'

const DEFAULT_API_BASE_URL = '/api'
const AGENT_CALL_PATH = '/agent/call'
const AGENT_RESUME_PATH = '/agent/resume'

function buildApiUrl(path: string): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  const baseUrl = configuredBaseUrl || DEFAULT_API_BASE_URL
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  const lines = block.split('\n')
  let eventName = ''
  const dataLines: string[] = []

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue
    }
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  if (!eventName || dataLines.length === 0) {
    return null
  }

  return {
    event: eventName,
    data: dataLines.join('\n'),
  }
}

function safeParseAgentEvent(rawData: string): AgentStreamEvent | null {
  try {
    return JSON.parse(rawData) as AgentStreamEvent
  } catch {
    return null
  }
}

async function consumeAgentSse(
  response: Response,
  handlers: AgentStreamHandlers,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`调用智能体失败: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('调用智能体失败: 响应流为空')
  }

  handlers.onOpen?.()

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')

      let boundaryIndex = buffer.indexOf('\n\n')
      while (boundaryIndex !== -1) {
        const block = buffer.slice(0, boundaryIndex).trim()
        buffer = buffer.slice(boundaryIndex + 2)

        const parsed = parseSseBlock(block)
        if (parsed?.event === 'agent') {
          const payload = safeParseAgentEvent(parsed.data)
          if (payload) {
            handlers.onAgentEvent?.(payload)
          }
        }

        boundaryIndex = buffer.indexOf('\n\n')
      }
    }

    const tail = parseSseBlock(buffer.trim())
    if (tail?.event === 'agent') {
      const payload = safeParseAgentEvent(tail.data)
      if (payload) {
        handlers.onAgentEvent?.(payload)
      }
    }
  } finally {
    reader.releaseLock()
    handlers.onComplete?.()
  }
}

export async function callAgentStream(
  payload: AgentCallRequest,
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(buildApiUrl(AGENT_CALL_PATH), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
    signal,
  })

  await consumeAgentSse(response, handlers)
}

export async function resumeAgentStream(
  payload: AgentResumeRequest,
  handlers: AgentStreamHandlers = {},
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(buildApiUrl(AGENT_RESUME_PATH), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
    signal,
  })

  await consumeAgentSse(response, handlers)
}
