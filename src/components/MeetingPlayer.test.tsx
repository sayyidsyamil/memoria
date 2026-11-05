import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MeetingPlayer, type PlayerHandle } from './MeetingPlayer'

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(async function (this: HTMLMediaElement) { this.dispatchEvent(new Event('play')) }) })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() })
})
it('seeks from any tab through the handle and reports time and playback', () => {
  const ref = createRef<PlayerHandle>()
  const onTime = vi.fn()
  const { container } = render(<MeetingPlayer ref={ref} src="/audio.webm" fallbackDuration={58} marks={[{ at: 20, label: 'Pilot' }]} showControls={false} onTime={onTime} />)
  expect(screen.queryByRole('group', { name: 'Recording player' })).not.toBeInTheDocument()
  act(() => ref.current!.seek(20, false))
  expect(container.querySelector('audio')!.currentTime).toBe(20)
  expect(onTime).toHaveBeenLastCalledWith(20, false)
})
it('renders the control bar with total length, marked-moment ticks and a mark action', () => {
  const mark = vi.fn()
  const { container } = render(<MeetingPlayer src="/audio.webm" fallbackDuration={58} marks={[{ at: 29, label: 'Halfway' }]} showControls onTime={vi.fn()} onMark={mark} />)
  expect(screen.getByLabelText('Total length')).toHaveTextContent('0:58')
  expect(screen.getByLabelText('Elapsed time')).toHaveTextContent('0:00')
  const tick = container.querySelector('.player-mark') as HTMLElement
  expect(tick.style.left).toBe('50%')
  expect(tick).toHaveAttribute('title', '0:29 Halfway')
  fireEvent.click(screen.getByRole('button', { name: 'Mark this moment' }))
  expect(mark).toHaveBeenCalled()
  fireEvent.change(screen.getByRole('slider', { name: 'Seek recording' }), { target: { value: '12' } })
  expect(screen.getByLabelText('Elapsed time')).toHaveTextContent('0:12')
  fireEvent.click(screen.getByRole('button', { name: 'Play recording' }))
  expect(screen.getByRole('button', { name: 'Pause recording' })).toBeInTheDocument()
})
