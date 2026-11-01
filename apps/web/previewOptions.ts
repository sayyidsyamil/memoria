// Preview-server options for the static web bundle, resolved from the
// environment so device testing never needs a config edit.

const DEFAULT_PREVIEW_HOST = '127.0.0.1'
const DEFAULT_PREVIEW_PORT = 4173

export type PreviewEnv = Record<string, string | undefined>

/** Loopback unless MEMORIA_WEB_HOST (or `--host` on the CLI) opts into LAN/device testing. */
export function webPreviewHost(env: PreviewEnv): string {
  return env.MEMORIA_WEB_HOST?.trim() || DEFAULT_PREVIEW_HOST
}

export function webPreviewPort(env: PreviewEnv): number {
  const port = Number(env.MEMORIA_WEB_PORT)
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PREVIEW_PORT
}

/** Extra Host headers the preview server accepts, e.g. a Tailscale name. IP addresses always pass. */
export function webPreviewAllowedHosts(env: PreviewEnv): string[] {
  return (env.MEMORIA_WEB_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
}

/** The static bundle ships no API: `/api/*` must 404 instead of falling back to index.html. */
export function isApiRequestPath(url: string | undefined): boolean {
  const pathname = (url ?? '').split('?')[0]
  return pathname === '/api' || pathname.startsWith('/api/')
}

export interface RemoteProxy {
  target: string
  /** The collaboration channel is a websocket under the same prefix. */
  ws: true
}

/**
 * With MEMORIA_REMOTE_URL set, the preview server forwards the Memoria remote protocol
 * (`/v1/*`, websockets included) to that server, so the page talks to its own origin, as it
 * will behind the hosted proxy. Unset, or not an http(s) URL: no proxy.
 */
export function webPreviewProxy(env: PreviewEnv): Record<string, RemoteProxy> | undefined {
  const target = env.MEMORIA_REMOTE_URL?.trim() ?? ''
  if (!/^https?:\/\/[^\s/]+\/?$/u.test(target)) return undefined
  return { '/v1': { target, ws: true } }
}
