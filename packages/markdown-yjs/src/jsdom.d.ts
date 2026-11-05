/** The one part of jsdom this package uses; `@types/jsdom` is not installed. */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string)
    readonly window: Record<string, unknown>
  }
}
