import type { Brief, LedgerRegistry } from './ledgerApi'
import { attributeLabel, findAttribute, formatDate, formatValue } from './ledgerFormat'

export function briefTitle(today: Date = new Date()): string {
  return `Meeting brief - ${today.toISOString().slice(0, 10)}`
}

export function briefToMarkdown(brief: Brief, registry: LedgerRegistry | null, today: Date = new Date()): string {
  const people = registry?.people ?? {}
  const show = (objectId: string, attribute: string, value: Parameters<typeof formatValue>[0]) =>
    formatValue(value, findAttribute(registry, objectId, attribute), people)
  const lines = [`# ${briefTitle(today)}`, '', '## Open commitments', '']
  if (brief.open_commitments.length === 0) lines.push('_No open commitments._')
  for (const c of brief.open_commitments) {
    const who = c.owner ? show(c.object_id, 'owner', c.owner) : 'nobody named yet'
    const due = c.deadline ? show(c.object_id, 'deadline', c.deadline) : 'no due date'
    lines.push(`- **${c.label}**: ${who}, due ${due}`)
  }
  lines.push('', '## What changed recently', '')
  if (brief.recent_changes.length === 0) lines.push('_Nothing has changed yet._')
  for (const c of brief.recent_changes) {
    const object = registry?.objects.find((o) => o.label === c.label)
    const spec = (value: Parameters<typeof formatValue>[0]) => formatValue(value, object?.attributes.find((a) => a.name === c.attribute), people)
    const when = formatDate(c.decided_at)
    lines.push(`- **${c.label}** (${attributeLabel(c.attribute).toLowerCase()}): ${spec(c.from)} -> ${spec(c.to)}${when ? ` on ${when}` : ''}`)
    if (c.quote) lines.push(`  > "${c.quote}"`)
  }
  if (brief.waiting_for_review > 0) {
    lines.push('', `_${brief.waiting_for_review} suggested change${brief.waiting_for_review === 1 ? ' is' : 's are'} still waiting for your review._`)
  }
  return `${lines.join('\n')}\n`
}

/** Saved briefs get the Brief type so they show up under Briefs in the sidebar. */
export function briefToNoteMarkdown(markdown: string): string {
  return `---\ntype: Brief\n---\n\n${markdown}`
}
