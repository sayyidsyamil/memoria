import type {
  MobileNote,
  MobilePropertyDisplayMode,
  MobileSavedView,
  MobileTypeDefinition,
  MobileViewDefinition,
  MobileViewFilterGroup,
} from '../workspace/mobileWorkspaceModel'
import type {
  MobileTypeDefinitionPatch,
} from '../workspace/mobileTypeDefinitions'

export const createdNotePath = 'Writing/Drafts/mobile-created.md'

export const createdTitleLessType = 'Project'

export const createdFolderPath = 'Folders/Created Drafts'

export const favoriteAlphaPath = 'Favorites/Alpha.md'

export const favoriteBetaPath = 'Favorites/Beta.md'

export const movedNoteFolderPath = 'Research'

export const movedNotePath = 'Research/Seed.md'

export const metadataNotePath = 'Metadata/Chrome State.md'

export const oldTypeName = 'Retired Proof'

export const oldViewName = 'Old Native Proof'

export const propertyRelationshipNotePath = 'Properties/Relationship Proof.md'

export const propertyRelationshipUrl = 'https://memoria.local/mobile'

export const removedIconNotePath = 'Metadata/Icon Removal.md'

export const relationshipSourcePath = 'Relationships/Source.md'

export const relationshipTargetPath = 'Relationships/native-related-target.md'

export const reorderedTypeAlphaName = 'Order Alpha'

export const reorderedTypeBetaName = 'Order Beta'

export const reorderedViewAlphaName = 'Order Alpha View'

export const reorderedViewBetaName = 'Order Beta View'

export const renamedTypeAssignedNotePath = 'Writing/Type Rename Assigned.md'

export const renamedTypeName = 'Rename Target'

export const renamedTypePath = 'rename-target.md'

export const renamedTypeSchemaCarrierName = 'Schema Carrier'

export const renamedTypeSourceName = 'Rename Source'

export const renamedTypeSourcePath = 'rename-source.md'

export const renamedFolderPath = 'Folders/Proof Queue'

export const restoredFolderPath = 'Restored Folder'

export const restoredNotePath = 'Restored Undo Note.md'

export const restoredTypeName = 'Restored Type'

export const restoredTypeOrder = 42

export const restoredTypePath = 'restored-type.md'

export const restoredViewFilename = 'restored-view.yml'

export const restoredViewName = 'Restored View'

export const textFilePath = 'Files/mobile-config.txt'

export const textFileUpdatedContent = 'feature=mobile-editing\nmode=plain-text\n'

export const typeName = 'Proof Decision'

export const updatedTypeName = 'Section Proof'

export const updatedTypeTemplate = '## Next\n\n- Keep desktop sections durable.'

export const updatedViewName = 'Updated Native Proof'

export const updatedViewSourceName = 'Update Native Proof'

export const updatedNativeProofViewFilters: MobileViewFilterGroup = {
  all: [
    {
      any: [
        { field: 'status', op: 'equals', regex: false, value: 'Active' },
        {
          all: [
            { field: 'depends_on', op: 'contains', regex: false, value: 'Relationships/Source' },
            { field: 'ReviewScore', op: 'equals', regex: false, value: 5 },
          ],
        },
      ],
    },
    { field: 'title', op: 'contains', regex: true, value: '^Mobile\\s+Persistence' },
    { field: 'Date', op: 'after', regex: false, value: '10 days ago' },
  ],
}

export const workspacePersistencePropertyDisplayModes = {
  Priority: 'number',
  Website: 'url',
} satisfies Record<string, MobilePropertyDisplayMode>

export function updatedNativeProofViewDefinition(): MobileViewDefinition {
  return {
    color: 'purple',
    filters: updatedNativeProofViewFilters,
    icon: 'folder',
    listPropertiesDisplay: ['status', 'Priority'],
    name: updatedViewName,
    sort: 'property:Priority:asc',
  }
}

export function mobilePersistenceViewDefinition(): MobileViewDefinition {
  return {
    color: 'green',
    filters: { all: [{ field: 'type', op: 'equals', value: 'Essay' }] },
    icon: 'file-text',
    name: 'Mobile Persistence',
    sort: 'modified:desc',
  }
}

export function updatedTypeDefinitionPatch(): MobileTypeDefinitionPatch {
  return {
    icon: 'sparkles',
    label: 'Section Proofs',
    listPropertiesDisplay: ['status', 'Priority', 'belongs_to'],
    order: 3,
    properties: {
      Priority: 'High',
      ReviewScore: 5,
    },
    relationships: {
      depends_on: ['[[Relationships/Source]]'],
      related_to: ['[[Research/Seed]]'],
    },
    sort: 'property:Priority:desc',
    template: updatedTypeTemplate,
    tone: 'yellow',
    view: 'Mobile Persistence',
    visible: false,
  }
}

export function restoredMobileNote(): MobileNote {
  return {
    created: '2d ago',
    date: '2d ago',
    favorite: false,
    id: restoredNotePath,
    links: 0,
    modified: '2d ago',
    path: restoredNotePath,
    rawContent: restoredNoteContent(),
    relationships: [],
    snippet: 'Restored from mobile history.',
    status: 'Active',
    tags: ['Restored'],
    title: 'Restored Undo Note',
    type: 'Essay',
    typeTone: 'green',
    workspace: 'TV',
  }
}

export function restoredMobileView(): MobileSavedView {
  return {
    definition: {
      color: 'blue',
      filters: { all: [] },
      icon: 'rotate-ccw',
      name: restoredViewName,
      order: 7,
      sort: 'modified:desc',
    },
    filename: restoredViewFilename,
    id: 'view-restored-view',
  }
}

export function restoredTypeDefinition(): MobileTypeDefinition {
  return {
    icon: 'rotate-ccw',
    order: restoredTypeOrder,
    path: restoredTypePath,
    rawContent: typeDefinitionContent(restoredTypeName, 'blue', restoredTypeOrder),
    tone: 'blue',
  }
}

export function seedNoteInitialContent() {
  return essayNoteContent('Seeded Mobile Note', 'Initial content.')
}

export function seedNoteUpdatedContent() {
  return essayNoteContent('Seeded Mobile Note', 'This was saved before moving through native persistence.', ['status: Active'])
}

export function restoredNoteContent() {
  return [
    '---',
    'type: Essay',
    'status: Active',
    'tags:',
    '  - Restored',
    '---',
    '# Restored Undo Note',
    '',
    'Restored from mobile history.',
    '',
  ].join('\n')
}

export function favoriteNoteContent(title: string, index: number) {
  return [
    '---',
    `title: ${title}`,
    '_favorite: true',
    `_favorite_index: ${index}`,
    '---',
    `# ${title}`,
    '',
  ].join('\n')
}

export function metadataNoteInitialContent() {
  return essayNoteContent('Chrome State', 'Metadata persistence proof seed.')
}

export function relationshipSourceContent() {
  return essayNoteContent('Relationship Source', 'Create a relationship target from this note.', [
    'status: Draft',
    'belongs_to:',
    '  - [[Writing/Seed]]',
  ])
}

export function propertyRelationshipNoteContent() {
  return essayNoteContent('Relationship Proof', 'Property and relationship persistence seed.', [
    'status: Draft',
    'Obsolete: remove me',
    'Related to:',
    '  - "[[Writing/Seed]]"',
  ])
}

function essayNoteContent(title: string, body: string, properties = ['status: Draft']) {
  return ['---', 'type: Essay', ...properties, '---', `# ${title}`, '', body, ''].join('\n')
}

export function textFileInitialContent() {
  return 'feature=seed\nmode=plain-text\n'
}

export function renamedTypeAssignedNoteContent() {
  return [
    '---',
    `type: ${renamedTypeSourceName}`,
    'status: Draft',
    '---',
    '# Type Rename Assigned',
    '',
    `References [[${renamedTypeSourceName}]].`,
    '',
  ].join('\n')
}

export function renamedTypeSchemaCarrierContent() {
  return [
    '---',
    'type: Type',
    'color: orange',
    'icon: file-text',
    'related_to:',
    `  - "[[${renamedTypeSourceName}]]"`,
    '---',
    `# ${renamedTypeSchemaCarrierName}`,
    '',
  ].join('\n')
}

export function typeDefinitionContent(name: string, color: string, order?: number) {
  return [
    '---',
    'type: Type',
    `color: ${color}`,
    'icon: file-text',
    ...(order === undefined ? [] : [`_order: ${order}`]),
    '---',
    `# ${name}`,
    '',
  ].join('\n')
}

export function orderedNativeProofViewContent(name: string, order: number) {
  return [
    `name: ${name}`,
    'icon: file-text',
    'color: gray',
    'sort: null',
    `order: ${order}`,
    'filters:',
    '  all: []',
    '',
  ].join('\n')
}

export function oldNativeProofViewContent() {
  return [
    `name: ${oldViewName}`,
    'icon: archive',
    'color: gray',
    'sort: null',
    'filters:',
    '  all: []',
    '',
  ].join('\n')
}

export function updateNativeProofViewContent() {
  return [
    `name: ${updatedViewSourceName}`,
    'icon: archive',
    'color: gray',
    'sort: null',
    'listPropertiesDisplay:',
    '  - status',
    'filters:',
    '  all:',
    '    - field: type',
    '      op: equals',
    '      value: Essay',
    '',
  ].join('\n')
}
