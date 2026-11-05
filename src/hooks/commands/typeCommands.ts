import type { CommandAction } from './types'
import type { SidebarSelection } from '../../types'
import { canonicalizeTypeName } from '../../utils/vaultTypes'
import { pluralizeType } from '../../shared/typeLabels'
export { pluralizeType } from '../../shared/typeLabels'

export function buildTypeCommands(
  types: string[],
  onCreateNoteOfType: (type: string) => void,
  onSelect: (sel: SidebarSelection) => void,
): CommandAction[] {
  return types.flatMap((type) => {
    const canonicalType = canonicalizeTypeName(type)
    if (!canonicalType) return []

    const slug = canonicalType.toLowerCase().replace(/\s+/g, '-')
    const plural = pluralizeType(canonicalType)
    const commands: CommandAction[] = []

    if (!['note', 'type'].includes(canonicalType.toLowerCase())) {
      commands.push({
        id: `new-${slug}`, label: `New ${canonicalType}`, group: 'Note' as const,
        keywords: ['new', 'create', canonicalType.toLowerCase()],
        enabled: true, execute: () => onCreateNoteOfType(canonicalType),
      })
    }

    commands.push({
      id: `list-${slug}`, label: `List ${plural}`, group: 'Navigation' as const,
      keywords: ['list', 'show', 'filter', canonicalType.toLowerCase(), plural.toLowerCase()],
      enabled: true, execute: () => onSelect({ kind: 'sectionGroup', type: canonicalType }),
    })

    return commands
  })
}
