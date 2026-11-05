import type { MobileNote, MobileSavedView } from './mobileWorkspaceModel'

export function note(overrides: Partial<MobileNote>): MobileNote {
  return {
    created: '-',
    date: '-',
    favorite: false,
    id: 'note',
    links: 0,
    modified: '-',
    relationships: [],
    snippet: '',
    status: '',
    tags: [],
    title: 'Note',
    type: 'Note',
    typeTone: 'gray',
    workspace: 'TV',
    ...overrides,
  }
}

export function relationship(key: string, values: Array<{ ref: string; title: string }>) {
  return {
    key,
    kind: 'custom' as const,
    values: values.map((value) => ({
      ...value,
      type: 'Note',
      typeTone: 'gray' as const,
    })),
  }
}

export function viewFixture(filename: string, name: string, order: number | null): MobileSavedView {
  return {
    definition: {
      color: null,
      filters: { all: [] },
      icon: null,
      name,
      order,
      sort: null,
    },
    filename,
    id: `view-${filename.replace(/\.yml$/u, '')}`,
  }
}

export function requiredView(view: MobileSavedView | null): MobileSavedView {
  if (!view) throw new Error('Expected a valid saved view')
  return view
}
