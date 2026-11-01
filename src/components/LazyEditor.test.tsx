import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorProps } from './Editor'

const startup = vi.hoisted(() => {
  const phases = new Map<string, { promise: Promise<void>, resolve: () => void }>()
  const phase = (name: string) => {
    let entry = phases.get(name)
    if (!entry) {
      let resolve!: () => void
      const promise = new Promise<void>((next) => { resolve = next })
      entry = { promise, resolve }
      phases.set(name, entry)
    }
    return entry
  }
  return {
    markStartupPhase: vi.fn(),
    phases,
    reach: (name: string) => phase(name).resolve(),
    waitForStartupPhase: vi.fn((name: string) => phase(name).promise),
  }
})

vi.mock('../lib/startupPerformance', () => ({
  markStartupPhase: startup.markStartupPhase,
  waitForStartupPhase: startup.waitForStartupPhase,
}))

const editorModule = vi.hoisted(() => {
  let resolve!: () => void
  const ready = new Promise<void>((next) => { resolve = next })
  return { ready, resolve }
})

vi.mock('./Editor', async () => {
  await editorModule.ready
  return { Editor: () => <div>Loaded editor</div> }
})

async function renderLazyEditor(activeTabPath: string | null) {
  const { LazyEditor } = await import('./LazyEditor')
  return { LazyEditor, ...render(<LazyEditor {...({ activeTabPath } as EditorProps)} />) }
}

function editorRequested(): boolean {
  return startup.markStartupPhase.mock.calls.some(([phase]) => phase === 'editor_module_requested')
}

describe('LazyEditor', () => {
  beforeEach(() => {
    vi.resetModules()
    startup.phases.clear()
    startup.markStartupPhase.mockClear()
    startup.waitForStartupPhase.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('keeps the app shell renderable while the editor bundle loads', async () => {
    const { LazyEditor, rerender } = await renderLazyEditor(null)

    expect(screen.getByTestId('editor-module-loading')).toBeInTheDocument()
    expect(startup.waitForStartupPhase).toHaveBeenCalledWith('react_shell')
    expect(editorRequested()).toBe(false)

    await act(async () => { startup.reach('react_shell') })
    expect(editorRequested()).toBe(true)

    rerender(<LazyEditor {...({ activeTabPath: '/vault/note.md' } as EditorProps)} />)

    await act(async () => { editorModule.resolve() })
    expect(await screen.findByText('Loaded editor')).toBeInTheDocument()
    expect(startup.markStartupPhase).toHaveBeenCalledWith('editor_module_loaded')
    expect(startup.markStartupPhase).toHaveBeenCalledWith('editor_committed')
  })

  async function renderWebEditorAfterShell() {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', 'true')
    vi.useFakeTimers()
    await renderLazyEditor(null)
    await act(async () => { startup.reach('react_shell') })
  }

  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  it('on the web, loads the editor bundle only after the note list painted and a grace period (TOL-206)', async () => {
    await renderWebEditorAfterShell()

    await act(async () => { startup.reach('active_usable') })
    await advance(100)
    expect(editorRequested()).toBe(false)

    await act(async () => { startup.reach('note_list_painted') })
    await advance(900)
    expect(editorRequested()).toBe(false)

    await advance(200)
    expect(editorRequested()).toBe(true)
  })

  it('on the web, loads the editor bundle at once when the user presses a pointer after the list painted', async () => {
    await renderWebEditorAfterShell()
    await act(async () => { startup.reach('note_list_painted') })
    await advance(10)
    expect(editorRequested()).toBe(false)

    await act(async () => { window.dispatchEvent(new Event('pointerdown')) })
    await advance(10)
    expect(editorRequested()).toBe(true)
  })

  it('on the web, loads the editor bundle anyway when the note list is slow to paint', async () => {
    await renderWebEditorAfterShell()

    await advance(2_000)
    expect(editorRequested()).toBe(false)

    await advance(600)
    expect(editorRequested()).toBe(true)
  })

  it('on the web, waits for an idle moment when the browser offers one', async () => {
    const idle: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => { idle.push(callback); return idle.length })
    await renderWebEditorAfterShell()
    await act(async () => { startup.reach('note_list_painted') })
    await advance(1_100)
    expect(editorRequested()).toBe(false)

    await act(async () => { for (const callback of idle) callback() })
    expect(editorRequested()).toBe(true)
    vi.unstubAllGlobals()
  })
})
