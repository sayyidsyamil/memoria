// Commit cadence of the collaboration channel: how many commits a minute of editing makes.
//
//   pnpm server:collab-bench <remote-url> [seconds]
//
// Part 1 replays synthetic editing sessions through the flush policy, without waiting: the
// policy only looks at the times of the edits. Part 2 runs one of them for real, sped up,
// against a clone of the given remote, to check the prediction and to time the flushes.
// It writes to that remote: use a throwaway one.
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import * as Y from 'yjs'
import { CollabProvider, type SocketLike } from '../../../packages/collab-client/src/collabProvider.ts'
import type { ListResponse } from '../../../packages/protocol/src/index.ts'
import { ChangeEmitter } from '../src/changeEmitter.ts'
import { type FlushPolicy, simulateFlushes } from '../src/collab/flush.ts'
import { closeVaultServer, createVaultServer } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import { Vault } from '../src/vault.ts'

const TOKEN = 'bench-token-not-a-secret'
const NOTE = 'welcome.md'
const SESSION_MS = 10 * 60_000
const SPEED_UP = 20
const DEFAULT_REAL_SECONDS = 30

const POLICIES: FlushPolicy[] = [
  { idleMs: 2_000, maxWaitMs: 30_000 },
  { idleMs: 5_000, maxWaitMs: 60_000 },
  { idleMs: 10_000, maxWaitMs: 120_000 },
  { idleMs: 30_000, maxWaitMs: 300_000 },
]

interface Pause {
  /** Chance that a keystroke is followed by this pause. */
  chance: number
  minMs: number
  maxMs: number
}

interface Session {
  name: string
  /** Time between two keystrokes while typing. */
  keyMs: number
  pauses: Pause[]
}

const SESSIONS: Session[] = [
  { name: 'typing without a pause (about 60 wpm)', keyMs: 200, pauses: [] },
  {
    name: 'writing: sentences, thinking pauses, a break now and then',
    keyMs: 220,
    pauses: [
      { chance: 1 / 70, minMs: 2_000, maxMs: 9_000 },
      { chance: 1 / 600, minMs: 20_000, maxMs: 90_000 },
    ],
  },
  { name: 'reviewing: a small fix every 20 to 70 seconds', keyMs: 250, pauses: [{ chance: 1 / 12, minMs: 20_000, maxMs: 70_000 }] },
]

/** A small seeded generator (mulberry32): the sessions are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

function pauseAfterKey({ pauses }: Session, random: () => number): number {
  for (const pause of pauses) {
    if (random() < pause.chance) return pause.minMs + random() * (pause.maxMs - pause.minMs)
  }
  return 0
}

/** The times of the keystrokes of a session, in milliseconds from its start. */
function editTimes(session: Session, lengthMs: number): number[] {
  const random = seeded(42)
  const times: number[] = []
  for (let time = 0; time < lengthMs; time += session.keyMs + pauseAfterKey(session, random)) times.push(Math.round(time))
  return times
}

function perMinute(count: number, lengthMs: number): string {
  return (count / (lengthMs / 60_000)).toFixed(2)
}

function label({ idleMs, maxWaitMs }: FlushPolicy): string {
  return `${idleMs / 1000} s idle / ${maxWaitMs / 1000} s max`
}

function printSimulation(): void {
  console.log(`Simulated: commits per minute over a ${SESSION_MS / 60_000}-minute session\n`)
  console.log(`| Session | Keystrokes | ${POLICIES.map(label).join(' | ')} |`)
  console.log(`|---|---|${POLICIES.map(() => '---').join('|')}|`)
  for (const session of SESSIONS) {
    const times = editTimes(session, SESSION_MS)
    const rates = POLICIES.map((policy) => perMinute(simulateFlushes(policy, times).length, SESSION_MS))
    console.log(`| ${session.name} | ${times.length} | ${rates.join(' | ')} |`)
  }
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

/** Times every write of a live document to the vault: pull, serialize, commit, push. */
function timedUpdates(vault: Vault): number[] {
  const durations: number[] = []
  const update = vault.update.bind(vault)
  vault.update = async (path, produce) => {
    const started = performance.now()
    const result = await update(path, produce)
    if (result) durations.push(performance.now() - started)
    return result
  }
  return durations
}

async function connect(origin: string): Promise<CollabProvider> {
  const headers = { authorization: `Bearer ${TOKEN}` }
  const { files } = (await (await fetch(new URL('/v1/files', origin), { headers })).json()) as ListResponse
  const docId = files.find((file) => file.path === NOTE)?.docId
  const url = `${origin.replace('http', 'ws')}/v1/collab/docs/${docId}`
  const provider = new CollabProvider({
    doc: new Y.Doc(),
    openSocket: async () => new WebSocket(url, { headers }) as unknown as SocketLike,
  })
  await provider.whenSynced()
  return provider
}

/** Types one character at each of the given times, measured from now. */
async function replay(doc: Y.Doc, times: number[]): Promise<void> {
  const text = doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText).next().value as Y.XmlText
  const started = performance.now()
  for (const time of times) {
    const wait = time - (performance.now() - started)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    text.insert(text.length, 'x')
  }
}

async function printRealRun(remoteUrl: string, seconds: number): Promise<void> {
  const policy = POLICIES[1]
  const real: FlushPolicy = { idleMs: policy.idleMs / SPEED_UP, maxWaitMs: policy.maxWaitMs / SPEED_UP }
  const times = editTimes(SESSIONS[1], seconds * 1000 * SPEED_UP)
  const dataDir = await mkdtemp(join(tmpdir(), 'memoria-collab-bench-'))
  const vault = await Vault.open({ dir: join(dataDir, 'vault'), remoteUrl })
  const durations = timedUpdates(vault)
  const server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(dataDir, 'state')),
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
    collab: { policy: real, lingerMs: 0 },
    changes: new ChangeEmitter(),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const provider = await connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    await replay(provider.doc, times.map((time) => time / SPEED_UP))
    provider.destroy()
  } finally {
    await closeVaultServer(server)
    await vault.idle()
    await rm(dataDir, { recursive: true, force: true })
  }
  const predicted = simulateFlushes(policy, times).length
  const sorted = [...durations].sort((a, b) => a - b)
  const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(sorted.length, 1)
  console.log(`\nReal run: "${SESSIONS[1].name}", ${label(policy)}, replayed ${SPEED_UP}x faster for ${seconds} s`)
  console.log(`  keystrokes ${times.length}, commits ${durations.length}, predicted by the simulation ${predicted}`)
  console.log(`  flush (pull, serialize, commit, push) ms: mean ${mean.toFixed(1)}, p50 ${percentile(sorted, 0.5).toFixed(1)}, p95 ${percentile(sorted, 0.95).toFixed(1)}, max ${(sorted.at(-1) ?? 0).toFixed(1)}`)
}

async function main(): Promise<void> {
  const [remoteUrl, seconds] = process.argv.slice(2)
  printSimulation()
  if (!remoteUrl) return console.log('\nNo remote given: skipped the real run.')
  await printRealRun(remoteUrl, Number(seconds ?? DEFAULT_REAL_SECONDS))
}

await main()
