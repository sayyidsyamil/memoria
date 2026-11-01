import type {
  MobileEditorBlock,
  MobileEditorInline,
  MobileNote,
  MobileRelationship,
  MobileRelationshipKind,
  MobileRelationshipValue,
  MobileSidebarFolder,
  MobileSidebarIcon,
  MobileSidebarItem,
  MobileSidebarSection,
  MobileSavedView,
  MobileSyncStatus,
  MobileTone,
  MobileTypeDefinitions,
  MobileWorkspaceSnapshot,
} from '../workspace/mobileWorkspaceModel'
import { fixtureEditorBullets, fixtureEditorBlocks, longTitleEditorBlocks, propertyHeavyEditorBlocks, markdownHeavyEditorBlocks } from './workspaceEditorFixtures'

export type FixtureNote = MobileNote

export type FixtureRelationshipKind = MobileRelationshipKind

export type FixtureRelationship = MobileRelationship

export type FixtureRelationshipValue = MobileRelationshipValue

export type FixtureTone = MobileTone

export type FixtureSidebarIcon = MobileSidebarIcon

export type FixtureSidebarItem = MobileSidebarItem

export type FixtureSidebarSection = MobileSidebarSection

export type FixtureSidebarFolder = MobileSidebarFolder

export type FixtureSavedView = MobileSavedView

export type FixtureSyncStatus = MobileSyncStatus

export type FixtureEditorInline = MobileEditorInline

export type FixtureEditorBlock = MobileEditorBlock

export type WorkspaceScenario = MobileWorkspaceSnapshot & {
  id: WorkspaceScenarioId
}

export type WorkspaceScenarioId =
  | 'default'
  | 'empty-inbox'
  | 'folder-tree'
  | 'long-title'
  | 'markdown-heavy'
  | 'property-heavy'

export const fixtureNotes: FixtureNote[] = [
  {
    id: 'workflow-orchestration',
    path: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
    title: 'Workflow Orchestration Essay',
    snippet: 'The current narrative and temptation: everything routed through an LLM.',
    type: 'Essay',
    typeTone: 'green',
    tags: ['Design', 'AI'],
    status: 'Draft',
    date: 'May 13, 2026',
    modified: '9h ago',
    created: '5d ago',
    favorite: true,
    links: 12,
    relationships: [
      {
        kind: 'belongsTo',
        values: [
          { title: 'LLM Workflow', type: 'Essay', typeTone: 'green' },
          { title: 'Memoria MVP', type: 'Project', typeTone: 'purple' },
        ],
      },
      {
        kind: 'relatedTo',
        values: [
          { title: 'Release Notes', type: 'Release', typeTone: 'orange' },
        ],
      },
      {
        kind: 'custom',
        label: 'Mentions',
        values: [
          { title: 'AI Ops Guide', type: 'Procedure', typeTone: 'purple' },
        ],
      },
    ],
    workspace: 'TV',
  },
  {
    id: 'open-source-project',
    path: 'Memoria/Mobile UI/How I Run an Open Source Project.md',
    title: 'How I Run an Open Source Project',
    snippet: 'Memoria unexpected success: various sources of input, requests, and bugs.',
    type: 'Procedure',
    typeTone: 'purple',
    tags: ['Process', 'Public'],
    status: 'Active',
    date: 'May 12, 2026',
    modified: '10h ago',
    created: '10h ago',
    favorite: false,
    links: 8,
    relationships: [
      {
        kind: 'has',
        values: [
          { title: 'Contributor Guide', type: 'Procedure', typeTone: 'purple' },
          { title: 'Community Forum', type: 'Essay', typeTone: 'green' },
        ],
      },
      {
        kind: 'belongsTo',
        values: [
          { title: 'Project Board', type: 'Project', typeTone: 'purple' },
        ],
      },
    ],
    workspace: 'TV',
  },
  {
    id: 'release-2026-05-02',
    path: 'Memoria/Releases/v2026-05-02.md',
    title: 'v2026-05-02',
    snippet: 'Release cleanup date, bug fixes, and mobile planning notes.',
    type: 'Release',
    typeTone: 'orange',
    tags: ['Memoria MVP'],
    status: 'Shipped',
    date: 'May 2, 2026',
    modified: '12h ago',
    created: '1d ago',
    favorite: false,
    links: 18,
    relationships: [
      {
        kind: 'relatedTo',
        values: [
          { title: 'QA Checklist', type: 'Procedure', typeTone: 'purple' },
          { title: 'Mobile Planning', type: 'Essay', typeTone: 'green' },
        ],
      },
      {
        kind: 'has',
        values: [
          { title: 'Release Notes', type: 'Release', typeTone: 'orange' },
          { title: 'Postmortem', type: 'Essay', typeTone: 'green' },
        ],
      },
    ],
    workspace: 'TV',
  },
]

const longTitleNote: FixtureNote = {
  id: 'long-title-layout-pressure',
  path: 'Writing/Essays/A Very Long Note Title.md',
  title: 'A Very Long Note Title That Should Stay Readable Without Pushing Type Icons or Property Controls Out of Alignment',
  snippet: 'Used to verify row truncation, editor title wrapping, and toolbar stability.',
  type: 'Essay',
  typeTone: 'green',
  tags: ['Design', 'Mobile', 'Layout'],
  status: 'Draft',
  date: 'June 3, 2026',
  modified: '14m ago',
  created: '2d ago',
  favorite: false,
  links: 6,
  relationships: [
    {
      kind: 'relatedTo',
      values: [
        { title: 'Tablet Shell', type: 'Project', typeTone: 'purple' },
        { title: 'Properties Panel', type: 'Procedure', typeTone: 'purple' },
      ],
    },
  ],
  workspace: 'TV',
}

const propertyHeavyNote: FixtureNote = {
  id: 'mobile-ui-property-heavy',
  path: 'Memoria/Mobile UI/Mobile UI Parity Review.md',
  title: 'Mobile UI Parity Review',
  snippet: 'A dense fixture for multi-value properties, relationship groups, and long metadata sets.',
  type: 'Procedure',
  typeTone: 'purple',
  tags: ['Mobile', 'Parity', 'Design QA', 'Tablet', 'Inspector', 'Relationships'],
  status: 'Active',
  date: 'June 9, 2026',
  modified: '3m ago',
  created: '4d ago',
  favorite: true,
  links: 32,
  relationships: [
    {
      kind: 'belongsTo',
      values: [
        { title: 'Memoria Mobile', type: 'Project', typeTone: 'purple' },
        { title: 'Tablet Workspace', type: 'Essay', typeTone: 'green' },
      ],
    },
    {
      kind: 'has',
      values: [
        { title: 'Navigation Pass', type: 'Procedure', typeTone: 'purple' },
        { title: 'Property Inspector Pass', type: 'Procedure', typeTone: 'purple' },
        { title: 'Sync Footer Pass', type: 'Procedure', typeTone: 'purple' },
        { title: 'Screenshot QA Matrix', type: 'Release', typeTone: 'orange' },
      ],
    },
    {
      kind: 'relatedTo',
      values: [
        { title: 'Desktop Inspector', type: 'Essay', typeTone: 'green' },
        { title: 'Relationship Model', type: 'Essay', typeTone: 'green' },
        { title: 'Mobile Design Review', type: 'Procedure', typeTone: 'purple' },
      ],
    },
    {
      kind: 'custom',
      label: 'Depends on',
      values: [
        { title: 'Fixture Harness', type: 'Procedure', typeTone: 'purple' },
        { title: 'Expo Web Export', type: 'Procedure', typeTone: 'purple' },
        { title: 'Playwright Screenshots', type: 'Release', typeTone: 'orange' },
      ],
    },
  ],
  workspace: 'TV',
}

const markdownHeavyNote: FixtureNote = {
  id: 'markdown-heavy-renderer',
  path: 'Memoria/Mobile UI/Markdown Renderer Parity.md',
  title: 'Markdown Renderer Parity',
  snippet: 'Renderer fixture for H4, ordered lists, tasks, code fences, links, and dividers.',
  type: 'Essay',
  typeTone: 'green',
  tags: ['Mobile', 'Markdown', 'Parity'],
  status: 'Active',
  date: 'June 15, 2026',
  modified: '1m ago',
  created: 'Jun 15',
  favorite: false,
  links: 8,
  relationships: [
    {
      kind: 'relatedTo',
      values: [
        { title: 'Workflow Orchestration Essay', type: 'Essay', typeTone: 'green' },
      ],
    },
  ],
  workspace: 'TV',
}

const defaultSidebarSections: FixtureSidebarSection[] = [
  {
    id: 'primary',
    items: [
      { id: 'inbox', active: true, count: '7', icon: 'inbox', label: 'Inbox' },
      { id: 'all-notes', count: '8846', icon: 'file', label: 'All Notes' },
      { id: 'archive', count: '276', icon: 'archive', label: 'Archive' },
    ],
  },
  {
    id: 'favorites',
    label: 'Favorites',
    items: [
      { id: 'personal-journal', icon: 'star', label: 'Personal Journal' },
      { id: 'memoria-mvp', icon: 'folder', label: 'Memoria MVP' },
    ],
  },
  {
    id: 'views',
    label: 'Views',
    items: [
      { id: 'view-active-procedures', count: '1', icon: 'view', label: 'Active Procedures', tone: 'purple', viewId: 'view-active-procedures' },
    ],
  },
  {
    count: '517',
    id: 'types',
    label: 'Types',
    items: [
      { id: 'essays', count: '448', icon: 'file', label: 'Essays', tone: 'green', typeName: 'Essay' },
      { id: 'procedures', count: '51', icon: 'procedure', label: 'Procedures', tone: 'purple', typeName: 'Procedure' },
      { id: 'responsibilities', count: '18', icon: 'tag', label: 'Responsibilities', tone: 'orange', typeName: 'Responsibility' },
    ],
  },
  {
    id: 'folders',
    label: 'Folders',
    folders: [
      {
        id: 'Writing',
        name: 'Writing',
        expanded: true,
        children: [
          { id: 'Writing/Essays', name: 'Essays', children: [] },
          { id: 'Writing/Drafts', name: 'Drafts', children: [] },
        ],
      },
      {
        id: 'Memoria',
        name: 'Memoria',
        expanded: true,
        active: true,
        children: [
          { id: 'Memoria/Mobile UI', name: 'Mobile UI', children: [] },
          { id: 'Memoria/Releases', name: 'Releases', children: [] },
        ],
      },
    ],
  },
]

const fixtureViews: FixtureSavedView[] = [
  {
    filename: 'active-procedures.yml',
    id: 'view-active-procedures',
    definition: {
      color: 'purple',
      filters: {
        all: [
          { field: 'type', op: 'equals', value: 'Procedure' },
          { field: 'status', op: 'equals', value: 'Active' },
        ],
      },
      icon: null,
      listPropertiesDisplay: ['belongs_to', 'tags'],
      name: 'Active Procedures',
      sort: 'modified:desc',
    },
  },
]

const fixtureTypeDefinitions: MobileTypeDefinitions = {
  Essay: {
    icon: 'file',
    path: 'essay.md',
    properties: { Priority: 'Medium' },
    rawContent: '---\ntype: Type\ncolor: green\nicon: file\n---\n# Essay\n',
    tone: 'green',
  },
  Procedure: {
    icon: 'stack',
    path: 'procedure.md',
    properties: { Cadence: 'Weekly' },
    rawContent: '---\ntype: Type\ncolor: purple\nicon: stack\n---\n# Procedure\n',
    tone: 'purple',
  },
  Release: {
    icon: 'archive',
    path: 'release.md',
    properties: { Date: '2026-05-02' },
    rawContent: '---\ntype: Type\ncolor: orange\nicon: archive\n---\n# Release\n',
    tone: 'orange',
  },
}

const folderTreePressureSections: FixtureSidebarSection[] = [
  ...defaultSidebarSections.filter((section) => section.id !== 'folders'),
  {
    id: 'folders',
    label: 'Folders',
    folders: [
      {
        id: 'Writing',
        name: 'Writing',
        expanded: true,
        children: [
          { id: 'Writing/Essays', name: 'Essays', children: [] },
          { id: 'Writing/Drafts', name: 'Drafts', children: [] },
          { id: 'Writing/Research Backlog', name: 'Research Backlog', children: [] },
        ],
      },
      {
        id: 'Memoria',
        name: 'Memoria',
        expanded: true,
        active: true,
        children: [
          {
            id: 'Memoria/Mobile UI',
            name: 'Mobile UI',
            expanded: true,
            children: [
              { id: 'Memoria/Mobile UI/Tablet Shell', name: 'Tablet Shell', children: [] },
              { id: 'Memoria/Mobile UI/Properties Panel', name: 'Properties Panel', children: [] },
            ],
          },
          { id: 'Memoria/Releases', name: 'Releases', children: [] },
        ],
      },
      {
        id: 'Attachments',
        name: 'Attachments',
        expanded: true,
        children: [
          { id: 'Attachments/Images', name: 'Images', children: [] },
          { id: 'Attachments/PDFs', name: 'PDFs', children: [] },
        ],
      },
    ],
  },
]

export const defaultWorkspaceScenarioId: WorkspaceScenarioId = 'default'

export const workspaceScenarios: Record<WorkspaceScenarioId, WorkspaceScenario> = {
  default: {
    editorBlocks: fixtureEditorBlocks,
    editorBullets: fixtureEditorBullets,
    id: 'default',
    noteListSubtitle: '7 open notes',
    notes: fixtureNotes,
    selectedNoteId: fixtureNotes[0].id,
    sidebarSections: defaultSidebarSections,
    sync: { kind: 'synced', minutesAgo: 2 },
    typeDefinitions: fixtureTypeDefinitions,
    views: fixtureViews,
  },
  'folder-tree': {
    editorBlocks: fixtureEditorBlocks,
    editorBullets: fixtureEditorBullets,
    id: 'folder-tree',
    noteListSubtitle: '7 open notes',
    notes: fixtureNotes,
    selectedNoteId: fixtureNotes[1].id,
    sidebarSections: folderTreePressureSections,
    sync: { kind: 'synced', minutesAgo: 8 },
    typeDefinitions: fixtureTypeDefinitions,
    views: fixtureViews,
  },
  'empty-inbox': {
    editorBlocks: fixtureEditorBlocks,
    editorBullets: fixtureEditorBullets,
    id: 'empty-inbox',
    noteListSubtitle: '0 open notes',
    notes: [],
    searchQuery: 'Inbox',
    sidebarSections: defaultSidebarSections,
    sync: { kind: 'pullRequired' },
    typeDefinitions: fixtureTypeDefinitions,
    views: fixtureViews,
  },
  'long-title': {
    editorBlocks: longTitleEditorBlocks,
    editorBullets: [
      'This note intentionally uses a title long enough to pressure the row, toolbar, and editor heading.',
      'The title should truncate in narrow slots and wrap only inside the editor content area.',
    ],
    id: 'long-title',
    noteListSubtitle: '8 open notes',
    notes: [longTitleNote, ...fixtureNotes],
    selectedNoteId: longTitleNote.id,
    sidebarSections: defaultSidebarSections,
    sync: { kind: 'synced', minutesAgo: 1 },
    typeDefinitions: fixtureTypeDefinitions,
    views: fixtureViews,
  },
  'markdown-heavy': {
    editorBlocks: markdownHeavyEditorBlocks,
    editorBullets: [
      'Renderer fixture for H4, ordered lists, tasks, code fences, links, and dividers.',
      'The scenario is isolated from the default screenshot baseline.',
    ],
    id: 'markdown-heavy',
    noteListSubtitle: '8 open notes',
    notes: [markdownHeavyNote, ...fixtureNotes],
    selectedNoteId: markdownHeavyNote.id,
    sidebarSections: defaultSidebarSections,
    sync: { kind: 'synced', minutesAgo: 0 },
    typeDefinitions: fixtureTypeDefinitions,
    views: fixtureViews,
  },
  'property-heavy': {
    editorBlocks: propertyHeavyEditorBlocks,
    editorBullets: [
      'Property-heavy notes should preserve scanability even when relationships contain several typed groups.',
      'The add-property and add-relationship affordances must remain visible without becoming floating actions.',
    ],
    id: 'property-heavy',
    noteListSubtitle: '8 open notes',
    notes: [propertyHeavyNote, ...fixtureNotes],
    selectedNoteId: propertyHeavyNote.id,
    sidebarSections: defaultSidebarSections,
    sync: { kind: 'conflict' },
    typeDefinitions: fixtureTypeDefinitions,
    views: fixtureViews,
  },
}

export function workspaceScenarioForId(id: string | null | undefined) {
  if (!id || !(id in workspaceScenarios)) {
    return workspaceScenarios[defaultWorkspaceScenarioId]
  }

  return workspaceScenarios[id as WorkspaceScenarioId]
}

export { fixtureEditorBullets, fixtureEditorBlocks } from './workspaceEditorFixtures'
