// @vitest-environment jsdom
import { act, createElement, type ContextType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileVaultPicker } from './MobileVaultPicker'
import { MobileVaultPickerContext } from '../../workspace/MobileVaultContext'

type Props = { children?: ReactNode; testID?: string; disabled?: boolean; onPress?: () => void;
  accessibilityState?: { selected: boolean } }
function Surface(props: Props) {
  return createElement('div', { 'data-testid': props.testID }, props.children)
}
function Control(props: Props) {
  return createElement('button', { type: 'button', 'data-testid': props.testID, disabled: props.disabled,
    onClick: props.onPress, 'aria-selected': props.accessibilityState?.selected }, props.children)
}
vi.mock('react-native', () => ({ StyleSheet: { create: (styles: object) => styles, hairlineWidth: 0.5 } }))
vi.mock('phosphor-react-native', () => ({ CaretDown: () => null, Check: () => null, GearSix: () => null }))
vi.mock('../../ui/theme/useMobileTheme', () => ({ useMobileColors: () => ({}) }))
vi.mock('../ui/text', () => ({ Text: Surface }))
vi.mock('../ui/dropdown-menu', () => ({ DropdownMenu: Surface, DropdownMenuContent: Surface,
  DropdownMenuTrigger: Control, DropdownMenuItem: Control }))

type Picker = NonNullable<ContextType<typeof MobileVaultPickerContext>>
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
let picker: Picker
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  root = createRoot(host)
  picker = { disabled: false, manage: vi.fn(), choices: [
    { id: 'local', label: 'Local vault', selected: true, select: vi.fn(async () => {}) },
    { id: 'git', label: 'Git vault', selected: false, select: vi.fn(async () => {}) },
  ] }
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })

it('offers only remembered vaults followed by Manage vaults', async () => {
  await render()
  const options = host.querySelector('[data-testid="sidebar-vault-options"]')
  if (!options) throw new Error('Vault choices are missing')
  expect([...options.querySelectorAll('button')].map(button => button.textContent))
    .toEqual(['Local vault', 'Git vault', 'Manage vaults'])
  expect(host.querySelector('[data-testid="quick-select-vault-local"]')?.getAttribute('aria-selected')).toBe('true')
  await click('quick-select-vault-git')
  expect(picker.choices[1].select).toHaveBeenCalledExactlyOnceWith()
  expect(picker.manage).not.toHaveBeenCalled()
})
it('opens Settings from the final management entry', async () => {
  await render()
  await click('quick-manage-vaults')
  expect(picker.manage).toHaveBeenCalledExactlyOnceWith()
})
it('prevents overlapping switches while an operation is running', async () => {
  picker.disabled = true
  await render()
  expect([...host.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
  await click('quick-select-vault-git')
  expect(picker.choices[1].select).not.toHaveBeenCalled()
})
function render() {
  return act(async () => root.render(createElement(MobileVaultPickerContext.Provider, { value: picker }, createElement(MobileVaultPicker))))
}
function click(id: string) {
  return act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click())
}
