/**
 * Development bridge for Memoria's desktop commands in the browser build. Enabled only when
 * VITE_MEMORIA_DEV_BRIDGE=1 (see scripts/memoria-dev-bridge.ts); otherwise it never answers.
 */

const BRIDGED = new Set([
  'load_vault_list', 'get_default_vault_path', 'check_vault_exists', 'ai_model_status', 'list_recoverable_recordings',
  'cancel_wiki_memory', 'wiki_memory', 'temporal_api', 'meetings_api', 'live_memory_check', 'live_ask',
])

export const NOT_BRIDGED = Symbol('not bridged')

export async function tryMemoriaBridge(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  if (import.meta.env.VITE_MEMORIA_DEV_BRIDGE !== '1' || !BRIDGED.has(cmd)) return NOT_BRIDGED
  const response = await fetch('/api/memoria/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd, args: args ?? {} }),
  })
  if (response.status === 404) return NOT_BRIDGED
  const reply = await response.json() as { value?: unknown; error?: unknown }
  if ('error' in reply) throw reply.error
  return reply.value
}
