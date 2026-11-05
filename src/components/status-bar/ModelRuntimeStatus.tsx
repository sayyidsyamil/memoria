import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './modelRuntimeStatus.css'

const runtimes = [
  { key: 'speech', label: 'Speech' },
  { key: 'qwen', label: 'Knowledge' },
  { key: 'embed', label: 'Search' },
] as const

interface Runtime { state: string; message?: string }

export function ModelRuntimeStatus() {
  const [models, setModels] = useState<Record<string, Runtime>>({})
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const result = await invoke<unknown>('ai_model_status')
        if (!active) return
        const valid = result !== null && typeof result === 'object' && !Array.isArray(result)
        const entries = valid ? Object.entries(result) : []
        setModels(Object.fromEntries(entries.filter(([, value]) => value !== null && typeof value === 'object' && typeof value.state === 'string')))
        setUnavailable(!valid)
      } catch {
        if (active) setUnavailable(true)
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  return <div className="model-runtime-status" role="status" aria-label="Local AI runtime status">
    {unavailable ? <span>Local AI status unavailable</span> : runtimes.map(({ key, label }) => {
      const model = models[key]
      const state = model?.state === 'ready' ? 'Ready' : model?.state === 'failed' ? 'Needs attention' : model?.state === 'preparing' || model?.state === 'starting' ? 'Preparing' : 'Queued'
      return <span key={key} className="model-runtime-item" data-state={model?.state ?? 'queued'} title={model?.message ? `${label}: ${model.message}` : `${label}: ${state}`}>
        <i aria-hidden="true" /><span>{label}: <b>{state}</b></span>
      </span>
    })}
  </div>
}
