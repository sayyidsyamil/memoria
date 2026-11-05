// Measures the latency of one save (pull + commit + push) through the HTTP API, in process,
// against a clone of the given remote. It writes to that remote: use a throwaway one.
//
//   node --experimental-strip-types scripts/bench.ts <remote-url> [saves]
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROUTES } from '../../../packages/protocol/src/index.ts'
import { ChangeEmitter } from '../src/changeEmitter.ts'
import { createVaultServer } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import { Vault } from '../src/vault.ts'

const TOKEN = 'bench-token-not-a-secret'
const DEFAULT_SAVES = 50
const NOTE = 'bench/latency.md'

interface Sample {
  total: number
  pull: number
  commit: number
  push: number
}

type Phase = keyof Sample

function phaseMs(serverTiming: string, phase: Phase): number {
  const prefix = `${phase};dur=`
  const entry = serverTiming.split(', ').find((part) => part.startsWith(prefix))
  return entry ? Number(entry.slice(prefix.length)) : 0
}

interface SaveRequest {
  base: URL
  body: string
  /** Etag of the previous save; null for the first one. */
  etag: string | null
}

async function save({ base, body, etag }: SaveRequest): Promise<{ etag: string; sample: Sample }> {
  const precondition: Record<string, string> = etag ? { 'if-match': etag } : { 'if-match': '*' }
  const started = performance.now()
  const response = await fetch(new URL(`${ROUTES.files}/${NOTE}`, base), {
    method: 'PUT',
    body,
    headers: { authorization: `Bearer ${TOKEN}`, ...precondition },
  })
  await response.arrayBuffer()
  const total = performance.now() - started
  if (!response.ok) throw new Error(`save failed with ${response.status}`)
  const timing = response.headers.get('server-timing') ?? ''
  const sample = { total, pull: phaseMs(timing, 'pull'), commit: phaseMs(timing, 'commit'), push: phaseMs(timing, 'push') }
  return { etag: response.headers.get('etag') ?? '', sample }
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function summary(samples: Sample[], phase: Phase): string {
  const sorted = samples.map((sample) => sample[phase]).sort((a, b) => a - b)
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  const cells = [mean, percentile(sorted, 0.5), percentile(sorted, 0.95), sorted[sorted.length - 1]]
  return `${phase.padEnd(7)} ${cells.map((value) => value.toFixed(1).padStart(8)).join('')}`
}

async function measure(base: URL, saves: number): Promise<Sample[]> {
  const samples: Sample[] = []
  let etag: string | null = null
  for (let index = 0; index < saves; index++) {
    const body = `# Latency\n\nSave ${index} at ${new Date().toISOString()}\n`
    const result = await save({ base, body, etag })
    etag = result.etag
    samples.push(result.sample)
  }
  return samples
}

async function bench(remoteUrl: string, saves: number): Promise<void> {
  const data = await mkdtemp(join(tmpdir(), 'memoria-bench-'))
  const vault = await Vault.open({ dir: join(data, 'vault'), remoteUrl })
  const store = new LocalDiskStore(join(data, 'state'))
  const server = await createVaultServer({ vault, store, token: TOKEN, maxBodyBytes: 1024 * 1024, changes: new ChangeEmitter() })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    const samples = await measure(base, saves)
    const phases: Phase[] = ['total', 'pull', 'commit', 'push']
    const lines = phases.map((phase) => summary(samples, phase))
    process.stdout.write(`${saves} saves, ms      mean     p50     p95     max\n${lines.join('\n')}\n`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(data, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const [remoteUrl, saves] = process.argv.slice(2)
  if (!remoteUrl) throw new Error('usage: bench.ts <remote-url> [saves]')
  const count = saves === undefined ? DEFAULT_SAVES : Number(saves)
  if (!Number.isInteger(count) || count < 1) throw new Error('saves must be a positive integer')
  await bench(remoteUrl, count)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
