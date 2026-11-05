import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { Check, Question, SpinnerGap } from '@phosphor-icons/react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'
import { initials } from '../lib/format'
import './memoriaUi.css'

// Small shared primitives for the meeting-memory surfaces. Interaction patterns
// (sliding pill tabs, stateful save button, step rail, level meter) are original
// implementations inspired by public design references; see docs/UI-PATTERNS.md.

export type Tone = 'neutral' | 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal' | 'pink'

export function SectionLabel({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('mui-label', className)} {...props} />
}

export function Chip({ tone = 'neutral', dot = false, className, ...props }: ComponentProps<'span'> & { tone?: Tone; dot?: boolean }) {
  return <span className={cn('mui-chip', className)} data-tone={tone} data-dot={dot || undefined} {...props} />
}

export interface PillTab { value: string; label: string; count?: number; disabled?: boolean; attention?: boolean }

export function PillTabsRoot({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('mui-tabs-root', className)} {...props} />
}

export function PillTabPanel({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mui-tab-panel', className)} {...props} />
}

/** Segmented control whose active pill slides to the selected tab. */
export function PillTabList({ tabs, value, label, className, onSelect }: {
  tabs: PillTab[]; value: string; label: string; className?: string
  /** Radix selects on mouse-down/focus; click (assistive "press", keyboard Enter) must select too. */
  onSelect?: (value: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const [mark, setMark] = useState({ x: 0, width: 0 })
  const [ready, setReady] = useState(false)
  const signature = tabs.map(tab => `${tab.value}:${tab.label}:${tab.count ?? ''}`).join('|')
  useLayoutEffect(() => {
    const node = list.current
    if (!node) return
    const measure = () => {
      const active = node.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      if (active) setMark(previous => previous.x === active.offsetLeft && previous.width === active.offsetWidth ? previous : { x: active.offsetLeft, width: active.offsetWidth })
      // In a narrow container the strip scrolls; keep the selected tab in view without moving anything else.
      if (active && node.clientWidth > 0) {
        const left = active.offsetLeft, right = left + active.offsetWidth
        if (left < node.scrollLeft) node.scrollLeft = Math.max(0, left - 6)
        else if (right > node.scrollLeft + node.clientWidth) node.scrollLeft = right - node.clientWidth + 6
      }
    }
    measure()
    // Enable the slide only after the first measurement so the pill does not fly in.
    const frame = requestAnimationFrame(() => setReady(true))
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    return () => { cancelAnimationFrame(frame); observer?.disconnect() }
  }, [value, signature])
  return <TabsPrimitive.List ref={list} aria-label={label} className={cn('mui-tabs', className)}>
    <span aria-hidden="true" className="mui-tabs-indicator" data-ready={ready || undefined} style={{ transform: `translateX(${mark.x}px)`, width: mark.width }} />
    {tabs.map(tab => <TabsPrimitive.Trigger key={tab.value} value={tab.value} disabled={tab.disabled} className="mui-tab" onClick={() => { if (!tab.disabled) onSelect?.(tab.value) }}>
      {tab.label}
      {tab.count !== undefined && <span className="mui-tab-count">{tab.count}</span>}
      {tab.attention && <span className="mui-tab-attention" aria-label="needs attention" />}
    </TabsPrimitive.Trigger>)}
  </TabsPrimitive.List>
}

export type RailState = 'done' | 'current' | 'todo'

/** Horizontal progress rail; reflects real saved state, never decorative. */
export function LifecycleRail({ steps, label }: { steps: { label: string; state: RailState }[]; label: string }) {
  return <ol className="mui-rail" aria-label={label}>
    {steps.map(step => <li key={step.label} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
      <span className="mui-rail-mark" aria-hidden="true">{step.state === 'done' && <Check size={9} weight="bold" />}</span>
      {step.label}
      <span className="sr-only">{step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (next)' : ' (not started)'}</span>
    </li>)}
  </ol>
}

/** Button that reports idle → working → done in place. */
export function StateButton({ status, labels, className, disabled, ...props }: Omit<ComponentProps<typeof Button>, 'children'> & {
  status: 'idle' | 'working' | 'done'; labels: { idle: ReactNode; working: ReactNode; done: ReactNode }
}) {
  return <Button {...props} className={cn('mui-state-button', className)} data-status={status} disabled={disabled || status === 'working'}>
    {status === 'working' && <SpinnerGap className="mui-spin" size={15} aria-hidden="true" />}
    {status === 'done' && <Check size={15} weight="bold" aria-hidden="true" />}
    {labels[status]}
  </Button>
}

export function EmptyState({ icon, title, children, action, className }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={cn('mui-empty', className)}>
    <span className="mui-empty-icon" aria-hidden="true">{icon}</span>
    <h3>{title}</h3>
    {children && <p>{children}</p>}
    {action}
  </div>
}

/** Scrolling history of real microphone levels (0–1), newest on the right. */
export function LevelMeter({ levels, paused = false, className }: { levels: number[]; paused?: boolean; className?: string }) {
  return <div className={cn('mui-meter', className)} data-paused={paused || undefined} aria-hidden="true">
    {levels.map((level, index) => <span key={index} style={{ height: `${Math.round(14 + Math.min(1, Math.max(0, level)) * 86)}%` }} />)}
  </div>
}

/** Initials avatar tinted with the speaker's tone; unknown voices show a question mark. */
export function Avatar({ label, tone = 'neutral', size = 32, className }: { label: string; tone?: Tone; size?: number; className?: string }) {
  const unknown = /^unknown/i.test(label)
  return <span className={cn('mui-avatar', className)} data-tone={tone} data-unknown={unknown || undefined} aria-hidden="true"
    style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * .4)) }}>{unknown ? <Question size={Math.round(size * .5)} weight="bold" /> : initials(label)}</span>
}
