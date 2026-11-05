import { describe, it, expect } from 'vitest'
import { buildVaultIndex, type VaultFile } from '../src/index'

describe('Performance (6k notes under 3s)', () => {
  it('indexes 6,000 synthetic notes in under 3 seconds in Node', () => {
    const files: VaultFile[] = []
    const now = Date.now()
    
    for (let i = 0; i < 6000; i++) {
      const content = `---
type: Note
status: Active
tags:
  - tag-${i % 100}
belongs_to: "[[project-${i % 50}]]"
---

# Note ${i}

This is note number ${i}. It contains some sample content to test the indexing performance.

## Section 1

Some body text here with **bold** and *italic* formatting.

- Bullet point 1
- Bullet point 2
- Bullet point 3

Links to [[other-note-${i + 1}]] and [[other-note-${i + 2}]].

## Section 2

More content with some wikilinks: [[reference-${i}]] and [[topic-${i % 20}]].

Final paragraph with more text to make the snippet interesting.
`
      
      files.push({
        relativePath: `notes/note-${i}.md`,
        content,
        size: content.length,
        createdAt: now - i * 1000,
        modifiedAt: now - i * 500,
      })
    }
    
    const startTime = performance.now()
    const entries = buildVaultIndex(files)
    const endTime = performance.now()
    
    const elapsedSeconds = (endTime - startTime) / 1000
    
    console.log(`Indexed ${entries.length} notes in ${elapsedSeconds.toFixed(3)} seconds`)
    
    expect(entries.length).toBe(6000)
    expect(elapsedSeconds).toBeLessThan(3)
  })
})
