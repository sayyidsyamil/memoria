import { JSDOM } from 'jsdom'

/**
 * BlockNote parses markdown through an HTML DOM and builds its ProseMirror schema with
 * `document`. In Node there is none, so a jsdom window lends its DOM globals. In a browser
 * (or a jsdom test environment) this does nothing.
 */
const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DOMParser', 'getComputedStyle']

export function installHeadlessDom(target: Record<string, unknown> = globalThis): void {
  if (target.document !== undefined) return
  const { window } = new JSDOM('<!doctype html><html><body></body></html>')
  for (const name of DOM_GLOBALS) {
    Object.defineProperty(target, name, { value: window[name], configurable: true, writable: true })
  }
}
