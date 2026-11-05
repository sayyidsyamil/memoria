import { invoke } from '@tauri-apps/api/core'
import type { DeleteMeetingResult, MeetingApiError, MeetingRecord, SaveMeetingInput } from './meetingTypes'

export class MeetingServiceError extends Error {
  readonly code: MeetingApiError['code']
  constructor(error: MeetingApiError) { super(error.message); this.name = 'MeetingServiceError'; this.code = error.code }
  override toString() { return this.message }
}

function record(value: unknown): MeetingRecord {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string'
    || !('title' in value) || typeof value.title !== 'string' || !('pagePath' in value) || typeof value.pagePath !== 'string'
    || !('status' in value) || !['needs-review', 'transcript-reviewed'].includes(String(value.status))) {
    throw new MeetingServiceError({ code: 'INVALID_RESPONSE', message: 'The meeting service returned an invalid record.' })
  }
  return value as MeetingRecord
}

async function request(vaultPath: string, operation: 'list' | 'get' | 'save' | 'delete', data: object = {}): Promise<unknown> {
  try { return await invoke('meetings_api', { request: { vaultPath, operation, ...data } }) }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      throw new MeetingServiceError(error as MeetingApiError)
    }
    throw new MeetingServiceError({ code: 'RUNTIME_UNAVAILABLE', message: 'The meeting service is unavailable. Please try again.' })
  }
}

export const meetingService = {
  async list(vaultPath: string): Promise<MeetingRecord[]> {
    const result = await request(vaultPath, 'list')
    if (!Array.isArray(result)) throw new MeetingServiceError({ code: 'INVALID_RESPONSE', message: 'The meeting list could not be loaded.' })
    return result.map(record).sort((a, b) => (b.created ?? '').localeCompare(a.created ?? '') || a.id.localeCompare(b.id))
  },
  async get(vaultPath: string, id: string): Promise<MeetingRecord> { return record(await request(vaultPath, 'get', { id })) },
  async save(vaultPath: string, input: SaveMeetingInput): Promise<MeetingRecord> { return record(await request(vaultPath, 'save', { record: input })) },
  async delete(vaultPath: string, id: string): Promise<DeleteMeetingResult> {
    const result = await request(vaultPath, 'delete', { id })
    if (!result || typeof result !== 'object' || !('deleted' in result) || typeof result.deleted !== 'boolean' || !('id' in result) || result.id !== id) {
      throw new MeetingServiceError({ code: 'INVALID_RESPONSE', message: 'The meeting deletion could not be confirmed.' })
    }
    return result as DeleteMeetingResult
  },
}
