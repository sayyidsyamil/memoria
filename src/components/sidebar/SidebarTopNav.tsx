import { useState } from 'react'
import { Archive, Books, CaretDown, CaretRight, Files, NewspaperClipping, Tray } from '@phosphor-icons/react'
import type { SidebarSelection } from '../../types'
import { isSelectionActive, NavItem, SidebarCountPill, type SectionGroup } from '../SidebarParts'
import { translate, type AppLocale } from '../../lib/i18n'
import { getTypeColor } from '../../utils/typeColors'

type WikiTypeSection = SectionGroup & { count: number }

interface SidebarTopNavProps {
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  showInbox: boolean
  inboxCount: number
  wikiCount: number
  sourcesCount: number
  briefsCount: number
  archivedCount: number
  wikiTypeSections: WikiTypeSection[]
  locale?: AppLocale
  loading?: boolean
}

function WikiTypeItem({
  section,
  active,
  onSelect,
}: {
  section: WikiTypeSection
  active: boolean
  onSelect: () => void
}) {
  const { Icon } = section
  const color = getTypeColor(section.type, section.customColor)

  return (
    <button
      type="button"
      className={[
        'flex h-auto w-full cursor-pointer select-none items-center justify-start rounded text-left transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      ].join(' ')}
      style={{ padding: '5px 8px 5px 28px', borderRadius: 4, gap: 7 }}
      onClick={onSelect}
    >
      <Icon size={14} weight={active ? 'fill' : 'regular'} style={{ color, flexShrink: 0 }} />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{section.label}</span>
      <SidebarCountPill
        count={section.count}
        compact
        className={active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}
        style={active ? undefined : { background: 'var(--muted)' }}
      />
    </button>
  )
}

function WikiNavGroup({
  selection,
  onSelect,
  wikiCount,
  wikiTypeSections,
  loading,
  locale,
}: Pick<SidebarTopNavProps, 'selection' | 'onSelect' | 'wikiCount' | 'wikiTypeSections' | 'loading' | 'locale'> & {
  locale: AppLocale
}) {
  const [expanded, setExpanded] = useState(true)
  const active = isSelectionActive(selection, { kind: 'filter', filter: 'wiki' })
  const hasTypes = wikiTypeSections.length > 0

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex h-7 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? 'Collapse Wiki types' : 'Expand Wiki types'}
          disabled={!hasTypes}
          style={{ opacity: hasTypes ? 1 : 0.35 }}
        >
          {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
        </button>
        <div className="min-w-0 flex-1">
          <NavItem
            icon={Books}
            label={translate(locale, 'sidebar.nav.wiki')}
            count={wikiCount}
            countLoading={loading}
            isActive={active}
            badgeClassName="text-muted-foreground"
            badgeStyle={{ background: 'var(--muted)' }}
            activeBadgeClassName="bg-primary text-primary-foreground"
            onClick={() => onSelect({ kind: 'filter', filter: 'wiki' })}
          />
        </div>
      </div>
      {expanded && hasTypes && (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {wikiTypeSections.map((section) => (
            <WikiTypeItem
              key={section.type}
              section={section}
              active={isSelectionActive(selection, { kind: 'sectionGroup', type: section.type })}
              onSelect={() => onSelect({ kind: 'sectionGroup', type: section.type })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SidebarTopNav({
  selection,
  onSelect,
  showInbox,
  inboxCount,
  wikiCount,
  sourcesCount,
  briefsCount,
  archivedCount,
  wikiTypeSections,
  locale = 'en',
  loading = false,
}: SidebarTopNavProps) {
  return (
    <div className="border-b border-border" data-testid="sidebar-top-nav" style={{ padding: '4px 6px' }}>
      {showInbox && (
        <NavItem
          icon={Tray}
          label={translate(locale, 'sidebar.nav.inbox')}
          count={inboxCount}
          countLoading={loading}
          isActive={isSelectionActive(selection, { kind: 'filter', filter: 'inbox' })}
          badgeClassName="text-muted-foreground"
          badgeStyle={{ background: 'var(--muted)' }}
          activeBadgeClassName="bg-primary text-primary-foreground"
          onClick={() => onSelect({ kind: 'filter', filter: 'inbox' })}
        />
      )}
      <WikiNavGroup
        selection={selection}
        onSelect={onSelect}
        wikiCount={wikiCount}
        wikiTypeSections={wikiTypeSections}
        loading={loading}
        locale={locale}
      />
      <NavItem
        icon={Files}
        label={translate(locale, 'sidebar.nav.sources')}
        count={sourcesCount}
        countLoading={loading}
        isActive={isSelectionActive(selection, { kind: 'filter', filter: 'sources' })}
        badgeClassName="text-muted-foreground"
        badgeStyle={{ background: 'var(--muted)' }}
        activeBadgeClassName="bg-primary text-primary-foreground"
        onClick={() => onSelect({ kind: 'filter', filter: 'sources' })}
      />
      <NavItem
        icon={NewspaperClipping}
        label={translate(locale, 'sidebar.nav.briefs')}
        count={briefsCount}
        countLoading={loading}
        isActive={isSelectionActive(selection, { kind: 'filter', filter: 'briefs' })}
        badgeClassName="text-muted-foreground"
        badgeStyle={{ background: 'var(--muted)' }}
        activeBadgeClassName="bg-primary text-primary-foreground"
        onClick={() => onSelect({ kind: 'filter', filter: 'briefs' })}
      />
      <NavItem
        icon={Archive}
        label={translate(locale, 'sidebar.nav.archive')}
        count={archivedCount}
        countLoading={loading}
        isActive={isSelectionActive(selection, { kind: 'filter', filter: 'archived' })}
        badgeClassName="text-muted-foreground"
        badgeStyle={{ background: 'var(--muted)' }}
        activeBadgeClassName="bg-primary text-primary-foreground"
        onClick={() => onSelect({ kind: 'filter', filter: 'archived' })}
      />
    </div>
  )
}
