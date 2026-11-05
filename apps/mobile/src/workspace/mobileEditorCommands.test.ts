import { describe, expect, it, vi } from 'vitest'
import {
  createMobileEditorCommandForwarders,
  mergeMobileEditorCommands,
  mobileEditorCommandCapabilities,
  type MobileEditorCommands,
} from './mobileEditorCommands'

describe('mobile editor commands', () => {
  it('does not mark unsupported editor commands as available', () => {
    const commands = { save: vi.fn() } satisfies MobileEditorCommands

    expect(mobileEditorCommandCapabilities(commands)).toEqual({
      blur: false,
      findInNote: false,
      replaceInNote: false,
      pastePlainText: false,
      save: true,
      toggleRawEditor: false,
    })
  })

  it('marks every supplied editor command as available', () => {
    const commands = {
      blur: vi.fn(),
      findInNote: vi.fn(),
      replaceInNote: vi.fn(),
      pastePlainText: vi.fn(),
      save: vi.fn(),
      toggleRawEditor: vi.fn(),
    } satisfies MobileEditorCommands

    expect(mobileEditorCommandCapabilities(commands)).toEqual({
      blur: true,
      findInNote: true,
      replaceInNote: true,
      pastePlainText: true,
      save: true,
      toggleRawEditor: true,
    })
  })

  it('merges panel and editor registrations so chrome commands coexist with active editor commands', () => {
    const blur = vi.fn()
    const save = vi.fn()
    const toggleRawEditor = vi.fn()
    const pastePlainText = vi.fn()

    expect(mergeMobileEditorCommands([
      { toggleRawEditor },
      { blur, pastePlainText, save },
    ])).toEqual({
      blur,
      pastePlainText,
      save,
      toggleRawEditor,
    })
  })

  it('uses the active editor blur command without losing independent panel commands', () => {
    const previousBlur = vi.fn()
    const activeBlur = vi.fn()
    const commands = mergeMobileEditorCommands([
      { blur: previousBlur, toggleRawEditor: vi.fn() },
      { blur: activeBlur },
    ])

    commands.blur?.()

    expect(activeBlur).toHaveBeenCalledOnce()
    expect(previousBlur).not.toHaveBeenCalled()
    expect(commands.toggleRawEditor).toBeDefined()
  })

  it('forwards to the latest callback without registering unsupported commands', () => {
    const previousBlur = vi.fn()
    const activeBlur = vi.fn()
    let current: MobileEditorCommands = { blur: previousBlur }
    const registered = createMobileEditorCommandForwarders(mobileEditorCommandCapabilities(current), () => current)
    current = { blur: activeBlur }

    registered.blur?.()

    expect(Object.keys(registered)).toEqual(['blur'])
    expect(activeBlur).toHaveBeenCalledOnce()
    expect(previousBlur).not.toHaveBeenCalled()
    current = {}
    expect(() => registered.blur?.()).not.toThrow()
  })
})
