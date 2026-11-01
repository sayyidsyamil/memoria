import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OfflineBadge } from './StatusBarBadges'

type RemoteWindow = Window & { MEMORIA_REMOTE_URL?: string; MEMORIA_REMOTE_TOKEN?: string }

afterEach(() => {
  const remote = window as RemoteWindow
  delete remote.MEMORIA_REMOTE_URL
  delete remote.MEMORIA_REMOTE_TOKEN
})

describe('OfflineBadge', () => {
  it('renders nothing online', () => {
    const { container } = render(<OfflineBadge isOffline={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the desktop wording', () => {
    render(<OfflineBadge isOffline />)
    const badge = screen.getByTestId('status-offline')
    expect(badge).toHaveTextContent('Offline')
    expect(badge).not.toHaveTextContent('read-only')
    expect(badge).toHaveAttribute('title', 'No internet connection')
  })

  it('says the vault is read-only on the web (TOL-198)', () => {
    const remote = window as RemoteWindow
    remote.MEMORIA_REMOTE_URL = 'https://server.test'
    remote.MEMORIA_REMOTE_TOKEN = 'token'
    render(<OfflineBadge isOffline />)
    const badge = screen.getByTestId('status-offline')
    expect(badge).toHaveTextContent('Offline · read-only')
    expect(badge).toHaveAttribute('data-read-only', 'true')
    expect(badge.getAttribute('title')).toContain('read-only until you reconnect')
  })

  it('shows only the dot when compact', () => {
    render(<OfflineBadge isOffline compact readOnly />)
    expect(screen.getByTestId('status-offline')).not.toHaveTextContent('read-only')
  })
})
