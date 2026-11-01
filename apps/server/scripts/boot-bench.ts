import { mkdir, rm, writeFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const NOTE_COUNT = 6000
const BENCHMARK_RUNS = 3

async function tmpDir(): Promise<string> {
  const base = join(tmpdir(), `memoria-boot-bench-${Date.now()}-${randomBytes(8).toString('hex')}`)
  await mkdir(base, { recursive: true })
  return base
}

function git(dir: string, args: string[]): void {
  execSync(`git ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`, { cwd: dir, stdio: 'pipe' })
}

async function createSyntheticVault(remoteDir: string, noteCount: number): Promise<void> {
  console.log(`Creating synthetic vault with ${noteCount} notes...`)
  
  git(remoteDir, ['init', '--bare', '-b', 'main'])
  
  const workDir = await tmpDir()
  git(workDir, ['clone', remoteDir, '.'])
  
  // Generate notes in batches to avoid overwhelming git
  const batchSize = 100
  for (let batch = 0; batch < noteCount; batch += batchSize) {
    const end = Math.min(batch + batchSize, noteCount)
    for (let i = batch; i < end; i++) {
      const path = join(workDir, `note-${String(i).padStart(6, '0')}.md`)
      const content = `# Note ${i}\n\nThis is synthetic note number ${i}.\n\n` +
        `## Content\n\n${Array(10).fill(`Paragraph ${i} content.`).join('\n\n')}\n`
      await writeFile(path, content)
    }
    git(workDir, ['add', '.'])
    git(workDir, ['commit', '-q', '-m', `Add notes ${batch} to ${end}`])
    console.log(`  Created notes ${batch} to ${end}`)
  }
  
  git(workDir, ['push', '-q', 'origin', 'main'])
  await rm(workDir, { recursive: true, force: true })
  console.log(`Synthetic vault created with ${noteCount} notes`)
}

async function measureBootTime(remoteDir: string): Promise<number> {
  const dataDir = await tmpDir()
  const vaultDir = join(dataDir, 'vault')
  const stateDir = join(dataDir, 'state')
  await mkdir(stateDir, { recursive: true })
  
  const start = performance.now()
  
  // Dynamic import to measure actual boot time
  const { Vault } = await import('../src/vault.ts')
  const { DocIndex } = await import('../src/docIndex.ts')
  const { LocalDiskStore } = await import('../src/store.ts')
  
  const vault = await Vault.open({
    dir: vaultDir,
    remoteUrl: remoteDir,
    branch: 'main',
  })
  
  const store = new LocalDiskStore(stateDir)
  const docs = await DocIndex.open(store)
  const { files } = await vault.list()
  const notePaths = files.map(file => file.path).filter(p => p.endsWith('.md'))
  await docs.reconcile(notePaths as never[])
  
  const end = performance.now()
  const bootTimeMs = end - start
  
  await rm(dataDir, { recursive: true, force: true })
  
  return bootTimeMs
}

async function main(): Promise<void> {
  console.log('=== Memoria Server Boot Benchmark ===\n')
  
  const remoteDir = await tmpDir()
  
  try {
    await createSyntheticVault(remoteDir, NOTE_COUNT)
    console.log()
    
    const bootTimes: number[] = []
    
    for (let run = 1; run <= BENCHMARK_RUNS; run++) {
      console.log(`Run ${run}/${BENCHMARK_RUNS}...`)
      const bootTimeMs = await measureBootTime(remoteDir)
      bootTimes.push(bootTimeMs)
      console.log(`  Boot time: ${bootTimeMs.toFixed(0)} ms`)
    }
    
    console.log()
    console.log('=== Results ===')
    console.log(`Notes: ${NOTE_COUNT}`)
    console.log(`Runs: ${BENCHMARK_RUNS}`)
    console.log(`Boot times: ${bootTimes.map(t => t.toFixed(0)).join(', ')} ms`)
    
    const avgBootTime = bootTimes.reduce((a, b) => a + b, 0) / bootTimes.length
    const minBootTime = Math.min(...bootTimes)
    const maxBootTime = Math.max(...bootTimes)
    
    console.log(`Average: ${avgBootTime.toFixed(0)} ms`)
    console.log(`Min: ${minBootTime.toFixed(0)} ms`)
    console.log(`Max: ${maxBootTime.toFixed(0)} ms`)
    
  } finally {
    await rm(remoteDir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error('Benchmark failed:', error)
  process.exitCode = 1
})
