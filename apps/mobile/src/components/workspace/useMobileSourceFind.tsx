import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import { useMobileAnalytics } from '../../analytics/useMobileAnalytics'
import { mobileEditorFindSnapshot, nextMobileEditorFindIndex, replaceAllMobileEditorFindMatches, replaceCurrentMobileEditorFindMatch, type MobileEditorFindOptions } from '../../workspace/mobileEditorFind'
import { useRegisteredMobileEditorCommands, type RegisterMobileEditorCommands } from '../../workspace/mobileEditorCommands'
import { MobileEditorFindBar } from './MobileEditorFindBar'
import type { MobileFindRequest } from './MobileWysiwygFindBridge'

export function useMobileSourceFind({ content, register, onUpdate, input }: {
  content: string
  register?: RegisterMobileEditorCommands
  onUpdate: (content: string) => void
  input: RefObject<TextInput | null>
}) {
  const analytics = useMobileAnalytics()
  const [session, setSession] = useState<{ replace: boolean; id: number } | null>(null)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState({ caseSensitive: false, regex: false })
  const [activeIndex, setActiveIndex] = useState(0)
  const snapshot = useMemo(() => mobileEditorFindSnapshot(content, query, options, activeIndex), [content, query, options, activeIndex])
  const active = snapshot.activeMatch
  useSourceFindSelection(input, active)
  const open = (replace: boolean) => {
    setQuery('')
    setSession((current) => ({ replace, id: (current?.id ?? 0) + 1 }))
    analytics.capture({ name: 'mobile_editor_tool_opened', tool: replace ? 'replace' : 'find' })
  }
  useRegisteredMobileEditorCommands(register, {
    blur: () => input.current?.blur(),
    findInNote: () => open(false),
    replaceInNote: () => open(true),
  })
  const close = () => { setSession(null); setQuery(''); input.current?.focus() }
  const update = (request: MobileFindRequest) => {
    if (request.kind === 'query') { setQuery(request.query); setOptions(request.options); setActiveIndex(0) }
    if (request.kind === 'move') setActiveIndex(nextMobileEditorFindIndex(activeIndex, snapshot.matchCount, request.direction))
    if (request.kind === 'replace') {
      replaceSourceMatches({ request, activeIndex, content, options, query, onUpdate })
    }
  }
  const bar = session === null ? null : <MobileEditorFindBar key={session.id} snapshot={snapshot} replace={session.replace} onRequest={update} onClose={close} />
  return { bar, active }
}

function useSourceFindSelection(input: RefObject<TextInput | null>, active: { from: number; to: number } | null) {
  useEffect(() => {
    const target = input.current
    if (!active || !target) return
    if ('setSelectionRange' in target && typeof target.setSelectionRange === 'function') {
      target.setSelectionRange(active.from, active.to)
    } else target.setSelection(active.from, active.to)
  }, [active, input])
}

function replaceSourceMatches({ request, onUpdate, ...context }: {
  request: Extract<MobileFindRequest, { kind: 'replace' }>
  content: string
  query: string
  options: MobileEditorFindOptions
  activeIndex: number
  onUpdate: (content: string) => void
}) {
  const replaceMatch = request.all ? replaceAllMobileEditorFindMatches : replaceCurrentMobileEditorFindMatch
  const next = replaceMatch({ ...context, replacement: request.replacement })
  if (next !== null) onUpdate(next)
}
