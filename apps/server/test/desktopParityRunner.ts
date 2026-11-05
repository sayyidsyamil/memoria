import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { WebSocket as NodeWebSocket } from 'ws'
import type { SocketLike } from '../../../packages/collab-client/src/collabProvider.ts'
import {
  createRemoteAttachments,
  createRemoteVaultBackend,
  type RemoteBindings,
} from '../../../packages/collab-client/src/remoteVaultBackend.ts'
import { baseRevision } from '../../../packages/markdown-yjs/src/index.ts'
import { DOC_FRONTMATTER_FIELD } from '../../../packages/protocol/src/index.ts'
import { registerLiveNoteDocument } from '../../../src/lib/liveNoteDocuments'
import { editRemoteFrontmatter } from '../../../src/lib/remoteFrontmatter'
import type { VaultBackend, VaultCollabDoc } from '../../../src/lib/vaultBackend/types'
import { ChangeEmitter } from '../src/changeEmitter.ts'
import type { VaultPath } from '../src/paths.ts'
import { closeVaultServer, createVaultServer } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import type { Vault } from '../src/vault.ts'
import { codec, settle } from './collabHelpers.ts'
import { ATTACHMENT_NOW, newNoteContent, PARITY_SCRIPT, type ParityStep, PNG_BASE64 } from './desktopParityScript.ts'
import { createFixture, type Fixture } from './helpers.ts'

/** What a step left in the vault: each changed note's content, `null` for a note that is gone. */
export type ChangedNotes = Record<string, string | null>

export type RecordedStep = ParityStep & { changed: ChangedNotes; stored?: string }

export interface ParityGolden {
  seed: Record<string, string>
  steps: RecordedStep[]
  /** Uploaded attachments, base64. */
  attachments: Record<string, string>
}

const TOKEN = 'parity-token-0123456789'
const WAIT_MS = 15_000
type LiveDoc = VaultCollabDoc<RemoteBindings>

function isMarkdown(path: string): boolean {
  return path.endsWith('.md')
}

function changedNotes(before: Record<string, string>, after: Record<string, string>): ChangedNotes {
  const changed: ChangedNotes = {}
  for (const [path, content] of Object.entries(after)) if (before[path] !== content) changed[path] = content
  for (const path of Object.keys(before)) if (!(path in after)) changed[path] = null
  return changed
}

async function until(done: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await settle(1)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** The web app, a server and the remote they share, driven one scripted step at a time. */
class ParityRun {
  private readonly docs = new Map<string, LiveDoc>()
  private readonly releases: (() => void)[] = []
  private readonly attachments: Record<string, string> = {}

  private readonly vault: Vault
  private readonly backend: VaultBackend<RemoteBindings>
  private readonly baseUrl: string

  constructor(vault: Vault, backend: VaultBackend<RemoteBindings>, baseUrl: string) {
    this.vault = vault
    this.backend = backend
    this.baseUrl = baseUrl
  }

  async notes(): Promise<Record<string, string>> {
    const { files } = await this.vault.list()
    const notes: Record<string, string> = {}
    for (const { path } of files.filter((file) => isMarkdown(file.path))) {
      notes[path] = (await this.vault.read(path as VaultPath)).bytes.toString('utf8')
    }
    return notes
  }

  async run(): Promise<ParityGolden> {
    const seed = await this.notes()
    const steps: RecordedStep[] = []
    let before = seed
    for (const step of PARITY_SCRIPT) {
      const stored = await this.apply(step)
      const after = await this.notes()
      steps.push({ ...step, changed: changedNotes(before, after), ...(stored ? { stored } : {}) })
      before = after
    }
    return { seed, steps, attachments: this.attachments }
  }

  close(): void {
    for (const release of this.releases) release()
    for (const doc of this.docs.values()) doc.close()
  }

  /** Applies a step; resolves with where an uploaded attachment was stored. */
  private async apply(step: ParityStep): Promise<string | undefined> {
    switch (step.op) {
      case 'create':
        await this.create(step)
        return undefined
      case 'body':
        await this.setBody(step.path, step.body)
        return undefined
      case 'property':
        await this.editProperty(step)
        return undefined
      case 'rename':
        await this.rename(step)
        return undefined
      case 'attachment':
        return this.attach(step)
    }
  }

  private async create({ path, title, type }: Extract<ParityStep, { op: 'create' }>): Promise<void> {
    const content = newNoteContent(title, type)
    const result = await this.backend.files.write(path, content, { baseRevision: null })
    if (result.status !== 'written') throw new Error(`could not create ${path}`)
  }

  /** The note's live document, opened like the editor opens it and registered for property edits. */
  private async live(path: string): Promise<LiveDoc> {
    const open = this.docs.get(path)
    if (open) return open
    const collab = this.backend.collab as NonNullable<typeof this.backend.collab>
    const doc = await collab.openDoc(path)
    await doc.synced
    this.docs.set(path, doc)
    this.releases.push(registerLiveNoteDocument(doc))
    return doc
  }

  private currentPath(path: string): string {
    return this.docs.get(path)?.path ?? path
  }

  /** Waits until the server has written what the document says to the note's file. */
  private async flushed(doc: LiveDoc): Promise<void> {
    await until(async () => {
      const file = (await this.vault.read(doc.path as VaultPath)).bytes.toString('utf8')
      return (await codec.canonical(file)) === codec.read(doc.doc)
    }, `${doc.path} to be written`)
  }

  private async setBody(path: string, body: string): Promise<void> {
    const doc = await this.live(path)
    const frontmatter = doc.doc.getText(DOC_FRONTMATTER_FIELD).toString()
    await codec.write(doc.doc, { markdown: `${frontmatter}\n${body}`, revision: baseRevision(doc.doc) ?? '' })
    await this.flushed(doc)
  }

  private async editProperty({ path, key, value, live }: Extract<ParityStep, { op: 'property' }>): Promise<void> {
    const doc = live ? await this.live(path) : null
    await editRemoteFrontmatter(this.backend.files, { path: this.currentPath(path), key, value })
    if (doc) await this.flushed(doc)
  }

  private async rename({ path, newTitle, oldTitle }: Extract<ParityStep, { op: 'rename' }>): Promise<void> {
    await this.backend.files.rename({ path: this.currentPath(path), newTitle, oldTitle })
    await this.vault.idle()
    for (const doc of this.docs.values()) await this.flushed(doc)
  }

  private async attach({ path, filename, alt }: Extract<ParityStep, { op: 'attachment' }>): Promise<string> {
    const uploads = createRemoteAttachments({ baseUrl: this.baseUrl, token: TOKEN, now: () => ATTACHMENT_NOW })
    const bytes = Buffer.from(PNG_BASE64, 'base64')
    const { path: stored } = await uploads.save({ filename, bytes })
    this.attachments[stored] = PNG_BASE64
    const doc = await this.live(path)
    const body = codec.read(doc.doc).slice(doc.doc.getText(DOC_FRONTMATTER_FIELD).length)
    await this.setBody(path, `${body.trim()}\n\n![${alt}](${stored})\n`)
    return stored
  }
}

async function startServer(fixture: Fixture, vault: Vault): Promise<Server> {
  const server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
    collab: { policy: { idleMs: 20, maxWaitMs: 2_000 }, lingerMs: 10 },
    changes: new ChangeEmitter(),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server
}

/** Runs the whole script on a fresh fixture vault and returns what every step left. */
export async function runParityScript(): Promise<ParityGolden> {
  const fixture = await createFixture()
  const vault = await fixture.openVault()
  const server = await startServer(fixture, vault)
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const createSocket = (url: string) => new NodeWebSocket(url) as unknown as SocketLike
  const run = new ParityRun(vault, createRemoteVaultBackend({ baseUrl, token: TOKEN, createSocket }), baseUrl)
  try {
    return await run.run()
  } finally {
    run.close()
    await closeVaultServer(server)
    await vault.idle()
    await fixture.cleanup()
  }
}
