import { describe, expect, it } from 'vitest'
import { initialEditText, isMisreadNumber, numbersIn, onlyBigNumberIn } from './ledgerNumbers'

describe('numbersIn (same rules as the engine)', () => {
  it('reads a number with thousands separators', () => expect(numbersIn('the pilot budget is 250,000 ringgit')).toEqual([250000]))
  it('reads a number with a magnitude word both ways', () => expect(numbersIn('about 2.5 million')).toEqual([2.5, 2500000]))
  it('reads attached magnitudes such as RM2m and 250k', () => {
    expect(numbersIn('RM2m')).toEqual([2, 2000000])
    expect(numbersIn('say 250k')).toEqual([250, 250000])
  })
  it('reads decimals', () => expect(numbersIn('1,234.5 and 0.75')).toEqual([1234.5, 0.75]))
  it('finds nothing when no digits are written', () => expect(numbersIn('two hundred and fifty thousand')).toEqual([]))
  it('does not read digits that are part of a word', () => expect(numbersIn('v2x')).toEqual([]))
  it('agrees with the engine on dotted and time-like text', () => {
    expect(numbersIn('1.2.3')).toEqual([1.2])
    expect(numbersIn('12:30 on 5.5.')).toEqual([12, 30, 5.5])
  })
})

describe('onlyBigNumberIn', () => {
  it('returns the single number of 1,000 or more', () => {
    expect(onlyBigNumberIn('Okay, the pilot budget is 250,000 ringgit. Raj, please note that down.')).toBe(250000)
    expect(onlyBigNumberIn('RM2m')).toBe(2000000)
    expect(onlyBigNumberIn('250k')).toBe(250000)
    expect(onlyBigNumberIn('2.5 million')).toBe(2500000)
  })
  it('is null when there is none or more than one', () => {
    expect(onlyBigNumberIn('no digits here')).toBeNull()
    expect(onlyBigNumberIn('from 250,000 to 280,000 ringgit')).toBeNull()
    expect(onlyBigNumberIn('item 3 of 12')).toBeNull()
  })
  it('counts the same number written twice once', () => expect(onlyBigNumberIn('250,000 ringgit, yes 250,000')).toBe(250000))
})

describe('initialEditText', () => {
  const quote = 'the pilot budget is 250,000 ringgit'
  it('pre-fills the quote number for a misread suggestion', () => expect(initialEditText(2500000, 'the number is not in the quote', quote)).toBe('250000'))
  it('keeps the suggested value when the quote has no single big number', () =>
    expect(initialEditText(2500000, 'the number is not in the quote', 'it is 3 or 4')).toBe('2500000'))
  it('keeps the suggested value for other reasons', () => expect(initialEditText(300000, 'confirm_conflicts', quote)).toBe('300000'))
  it('recognises the engine reason', () => {
    expect(isMisreadNumber('the number is not in the quote')).toBe(true)
    expect(isMisreadNumber('confirm_conflicts')).toBe(false)
  })
})
