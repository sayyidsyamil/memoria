import { describe, expect, it } from 'vitest'
import {
  addPropertyFields,
  deletePropertyEdit,
  editPropertyFields,
  propertyEditFromForm,
} from './tabletWorkspacePropertyActions'

describe('tablet workspace property actions', () => {
  it('opens prefilled add-property sheets with persisted desktop display modes', () => {
    expect(addPropertyFields('Priority', { Priority: 'status' })).toEqual([
      { key: 'propertyName', value: 'Priority' },
      { key: 'propertyValue', value: '' },
      { key: 'propertyValueKind', value: 'status' },
    ])
  })

  it('falls back to desktop key heuristics when no display mode override exists', () => {
    expect(addPropertyFields('Due date')).toContainEqual({
      key: 'propertyValueKind',
      value: 'date',
    })
  })

  it('opens edit-property sheets with persisted desktop display modes', () => {
    expect(editPropertyFields('Priority', 'High', { Priority: 'status' })).toContainEqual({
      key: 'propertyValueKind',
      value: 'status',
    })
  })

  it('saves property value edits together with desktop display mode overrides', () => {
    expect(propertyEditFromForm({
      propertyName: ' Priority ',
      propertyValue: '5',
      propertyValueKind: 'number',
    }, ' note-1 ')).toEqual({
      edits: [
        {
          key: 'Priority',
          noteId: 'note-1',
          type: 'updateProperty',
          value: 5,
        },
        {
          key: 'Priority',
          mode: 'number',
          type: 'updatePropertyDisplayMode',
        },
      ],
      type: 'bulkEdit',
    })
    expect(propertyEditFromForm({
      propertyName: '',
      propertyValue: '5',
      propertyValueKind: 'number',
    }, 'note-1')).toBeNull()
    expect(propertyEditFromForm({
      propertyName: 'Priority',
      propertyValue: '5',
      propertyValueKind: 'number',
    }, '')).toBeNull()
  })

  it('builds guarded desktop delete-property edits', () => {
    expect(deletePropertyEdit(' note-1 ', ' Status ')).toEqual({
      key: 'Status',
      noteId: 'note-1',
      type: 'deleteProperty',
    })
    expect(deletePropertyEdit('', 'Status')).toBeNull()
    expect(deletePropertyEdit('note-1', '')).toBeNull()
  })
})
