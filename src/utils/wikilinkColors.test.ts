import { describe, it, expect } from 'vitest'
import type { VaultEntry } from '../types'
import { findEntryByTarget, lookupColorForEntry, resolveWikilinkColor } from './wikilinkColors'

function makeEntry(overrides: Partial<VaultEntry>): VaultEntry {
  return {
    path: '/vault/note.md',
    filename: 'note.md',
    title: 'Note',
    isA: null,
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: null,
    createdAt: null,
    fileSize: 100,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    template: null, sort: null,
    outgoingLinks: [],
    ...overrides,
  }
}

const typeProject = makeEntry({ path: '/vault/project.md', filename: 'project.md', title: 'Project', isA: 'Type', color: 'red' })
const typePerson = makeEntry({ path: '/vault/person.md', filename: 'person.md', title: 'Person', isA: 'Type', color: 'yellow' })
const typeEvent = makeEntry({ path: '/vault/event.md', filename: 'event.md', title: 'Event', isA: 'Type', color: 'yellow' })
const typeTopic = makeEntry({ path: '/vault/topic.md', filename: 'topic.md', title: 'Topic', isA: 'Type', color: 'green' })
const typeRecipe = makeEntry({ path: '/vault/recipe.md', filename: 'recipe.md', title: 'Recipe', isA: 'Type', color: 'orange', icon: 'cooking-pot' })
const typeNote = makeEntry({ path: '/vault/note.md', filename: 'note.md', title: 'Note', isA: 'Type', color: 'blue' })

const projectEntry = makeEntry({ path: '/vault/project/app.md', filename: 'app.md', title: 'Build App', isA: 'Project' })
const personEntry = makeEntry({ path: '/vault/person/alice.md', filename: 'alice.md', title: 'Alice', isA: 'Person', aliases: ['Alice Smith'] })
const eventEntry = makeEntry({ path: '/vault/event/kickoff.md', filename: 'kickoff.md', title: 'Kickoff Meeting', isA: 'Event' })
const topicEntry = makeEntry({ path: '/vault/topic/dev.md', filename: 'dev.md', title: 'Software Development', isA: 'Topic' })
const recipeEntry = makeEntry({ path: '/vault/recipe/pasta.md', filename: 'pasta.md', title: 'Pasta Carbonara', isA: 'Recipe' })
const untypedEntry = makeEntry({ path: '/vault/note/random.md', filename: 'random.md', title: 'Random Thought' })
const noteEntry = makeEntry({ path: '/vault/note/welcome-to-laputa.md', filename: 'welcome-to-laputa.md', title: 'Welcome to Laputa', isA: 'Note' })

const allEntries = [typeProject, typePerson, typeEvent, typeTopic, typeRecipe, typeNote, projectEntry, personEntry, eventEntry, topicEntry, recipeEntry, untypedEntry, noteEntry]

describe('findEntryByTarget', () => {
  it('matches by title', () => {
    expect(findEntryByTarget(allEntries, 'Alice')).toBe(personEntry)
  })

  it('matches by filename stem', () => {
    expect(findEntryByTarget(allEntries, 'pasta')).toBe(recipeEntry)
  })

  it('matches by alias', () => {
    expect(findEntryByTarget(allEntries, 'Alice Smith')).toBe(personEntry)
  })

  it('handles pipe syntax (display name)', () => {
    expect(findEntryByTarget(allEntries, 'Alice|Alice S.')).toBe(personEntry)
  })

  it('returns undefined for non-existent target', () => {
    expect(findEntryByTarget(allEntries, 'Non Existent')).toBeUndefined()
  })

  it('matches by relative path (folder/slug)', () => {
    expect(findEntryByTarget(allEntries, 'note/welcome-to-laputa')).toBe(noteEntry)
  })

  it('matches by relative path with pipe syntax', () => {
    expect(findEntryByTarget(allEntries, 'note/welcome-to-laputa|Welcome!')).toBe(noteEntry)
  })

  it('matches project by relative path', () => {
    expect(findEntryByTarget(allEntries, 'project/app')).toBe(projectEntry)
  })

  it('matches person by relative path', () => {
    expect(findEntryByTarget(allEntries, 'person/alice')).toBe(personEntry)
  })
})

describe('lookupColorForEntry', () => {
  it('uses the link accent instead of the Project type color', () => {
    expect(lookupColorForEntry(allEntries, projectEntry)).toBe('var(--accent-blue)')
  })

  it('uses the link accent instead of the Person type color', () => {
    expect(lookupColorForEntry(allEntries, personEntry)).toBe('var(--accent-blue)')
  })

  it('uses the link accent instead of the Event type color', () => {
    expect(lookupColorForEntry(allEntries, eventEntry)).toBe('var(--accent-blue)')
  })

  it('uses the link accent instead of the Topic type color', () => {
    expect(lookupColorForEntry(allEntries, topicEntry)).toBe('var(--accent-blue)')
  })

  it('uses the link accent instead of a custom Type color', () => {
    expect(lookupColorForEntry(allEntries, recipeEntry)).toBe('var(--accent-blue)')
  })

  it('uses the same link accent for an entry with no type', () => {
    expect(lookupColorForEntry(allEntries, untypedEntry)).toBe('var(--accent-blue)')
  })
})

describe('resolveWikilinkColor', () => {
  it('returns the link accent for a known typed note', () => {
    const result = resolveWikilinkColor(allEntries, 'Build App')
    expect(result.isBroken).toBe(false)
    expect(result.color).toBe('var(--accent-blue)')
  })

  it('returns broken link for a non-existent target', () => {
    const result = resolveWikilinkColor(allEntries, 'Does Not Exist')
    expect(result.isBroken).toBe(true)
    expect(result.color).toBe('var(--text-muted)')
  })

  it('returns the link accent for an untyped note', () => {
    const result = resolveWikilinkColor(allEntries, 'Random Thought')
    expect(result.isBroken).toBe(false)
    expect(result.color).toBe('var(--accent-blue)')
  })

  it('uses the link accent without marking links broken before entries load', () => {
    const result = resolveWikilinkColor([], 'Anything')
    expect(result.isBroken).toBe(false)
    expect(result.color).toBe('var(--accent-blue)')
  })

  it('resolves alias-based wikilink target', () => {
    const result = resolveWikilinkColor(allEntries, 'Alice Smith')
    expect(result.isBroken).toBe(false)
    expect(result.color).toBe('var(--accent-blue)')
  })

  it('resolves pipe-syntax wikilink target', () => {
    const result = resolveWikilinkColor(allEntries, 'Alice|Alice S.')
    expect(result.isBroken).toBe(false)
    expect(result.color).toBe('var(--accent-blue)')
  })

  it('resolves relative-path wikilink target to the link accent', () => {
    const result = resolveWikilinkColor(allEntries, 'note/welcome-to-laputa')
    expect(result.isBroken).toBe(false)
    expect(result.color).toBe('var(--accent-blue)')
  })

  it('resolves relative-path with pipe syntax to the link accent', () => {
    const result = resolveWikilinkColor(allEntries, 'person/alice|Alice S.')
    expect(result.isBroken).toBe(false)
    expect(result.color).toBe('var(--accent-blue)')
  })
})
