import { expect, it } from 'vitest'
import { mobilePaneFooterFrame, mobilePaneFooterRowHeight } from './mobilePaneFooterLayout'

it.each([0, 21, 34])('centers controls within the full footer including a %s-point inset', bottom => {
  const frame = mobilePaneFooterFrame(bottom)
  expect(frame.height).toBe(48 + bottom)
  expect(frame.paddingBottom).toBe(0)
  expect(Number(frame.height) - Number(frame.paddingBottom)).toBe(mobilePaneFooterRowHeight + bottom)
  expect(frame.alignItems).toBe('center')
  expect(frame.flexShrink).toBe(0)
})

it('does not add a second inset when the pane owns the clearance or the keyboard covers it', () => {
  expect(mobilePaneFooterFrame()).toEqual(mobilePaneFooterFrame(0))
  expect(mobilePaneFooterFrame().height).toBeGreaterThanOrEqual(44)
})
