import type * as Sentry from '@sentry/react'

// TOL-232: what the web build adds to the shared Sentry setup. In a browser the SDK records the
// page URL and fetch/navigation breadcrumbs, and Memoria Web URLs carry note paths
// (`/v1/files/<path>`, note routes) and collaboration tickets in query strings. Those are cut
// down to the origin and the first path segment before anything is sent. Stack frame URLs
// (the bundle's /assets files) are left alone: Sentry needs them to apply the source maps.

type BeforeSend = (event: Sentry.ErrorEvent, hint: Sentry.EventHint) => Sentry.ErrorEvent | null

const BREADCRUMB_URL_KEYS = ['url', 'from', 'to'] as const

export const WEB_PLATFORM_TAG = 'web'

/** `https://host/v1/files/Notes/a.md?ticket=x` → `https://host/v1`; unparseable → ''. */
export function redactWebUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin)
    const [firstSegment] = url.pathname.split('/').filter(Boolean)
    return firstSegment ? `${url.origin}/${firstSegment}` : url.origin
  } catch {
    return ''
  }
}

export function scrubWebBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const data = breadcrumb.data
  if (!data) return breadcrumb

  for (const key of BREADCRUMB_URL_KEYS) {
    const value = Reflect.get(data, key)
    if (typeof value === 'string') Reflect.set(data, key, redactWebUrl(value))
  }
  return breadcrumb
}

function scrubWebEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.url) event.request.url = redactWebUrl(event.request.url)
  for (const breadcrumb of event.breadcrumbs ?? []) scrubWebBreadcrumb(breadcrumb)
  return event
}

/** The desktop options plus the web URL scrubbing, applied after the shared `beforeSend`. */
export function withWebPrivacy<T extends { beforeSend: BeforeSend }>(options: T): T & Sentry.BrowserOptions {
  return {
    ...options,
    beforeSend: (event: Sentry.ErrorEvent, hint: Sentry.EventHint) => {
      const kept = options.beforeSend(event, hint)
      return kept && scrubWebEvent(kept)
    },
    beforeBreadcrumb: scrubWebBreadcrumb,
  }
}
