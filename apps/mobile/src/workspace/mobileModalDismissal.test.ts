import { expect, it, vi } from 'vitest'
import { createMobileModalDismissal } from './mobileModalDismissal'

it('dismisses only the most recently opened modal and restores its parent after cleanup', () => {
  const active = vi.fn()
  const modals = createMobileModalDismissal(active)
  const parent = vi.fn()
  const child = vi.fn()
  const removeParent = modals.register(parent)
  const removeChild = modals.register(child)
  expect(active.mock.calls).toEqual([[true]])
  expect(modals.dismiss({ key: 'Escape' })).toBe(true)
  expect(child).toHaveBeenCalledOnce()
  expect(parent).not.toHaveBeenCalled()
  removeChild()
  expect(active.mock.calls).toEqual([[true]])
  modals.dismiss({ key: 'Escape' })
  expect(parent).toHaveBeenCalledOnce()
  removeParent()
  expect(active.mock.calls).toEqual([[true], [false]])
  expect(modals.dismiss({ key: 'Escape' })).toBe(false)
})

it('handles a bubbling event once even if closing immediately unregisters the modal', () => {
  const modals = createMobileModalDismissal(vi.fn())
  const parent = vi.fn()
  modals.register(parent)
  const remove = modals.register(() => remove())
  const event = { key: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
  modals.dismiss(event)
  modals.dismiss(event)
  expect(parent).not.toHaveBeenCalled()
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
})

it.each([
  { key: 'Enter' }, { key: 'ArrowDown' }, { key: 'k', metaKey: true },
  { key: 'Escape', ctrlKey: true }, { key: 'Escape', metaKey: true },
  { key: 'Escape', altKey: true }, { key: 'Escape', shiftKey: true },
  { key: 'Escape', repeat: true },
])('leaves non-dismissal shortcuts and repeats alone: %j', event => {
  const modals = createMobileModalDismissal(vi.fn())
  const close = vi.fn()
  modals.register(close)
  expect(modals.dismiss(event)).toBe(false)
  expect(close).not.toHaveBeenCalled()
})

it('keeps a busy top modal in control when its close callback declines dismissal', () => {
  const modals = createMobileModalDismissal(vi.fn())
  const underlying = vi.fn()
  modals.register(underlying)
  const busy = vi.fn()
  modals.register(busy)
  modals.dismiss({ key: 'Escape' })
  modals.dismiss({ key: 'Escape' })
  expect(busy).toHaveBeenCalledTimes(2)
  expect(underlying).not.toHaveBeenCalled()
})

it('supports out-of-order unmounts and idempotent cleanup without disabling a newer modal', () => {
  const active = vi.fn()
  const modals = createMobileModalDismissal(active)
  const removeOld = modals.register(vi.fn())
  const latest = vi.fn()
  const removeNew = modals.register(latest)
  removeOld()
  removeOld()
  modals.dismiss({ key: 'Escape' })
  expect(latest).toHaveBeenCalledOnce()
  expect(active.mock.calls).toEqual([[true]])
  removeNew()
  removeNew()
  expect(active.mock.calls).toEqual([[true], [false]])
})
