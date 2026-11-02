import { expect, it } from 'vitest'
import { clock, identifiedSpeakers, speakerLabel, speakerOrder, speakerTone } from './speakers'

it('counts the unknown voice as identified only once a reviewer names it', () => {
  expect(identifiedSpeakers(['unassigned', 'unassigned'], {})).toEqual([])
  expect(identifiedSpeakers(['unassigned', 'unassigned'], { unassigned: 'Alex Tan' })).toEqual(['unassigned'])
  expect(identifiedSpeakers(['S01', 'unassigned', 'S01'], { unassigned: '  ' })).toEqual(['S01'])
  expect(identifiedSpeakers(['S01', 'unassigned'], undefined)).toEqual(['S01'])
})

it('uses one label rule for named, numbered and unknown voices', () => {
  const order = speakerOrder(['unassigned', 'S02', 'S01', 'S02', 'host'])
  expect(order).toEqual(['S02', 'S01', 'host'])
  expect(speakerLabel('unassigned', {}, order)).toBe('Unknown speaker')
  expect(speakerLabel('S02', {}, order)).toBe('Speaker 2')
  expect(speakerLabel('S01', { S01: ' Maya ' }, order)).toBe('Maya')
  expect(speakerLabel('host', undefined, order)).toBe('Speaker 3')
  expect(speakerLabel('S03', { S03: '  ' }, order)).toBe('Speaker 3')
})
it('gives each voice a stable colour and leaves unknown voices neutral', () => {
  const order = speakerOrder(['S01', 'S02'])
  expect(speakerTone('S01', order)).toBe('blue')
  expect(speakerTone('S02', order)).toBe('orange')
  expect(speakerTone('S07', order)).toBe('blue')
  expect(speakerTone('unassigned', order)).toBe('neutral')
})
it('formats clock times without hours', () => {
  expect(clock(0)).toBe('0:00')
  expect(clock(65.9)).toBe('1:05')
  expect(clock(-3)).toBe('0:00')
})
