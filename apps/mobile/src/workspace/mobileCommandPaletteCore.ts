import appCommandManifest from '../../../../src/shared/appCommandManifest.json'
import { mobileText } from '../i18n/mobileText'
import type { MobileCommandGroup, MobileCommandPaletteCommand, MobileCommandPaletteGroup, CommandConfig, DynamicCommandConfig } from './mobileCommandPalette.types'

export const commandGroupOrder: MobileCommandGroup[] = ['Navigation', 'Note', 'View', 'Settings']

export function mobileCommandPaletteResults(
  commands: MobileCommandPaletteCommand[],
  query: string,
): { flatList: MobileCommandPaletteCommand[]; groups: MobileCommandPaletteGroup[] } {
  const enabledCommands = commands.filter((command) => command.enabled)
  const trimmedQuery = query.trim()
  const flatList = trimmedQuery
    ? enabledCommands
      .map((command) => matchedCommand(trimmedQuery, command))
      .filter((match): match is { command: MobileCommandPaletteCommand; score: number } => match !== null)
      .sort((left, right) => right.score - left.score)
      .map((match) => match.command)
    : enabledCommands

  return {
    flatList,
    groups: groupCommands(flatList, trimmedQuery.length > 0),
  }
}

export function mobileCommandGroupLabel(group: MobileCommandGroup): string {
  if (group === 'Navigation') return mobileText('command.group.navigation')
  if (group === 'Note') return mobileText('command.group.note')
  if (group === 'View') return mobileText('command.group.view')
  return mobileText('command.group.settings')
}

export function command(config: CommandConfig): MobileCommandPaletteCommand {
  const manifestCommand = appCommandManifest.commands[config.desktopCommand]
  const shortcut = 'shortcut' in manifestCommand ? manifestCommand.shortcut?.display : undefined

  return {
    desktopCommand: config.desktopCommand,
    enabled: config.enabled ?? config.execute !== undefined,
    execute: config.execute ?? noop,
    group: config.group,
    id: manifestCommand.id,
    keywords: config.keywords,
    label: config.label,
    shortcut,
  }
}

export function dynamicCommand(config: DynamicCommandConfig): MobileCommandPaletteCommand {
  return {
    enabled: config.enabled ?? config.execute !== undefined,
    execute: config.execute ?? noop,
    group: config.group,
    id: config.id,
    keywords: config.keywords,
    label: config.label,
    shortcut: config.shortcut,
  }
}

export function matchedCommand(
  query: string,
  command: MobileCommandPaletteCommand,
): { command: MobileCommandPaletteCommand; score: number } | null {
  const labelResult = fuzzyMatch(query, command.label)
  if (labelResult.match) return { command, score: labelResult.score }

  for (const keyword of command.keywords) {
    const keywordResult = fuzzyMatch(query, keyword)
    if (keywordResult.match) return { command, score: keywordResult.score - 1 }
  }

  const groupResult = fuzzyMatch(query, command.group)
  if (groupResult.match) return { command, score: groupResult.score - 2 }
  return null
}

export function groupCommands(
  commands: MobileCommandPaletteCommand[],
  byRelevance: boolean,
): MobileCommandPaletteGroup[] {
  const groups = new Map<MobileCommandGroup, MobileCommandPaletteCommand[]>()
  for (const commandItem of commands) {
    groups.set(commandItem.group, [...(groups.get(commandItem.group) ?? []), commandItem])
  }

  const entries = Array.from(groups.entries())
  if (!byRelevance) {
    entries.sort((left, right) => commandGroupOrder.indexOf(left[0]) - commandGroupOrder.indexOf(right[0]))
  }

  return entries.map(([group, items]) => ({ group, items }))
}

export function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  let score = 0
  let lastMatchIndex = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t.charAt(ti) !== q.charAt(qi)) continue
    if (ti === lastMatchIndex + 1) score += 2
    if (ti === 0 || [' ', '-'].includes(t.charAt(ti - 1))) score += 3
    score += 1
    lastMatchIndex = ti
    qi += 1
  }

  return { match: qi === q.length, score }
}

export function noop() {}
