import { useState, type ReactNode } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { SourceIntake } from '../SourceIntake'

const FILES_OPEN_STORAGE_KEY = 'memoria:sidebar-files-open'

function storedOpen(): boolean {
  try {
    return localStorage.getItem(FILES_OPEN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function storeOpen(open: boolean): void {
  try {
    localStorage.setItem(FILES_OPEN_STORAGE_KEY, open ? '1' : '0')
  } catch {
    // Unavailable storage only means the section starts folded next time.
  }
}

/**
 * The notes, folders and imported documents of the workspace, folded under one "Files" heading below the Memoria section.
 * Folded by default; the choice is remembered.
 */
export function SidebarFilesSection({ vaultPath, children }: { vaultPath?: string; children: ReactNode }) {
  const [open, setOpen] = useState(storedOpen)
  return (
    <details className="workspace-library" open={open} onToggle={event => {
      const next = event.currentTarget.open
      if (next !== open) { setOpen(next); storeOpen(next) }
    }}>
      <summary><CaretRight size={12} weight="bold" aria-hidden="true" data-open={open || undefined} />Files</summary>
      {vaultPath && <div className="workspace-library-actions"><SourceIntake key={vaultPath} vaultPath={vaultPath} /></div>}
      {children}
    </details>
  )
}
