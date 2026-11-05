import { mobileText } from '../../i18n/mobileText'

export const mobileSlashCommands = [
  { action: 'paragraph', label: mobileText('editor.blockType.paragraph'), aliases: 'text normal' },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    action: `heading${level}` as const,
    label: mobileText(`editor.formatting.heading${level}`),
    aliases: `h${level} heading ${level}`,
  })),
  { action: 'bulletList', label: mobileText('editor.formatting.bulletList'), aliases: 'bullet unordered list' },
  { action: 'orderedList', label: mobileText('editor.formatting.orderedList'), aliases: 'numbered ordered list' },
  { action: 'taskList', label: mobileText('editor.formatting.taskList'), aliases: 'todo task check list' },
  { action: 'quote', label: mobileText('editor.formatting.quote'), aliases: 'blockquote quote' },
  { action: 'codeBlock', label: mobileText('editor.formatting.codeBlock'), aliases: 'code block' },
  { action: 'divider', label: mobileText('editor.formatting.divider'), aliases: 'divider rule separator' },
  { action: 'table', label: mobileText('editor.formatting.table'), aliases: 'table' },
  { action: 'mathBlock', label: mobileText('editor.slash.math'), aliases: 'math equation latex' },
] as const

export type MobileSlashAction = typeof mobileSlashCommands[number]['action']
export type MobileSlashState = {
  commands: Array<{ action: MobileSlashAction; label: string }>
  from: number
  to: number
  index: number
  query: string
}

export function matchingMobileSlashCommands(query: string) {
  const search = query.trim().toLocaleLowerCase()
  return mobileSlashCommands.filter(({ label, aliases }) => `${label} ${aliases}`.toLocaleLowerCase().includes(search))
}
