import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishPhoneNoteStack } from '../../hooks/phoneNoteStackStore'
import { PhoneNoteBackBar } from './PhoneNoteBackBar'

describe('PhoneNoteBackBar', () => {
  afterEach(() => { publishPhoneNoteStack(null) })

  it('goes back to the note list on the phone layout', () => {
    const backToList = vi.fn()
    act(() => { publishPhoneNoteStack({ active: true, backToList, showNote: vi.fn() }) })
    render(<PhoneNoteBackBar locale="en" />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to notes' }))

    expect(backToList).toHaveBeenCalled()
    expect(screen.getByText('Notes')).toBeTruthy()
  })

  it('renders nothing off the phone layout, and appears when the phone layout starts', () => {
    const { container } = render(<PhoneNoteBackBar locale="en" />)
    expect(container.childElementCount).toBe(0)

    act(() => { publishPhoneNoteStack({ active: true, backToList: vi.fn(), showNote: vi.fn() }) })

    expect(screen.getByRole('button', { name: 'Back to notes' })).toBeTruthy()
  })
})
