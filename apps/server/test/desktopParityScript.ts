import type { FrontmatterTextValue } from '../../../src/lib/frontmatterText'

/**
 * The scripted web edits of the desktop parity suite (TOL-228). Every step goes through the
 * web client and the server the way the web app sends it; `desktopParity.test.ts` records
 * the files each step leaves and `src-tauri/tests/web_desktop_parity.rs` checks that the
 * desktop writes the same bytes for the same operation and reads every note the same way.
 */

export type ParityStep =
  /** A note created from the web: the content `buildNoteContent` makes, written if absent. */
  | { op: 'create'; path: string; title: string; type: string }
  /** The note's body replaced through its live document, as the editor's transactions would. */
  | { op: 'body'; path: string; body: string }
  /** A property edit; `live` sends it into the open document, else to the file. No `value` deletes. */
  | { op: 'property'; path: string; key: string; value?: FrontmatterTextValue; live: boolean }
  /** A title rename: the file follows the title and wikilinks to the note are rewritten. */
  | { op: 'rename'; path: string; newTitle: string; oldTitle: string }
  /** An image uploaded from the web, then shown at the end of the note's body. */
  | { op: 'attachment'; path: string; filename: string; alt: string }

/**
 * What the app's `buildNoteContent` makes for a new note with a title and a type, on the web as
 * on the desktop; `src/hooks/noteCreationParity.test.ts` holds the two together.
 */
export function newNoteContent(title: string, type: string): string {
  return `---\ntitle: ${title}\ntype: ${type}\n---\n`
}

export const ATTACHMENT_NOW = 1_767_225_600_000

/** A 1×1 PNG: the bytes the suite uploads. */
export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=='

const SYNC = 'weekly-sync.md'
const ADA = 'ada-lovelace.md'
const ROADMAP = 'roadmap.md'

const AGENDA = '# Team Sync\n\nAgenda for the week.\n'
const LISTS = `${AGENDA}\n- Budget\n- Hiring\n  - Backend\n  - Design\n\n1. Review\n2. Decide\n`
const TASKS = `${LISTS}\n- [ ] Send minutes\n- [x] Book the room\n`
const TABLE = `${TASKS}\n| Owner | Topic |\n| --- | --- |\n| Ada | Engine |\n| Luca | Notes |\n`
const CODE = `${TABLE}\n\`\`\`ts\nconst total = items.reduce((sum, item) => sum + item.cost, 0)\n\`\`\`\n`
const LINKS = `${CODE}\nOwner: [[ada-lovelace]], see [[ada-lovelace|Ada]] and [[roadmap|the roadmap]].\n`
const INLINE = `${LINKS}\nSome **bold**, _italic_, \`code\` and a [link](https://example.com).\n`
const SECTIONS = `${INLINE}\n## Decisions\n\n> Ship the parity suite first.\n`

export const PARITY_SCRIPT: ParityStep[] = [
  { op: 'create', path: SYNC, title: 'Weekly Sync', type: 'Note' },
  { op: 'create', path: ADA, title: 'Ada Lovelace', type: 'Person' },
  { op: 'create', path: ROADMAP, title: 'Roadmap', type: 'Project' },
  { op: 'body', path: SYNC, body: '# Weekly Sync\n\nAgenda for the week.\n' },
  { op: 'body', path: SYNC, body: AGENDA },
  { op: 'body', path: SYNC, body: LISTS },
  { op: 'body', path: SYNC, body: TASKS },
  { op: 'body', path: SYNC, body: TABLE },
  { op: 'body', path: SYNC, body: CODE },
  { op: 'body', path: SYNC, body: LINKS },
  { op: 'body', path: SYNC, body: INLINE },
  { op: 'body', path: SYNC, body: SECTIONS },
  { op: 'body', path: ADA, body: '# Ada Lovelace\n\nFirst programmer. Works on [[roadmap]].\n' },
  { op: 'body', path: ROADMAP, body: '# Roadmap\n\nOwned by [[ada-lovelace|Ada]].\n' },
  { op: 'property', path: SYNC, key: 'status', value: 'Active', live: true },
  { op: 'property', path: SYNC, key: 'tags', value: ['planning', 'team'], live: true },
  { op: 'property', path: SYNC, key: 'priority', value: 2, live: true },
  { op: 'property', path: SYNC, key: 'published', value: true, live: true },
  { op: 'property', path: SYNC, key: 'related_to', value: '[[ada-lovelace]]', live: true },
  { op: 'property', path: SYNC, key: 'summary', value: 'Q4: plan & review', live: true },
  { op: 'property', path: SYNC, key: 'status', value: 'Done', live: true },
  { op: 'property', path: SYNC, key: 'priority', live: true },
  { op: 'property', path: ADA, key: 'aliases', value: ['Countess', 'Ada'], live: true },
  { op: 'property', path: 'projects/alpha.md', key: 'type', value: 'Project', live: false },
  { op: 'property', path: 'welcome.md', key: 'belongs_to', value: ['[[projects/alpha]]', '[[roadmap]]'], live: false },
  { op: 'property', path: 'welcome.md', key: 'Owner', value: '[[ada-lovelace|Ada]]', live: false },
  { op: 'rename', path: ADA, newTitle: 'Ada King', oldTitle: 'Ada Lovelace' },
  { op: 'rename', path: ROADMAP, newTitle: 'Roadmap 2027', oldTitle: 'Roadmap' },
  { op: 'attachment', path: SYNC, filename: 'my photo.png', alt: 'My photo' },
  { op: 'rename', path: SYNC, newTitle: 'Team Sync', oldTitle: 'Team Sync' },
]
