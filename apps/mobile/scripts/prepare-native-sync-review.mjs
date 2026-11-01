/* global console, process */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gitTestEnvironment } from '../src/workspace/git/gitTestServer.ts'

const [action, device, evidence] = process.argv.slice(2)
if (!['prepare', 'verify', 'restore'].includes(action) || !device || !evidence) throw new Error('Usage: prepare-native-sync-review.mjs prepare|verify|restore DEVICE EVIDENCE')
const app = 'com.memoria.mobile.dev'
const home = execFileSync('xcrun', ['simctl', 'get_app_container', device, app, 'data'], { encoding: 'utf8' }).trim()
const documents = join(home, 'Documents')
const config = join(documents, '.memoria-mobile-config')
const fixture = join(documents, 'Git Vaults', 'vault-qa-sync-review')
const backup = join(evidence, 'sync-review-backup')
const git = args => execFileSync('git', ['-C', fixture, ...args], { env: gitTestEnvironment(), encoding: 'utf8' }).trim()

async function treeHashes(root, prefix = '') {
  const result = {}
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Unexpected fixture symlink')
    if (entry.isDirectory()) Object.assign(result, await treeHashes(root, path))
    else result[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex')
  }
  return result
}

async function stop() {
  try { execFileSync('xcrun', ['simctl', 'terminate', device, app], { stdio: 'pipe' }) } catch { /* Already stopped. */ }
}

async function prepare() {
  await stop()
  await mkdir(backup)
  await cp(config, join(backup, 'config'), { recursive: true, errorOnExist: true, force: false })
  await writeFile(join(backup, 'laputa.json'), JSON.stringify(await treeHashes(join(documents, 'Memoria Vault'))))
  await mkdir(fixture)
  git(['init', '--initial-branch=main'])
  await checkpoint('Base conflict body')
  git(['branch', 'other'])
  const local = await checkpoint('Local conflict body')
  git(['checkout', 'other'])
  const remote = await checkpoint('Remote conflict body')
  git(['checkout', 'main'])
  git(['update-ref', 'refs/remotes/origin/main', remote])
  // The review itself is native/local. Deliberately invalid transport prevents ANY remote request.
  git(['config', 'remote.origin.url', 'http://127.0.0.1/disabled-qa-transport'])
  await writeFile(join(backup, 'heads.json'), JSON.stringify({ local, remote }))
  const catalog = { vaults: [{ id: 'vault-qa-sync-review', label: 'Sync Conflict QA', repositoryUrl: 'https://github.com/qa-invalid/isolated.git' }], activeId: 'vault-qa-sync-review', localVaults: [], activeLocalId: null }
  await writeFile(join(config, 'git-vaults.json'), JSON.stringify(catalog))
  await writeFile(join(config, 'settings.json'), JSON.stringify({ theme: 'light', uiScale: 1.1, autoGit: false, analytics: false }))
  await writeFile(join(config, 'sync-history.json'), JSON.stringify({ 'vault-qa-sync-review': { status: 'diverged', lastSuccessAt: null, lastCommitId: local.slice(0, 8), phase: null, error: 'conflict' } }))
  console.log('Prepared isolated native conflict review; original catalog and vault hashes retained.')
}

async function checkpoint(body) {
  await writeFile(join(fixture, 'conflict.md'), `---\ntype: Note\n---\n# Conflict QA\n\n${body}\n`)
  git(['add', '.'])
  git(['-c', 'user.name=Native QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'Disposable conflict fixture'])
  return git(['rev-parse', 'HEAD'])
}

async function verify() {
  const { local, remote } = JSON.parse(await readFile(join(backup, 'heads.json'), 'utf8'))
  if (git(['show', '-s', '--format=%P', 'HEAD']) !== `${local} ${remote}`) throw new Error('Native merge parents missing')
  const ours = await readFile(join(fixture, 'conflict.md'), 'utf8')
  const theirs = await readFile(join(fixture, 'conflict (conflict 1).md'), 'utf8')
  if (!ours.includes('Local conflict body') || !theirs.includes('Remote conflict body')) throw new Error('Native choices were not preserved')
  if (git(['status', '--porcelain'])) throw new Error('Resolved Git worktree is dirty')
  console.log('Native merge parents, both file versions and clean Git index verified.')
}

async function restore() {
  await stop()
  const before = JSON.parse(await readFile(join(backup, 'laputa.json'), 'utf8'))
  const after = await treeHashes(join(documents, 'Memoria Vault'))
  const unchanged = Object.keys(before).length === Object.keys(after).length && Object.keys(before).every(path => before[path] === after[path])
  const previous = join(backup, 'config')
  const currentNames = await readdir(config)
  const originalNames = await readdir(previous)
  for (const name of currentNames) if (!originalNames.includes(name)) await rm(join(config, name))
  await cp(previous, config, { recursive: true })
  await rm(fixture, { recursive: true, force: true })
  const originalHashes = await treeHashes(previous)
  const restoredHashes = await treeHashes(config)
  if (!Object.keys(originalHashes).every(path => originalHashes[path] === restoredHashes[path])) throw new Error('Configuration restoration mismatch')
  await writeFile(join(evidence, 'sync-review-restoration.json'), JSON.stringify({ unchanged, files: Object.keys(after).length, configurationRestored: true }))
  if (!unchanged) throw new Error('User vault changed: retained evidence for investigation')
  console.log(`Restored configuration; all ${Object.keys(after).length} original vault files unchanged.`)
}

if (action === 'prepare') await prepare()
if (action === 'verify') await verify()
if (action === 'restore') await restore()
