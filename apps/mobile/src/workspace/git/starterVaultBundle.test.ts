import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from 'node:process'
import bundledManifest from '../../../assets/starter-vault/manifest.json'
import { generateStarterBundle } from '../../../scripts/starterVaultBundle'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'memoria-starter-bundle-'))
  roots.push(root)
  const repository = join(root, 'source')
  const outputDirectory = join(root, 'bundle')
  mkdirSync(repository)
  const environment = { ...env }
  for (const key of Object.keys(environment)) if (key.startsWith('GIT_')) delete environment[key]
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', env: environment,
  }).trim()
  git('init', '--quiet')
  const write = (name: string, value: string | Buffer) => {
    mkdirSync(join(repository, name, '..'), { recursive: true })
    writeFileSync(join(repository, name), value)
  }
  const commit = () => {
    git('-c', 'core.autocrlf=false', 'add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Template fixture')
    return git('rev-parse', 'HEAD')
  }
  return { repository, outputDirectory, write, commit }
}

it('copies the pinned tree verbatim with binary assets outside JavaScript', () => {
  const source = fixture()
  const image = Buffer.from([137, 80, 78, 71, 0, 1, 2])
  source.write('note.md', '---\ntype: Type\n---\n# Note\n')
  source.write('AGENTS.md', 'Template guidance is vault data.\n')
  source.write('views/active.yml', 'name: Active\n')
  source.write('attachments/example.png', image)
  source.write('.gitignore', '.DS_Store\n')
  const revision = source.commit()
  source.write('note.md', '# Uncommitted change must not leak into the bundle')
  const manifest = generateStarterBundle({ ...source, revision })
  expect(manifest.revision).toBe(revision)
  expect(manifest.files).toHaveLength(5)
  expect(manifest.files.find(file => file.path === 'note.md')?.text).toContain('type: Type')
  expect(manifest.files.find(file => file.path === 'AGENTS.md')?.text).toBe('Template guidance is vault data.\n')
  const asset = manifest.files.find(file => file.path === 'attachments/example.png')
  expect(asset?.text).toBeUndefined()
  const hash = createHash('sha256').update(image).digest('hex')
  expect(asset?.sha256).toBe(hash)
  expect(readFileSync(join(source.outputDirectory, 'images', `${hash}.png`))).toEqual(image)
  expect(readFileSync(join(source.outputDirectory, 'images.ts'), 'utf8')).toContain(`./images/${hash}.png`)
  expect(readFileSync(join(source.outputDirectory, 'manifest.json'), 'utf8')).not.toContain('base64')
  expect(existsSync(join(source.outputDirectory, '.git'))).toBe(false)
})

it('generates identical manifests and asset references for the same revision', () => {
  const source = fixture()
  source.write('note.md', '# Note\n')
  const revision = source.commit()
  generateStarterBundle({ ...source, revision })
  const before = readFileSync(join(source.outputDirectory, 'manifest.json'))
  generateStarterBundle({ ...source, revision })
  expect(readFileSync(join(source.outputDirectory, 'manifest.json'))).toEqual(before)
})

it('reads the specified repository even when invoked from another repository hook', () => {
  const source = fixture()
  source.write('note.md', '# Template')
  const revision = source.commit()
  vi.stubEnv('GIT_DIR', join(source.outputDirectory, 'foreign.git'))
  vi.stubEnv('GIT_WORK_TREE', source.outputDirectory)
  const manifest = generateStarterBundle({ ...source, revision })
  expect(manifest.files[0].text).toBe('# Template')
})

it('rejects symbolic links rather than reading targets outside the template', () => {
  const source = fixture()
  symlinkSync('../outside', join(source.repository, 'linked.md'))
  const revision = source.commit()
  expect(() => generateStarterBundle({ ...source, revision })).toThrow('Unsupported template entry')
  expect(existsSync(source.outputDirectory)).toBe(false)
})

it('fails explicitly rather than silently omitting unsupported template files', () => {
  const source = fixture()
  source.write('payload.exe', Buffer.from([0, 255]))
  const revision = source.commit()
  expect(() => generateStarterBundle({ ...source, revision })).toThrow('Unsupported template file')
  expect(existsSync(source.outputDirectory)).toBe(false)
})

it.each(['HEAD', '--all', '../main', 'a'.repeat(39)])('requires an immutable commit instead of %s', revision => {
  const source = fixture()
  expect(() => generateStarterBundle({ ...source, revision })).toThrow('Expected a full commit SHA')
  expect(existsSync(source.outputDirectory)).toBe(false)
})

it('rejects ambiguous cross-platform paths', () => {
  const source = fixture()
  source.write('bad\\name.md', '# Unsafe name')
  expect(() => generateStarterBundle({ ...source, revision: source.commit() })).toThrow('Invalid template path')
  expect(existsSync(source.outputDirectory)).toBe(false)
})

it('rejects invalid UTF-8 instead of changing template bytes', () => {
  const source = fixture()
  source.write('note.md', Buffer.from([255]))
  expect(() => generateStarterBundle({ ...source, revision: source.commit() })).toThrow()
  expect(existsSync(source.outputDirectory)).toBe(false)
})

it('rejects an empty template rather than shipping a blank starter', () => {
  const source = fixture()
  expect(() => generateStarterBundle({ ...source, revision: source.commit() })).toThrow('Empty template tree')
})

it('checks blob size before loading an oversized asset into memory', () => {
  const source = fixture()
  source.write('large.png', Buffer.alloc(8 * 1024 * 1024 + 1))
  expect(() => generateStarterBundle({ ...source, revision: source.commit() })).toThrow('Template file exceeds size limit')
  expect(existsSync(source.outputDirectory)).toBe(false)
})

it('preserves the prior bundle if a new snapshot fails validation', () => {
  const source = fixture()
  source.write('note.md', '# Original')
  generateStarterBundle({ ...source, revision: source.commit() })
  const before = readFileSync(join(source.outputDirectory, 'manifest.json'))
  source.write('unsupported.exe', 'Not a supported vault asset')
  expect(() => generateStarterBundle({ ...source, revision: source.commit() })).toThrow('Unsupported template file')
  expect(readFileSync(join(source.outputDirectory, 'manifest.json'))).toEqual(before)
})

it('keeps every checked-in template file consistent with its recorded checksum', () => {
  const paths = bundledManifest.files.map(file => file.path)
  expect(new Set(paths).size).toBe(paths.length)
  expect(paths).toContain('note.md')
  expect(paths).toContain('views/active-projects.yml')
  for (const file of bundledManifest.files) {
    const bytes = file.asset
      ? readFileSync(new URL(`../../../assets/starter-vault/${file.asset}`, import.meta.url))
      : Buffer.from(file.text ?? '')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
  }
})
