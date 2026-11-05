import { expect, it } from 'vitest'
import { tabletPanelGestureIntent } from './tabletPanelGestureIntent'

const context = { width: 1366, left: 0, minimumLeft: -600, properties: 300 }

it('waits for horizontal intent and yields vertical movement to scrolling', () => {
  expect(tabletPanelGestureIntent(context, { x: 500, dx: -8, dy: 2 })).toBe('wait')
  expect(tabletPanelGestureIntent(context, { x: 500, dx: -10, dy: 18 })).toBe('fail')
  expect(tabletPanelGestureIntent(context, { x: 500, dx: -30, dy: 8 })).toBe('left')
})

it('keeps sequential panel navigation available from the note-list header', () => {
  expect(tabletPanelGestureIntent(context, { x: 450, dx: -30, dy: 0 })).toBe('left')
  expect(tabletPanelGestureIntent({ ...context, left: -260 }, { x: 200, dx: -30, dy: 0 })).toBe('left')
  expect(tabletPanelGestureIntent({ ...context, left: -600 }, { x: 450, dx: -30, dy: 0 })).toBe('fail')
})

it('leaves note-row swipes to quick actions', () => {
  expect(tabletPanelGestureIntent(context, { x: 450, y: 200, dx: -30, dy: 0 })).toBe('fail')
  expect(tabletPanelGestureIntent(context, { x: 450, y: 200, dx: 30, dy: 0 })).toBe('fail')
  expect(tabletPanelGestureIntent({ ...context, left: -260 }, { x: 200, y: 200, dx: 30, dy: 0 })).toBe('fail')
})

it('hides and restores the left panels from the editor interior at every snap point', () => {
  for (const left of [0, -260, -600]) {
    const geometry = { ...context, left }
    expect(tabletPanelGestureIntent(geometry, { x: 800, y: 400, dx: -30, dy: 0 }))
      .toBe(left === -600 ? 'fail' : 'left')
    expect(tabletPanelGestureIntent(geometry, { x: 800, y: 400, dx: 30, dy: 0 }))
      .toBe(left === 0 ? 'fail' : 'left')
    expect(tabletPanelGestureIntent(geometry, { x: 800, y: 400, dx: 5, dy: -40 })).toBe('fail')
  }
})

it('keeps sidebar drags and editor edge reveals available', () => {
  expect(tabletPanelGestureIntent(context, { x: 100, y: 200, dx: -30, dy: 0 })).toBe('left')
  expect(tabletPanelGestureIntent({ ...context, left: -600 }, { x: 10, y: 200, dx: 30, dy: 0 })).toBe('left')
})

it('opens Properties only from the right edge and closes it from its own surface', () => {
  expect(tabletPanelGestureIntent(context, { x: 1350, dx: -30, dy: 0 })).toBe('properties')
  expect(tabletPanelGestureIntent({ ...context, properties: 0 }, { x: 1100, dx: 30, dy: 0 })).toBe('properties')
  expect(tabletPanelGestureIntent({ ...context, properties: 0 }, { x: 500, dx: -30, dy: 0 })).toBe('left')
})
