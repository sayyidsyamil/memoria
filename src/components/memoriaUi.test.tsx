import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { Chip, EmptyState, LevelMeter, LifecycleRail, PillTabList, PillTabPanel, PillTabsRoot, StateButton } from './memoriaUi'

function Tabs({ onSelect }: { onSelect?: (value: string) => void }) {
  const [value, setValue] = useState('a')
  return <PillTabsRoot value={value} onValueChange={setValue}>
    <PillTabList label="Sections" value={value} onSelect={next => { onSelect?.(next); setValue(next) }} tabs={[{ value: 'a', label: 'First', count: 3 }, { value: 'b', label: 'Second' }, { value: 'c', label: 'Locked', disabled: true }]} />
    <PillTabPanel value="a">Panel A</PillTabPanel>
    <PillTabPanel value="b">Panel B</PillTabPanel>
  </PillTabsRoot>
}

it('switches tabs on click, shows counts and never selects a disabled tab', () => {
  const select = vi.fn()
  render(<Tabs onSelect={select} />)
  expect(screen.getByRole('tab', { name: /First/ })).toHaveAttribute('data-state', 'active')
  expect(screen.getByRole('tab', { name: /First/ })).toHaveTextContent('3')
  fireEvent.click(screen.getByRole('tab', { name: 'Second' }))
  expect(screen.getByText('Panel B')).toBeInTheDocument()
  expect(screen.queryByText('Panel A')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Locked' }))
  expect(select).not.toHaveBeenCalledWith('c')
})
it('exposes progress as a labelled list with the next step marked', () => {
  render(<LifecycleRail label="Meeting progress" steps={[{ label: 'Recorded', state: 'done' }, { label: 'Reviewed', state: 'current' }, { label: 'Approved', state: 'todo' }]} />)
  const items = screen.getAllByRole('listitem')
  expect(items[1]).toHaveAttribute('aria-current', 'step')
  expect(items[0]).toHaveTextContent('Recorded (done)')
  expect(items[2]).toHaveTextContent('Approved (not started)')
})
it('reports saving in place and blocks repeat clicks while working', () => {
  const click = vi.fn()
  const labels = { idle: 'Save', working: 'Saving…', done: 'Saved' }
  const { rerender } = render(<StateButton status="idle" labels={labels} onClick={click} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(click).toHaveBeenCalledTimes(1)
  rerender(<StateButton status="working" labels={labels} onClick={click} />)
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  rerender(<StateButton status="done" labels={labels} onClick={click} />)
  expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('data-status', 'done')
})
it('clamps meter heights and renders chips and empty states', () => {
  const { container } = render(<><LevelMeter levels={[-1, 0.5, 4]} /><Chip tone="green" dot>Saved</Chip><EmptyState icon={<span />} title="Nothing here" action={<button>Act</button>}>Explain</EmptyState></>)
  const heights = [...container.querySelectorAll('.mui-meter span')].map(bar => (bar as HTMLElement).style.height)
  expect(heights).toEqual(['14%', '57%', '100%'])
  expect(screen.getByText('Saved')).toHaveAttribute('data-tone', 'green')
  expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument()
})
