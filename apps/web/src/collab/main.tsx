import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@blocknote/mantine/style.css'
import 'katex/dist/katex.min.css'
import '../../../../src/index.css'
import '../../../../src/components/Editor.css'
import '../../../../src/components/EditorTheme.css'
import './collab.css'
import { CollabApp } from './CollabApp'

// Memoria Web, spike S4 (TOL-8): one note opened as a live document. This entry exists only
// in the web build; the desktop bundle is built from the repository's index.html.
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <CollabApp />
  </StrictMode>,
)
