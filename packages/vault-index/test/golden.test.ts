import { describe, it, expect } from 'vitest'
import { buildVaultIndex, type VaultFile, type VaultEntry } from '../src/index'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

describe('Golden fixture parity (TOL-147)', () => {
  it('matches golden demo-vault-v2.json field-for-field', () => {
    const goldenPath = join(__dirname, '../../../src-tauri/src/vault/mod_tests/fixtures/golden/demo-vault-v2.json')
    const vaultPath = join(__dirname, '../../../demo-vault-v2')
    
    const golden: VaultEntry[] = JSON.parse(readFileSync(goldenPath, 'utf-8'))
    const files = loadVaultFiles(vaultPath)
    const entries = buildVaultIndex(files)

    expect(entries.length).toBe(golden.length)

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const expected = golden[i]

      expect(entry.path, `Entry ${i} path mismatch`).toBe(expected.path)
      expect(entry.filename, `${entry.path}: filename`).toBe(expected.filename)
      expect(entry.title, `${entry.path}: title`).toBe(expected.title)
      expect(entry.fileSize, `${entry.path}: fileSize`).toBe(expected.fileSize)
      expect(entry.snippet, `${entry.path}: snippet`).toBe(expected.snippet)
      expect(entry.wordCount, `${entry.path}: wordCount`).toBe(expected.wordCount)
      expect(entry.hasH1, `${entry.path}: hasH1`).toBe(expected.hasH1)
      expect(entry.fileKind, `${entry.path}: fileKind`).toBe(expected.fileKind)

      if (expected.isA !== undefined) {
        expect(entry.isA, `${entry.path}: isA`).toBe(expected.isA)
      } else {
        expect(entry.isA, `${entry.path}: isA should be undefined`).toBeUndefined()
      }

      if (expected.aliases !== undefined) {
        expect(entry.aliases, `${entry.path}: aliases`).toEqual(expected.aliases)
      } else {
        expect(entry.aliases, `${entry.path}: aliases should be undefined`).toBeUndefined()
      }

      if (expected.belongsTo !== undefined) {
        expect(entry.belongsTo, `${entry.path}: belongsTo`).toEqual(expected.belongsTo)
      } else {
        expect(entry.belongsTo, `${entry.path}: belongsTo should be undefined`).toBeUndefined()
      }

      if (expected.status !== undefined) {
        expect(entry.status, `${entry.path}: status`).toBe(expected.status)
      } else {
        expect(entry.status, `${entry.path}: status should be undefined`).toBeUndefined()
      }

      if (expected.relationships !== undefined) {
        expect(entry.relationships, `${entry.path}: relationships`).toEqual(expected.relationships)
      } else {
        expect(entry.relationships, `${entry.path}: relationships should be undefined`).toBeUndefined()
      }

      if (expected.outgoingLinks !== undefined) {
        expect(entry.outgoingLinks, `${entry.path}: outgoingLinks`).toEqual(expected.outgoingLinks)
      } else {
        expect(entry.outgoingLinks, `${entry.path}: outgoingLinks should be undefined`).toBeUndefined()
      }
    }
  })
})

function loadVaultFiles(vaultPath: string): VaultFile[] {
  const files: VaultFile[] = []
  
  function walk(dir: string, relativePath = '') {
    const entries = readdirSync(dir)
    
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const relPath = relativePath ? `${relativePath}/${entry}` : entry
      const stats = statSync(fullPath)
      
      if (stats.isDirectory()) {
        if (entry !== '.git' && !entry.startsWith('.')) {
          walk(fullPath, relPath)
        }
      } else if (stats.isFile() && !entry.startsWith('.')) {
        const content = readFileSync(fullPath, 'utf-8')
        files.push({
          relativePath: relPath,
          content,
          size: stats.size,
          createdAt: stats.birthtimeMs,
          modifiedAt: stats.mtimeMs,
        })
      }
    }
  }
  
  walk(vaultPath)
  return files
}
