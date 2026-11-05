import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MeetingHudView, type HudViewProps } from './MeetingHudView'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ startDragging: vi.fn() }) }))

const base: HudViewProps = {
  state: 'recording', saveStage: '', seconds: 125, levels: [], prep: 0, captionsOpen: true, liveTurns: [], caption: '',
  captionError: '', marks: [], markNotice: '', error: '', onToggleCaptions: vi.fn(), onOpenWorkspace: vi.fn(),
  onPause: vi.fn(), onEnd: vi.fn(), onMark: vi.fn(),
}

function view(props: Partial<HudViewProps> = {}) {
  const result = render(<MeetingHudView {...base} {...props} />)
  return { ...result, update: (next: Partial<HudViewProps>) => result.rerender(<MeetingHudView {...base} {...props} {...next} />) }
}

it('shows the words being spoken after the last caption, without an avatar, until they are cleared', () => {
  const turns = [{ speaker: 'S01', start: 0, end: 2, text: 'First point.' }]
  const { update } = view({ liveTurns: turns, partial: ' and the second ' })
  const transcript = screen.getByLabelText('Live transcript')
  const partial = transcript.querySelector('.meeting-hud-partial')
  expect(partial).toHaveTextContent(/^and the second$/)
  expect(transcript.lastElementChild).toBe(partial)
  expect(partial?.querySelector('.mui-avatar')).toBeNull()
  // Announced once committed, not at every word.
  expect(partial).toHaveAttribute('aria-hidden', 'true')
  update({ partial: '' })
  expect(transcript.querySelector('.meeting-hud-partial')).toBeNull()
  expect(transcript.querySelectorAll('.meeting-hud-live-turn')).toHaveLength(1)
})

it('shows the words being spoken in place of the listening placeholder before the first caption', () => {
  const { update } = view({ partial: 'Good morning' })
  expect(screen.queryByText('Listening for speech…')).not.toBeInTheDocument()
  expect(screen.getByText('Good morning')).toHaveClass('meeting-hud-partial')
  update({ partial: '' })
  expect(screen.getByText('Listening for speech…')).toBeInTheDocument()
})

it('groups consecutive turns of one speaker under one avatar and keeps each turn with its own markers', () => {
  const turns = [
    { speaker: 'S01', start: 0, end: 2, text: 'First point.' },
    { speaker: 'S01', start: 3, end: 5, text: 'Gamma Solutions is our vendor now.' },
    { speaker: 'S02', start: 6, end: 8, text: 'I thought it was Beta Cloud.' },
    { speaker: 'S01', start: 9, end: 11, text: 'Let me check.' },
  ]
  const cue = { factId: 5, label: 'Vendor', attribute: 'outcome', currentValue: 'Beta Cloud', quote: 'We move to Beta Cloud.', reason: 'Another vendor.', heardAt: 3 }
  view({ liveTurns: turns, liveCues: [cue], partial: 'and then' })
  const runs = document.querySelectorAll('.meeting-hud-live-run')
  expect(runs).toHaveLength(3)
  runs.forEach(run => expect(run.querySelectorAll('.mui-avatar')).toHaveLength(1))
  const paragraphs = [...document.querySelectorAll('.meeting-hud-live-turn')]
  expect(paragraphs.map(turn => turn.textContent)).toEqual(['Speaker 1: First point.', 'Speaker 1: Gamma Solutions is our vendor now.', 'Speaker 2: I thought it was Beta Cloud.', 'Speaker 1: Let me check.'])
  expect([...runs[0].querySelectorAll('.meeting-hud-live-turn')]).toEqual(paragraphs.slice(0, 2))
  expect(paragraphs.filter(turn => turn.hasAttribute('data-flagged'))).toEqual([paragraphs[1]])
  expect(paragraphs.filter(turn => turn.hasAttribute('data-latest'))).toEqual([paragraphs[3]])
})
