import { execFileSync } from 'node:child_process'
import { ok as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { extname, join, posix } from 'node:path'
import { env } from 'node:process'

type BundleFile = { path: string; sha256: string; text?: string; asset?: string }
type TreeEntry = { path: string; oid: string; size: number }
type PreparedFile = { file: BundleFile; image?: Buffer }
type BundleOptions = { repository: string; revision: string; outputDirectory: string }

const repositoryUrl = 'https://github.com/refactoringhq/tolaria-getting-started'
const maxFileBytes = 8 * 1024 * 1024
const maxBundleBytes = 32 * 1024 * 1024
const textExtensions = new Set(['.md', '.yml', '.yaml', '.json', '.html', '.txt'])

export function generateStarterBundle({ repository, revision, outputDirectory }: BundleOptions) {
  assert(/^[a-f0-9]{40}$/u.test(revision), 'Expected a full commit SHA')
  const entries = readTree({ repository, revision })
  const prepared = entries.map(entry => prepareFile(repository, entry))
  const manifest = { repository: repositoryUrl, revision, label: 'Getting Started', files: prepared.map(entry => entry.file) }
  writeBundle(outputDirectory, prepared, manifest)
  return manifest
}

function readTree({ repository, revision }: Pick<BundleOptions, 'repository' | 'revision'>) {
  const tree = execFileSync('git', ['-C', repository, 'ls-tree', '-rlz', revision], {
    encoding: 'utf8', maxBuffer: 1024 * 1024, env: gitEnvironment(),
  })
  const entries = tree.split('\0').filter(Boolean).map(parseTreeEntry)
  assert(entries.length > 0, 'Empty template tree')
  assert(entries.reduce((total, entry) => total + entry.size, 0) <= maxBundleBytes, 'Template bundle exceeds size limit')
  return entries
}

function gitEnvironment() {
  const environment = { ...env }
  for (const key of Object.keys(environment)) if (key.startsWith('GIT_')) delete environment[key]
  return environment
}

function parseTreeEntry(line: string): TreeEntry {
  const boundary = line.indexOf('\t')
  const [mode, kind, oid, size] = line.slice(0, boundary).trim().split(/\s+/u)
  const path = line.slice(boundary + 1)
  assert(['100644', '100755'].includes(mode) && kind === 'blob', 'Unsupported template entry')
  assert(/^[a-f0-9]{40}$/u.test(oid), 'Invalid template object')
  validateTemplatePath(path)
  const bytes = Number(size)
  assert(isAllowedFileSize(bytes), 'Template file exceeds size limit')
  return { path, oid, size: bytes }
}

function validateTemplatePath(path: string) {
  assert(path.length > 0 && !posix.isAbsolute(path) && posix.normalize(path) === path, 'Invalid template path')
  assert(!path.split('/').some(segment => ['..', '.', '.git'].includes(segment)), 'Invalid template path')
  assert([...path].every(character => character >= ' ' && character !== '\u007f' && character !== '\\'), 'Invalid template path')
}

function isAllowedFileSize(bytes: number) {
  return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= maxFileBytes
}

function prepareFile(repository: string, entry: TreeEntry): PreparedFile {
  const bytes = execFileSync('git', ['-C', repository, 'cat-file', 'blob', entry.oid], {
    maxBuffer: maxFileBytes, env: gitEnvironment(),
  })
  assert(bytes.length === entry.size, 'Template blob size mismatch')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (extname(entry.path) === '.png') {
    return { file: { path: entry.path, sha256, asset: `images/${sha256}.png` }, image: bytes }
  }
  assert(textExtensions.has(extname(entry.path)) || entry.path === '.gitignore', 'Unsupported template file')
  return { file: { path: entry.path, sha256, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } }
}

function writeBundle(directory: string, prepared: PreparedFile[], manifest: object) {
  mkdirSync(join(directory, 'images'), { recursive: true })
  for (const entry of prepared) {
    if (entry.image && entry.file.asset) writeFileSync(join(directory, entry.file.asset), entry.image)
  }
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(directory, 'images.ts'), imageModule(prepared))
}

function imageModule(prepared: PreparedFile[]) {
  const entries = prepared.filter(entry => entry.file.asset).map(({ file }) =>
    `    ${JSON.stringify(file.path)}: require(${JSON.stringify(`./${file.asset}`)}),`)
  return [
    '// Generated from the pinned starter tree. Run scripts/generate-starter-vault.ts to update.',
    'declare const require: (path: string) => number',
    '',
    'export function starterImageSources(): Record<string, number> {',
    '  return {', ...entries, '  }', '}', '',
  ].join('\n')
}
