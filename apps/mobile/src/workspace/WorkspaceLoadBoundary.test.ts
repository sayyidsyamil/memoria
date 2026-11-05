// @vitest-environment jsdom
import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceLoadBoundary } from './WorkspaceLoadBoundary'

describe('workspace load recovery', () => {
  it('retains a healthy workspace when its recovery key changes', () => {
    const root = createRoot(document.createElement('div'))
    const mounted = vi.fn()
    function Workspace() { useEffect(mounted, []); return 'Workspace' }
    try {
      for (const resetKey of [0, 1]) flushSync(() => root.render(createElement(WorkspaceLoadBoundary, {
        resetKey, fallback: 'Recovery', children: createElement(Workspace),
      })))
      expect(mounted).toHaveBeenCalledOnce()
    } finally { root.unmount() }
  })

  it('clears a rendering failure on a fresh key without changing boundary identity', () => {
    const host = document.createElement('div')
    const root = createRoot(host, { onCaughtError: vi.fn() })
    function Broken(): never { throw new Error('broken') }
    try {
      flushSync(() => root.render(createElement(WorkspaceLoadBoundary, {
        resetKey: 0, fallback: 'Recovery', children: createElement(Broken),
      })))
      expect(host.textContent).toBe('Recovery')
      flushSync(() => root.render(createElement(WorkspaceLoadBoundary, {
        resetKey: 1, fallback: 'Recovery', children: 'Fresh workspace',
      })))
      expect(host.textContent).toBe('Fresh workspace')
    } finally { root.unmount() }
  })

  it('replaces a failed workspace with recovery controls and resets for the next vault', () => {
    const container = document.createElement('div')
    const onCaughtError = vi.fn()
    const root = createRoot(container, { onCaughtError })
    const fallback = createElement('button', { type: 'button' }, 'Manage vaults')
    function BrokenWorkspace(): never { throw new Error('unreadable vault') }
    try {
      flushSync(() => root.render(createElement(WorkspaceLoadBoundary, {
        key: 'first', fallback, children: createElement(BrokenWorkspace),
      })))
      expect(container.textContent).toBe('Manage vaults')
      expect(onCaughtError).toHaveBeenCalledOnce()
      flushSync(() => root.render(createElement(WorkspaceLoadBoundary, {
        key: 'second', fallback, children: 'Restored note',
      })))
      expect(container.textContent).toBe('Restored note')
    } finally { root.unmount() }
  })
})
