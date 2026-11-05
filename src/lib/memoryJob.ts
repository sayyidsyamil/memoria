import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export function startMemoryJob<T>(request: Record<string, unknown>, onProgress: (stage: string) => void) {
  const jobId = crypto.randomUUID()
  const promise = (async () => {
    const unlisten = await listen<{ jobId: string; stage: string }>('wiki-memory-progress', event => {
      if (event.payload.jobId === jobId) onProgress(event.payload.stage)
    }).catch(() => () => undefined)
    try { return await invoke<T>('wiki_memory', { request: { ...request, jobId } }) }
    finally { unlisten() }
  })()
  return { promise, cancel: () => invoke<void>('cancel_wiki_memory', { jobId }) }
}
