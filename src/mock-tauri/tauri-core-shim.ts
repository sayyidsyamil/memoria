/**
 * Development bridge only (VITE_MEMORIA_DEV_BRIDGE=1, see vite.config.ts): components that import
 * `invoke` from @tauri-apps/api/core reach the browser mock and the Memoria engine bridge instead
 * of a missing Tauri runtime. Never part of a production build.
 */
export * from '../../node_modules/@tauri-apps/api/core.js'
import { mockInvoke } from './index'

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return mockInvoke<T>(cmd, args)
}

export function convertFileSrc(filePath: string): string {
  return `/@fs${filePath}`
}
