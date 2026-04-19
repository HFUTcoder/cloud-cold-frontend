import type {
  BaseResponse,
  LoginUserVO,
  UserLoginRequest,
  UserRegisterRequest,
} from '@/types/user'

const DEFAULT_API_BASE_URL = '/api'

function buildApiUrl(path: string): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  const baseUrl = configuredBaseUrl || DEFAULT_API_BASE_URL
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const result = (await response.json()) as BaseResponse<T>
  if (!response.ok || result.code !== 0) {
    throw new Error(result.message || `请求失败: ${response.status}`)
  }
  return result.data
}

export function userRegister(payload: UserRegisterRequest) {
  return request<number>('/user/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function userLogin(payload: UserLoginRequest) {
  return request<LoginUserVO>('/user/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function userLogout() {
  return request<boolean>('/user/logout', {
    method: 'POST',
  })
}

export function getLoginUser() {
  return request<LoginUserVO>('/user/get/login', {
    method: 'GET',
    headers: {},
  })
}
