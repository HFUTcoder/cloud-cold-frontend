import type {
  BaseResponse,
  LoginUserVO,
  UserLoginRequest,
  UserRegisterRequest,
} from '@/types/user'
import { requestJson } from '@/api/request'

export function userRegister(payload: UserRegisterRequest) {
  return requestJson<number>('/user/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function userLogin(payload: UserLoginRequest) {
  return requestJson<LoginUserVO>('/user/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function userLogout() {
  return requestJson<boolean>('/user/logout', {
    method: 'POST',
  })
}

export function getLoginUser() {
  return requestJson<LoginUserVO>('/user/get/login', {
    method: 'GET',
    headers: {},
  })
}
