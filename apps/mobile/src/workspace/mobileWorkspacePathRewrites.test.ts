import { describe, expect, it } from 'vitest'
import {
  movedNoteWikilinkRewrite,
  rewriteMovedWikilinkContent,
} from './mobileWorkspacePathRewrites'
import type { MobileNote } from './mobileWorkspaceModel'

describe('mobile workspace path rewrites', () => {
  it('retargets inbound wikilinks that use the desktop workspace alias casing', () => {
    const rewrite = movedNoteWikilinkRewrite(mobileNote({
      path: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
      workspaceAlias: 'TV',
    }), mobileNote({
      path: 'Writing/Essays/Workflow Orchestration Essay.md',
      workspaceAlias: 'TV',
    }))

    const content = rewriteMovedWikilinkContent(
      'Alias ref [[TV/Memoria/Mobile UI/Workflow Orchestration Essay|alias]] follows the move.',
      rewrite,
    )

    expect(content).toBe(
      'Alias ref [[TV/Writing/Essays/Workflow Orchestration Essay|alias]] follows the move.',
    )
  })
})

function mobileNote(overrides: Partial<MobileNote>): MobileNote {
  return {
    created: '5d ago',
    date: '5d ago',
    favorite: false,
    id: overrides.path ?? 'note.md',
    links: 0,
    modified: '9h ago',
    relationships: [],
    snippet: '',
    status: 'Draft',
    tags: [],
    title: 'Workflow Orchestration Essay',
    type: 'Essay',
    typeTone: 'gray',
    workspace: 'Memoria Vault',
    ...overrides,
  }
}
