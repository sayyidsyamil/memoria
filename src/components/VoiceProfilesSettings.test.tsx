import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceProfilesSettings } from './VoiceProfilesSettings'

const invokeMock = vi.fn()
let failWith: Error | null = null
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => {
    if (failWith) return Promise.reject(failWith)
    return Promise.resolve(invokeMock(...args))
  },
}))
vi.mock('../mock-tauri', () => ({ isTauri: () => true, mockInvoke: vi.fn() }))

function renderSettings(rememberVoices = false) {
  const setRememberVoices = vi.fn()
  render(<VoiceProfilesSettings rememberVoices={rememberVoices} setRememberVoices={setRememberVoices} />)
  return { setRememberVoices }
}

describe('VoiceProfilesSettings', () => {
  beforeEach(() => { invokeMock.mockReset(); failWith = null })

  it('shows the opt-in switch unchecked by default and reports changes', () => {
    const { setRememberVoices } = renderSettings(false)
    const box = screen.getByRole('checkbox', { name: /Remember voices to recognise people/ })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(setRememberVoices).toHaveBeenCalledWith(true)
  })

  it('asks for confirmation before deleting and does nothing if cancelled', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all saved voice profiles' }))
    expect(screen.getByText('Delete all saved voice profiles?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('deletes after confirmation and says so', async () => {
    invokeMock.mockResolvedValue(2)
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all saved voice profiles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete profiles' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('delete_voice_profiles'))
    expect(await screen.findByText('All saved voice profiles were deleted.')).toBeInTheDocument()
  })

  it('says plainly when there was nothing to delete', async () => {
    invokeMock.mockResolvedValue(0)
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all saved voice profiles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete profiles' }))
    expect(await screen.findByText('There were no saved voice profiles to delete.')).toBeInTheDocument()
  })

  it('shows the error when deletion fails', async () => {
    failWith = new Error('Could not delete saved voice profiles: denied')
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all saved voice profiles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete profiles' }))
    expect(await screen.findByText(/Could not delete saved voice profiles: denied/)).toBeInTheDocument()
  })
})
