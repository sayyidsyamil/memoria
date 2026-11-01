import { describe, expect, it } from 'vitest'
import { buildMobileDeepLinkForNote } from './mobileDeepLinks'
import type { MobileNote } from './mobileWorkspaceModel'

describe('buildMobileDeepLinkForNote', () => {
  it('builds desktop-shaped Memoria URLs from the active mobile vault and relative note path', () => {
    expect(buildMobileDeepLinkForNote({
      note: note({ path: 'Writing/Sponsorships/Acme call #1.md' }),
      source: {
        kind: 'localVault',
        label: 'Work Vault',
        totalNotes: 42,
        vaultPath: '/Users/luca/Work Vault',
        visibleNotes: 20,
      },
    })).toEqual({
      ok: true,
      url: 'memoria://work-vault/Writing/Sponsorships/Acme%20call%20%231.md',
    })
  })

  it('falls back to the note workspace label before rejecting missing vault metadata', () => {
    expect(buildMobileDeepLinkForNote({
      note: note({ path: 'Inbox.md', workspace: 'Memoria Vault' }),
    })).toEqual({
      ok: true,
      url: 'memoria://memoria-vault/Inbox.md',
    })

    expect(buildMobileDeepLinkForNote({
      note: note({ path: 'Inbox.md', workspace: '' }),
    })).toEqual({ error: 'missing_vault', ok: false })
  })

  it('rejects paths that cannot be vault-relative note paths', () => {
    expect(buildMobileDeepLinkForNote({
      note: note({ path: '../Outside.md' }),
      source: source(),
    })).toEqual({ error: 'unsafe_path', ok: false })
    expect(buildMobileDeepLinkForNote({
      note: note({ path: 'file:///Outside.md' }),
      source: source(),
    })).toEqual({ error: 'unsafe_path', ok: false })
  })

  it('uses the same slug shape as desktop workspace aliases', () => {
    expect(buildMobileDeepLinkForNote({
      note: note({ path: 'Inbox.md', workspace: '' }),
      source: {
        kind: 'localVault',
        label: '',
        totalNotes: 1,
        vaultPath: '/Users/luca/Work Vault',
        visibleNotes: 1,
      },
    })).toEqual({
      ok: true,
      url: 'memoria://work-vault/Inbox.md',
    })
    expect(buildMobileDeepLinkForNote({
      note: note({ path: 'Inbox.md' }),
      source: {
        kind: 'localVault',
        label: '  Laputa / Personal  ',
        totalNotes: 1,
        vaultPath: '/ignored',
        visibleNotes: 1,
      },
    })).toEqual({
      ok: true,
      url: 'memoria://laputa-personal/Inbox.md',
    })
  })
})

function source() {
  return {
    kind: 'localVault' as const,
    label: 'Laputa',
    totalNotes: 12,
    vaultPath: '/Users/luca/Laputa',
    visibleNotes: 8,
  }
}

function note(overrides: Partial<MobileNote> = {}): MobileNote {
  return {
    created: '-',
    date: '-',
    favorite: false,
    id: overrides.path ?? 'Writing/Note.md',
    links: 0,
    modified: '-',
    relationships: [],
    snippet: '',
    status: '',
    tags: [],
    title: 'Note',
    type: 'Note',
    typeTone: 'gray',
    workspace: 'Laputa',
    ...overrides,
  }
}
