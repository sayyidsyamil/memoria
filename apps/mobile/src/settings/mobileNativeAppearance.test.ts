import { describe, expect, it } from 'vitest'
import manifest from '../../app.json'

describe('native system appearance', () => {
  it('lets the native window report the system theme to React Native', () => {
    expect(manifest.expo.userInterfaceStyle).toBe('automatic')
  })
})
