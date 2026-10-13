export const MEMORIA_IMPORT_SOURCE_EVENT = 'memoria:import-source'
export const MEMORIA_START_MEETING_EVENT = 'memoria:start-meeting'
export const MEMORIA_OPEN_LEDGER_EVENT = 'memoria:open-ledger'

export interface ImportSourceEventDetail {
  input?: string
  mode?: 'file'
}

export interface StartMeetingEventDetail {
  autoStart?: boolean
}

export interface OpenLedgerEventDetail {
  tab?: 'now' | 'review' | 'ask' | 'prepare' | 'meetings' | 'setup'
}

export const COMPILE_INBOX_PROMPT = [
  'Compile the current Inbox into the Wiki.',
  '',
  'Use Memoria types as the organizing system:',
  '- Do not create Wiki/Entities or Wiki/Concepts folders.',
  '- Create or update normal typed notes using the existing vault types.',
  '- Every synthesized Wiki note must include YAML frontmatter with type: <best existing type> and _organized: true.',
  '- If a note already exists, update it in place instead of creating a duplicate.',
  '- Preserve source references and avoid duplicating facts.',
  '- Treat every processed Inbox item as raw evidence after compilation.',
  '- After an Inbox item is incorporated, update that original note frontmatter to type: Source, _organized: true, and status: compiled so it moves from Inbox to Sources.',
  '- If an Inbox item cannot be compiled, leave it in Inbox and explain why.',
  '- The target outcome after a successful full compile is: Inbox empty, Sources contains originals, Wiki contains synthesized typed knowledge.',
].join('\n')

export function requestImportSource(detail?: ImportSourceEventDetail): void {
  window.dispatchEvent(new CustomEvent<ImportSourceEventDetail>(MEMORIA_IMPORT_SOURCE_EVENT, { detail }))
}

export function requestStartMeeting(detail?: StartMeetingEventDetail): void {
  window.dispatchEvent(new CustomEvent<StartMeetingEventDetail>(MEMORIA_START_MEETING_EVENT, { detail }))
}

export function requestOpenLedger(detail?: OpenLedgerEventDetail): void {
  window.dispatchEvent(new CustomEvent<OpenLedgerEventDetail | undefined>(MEMORIA_OPEN_LEDGER_EVENT, { detail }))
}
