import { useEffect } from 'react'

export function MobileEditorActionRedirect({ command, onClose }: { command: () => void; onClose: () => void }) {
  useEffect(() => { onClose(); command() }, [command, onClose])
  return null
}
