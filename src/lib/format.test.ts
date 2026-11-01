import { expect, it } from 'vitest'
import { highlightParts, initials, plural } from './format'

it('builds readable initials for people, numbered speakers and unknown voices', () => {
  expect(initials('Maya Chen')).toBe('MC')
  expect(initials('Priya')).toBe('P')
  expect(initials('Dana Marie Ruiz')).toBe('DR')
  expect(initials('Speaker 2')).toBe('2')
  expect(initials('Unknown speaker')).toBe('?')
  expect(initials('  ')).toBe('?')
})
it('highlights query words by prefix and joins phrases into one run', () => {
  const parts = highlightParts('Net revenue churn landed at 3.1 percent, down from 4.4', ['churn', 'landed'])
  expect(parts.filter(part => part.hit).map(part => part.text)).toEqual(['churn landed'])
  expect(parts.map(part => part.text).join('')).toBe('Net revenue churn landed at 3.1 percent, down from 4.4')
  expect(highlightParts("I'd lead with the churn number", ['churn', 'number']).filter(part => part.hit).map(part => part.text)).toEqual(['churn number'])
  expect(highlightParts('Churning customers', ['churn'])[0]).toEqual({ text: 'Churning', hit: true })
  expect(highlightParts('Nothing here', [])).toEqual([{ text: 'Nothing here', hit: false }])
})
it('writes counts in singular and plural', () => {
  expect(plural(0, 'meeting')).toBe('0 meetings')
  expect(plural(1, 'meeting')).toBe('1 meeting')
  expect(plural(2, 'brief')).toBe('2 briefs')
  expect(plural(1, 'entry', 'entries')).toBe('1 entry')
  expect(plural(2, 'entry', 'entries')).toBe('2 entries')
})
