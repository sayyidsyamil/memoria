type DismissalKeyEvent = {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
  preventDefault?: () => void
  stopImmediatePropagation?: () => void
}

type ModalEntry = { close: () => void }

export function createMobileModalDismissal(onActiveChange: (active: boolean) => void) {
  const entries: ModalEntry[] = []
  const handled = new WeakSet<DismissalKeyEvent>()
  return {
    register: (close: () => void) => registerModal(entries, close, onActiveChange),
    dismiss: (event: DismissalKeyEvent) => dismissModal(entries, handled, event),
  }
}

function registerModal(entries: ModalEntry[], close: () => void, onActiveChange: (active: boolean) => void) {
  const entry = { close }
  entries.push(entry)
  if (entries.length === 1) onActiveChange(true)
  return () => {
    const index = entries.indexOf(entry)
    if (index < 0) return
    entries.splice(index, 1)
    if (entries.length === 0) onActiveChange(false)
  }
}

function dismissModal(entries: ModalEntry[], handled: WeakSet<DismissalKeyEvent>, event: DismissalKeyEvent) {
  if (handled.has(event)) return true
  const top = entries.at(-1)
  if (!top || !isDismissalKey(event)) return false
  handled.add(event)
  event.preventDefault?.()
  event.stopImmediatePropagation?.()
  top.close()
  return true
}

function isDismissalKey(event: DismissalKeyEvent) {
  return event.key === 'Escape' && !event.repeat &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
}
