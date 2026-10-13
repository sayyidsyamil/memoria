import { describe, expect, it } from 'vitest'
import { rememberVoicesEnabled, shouldAskVoiceConsent, voiceProfileLabels } from './voiceProfiles'

const speakers = ['Speaker 0', 'Speaker 1']

describe('rememberVoicesEnabled', () => {
  it.each([[undefined, false], [null, false], [false, false], [true, true]])('%s -> %s', (value, expected) => {
    expect(rememberVoicesEnabled({ remember_voices: value })).toBe(expected)
  })
})

describe('voiceProfileLabels', () => {
  const labels = { 'Speaker 0': ' Aisha ', 'Speaker 1': 'Speaker 1' }

  it('saves nothing when the setting is off, even for named speakers', () => {
    expect(voiceProfileLabels(false, labels, speakers)).toEqual({})
  })

  it('saves only real names (trimmed) when the setting is on', () => {
    expect(voiceProfileLabels(true, labels, speakers)).toEqual({ 'Speaker 0': 'Aisha' })
  })

  it('ignores blank names', () => {
    expect(voiceProfileLabels(true, { 'Speaker 0': '   ' }, speakers)).toEqual({})
  })
})

describe('shouldAskVoiceConsent', () => {
  it('asks once a speaker has been named and the user never answered', () => {
    expect(shouldAskVoiceConsent({ remember_voices: null }, { 'Speaker 0': 'Aisha' }, speakers)).toBe(true)
    expect(shouldAskVoiceConsent({ remember_voices: undefined }, { 'Speaker 0': 'Aisha' }, speakers)).toBe(true)
  })

  it('does not ask before any speaker is named', () => {
    expect(shouldAskVoiceConsent({ remember_voices: null }, { 'Speaker 0': '  ', 'Speaker 1': 'Speaker 1' }, speakers)).toBe(false)
  })

  it('never asks again after a yes or a no', () => {
    expect(shouldAskVoiceConsent({ remember_voices: true }, { 'Speaker 0': 'Aisha' }, speakers)).toBe(false)
    expect(shouldAskVoiceConsent({ remember_voices: false }, { 'Speaker 0': 'Aisha' }, speakers)).toBe(false)
  })
})
