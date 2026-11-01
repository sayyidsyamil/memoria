import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import {
  autoRenameRemoteNote,
  createRemoteNote,
  deleteRemoteNotes,
  entryAtStoredPath,
  hasRemoteVault,
  newNotePath,
} from './remoteNotes'

const VAULT = '/Users/mock/demo-vault-v2'

interface Call {
  method: string
  path: string
  headers: Record<string, string>
  body?: string
}

let calls: Call[]
let answer: (call: Call) => Response

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { etag: '"e1"' } })
}

function configureRemote(on: boolean) {
  const target = window as { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }
  if (on) {
    target.MEMORIA_REMOTE_URL = 'https://vault.example'
    target.MEMORIA_REMOTE_TOKEN = 'token-for-tests'
  } else {
    delete target.MEMORIA_REMOTE_URL
    delete target.MEMORIA_REMOTE_TOKEN
  }
}

beforeEach(() => {
  calls = []
  answer = () => json({})
  configureRemote(true)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = {
      method: init.method ?? 'GET',
      path: new URL(url).pathname,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : undefined,
    }
    calls.push(call)
    return answer(call)
  }))
})

afterEach(() => {
  configureRemote(false)
  vi.unstubAllGlobals()
})

describe('where new notes go', () => {
  it('is vault-relative on a remote and under the vault folder otherwise', () => {
    expect(hasRemoteVault()).toBe(true)
    expect(newNotePath(VAULT, '/inbox/untitled-note-1.md')).toBe('inbox/untitled-note-1.md')

    configureRemote(false)
    expect(hasRemoteVault()).toBe(false)
    expect(newNotePath(VAULT, 'inbox/untitled-note-1.md')).toBe(`${VAULT}/inbox/untitled-note-1.md`)
  })

  it('moves the new entry to where it was stored', () => {
    const entry = { path: 'plan.md', filename: 'plan.md', title: 'Plan' } as VaultEntry

    expect(entryAtStoredPath(entry, 'plan.md')).toBe(entry)
    expect(entryAtStoredPath(entry, 'plan (conflict 2026-10-23 2130).md')).toEqual({
      path: 'plan (conflict 2026-10-23 2130).md',
      filename: 'plan (conflict 2026-10-23 2130).md',
      title: 'Plan',
    })
  })
})

describe('creating a note on the remote', () => {
  it('creates it only if nothing is at the path yet', async () => {
    answer = () => json({ outcome: 'created', path: 'untitled-note-1.md' }, 201)

    expect(await createRemoteNote('untitled-note-1.md', '# \n')).toBe('untitled-note-1.md')
    expect(calls).toEqual([
      expect.objectContaining({
        method: 'PUT',
        path: '/v1/files/untitled-note-1.md',
        headers: expect.objectContaining({ 'if-none-match': '*' }),
        body: '# \n',
      }),
    ])
  })

  it('resolves with the conflict copy when another device created the path first', async () => {
    answer = ({ method }) =>
      method === 'PUT'
        ? json({ outcome: 'conflict', path: 'plan (conflict 2026-10-23 2130).md' }, 409)
        : new Response('# Desktop plan\n', { headers: { etag: '"e2"' } })

    expect(await createRemoteNote('plan.md', '# Web plan\n')).toBe('plan (conflict 2026-10-23 2130).md')
  })
})

describe('deleting and renaming on the remote', () => {
  it('deletes each note at the revision it reads', async () => {
    expect(await deleteRemoteNotes(['a.md'])).toEqual(['a.md'])
    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(['GET /v1/files/a.md', 'DELETE /v1/files/a.md'])
    expect(calls[1].headers).toMatchObject({ 'if-match': '"e1"' })
  })

  it('renames an untitled note to its heading, and does nothing when the name fits', async () => {
    answer = () => json({ from: 'untitled-note-1.md', path: 'big-idea.md' })

    expect(await autoRenameRemoteNote('untitled-note-1.md', 'Big Idea')).toEqual({
      newPath: 'big-idea.md',
      entry: { path: 'big-idea.md', filename: 'big-idea.md', title: 'Big Idea' },
    })
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ from: 'untitled-note-1.md', to: 'big-idea.md', rewriteLinks: true, title: 'Big Idea' })

    expect(await autoRenameRemoteNote('big-idea.md', 'Big Idea')).toBeNull()
    expect(calls).toHaveLength(1)
  })
})
