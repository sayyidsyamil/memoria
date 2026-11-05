import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchLines } from '../src/lineMerge.ts'

export interface CorpusNote {
  name: string
  markdown: string
}

/** One place where the serializer's rendering differs from the source file. */
export interface Difference {
  kind: string
  source: string[]
  canonical: string[]
}

const DEMO_VAULT = fileURLToPath(new URL('../../../demo-vault-v2', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))

function notesIn(dir: string, label: string): CorpusNote[] {
  const names = (readdirSync(dir, { recursive: true }) as string[]).filter((name) => name.endsWith('.md'))
  return names.sort().map((name) => ({ name: `${label}/${name}`, markdown: readFileSync(join(dir, name), 'utf8') }))
}

export const demoVaultNotes = notesIn(DEMO_VAULT, 'demo-vault-v2')
export const fixtureNotes = notesIn(FIXTURES, 'fixtures')
export const corpus = [...demoVaultNotes, ...fixtureNotes]

function unescaped(line: string): string {
  return line.replaceAll('\\', '')
}

function sameAfter(change: (line: string) => string, source: string[], canonical: string[]): boolean {
  return source.length === canonical.length && source.every((line, index) => change(line) === change(canonical[index]))
}

const KINDS: [kind: string, matches: (source: string[], canonical: string[]) => boolean][] = [
  ['blank-lines', (source, canonical) => canonical.length === 0 && source.every((line) => line.trim() === '')],
  ['escaping', (source, canonical) => sameAfter(unescaped, source, canonical)],
  ['image-path-prefix', (source, canonical) => sameAfter((line) => line.replaceAll('](./', ']('), source, canonical)],
  ['trailing-spaces', (source, canonical) => sameAfter((line) => line.trimEnd(), source, canonical)],
]

function kindOf(source: string[], canonical: string[]): string {
  return KINDS.find(([, matches]) => matches(source, canonical))?.[0] ?? 'other'
}

/** Every place where `canonical` differs from `source`, classified. */
export function differences(source: string, canonical: string): Difference[] {
  const a = source.split('\n')
  const b = canonical.split('\n')
  const found: Difference[] = []
  let inA = 0
  let inB = 0
  for (const [nextA, nextB] of [...matchLines(a, b), [a.length, b.length] as const]) {
    if (nextA > inA || nextB > inB) {
      const [from, to] = [a.slice(inA, nextA), b.slice(inB, nextB)]
      found.push({ kind: kindOf(from, to), source: from, canonical: to })
    }
    inA = nextA + 1
    inB = nextB + 1
  }
  return found
}
