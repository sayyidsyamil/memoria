import { describe, expect, it } from 'vitest'
import {
  deleteTypeDefinitionEdit,
  deleteViewEdit,
  moveFavoriteEdit,
  moveTypeSectionEdit,
  moveViewEdit,
} from './tabletWorkspaceSidebarEditActions'

describe('tablet workspace sidebar edit actions', () => {
  it('builds desktop-compatible favorite move edits from sidebar actions', () => {
    expect(moveFavoriteEdit(' open-source-project ', 'up')).toEqual({
      direction: 'up',
      noteId: 'open-source-project',
      type: 'moveFavorite',
    })
    expect(moveFavoriteEdit('   ', 'down')).toBeNull()
  })

  it('builds desktop-compatible saved-view sidebar edits', () => {
    expect(moveViewEdit(' view-active-procedures ', 'down')).toEqual({
      direction: 'down',
      type: 'moveView',
      viewId: 'view-active-procedures',
    })
    expect(deleteViewEdit(' view-active-procedures ')).toEqual({
      type: 'deleteView',
      viewId: 'view-active-procedures',
    })
    expect(moveViewEdit('', 'up')).toBeNull()
    expect(deleteViewEdit('')).toBeNull()
  })

  it('builds desktop-compatible Type section sidebar edits', () => {
    expect(moveTypeSectionEdit(' Procedure ', 'up')).toEqual({
      direction: 'up',
      type: 'moveTypeSection',
      typeName: 'Procedure',
    })
    expect(deleteTypeDefinitionEdit(' Procedure ')).toEqual({
      type: 'deleteTypeDefinition',
      typeName: 'Procedure',
    })
    expect(moveTypeSectionEdit('', 'down')).toBeNull()
    expect(deleteTypeDefinitionEdit('')).toBeNull()
  })
})
