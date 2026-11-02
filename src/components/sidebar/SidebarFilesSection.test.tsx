import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SidebarFilesSection } from './SidebarFilesSection'

vi.mock('../SourceIntake', () => ({ SourceIntake: ({ vaultPath }: { vaultPath: string }) => <button type="button">Import files into {vaultPath}</button> }))

beforeEach(() => { localStorage.clear() })

function files() {
  return screen.getByText('Files').closest('details')!
}

it('folds the workspace files under one Files heading, folded by default', () => {
  render(<SidebarFilesSection vaultPath="/vault"><nav aria-label="Library">Inbox</nav></SidebarFilesSection>)
  expect(files()).not.toHaveAttribute('open')
  expect(files()).toContainElement(screen.getByText('Inbox'))
  expect(files()).toContainElement(screen.getByRole('button', { name: 'Import files into /vault', hidden: true }))
})

it('remembers that the section was opened', () => {
  const first = render(<SidebarFilesSection vaultPath="/vault"><p>Inbox</p></SidebarFilesSection>)
  files().open = true
  fireEvent(files(), new Event('toggle'))
  expect(files()).toHaveAttribute('open')
  first.unmount()
  render(<SidebarFilesSection vaultPath="/vault"><p>Inbox</p></SidebarFilesSection>)
  expect(files()).toHaveAttribute('open')
  files().open = false
  fireEvent(files(), new Event('toggle'))
  expect(localStorage.getItem('memoria:sidebar-files-open')).toBe('0')
})

it('shows the library without the import action when no workspace is open', () => {
  render(<SidebarFilesSection><p>Inbox</p></SidebarFilesSection>)
  expect(screen.queryByRole('button', { name: /Import files/, hidden: true })).not.toBeInTheDocument()
})
