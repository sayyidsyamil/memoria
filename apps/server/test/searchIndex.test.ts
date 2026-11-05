import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Vault } from '../src/vault.ts'
import { LocalDiskStore } from '../src/store.ts'
import { SearchIndex } from '../src/searchIndex.ts'
import type { VaultPath } from '../src/paths.ts'

describe('SearchIndex', () => {
  let tempDir: string
  let vault: Vault
  let store: LocalDiskStore
  let search: SearchIndex

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'search-index-test-'))
    const remoteDir = join(tempDir, 'remote.git')
    const vaultDir = join(tempDir, 'vault')
    const storeDir = join(tempDir, 'store')
    
    await exec('git', ['init', '--bare', '-b', 'main', remoteDir])
    await exec('git', ['clone', '-o', 'upstream', remoteDir, vaultDir])
    await exec('git', ['-C', vaultDir, 'config', 'user.name', 'Test'])
    await exec('git', ['-C', vaultDir, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', vaultDir, 'commit', '--allow-empty', '-m', 'initial'])
    await exec('git', ['-C', vaultDir, 'push', '-u', 'upstream', 'main'])
    
    vault = await Vault.open({ dir: vaultDir, remoteUrl: remoteDir, branch: 'main', pushDebounceMs: 0 })
    store = new LocalDiskStore(storeDir)
    search = await SearchIndex.open(vault, store)
    vault.onChange((changes) => search.apply(changes))
  })

  afterEach(async () => {
    await vault.idle()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('builds index from empty vault', async () => {
    const results = await search.search('anything', 10)
    expect(results.results).toHaveLength(0)
  })

  it('finds notes by title', async () => {
    await createNote('test.md', '# My Test Note\n\nSome content here.')
    
    const results = await search.search('test', 10)
    expect(results.results).toHaveLength(1)
    expect(results.results[0].path).toBe('test.md')
    expect(results.results[0].pathMatch).toBe(true)
  })

  it('finds notes by content', async () => {
    await createNote('note.md', '# Title\n\nThis note contains keyword in content.')
    
    const results = await search.search('keyword', 10)
    expect(results.results).toHaveLength(1)
    expect(results.results[0].path).toBe('note.md')
    expect(results.results[0].matches).toHaveLength(1)
    expect(results.results[0].matches[0].text).toContain('keyword')
  })

  it('performs case-insensitive search', async () => {
    await createNote('case.md', '# CaseSensitive Title\n\nMixed CASE content.')
    
    const results = await search.search('case', 10)
    expect(results.results).toHaveLength(1)
  })

  it('ranks title matches higher than content matches', async () => {
    await createNote('title-match.md', '# Important Keyword\n\nSome text.')
    await createNote('content-match.md', '# Other Title\n\nkeyword keyword keyword.')
    
    const results = await search.search('keyword', 10)
    expect(results.results).toHaveLength(2)
    expect(results.results[0].path).toBe('title-match.md')
  })

  it('extracts snippets with context', async () => {
    await createNote('snippet.md', '# Title\n\nLine before.\nLine with needle here.\nLine after.')
    
    const results = await search.search('needle', 10)
    expect(results.results).toHaveLength(1)
    expect(results.results[0].matches[0].text).toContain('needle')
  })

  it('handles multibyte Unicode correctly', async () => {
    const content = `# Korean Test\n\n${'한'.repeat(21)}aneedle after multibyte prefix`
    await createNote('unicode.md', content)
    
    const results = await search.search('needle', 10)
    expect(results.results).toHaveLength(1)
    expect(results.results[0].matches[0].text).toContain('needle')
  })

  it('excludes frontmatter from content search', async () => {
    await createNote('frontmatter.md', '---\nkeyword: value\n---\n# Title\n\nBody text.')
    
    const results = await search.search('keyword', 10)
    expect(results.results).toHaveLength(0)
  })

  it('excludes code blocks from content search', async () => {
    await createNote('code.md', '# Title\n\n```\nkeyword in code\n```\n\nNormal text.')
    
    const results = await search.search('keyword', 10)
    expect(results.results).toHaveLength(0)
  })

  it('updates index on file write', async () => {
    await createNote('update.md', '# Original')
    
    let results = await search.search('updated', 10)
    expect(results.results).toHaveLength(0)
    
    await updateNote('update.md', '# Updated Title')
    results = await search.search('updated', 10)
    expect(results.results).toHaveLength(1)
  })

  it('removes note from index on delete', async () => {
    await createNote('delete.md', '# To Delete')
    
    let results = await search.search('delete', 10)
    expect(results.results).toHaveLength(1)
    
    await deleteNote('delete.md')
    results = await search.search('delete', 10)
    expect(results.results).toHaveLength(0)
  })

  it('updates index on file rename', async () => {
    await createNote('old-name.md', '# Content')
    
    await vault.rename('old-name.md' as VaultPath, 'new-name.md' as VaultPath)
    await vault.idle()
    
    const results = await search.search('content', 10)
    expect(results.results).toHaveLength(1)
    expect(results.results[0].path).toBe('new-name.md')
  })

  it('persists index to storage', async () => {
    await createNote('persist.md', '# Persisted')
    
    const newSearch = await SearchIndex.open(vault, store)
    const results = await newSearch.search('persisted', 10)
    expect(results.results).toHaveLength(1)
  })

  it('rebuilds stale index', async () => {
    await createNote('first.md', '# First')
    
    await createNote('second.md', '# Second')
    
    const storeKey = 'search-index.json'
    await store.put(storeKey, Buffer.from(JSON.stringify({
      version: 1,
      head: 'stale-commit-id',
      notes: []
    })))
    
    const newSearch = await SearchIndex.open(vault, store)
    const results = await newSearch.search('second', 10)
    expect(results.results).toHaveLength(1)
  })

  it('respects search limit', async () => {
    for (let i = 0; i < 20; i++) {
      await createNote(`note${i}.md`, `# Note ${i}\n\nkeyword content`)
    }
    
    const results = await search.search('keyword', 5)
    expect(results.results).toHaveLength(5)
    expect(results.truncated).toBe(true)
  })

  it('limits matches per file', async () => {
    const content = Array(10).fill('keyword').join(' ')
    await createNote('many.md', `# Title\n\n${content}`)
    
    const results = await search.search('keyword', 10)
    expect(results.results).toHaveLength(1)
    expect(results.results[0].matches.length).toBeLessThanOrEqual(3)
  })

  async function createNote(path: string, content: string): Promise<void> {
    await vault.write(path as VaultPath, Buffer.from(content), { kind: 'absent' })
    await vault.idle()
  }

  async function updateNote(path: string, content: string): Promise<void> {
    const { etag } = await vault.read(path as VaultPath)
    await vault.write(path as VaultPath, Buffer.from(content), { kind: 'match', etag })
    await vault.idle()
  }

  async function deleteNote(path: string): Promise<void> {
    const { etag } = await vault.read(path as VaultPath)
    await vault.remove(path as VaultPath, etag)
    await vault.idle()
  }
})

async function exec(cmd: string, args: string[]): Promise<void> {
  const { spawn } = await import('node:child_process')
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' })
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))))
  })
}
