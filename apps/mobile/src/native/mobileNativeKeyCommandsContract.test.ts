import { describe, expect, it } from 'vitest'
import {
  mobileLaunchSearchArgumentName,
  mobileLaunchSearchFromArguments,
  mobileLaunchSearchFromNativeInputs,
} from './mobileNativeKeyCommandsContract'

describe('mobileLaunchSearchFromArguments', () => {
  it('returns an empty search when the QA launch argument is absent', () => {
    expect(mobileLaunchSearchFromArguments(['MemoriaMobile'])).toBe('')
  })

  it('normalizes raw query-string launch arguments', () => {
    expect(mobileLaunchSearchFromArguments([
      'MemoriaMobile',
      mobileLaunchSearchArgumentName,
      'source=dev-vault&mobileKeyboardShortcutProbe=1',
    ])).toBe('?source=dev-vault&mobileKeyboardShortcutProbe=1')
  })

  it('keeps query arguments that already include a leading question mark', () => {
    expect(mobileLaunchSearchFromArguments([
      'MemoriaMobile',
      mobileLaunchSearchArgumentName,
      '?layoutProbe=1',
    ])).toBe('?layoutProbe=1')
  })

  it('extracts the query from URL-shaped launch arguments', () => {
    expect(mobileLaunchSearchFromArguments([
      'MemoriaMobile',
      mobileLaunchSearchArgumentName,
      'memoria://mobile-ui-lab?layoutProbe=1&tabletPanels=all',
    ])).toBe('?layoutProbe=1&tabletPanels=all')
  })

  it('prefers simulator environment search over launch arguments', () => {
    expect(mobileLaunchSearchFromNativeInputs({
      args: [
        'MemoriaMobile',
        mobileLaunchSearchArgumentName,
        'layoutProbe=1',
      ],
      environmentSearch: 'mobileKeyboardShortcutProbe=1',
    })).toBe('?mobileKeyboardShortcutProbe=1')
  })
})
