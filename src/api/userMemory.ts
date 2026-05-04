import { requestJson } from '@/api/request'
import type { UserLongTermMemory, UserPetState } from '@/types/userMemory'

export function getUserPetState() {
  return requestJson<UserPetState>('/userMemory/pet/state', {
    method: 'GET',
    headers: {},
  })
}

export function listUserMemories() {
  return requestJson<UserLongTermMemory[]>('/userMemory/list', {
    method: 'GET',
    headers: {},
  })
}

export function rebuildUserMemories() {
  return requestJson<boolean>('/userMemory/rebuild', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function renameUserPet(petName: string) {
  return requestJson<boolean>('/userMemory/rename', {
    method: 'POST',
    body: JSON.stringify({ petName }),
  })
}

export function deleteUserMemory(memoryId: string) {
  return requestJson<boolean>(`/userMemory/delete?memoryId=${encodeURIComponent(memoryId)}`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
