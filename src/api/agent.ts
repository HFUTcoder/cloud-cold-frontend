import type { AgentCallRequest, AgentSseEvent, AgentStreamHandlers } from '@/types/agent'

const AGENT_CALL_PATH = '/agent/call'
const DEFAULT_API_BASE_URL = '/api'

function buildApiUrl(path: string): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  const baseUrl = configuredBaseUrl || DEFAULT_API_BASE_URL
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function parseSseBlock(block: string): AgentSseEvent | null {
  const lines = block.split('\n')
  let event = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue
    }
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim() || 'message'
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  return {
    event,
    data: dataLines.join('\n'),
  }
}

/**
 * 后端 application.yml 配置了 context-path=/api，因此默认请求 /api/agent/call
 */
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

        const event = parseSseBlock(block)
        if (event) {
          handlers.onEvent?.(event)

          if (event.event === 'message') {
            handlers.onMessage?.(event.data)
          } else if (event.event === 'error') {
            handlers.onError?.(event.data)
          }
        }

        boundaryIndex = buffer.indexOf('\n\n')
      }
    }

    const tailEvent = parseSseBlock(buffer.trim())
    if (tailEvent) {
      handlers.onEvent?.(tailEvent)
      if (tailEvent.event === 'message') {
        handlers.onMessage?.(tailEvent.data)
      } else if (tailEvent.event === 'error') {
        handlers.onError?.(tailEvent.data)
      }
    }
  } finally {
    reader.releaseLock()
    handlers.onComplete?.()
  }
}
