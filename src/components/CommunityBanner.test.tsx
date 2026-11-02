import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'

it('keeps the floating launcher clear of the update banner without a community promotion', () => {
  const appShell = document.createElement('div')
  appShell.className = 'app-shell'
  document.body.appendChild(appShell)
  const actions = { checkForUpdates: vi.fn(), startDownload: vi.fn(), openReleaseNotes: vi.fn(), dismiss: vi.fn() }
  try {
    const view = render(<UpdateBanner status={{ state: 'checking' }} actions={actions} />)
    expect(appShell.style.getPropertyValue('--ai-workspace-floating-button-bottom')).toBe('80px')
    view.rerender(<UpdateBanner status={{ state: 'idle' }} actions={actions} />)
    expect(appShell.style.getPropertyValue('--ai-workspace-floating-button-bottom')).toBe('2.75rem')
  } finally {
    appShell.remove()
  }
})
