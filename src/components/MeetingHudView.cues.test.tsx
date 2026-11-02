import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MeetingHudView, type HudViewProps } from './MeetingHudView'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ startDragging: vi.fn() }) }))

const cue = {
  factId: 5, label: 'Vendor', attribute: 'outcome', currentValue: 'Beta Cloud',
  quote: 'We drop Alpha Systems and move to Beta Cloud. This is final.', speaker: 'Aisha',
  meeting: '40748792-9187-5f8a-9542-eb8aa480f4c7', at: 39.84, reason: 'The statement names another vendor.',
}

function view(props: Partial<HudViewProps> = {}) {
  const base: HudViewProps = {
    state: 'recording', saveStage: '', seconds: 125, levels: [], prep: 0, captionsOpen: false, liveTurns: [], caption: '',
    captionError: '', marks: [], markNotice: '', error: '', onToggleCaptions: vi.fn(), onOpenWorkspace: vi.fn(),
    onPause: vi.fn(), onEnd: vi.fn(), onMark: vi.fn(),
  }
  return render(<MeetingHudView {...base} {...props} />)
}

it('shows an earlier decision with its value, quote, speaker, meeting title and time', () => {
  view({ captionsOpen: true, liveCues: [cue], cueMeetingTitles: new Map([[cue.meeting, 'Procurement pilot progress check']]) })
  const card = within(screen.getByRole('region', { name: 'Earlier decisions to check' }))
  expect(card.getByText('Earlier decision')).toBeInTheDocument()
  expect(card.getByText('Beta Cloud')).toBeInTheDocument()
  expect(card.getByText(/^Vendor is/)).toBeInTheDocument()
  expect(card.getByText(`“${cue.quote}”`)).toBeInTheDocument()
  expect(card.getByText('Aisha · Procurement pilot progress check · 00:39')).toBeInTheDocument()
  expect(card.queryByText(cue.meeting)).not.toBeInTheDocument()
})

it('writes an amount in the unit of its label and names a non-generic attribute', () => {
  view({ captionsOpen: true, liveCues: [{ ...cue, label: 'Pilot budget (RM)', attribute: 'amount', currentValue: 280000 }, { ...cue, factId: 9, label: 'Staff training', attribute: 'owner', currentValue: 'Raj' }] })
  expect(screen.getByText('RM 280,000')).toBeInTheDocument()
  expect(screen.getByText(/^Pilot budget is/)).toBeInTheDocument()
  expect(screen.getByText(/^Staff training owner is/)).toBeInTheDocument()
})

it('shows a badge on the compact notch that opens the cue', () => {
  const onToggleCaptions = vi.fn()
  view({ liveCues: [cue], onToggleCaptions })
  fireEvent.click(screen.getByRole('button', { name: '1 earlier decision to check' }))
  expect(onToggleCaptions).toHaveBeenCalledWith(true)
})

it('shows no badge without a cue', () => {
  view()
  expect(screen.queryByRole('button', { name: /earlier decision/ })).not.toBeInTheDocument()
})
