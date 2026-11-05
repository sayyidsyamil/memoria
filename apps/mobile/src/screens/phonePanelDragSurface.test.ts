import { expect, it } from 'vitest'
import { phonePanelDragSurface } from './phonePanelDragSurface'

it('permits sidebar navigation from note rows as well as the header and edges', () => {
  expect(phonePanelDragSurface('list', { x: 180, y: 200 }, 390, 40)).toBe(true)
  expect(phonePanelDragSurface('list', { x: 180, y: 60 }, 390, 40)).toBe(true)
  expect(phonePanelDragSurface('list', { x: 10, y: 200 }, 390, 40)).toBe(true)
})

it('keeps editor gestures at the edges and lets sidebars close from their surface', () => {
  expect(phonePanelDragSurface('editor', { x: 180, y: 400 }, 390, 40)).toBe(false)
  expect(phonePanelDragSurface('editor', { x: 380, y: 400 }, 390, 40)).toBe(true)
  expect(phonePanelDragSurface('sidebar', { x: 180, y: 400 }, 390, 40)).toBe(true)
  expect(phonePanelDragSurface('properties', { x: 180, y: 400 }, 390, 40)).toBe(true)
})
