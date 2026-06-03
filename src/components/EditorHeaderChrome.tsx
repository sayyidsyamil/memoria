import type { CSSProperties, ReactNode, Ref } from 'react'
import { cn } from '@/lib/utils'
import { ActionTooltip, type ActionTooltipCopy } from '@/components/ui/action-tooltip'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

export const EDITOR_HEADER_ICON_CLASS = 'size-[16px]'
type DragAwareStyle = CSSProperties & { WebkitAppRegion?: string }

export function EditorHeaderRoot({
  actions,
  rootRef,
  title,
  titleRef,
}: {
  actions: ReactNode
  rootRef?: Ref<HTMLDivElement>
  title: ReactNode
  titleRef?: Ref<HTMLDivElement>
}) {
  return (
    <TooltipProvider>
      <div
        ref={rootRef}
        data-tauri-drag-region
        data-title-hidden=""
        className="breadcrumb-bar flex shrink-0 items-center border-b border-transparent"
        style={{
          height: 52,
          background: 'var(--background)',
          padding: '6px 16px 6px var(--breadcrumb-bar-left-padding, 16px)',
          boxSizing: 'border-box',
        }}
      >
        <div ref={titleRef} className="breadcrumb-bar__title min-w-0 flex-1 overflow-hidden">
          {title}
        </div>
        <div
          aria-hidden="true"
          data-tauri-drag-region
          className="breadcrumb-bar__drag-spacer w-6 shrink-0"
        />
        {actions}
      </div>
    </TooltipProvider>
  )
}

export function EditorHeaderActions({
  actionsRef,
  children,
  overflowCollapsed,
  style,
}: {
  actionsRef?: Ref<HTMLDivElement>
  children: ReactNode
  overflowCollapsed?: boolean
  style?: CSSProperties
}) {
  const actionStyle: DragAwareStyle = { gap: 8, WebkitAppRegion: 'no-drag', ...style }

  return (
    <div
      ref={actionsRef}
      className="breadcrumb-bar__actions ml-auto flex shrink-0 items-center"
      data-overflow-collapsed={overflowCollapsed}
      style={actionStyle}
    >
      {children}
    </div>
  )
}

export function EditorHeaderActionButton({
  children,
  className,
  copy,
  onClick,
  style,
  testId,
  tooltipAlign = 'end',
}: {
  children: ReactNode
  className?: string
  copy: ActionTooltipCopy
  onClick?: () => void
  style?: CSSProperties
  testId?: string
  tooltipAlign?: 'start' | 'center' | 'end'
}) {
  return (
    <ActionTooltip copy={copy} side="bottom" align={tooltipAlign}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn('text-muted-foreground [&_svg:not([class*=size-])]:size-4', className)}
        style={style}
        onClick={onClick}
        aria-label={copy.label}
        aria-disabled={onClick ? undefined : true}
        data-testid={testId}
      >
        {children}
      </Button>
    </ActionTooltip>
  )
}
