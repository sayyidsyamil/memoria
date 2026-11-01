import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../hooks/appCommandDispatcher'
import { TOUCH_INPUT_QUERY } from '../lib/touchInput'
import { stubMediaQueries } from '../test-utils/mediaQueries'
import { render, renderEditor, resetEditorTestState } from './Editor.helpers.test'
import { TouchEmptyState } from './TouchEmptyState'

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }))
vi.mock('../lib/telemetry', () => ({ trackEvent }))

function recordCommands(): string[] {
  const commands: string[] = []
  window.addEventListener(APP_COMMAND_EVENT_NAME, (event) => {
    commands.push((event as CustomEvent<string>).detail)
  })
  return commands
}

describe('TouchEmptyState', () => {
  it('offers search and a new note as buttons', () => {
    const commands = recordCommands()
    render(<TouchEmptyState locale="en" />)
    expect(screen.getByText('Tap a note to start editing')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Search notes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create new note' }))

    expect(commands).toEqual([APP_COMMAND_IDS.fileQuickOpen, APP_COMMAND_IDS.fileNewNote])
    expect(trackEvent).toHaveBeenCalledWith('web_touch_empty_state_action', { action: 'search' })
    expect(trackEvent).toHaveBeenCalledWith('web_touch_empty_state_action', { action: 'new_note' })
  })
})

describe('the editor empty state', () => {
  beforeEach(() => {
    resetEditorTestState()
    stubMediaQueries({ [TOUCH_INPUT_QUERY]: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('is touch-first when a finger drives the web build', () => {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', 'true')
    renderEditor()
    expect(screen.getByTestId('touch-empty-state')).toBeInTheDocument()
    expect(screen.queryByText('Select a note to start editing')).not.toBeInTheDocument()
  })

  it('keeps the keyboard hints on the desktop app, touch screen or not', () => {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', '')
    renderEditor()
    expect(screen.queryByTestId('touch-empty-state')).not.toBeInTheDocument()
    expect(screen.getByText('Select a note to start editing')).toBeInTheDocument()
  })
})
