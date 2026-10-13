import type { Brief, HistoryEntry, LedgerFact, LedgerRegistry, MeetingSummary, Proposal } from '../lib/ledgerApi'
import { SAMPLE_REGISTRY } from '../lib/ledgerSampleRegistry'
import { M1, M2, M3, MOCK_MEETINGS, MOCK_PROPOSALS, MOCK_SLOTS, type SeedSlot } from './mock-ledger-data'
import { demoMode, demoSeed } from './mock-ledger-demo'

// localStorage['memoria:mock-ledger'] = 'fresh' starts with nothing set up and reveals each
// meeting's facts when it is added, so the whole first-run flow can be walked in a browser.
const isFresh = () => typeof localStorage !== 'undefined' && localStorage.getItem('memoria:mock-ledger') === 'fresh'

interface Args { vaultPath?: string; method: string; params?: Record<string, unknown> }

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

let registry: LedgerRegistry = clone(SAMPLE_REGISTRY)
let meetings: MeetingSummary[] = clone(MOCK_MEETINGS)
let proposals: Proposal[] = clone(MOCK_PROPOSALS)
let history = new Map<string, HistoryEntry[]>()
let nextId = 1

function labelOf(objectId: string): string {
  return registry.objects.find((o) => o.object_id === objectId)?.label ?? objectId
}

function seed(): void {
  if (demoMode()) {
    const demo = demoSeed()
    registry = demo.registry
    meetings = demo.meetings
    proposals = demo.proposals
    history = demo.history
    nextId = 1000
    return
  }
  const fresh = isFresh()
  registry = fresh ? { objects: [], people: {} } : clone(SAMPLE_REGISTRY)
  meetings = fresh ? [] : clone(MOCK_MEETINGS)
  proposals = fresh ? [] : clone(MOCK_PROPOSALS)
  history = new Map()
  nextId = 1
  if (!fresh) for (const slot of MOCK_SLOTS as SeedSlot[]) revealVersions(slot, () => true)
}

function revealVersions(slot: SeedSlot, wanted: (meeting: string) => boolean): number {
  const key = `${slot.object_id}.${slot.attribute}`
  const list = history.get(key) ?? []
  const added = slot.versions.filter((v) => wanted(v.evidence.meeting))
  for (const v of added) {
    const last = list[list.length - 1]
    if (last) last.claim_to = v.from
    list.push({
      fact_id: nextId++, object_id: slot.object_id, attribute: slot.attribute, label: labelOf(slot.object_id), value: v.value,
      claim_from: v.from, claim_to: null, decided_at: `${v.from}T09:30:00`, change_type: v.type,
      supersedes: null, confirms: null, corrects: null, retracted: null, evidence: [v.evidence],
    })
  }
  if (added.length > 0) history.set(key, list)
  return added.length
}
seed()

const live = (key: string) => (history.get(key) ?? []).filter((h) => !h.retracted)

/** Confirmations of the same value leave the current fact where the value was first recorded. */
function runStart(valid: HistoryEntry[]): number {
  let start = valid.length - 1
  while (start > 0 && valid[start - 1].value === valid[start].value && valid[start].change_type === 'CONFIRM') start--
  return start
}

function currentFacts(): LedgerFact[] {
  const rows: LedgerFact[] = []
  for (const key of history.keys()) {
    const valid = live(key)
    if (valid.length === 0) continue
    const last = valid[runStart(valid)]
    const [objectId] = key.split('.')
    const changes = valid.filter((v, i) => i > 0 && v.value !== valid[i - 1].value).length
    rows.push({
      fact_id: last.fact_id, object_id: objectId, attribute: last.attribute, label: labelOf(objectId),
      kind: registry.objects.find((o) => o.object_id === objectId)?.kind ?? 'decision', value: last.value, n_changes: changes,
      valid_from: last.claim_from, decided_at: last.decided_at, claim_from: last.claim_from, corrects: last.corrects, correction: last.correction, evidence: last.evidence,
    })
  }
  return rows
}

function findVersion(factId: number): { key: string; entry: HistoryEntry } | null {
  for (const [key, versions] of history) {
    const entry = versions.find((v) => v.fact_id === factId)
    if (entry) return { key, entry }
  }
  return null
}

function addVersion(base: HistoryEntry, value: HistoryEntry['value'], type: string, corrects: number | null, correction?: HistoryEntry['correction']): number {
  const entry: HistoryEntry = { ...base, fact_id: nextId++, value, change_type: type, corrects, retracted: null, claim_to: null, correction }
  const key = `${base.object_id}.${base.attribute}`
  const list = history.get(key) ?? []
  const last = list[list.length - 1]
  if (last) last.claim_to = base.claim_from
  history.set(key, [...list, entry])
  return entry.fact_id
}

function brief(): Brief {
  const facts = currentFacts()
  const value = (id: string, attr: string) => facts.find((f) => f.object_id === id && f.attribute === attr)?.value
  const known = (id: string) => facts.some((f) => f.object_id === id)
  const open = registry.objects.filter((o) => o.kind === 'commitment').flatMap((o) => {
    const status = value(o.object_id, 'status')
    if (status === 'done' || status === 'cancelled' || !known(o.object_id)) return []
    return [{ object_id: o.object_id, label: o.label, status: 'open', owner: value(o.object_id, 'owner'), deadline: value(o.object_id, 'deadline') }]
  })
  const changed = demoMode() ? [...history.keys()] : ['budget.amount', 'golive.date']
  const changes = changed.flatMap((key) => {
    const valid = live(key)
    const start = runStart(valid)
    const [a, b] = [valid[start - 1], valid[start]]
    return a && b ? [{ label: labelOf(b.object_id), attribute: b.attribute, from: a.value, to: b.value, decided_at: b.decided_at, quote: b.evidence[0]?.quote ?? null }] : []
  }).sort((x, y) => (y.decided_at ?? '').localeCompare(x.decided_at ?? ''))
  return { open_commitments: open, recent_changes: changes, decisions: [], waiting_for_review: proposals.length, meetings: meetings.length }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function askedDate(question: string): string | null {
  const match = /(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.exec(question)
  if (!match) return null
  return `2026-${String(MONTHS.indexOf(match[2]) + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

function ask(question: string): unknown {
  const q = question.toLowerCase()
  const route = (type: string, objectId: string, attribute: string, validAt: string | null = null) => ({ type, object_id: objectId, attribute, valid_at: validAt, tx_at: null, ok: true, reason: '' })
  if (/how many|times|changed/.test(q) && /go-?live/.test(q)) {
    const valid = live('golive.date')
    if (valid.length === 0) return { ok: false, reason: 'Nothing is recorded about this yet.', route: route('current', '', '') }
    const changes = valid.filter((v, i) => i > 0 && v.value !== valid[i - 1].value).length
    return { ok: true, route: route('n_changes', 'golive', 'date'), label: 'Go-live date', seconds: 0.4, type: 'n_changes', answer: changes, evidence: [] }
  }
  const asked = askedDate(q)
  if (/budget/.test(q) && asked) {
    const v = live('budget.amount').filter((x) => (x.claim_from ?? '') <= asked).at(-1)
    if (!v) return { ok: false, reason: 'Nothing was recorded for that date.', route: route('as_of_valid', 'budget', 'amount', asked) }
    return { ok: true, route: route('as_of_valid', 'budget', 'amount', asked), label: 'Pilot budget (RM)', seconds: 0.4, type: 'as_of_valid', answer: v.value, decided_at: v.decided_at, evidence: v.evidence }
  }
  if (/go-?live/.test(q)) {
    const v = live('golive.date').at(-1)
    if (!v) return { ok: false, reason: 'Nothing is recorded about this yet.', route: route('current', '', '') }
    return { ok: true, route: route('current', 'golive', 'date'), label: 'Go-live date', seconds: 0.4, type: 'current', answer: v?.value ?? null, decided_at: v?.decided_at, evidence: v.evidence }
  }
  return { ok: false, reason: 'The question does not match a tracked item.', route: route('current', '', '') }
}

function ingest(params: Record<string, unknown>) {
  const id = String(params.meeting_id)
  const turns = (params.turns as unknown[]) ?? []
  const known = isFresh() ? [M1, M2, M3].find((m) => m === id || m.endsWith(`/${id}`)) : undefined
  let applied = 2
  let proposed = 1
  if (known) {
    applied = (MOCK_SLOTS as SeedSlot[]).reduce((n, slot) => n + revealVersions(slot, (m) => m === known), 0)
    const waiting = MOCK_PROPOSALS.filter((p) => p.meeting === known)
    proposals = [...proposals, ...clone(waiting)]
    proposed = waiting.length
  }
  meetings = [...meetings, { meeting_id: id, occurred_at: String(params.occurred_at ?? new Date().toISOString().slice(0, 19)), source_id: `m${meetings.length}`.padEnd(12, '0'), evidence_items: applied + proposed }]
  return { meeting_id: id, stored_only: false, turns: turns.length, counts: { applied, proposed, ungrounded: 0, invalid: 0, unresolved: 0 }, items: [], seconds: 0.5 }
}

// The real app identifies a meeting by its note path relative to the vault.
const relativeTo = (vaultPath: string | undefined, value: unknown): unknown =>
  vaultPath ? JSON.parse(JSON.stringify(value ?? null).split(`${vaultPath.replace(/\/+$/, '')}/`).join('')) : value

export const mockLedgerHandlers: Record<string, (args: Args) => unknown> = {
  ledger_call: ({ vaultPath, method, params = {} }) => relativeTo(vaultPath, call(method, params)),
}

function call(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case 'ping': return { version: 'mock', extractor: 'none', objects: registry.objects.length, meetings: meetings.length }
    case 'registry.get': return clone(registry)
    case 'registry.set': {
      const incoming = params as unknown as LedgerRegistry
      const known = new Set(registry.objects.map((o) => o.object_id))
      registry = { objects: [...registry.objects, ...incoming.objects.filter((o) => !known.has(o.object_id))], people: { ...registry.people, ...incoming.people } }
      return clone(registry)
    }
    case 'meetings.list': return clone(meetings)
    case 'meetings.ingest': return ingest(params)
    case 'facts.current': return clone(currentFacts())
    case 'facts.history': return clone(history.get(`${params.object_id}.${params.attribute}`) ?? [])
    case 'ask': return ask(String(params.question ?? ''))
    case 'proposals.list': return clone(proposals)
    case 'proposals.accept': {
      const p = proposals.find((x) => x.proposal_id === params.proposal_id)
      if (!p) throw new Error(`proposal ${String(params.proposal_id)} not found`)
      const edits = params.edits as { value?: Proposal['value'] } | undefined
      const key = `${p.object_id}.${p.attribute}`
      const base = live(key).at(-1) ?? history.get(key)?.at(-1)
      proposals = proposals.filter((x) => x !== p)
      if (!base) throw new Error('nothing to change')
      return { fact_id: addVersion({ ...base, claim_from: '2026-10-12', decided_at: '2026-10-12T09:40:00', evidence: [{ quote: p.quote ?? '', speaker: p.speaker ?? '', meeting: p.meeting ?? '' }] }, edits?.value ?? p.value, 'REVISE', null), status: 'applied' }
    }
    case 'proposals.reject':
      proposals = proposals.filter((x) => x.proposal_id !== params.proposal_id)
      return { rejected: params.proposal_id }
    case 'facts.correct': {
      const found = findVersion(Number(params.fact_id))
      if (!found) throw new Error(`fact ${String(params.fact_id)} not found`)
      const retraction = () => ({ tx: nextId++, by: 'you', reason: `corrected: ${String(params.reason ?? '')}` })
      found.entry.retracted = retraction()
      // Later confirmations of the wrong value are set aside with it.
      for (const later of (history.get(found.key) ?? []).slice((history.get(found.key) ?? []).indexOf(found.entry) + 1)) {
        if (later.retracted) continue
        if (later.change_type !== 'CONFIRM' || later.value !== found.entry.value) break
        later.retracted = retraction()
      }
      return { fact_id: addVersion(found.entry, params.value as HistoryEntry['value'], 'CORRECT', found.entry.fact_id, { reviewer: 'you', reason: String(params.reason ?? ''), replaced_fact_id: found.entry.fact_id }), status: 'applied' }
    }
    case 'facts.retract': {
      const found = findVersion(Number(params.fact_id))
      if (!found) throw new Error(`fact ${String(params.fact_id)} not found`)
      found.entry.retracted = { tx: nextId++, by: 'you', reason: String(params.reason ?? '') }
      return { retracted: found.entry.fact_id }
    }
    case 'brief': return brief()
    default: throw new Error(`The decision engine does not know the method "${method}".`)
  }
}
