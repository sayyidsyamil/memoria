import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { Vault } from '../src/vault.ts'
import { LocalDiskStore } from '../src/store.ts'
import { SearchIndex } from '../src/searchIndex.ts'

const NOTE_COUNT = 6000
const WARMUP_QUERIES = 10
const BENCH_QUERIES = 100

interface BenchResult {
  noteCount: number
  queries: number
  times: number[]
  p50: number
  p95: number
  p99: number
  mean: number
}

async function exec(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'ignore' })
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))))
  })
}

async function generateSyntheticVault(vaultDir: string, noteCount: number): Promise<void> {
  await exec('git', ['-C', vaultDir, 'config', 'user.name', 'Bench'])
  await exec('git', ['-C', vaultDir, 'config', 'user.email', 'bench@example.com'])
  
  console.log(`Generating ${noteCount} synthetic notes...`)
  
  const topics = [
    'engineering', 'design', 'product', 'research', 'marketing', 'sales',
    'development', 'testing', 'deployment', 'operations', 'security', 'performance',
    'architecture', 'database', 'frontend', 'backend', 'mobile', 'infrastructure'
  ]
  
  const words = [
    'system', 'implementation', 'feature', 'bug', 'issue', 'requirement', 'specification',
    'design', 'interface', 'component', 'service', 'api', 'endpoint', 'request', 'response',
    'data', 'model', 'schema', 'query', 'optimization', 'performance', 'latency', 'throughput'
  ]
  
  for (let i = 0; i < noteCount; i++) {
    const topic = topics[i % topics.length]
    const title = `${topic.charAt(0).toUpperCase()}${topic.slice(1)} Note ${i}`
    
    const paragraphCount = 3 + (i % 5)
    const paragraphs = []
    
    for (let p = 0; p < paragraphCount; p++) {
      const sentenceCount = 3 + (p % 4)
      const sentences = []
      
      for (let s = 0; s < sentenceCount; s++) {
        const wordCount = 8 + ((i + p + s) % 12)
        const sentenceWords = []
        
        for (let w = 0; w < wordCount; w++) {
          sentenceWords.push(words[(i + p + s + w) % words.length])
        }
        
        sentences.push(sentenceWords.join(' '))
      }
      
      paragraphs.push(`${sentences.join('. ')}.`)
    }
    
    const content = `---
Is A: Note
Topic: ${topic}
---

# ${title}

${paragraphs.join('\n\n')}
`
    
    const filename = `note-${String(i).padStart(5, '0')}.md`
    writeFileSync(join(vaultDir, filename), content, 'utf8')
    
    if ((i + 1) % 500 === 0) {
      await exec('git', ['-C', vaultDir, 'add', '.'])
      await exec('git', ['-C', vaultDir, 'commit', '-m', `Add notes ${i - 499} to ${i}`])
      console.log(`  Generated ${i + 1}/${noteCount} notes`)
    }
  }
  
  if (noteCount % 500 !== 0) {
    await exec('git', ['-C', vaultDir, 'add', '.'])
    await exec('git', ['-C', vaultDir, 'commit', '-m', 'Add remaining notes'])
  }
  console.log(`Generated ${noteCount} notes`)
}

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil(sorted.length * p) - 1
  return sorted[Math.max(0, index)]
}

function calculateStats(times: number[]): Pick<BenchResult, 'p50' | 'p95' | 'p99' | 'mean'> {
  const sorted = [...times].sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  
  return {
    p50: percentile(sorted, 0.50),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    mean,
  }
}

async function benchmarkSearch(search: SearchIndex, queries: string[], runs: number): Promise<number[]> {
  const times: number[] = []
  
  for (let i = 0; i < runs; i++) {
    const query = queries[i % queries.length]
    const start = performance.now()
    await search.search(query, 50)
    const elapsed = performance.now() - start
    times.push(elapsed)
  }
  
  return times
}

async function runBenchmark(): Promise<BenchResult> {
  const tempDir = mkdtempSync(join(tmpdir(), 'search-bench-'))
  const remoteDir = join(tempDir, 'remote.git')
  const vaultDir = join(tempDir, 'vault')
  const storeDir = join(tempDir, 'store')
  
  try {
    await exec('git', ['init', '--bare', '-b', 'main', remoteDir])
    await exec('git', ['clone', '-o', 'upstream', remoteDir, vaultDir])
    await generateSyntheticVault(vaultDir, NOTE_COUNT)
    
    console.log('\nOpening vault and building search index...')
    const vault = await Vault.open({ dir: vaultDir, remoteUrl: remoteDir, branch: 'main', pushDebounceMs: 0 })
    const store = new LocalDiskStore(storeDir)
    
    const indexStart = performance.now()
    const search = await SearchIndex.open(vault, store)
    const indexTime = performance.now() - indexStart
    console.log(`Index built in ${indexTime.toFixed(0)}ms`)
    
    const queries = [
      'engineering', 'design', 'implementation', 'feature', 'system',
      'performance', 'database', 'api', 'optimization', 'service'
    ]
    
    console.log(`\nWarming up with ${WARMUP_QUERIES} queries...`)
    await benchmarkSearch(search, queries, WARMUP_QUERIES)
    
    console.log(`Running ${BENCH_QUERIES} benchmark queries...`)
    const times = await benchmarkSearch(search, queries, BENCH_QUERIES)
    
    await vault.idle()
    
    const stats = calculateStats(times)
    
    return {
      noteCount: NOTE_COUNT,
      queries: BENCH_QUERIES,
      times,
      ...stats,
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  console.log('=== Memoria Search Index Benchmark ===\n')
  console.log(`Notes: ${NOTE_COUNT}`)
  console.log(`Queries: ${BENCH_QUERIES}`)
  
  const result = await runBenchmark()
  
  console.log('\n=== Results ===')
  console.log(`Mean:   ${result.mean.toFixed(2)} ms`)
  console.log(`p50:    ${result.p50.toFixed(2)} ms`)
  console.log(`p95:    ${result.p95.toFixed(2)} ms`)
  console.log(`p99:    ${result.p99.toFixed(2)} ms`)
  
  if (result.p95 > 300) {
    console.log(`\n⚠️  WARNING: p95 (${result.p95.toFixed(2)}ms) exceeds 300ms target`)
    process.exitCode = 1
  } else {
    console.log(`\n✓ p95 (${result.p95.toFixed(2)}ms) meets <300ms target`)
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error)
  process.exitCode = 1
})
