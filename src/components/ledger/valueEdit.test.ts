import { describe, expect, it } from 'vitest'
import type { RegistryAttribute } from '../../lib/ledgerApi'
import { parseEditedValue, toInputText } from './valueEdit'

const spec = (type: RegistryAttribute['type'], values: string[] = []): RegistryAttribute => ({ name: 'x', type, values, change_kind: 'REVISE' })

describe('parseEditedValue', () => {
  it('rejects empty input', () => {
    expect(parseEditedValue(spec('text'), '   ')).toEqual({ error: 'Enter a value.' })
  })

  it('sends numbers as numbers, accepting thousands separators', () => {
    expect(parseEditedValue(spec('number'), '280,000')).toEqual({ value: 280000 })
    expect(parseEditedValue(spec('number'), 'lots')).toMatchObject({ error: expect.stringContaining('number') })
  })

  it('accepts only ISO dates for date attributes', () => {
    expect(parseEditedValue(spec('date'), '2026-12-20')).toEqual({ value: '2026-12-20' })
    expect(parseEditedValue(spec('date'), '20/12/2026')).toMatchObject({ error: expect.any(String) })
  })

  it('keeps person ids and choices as typed text', () => {
    expect(parseEditedValue(spec('person'), 'wei_ling')).toEqual({ value: 'wei_ling' })
    expect(parseEditedValue(spec('enum', ['a', 'b']), 'a')).toEqual({ value: 'a' })
  })

  it('converts stored values to input text', () => {
    expect(toInputText(280000)).toBe('280000')
    expect(toInputText(null)).toBe('')
  })
})
