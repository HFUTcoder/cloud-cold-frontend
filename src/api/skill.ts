import type { SkillMetadataVO } from '@/types/skill'
import { requestJson } from '@/api/request'

export function listSkills() {
  return requestJson<SkillMetadataVO[]>('/skill/list', {
    method: 'GET',
    headers: {},
  })
}
