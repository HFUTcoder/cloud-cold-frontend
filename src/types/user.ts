export interface BaseResponse<T> {
  code: number
  data: T
  message: string
}

export interface UserRegisterRequest {
  userAccount: string
  userPassword: string
  checkPassword: string
}

export interface UserLoginRequest {
  userAccount: string
  userPassword: string
}

export interface LoginUserVO {
  id: number
  userAccount: string
  userName?: string
  userAvatar?: string
  userProfile?: string
  userRole?: string
  quota?: number
}
