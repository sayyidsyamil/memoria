import type { ErrorEvent, Event, Exception, StackFrame } from '@sentry/react-native'
import type { DebugImage } from '@sentry/core'

const errorTypes = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError'])

// Rebuild reports from a small allowlist; parser errors can contain entire notes.
export function sanitizeMobileCrash(event: Event): ErrorEvent | null {
  if (event.type || !event.exception?.values?.length) return null
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'javascript',
    level: event.level,
    debug_meta: { images: event.debug_meta?.images?.flatMap(safeDebugImage) },
    exception: { values: event.exception.values.slice(0, 4).map(safeException) },
  }
}

function safeException(exception: Exception): Exception {
  return {
    type: errorTypes.has(exception.type ?? '') ? exception.type : 'Error',
    value: 'Mobile application error',
    mechanism: exception.mechanism ? { type: 'generic', handled: exception.mechanism.handled } : undefined,
    stacktrace: exception.stacktrace ? { frames: exception.stacktrace.frames?.slice(-80).map(safeFrame) } : undefined,
  }
}

function safeDebugImage(image: DebugImage): DebugImage[] {
  if (image.type !== 'sourcemap' || !/^[\da-f-]{36}$/i.test(image.debug_id)) return []
  const codeFile = bundleFilename(image.code_file)
  return codeFile ? [{ type: 'sourcemap', debug_id: image.debug_id, code_file: codeFile }] : []
}

function safeFrame(frame: StackFrame): StackFrame {
  return {
    filename: bundleFilename(frame.filename),
    function: frame.function && /^[\w$.<>:[\] -]{1,120}$/.test(frame.function) ? frame.function : undefined,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
  }
}

function bundleFilename(filename: string | undefined) {
  const basename = filename?.split(/[/?#]/).filter(Boolean).at(-1)
  if (!basename || !/^[\w.-]+\.(?:js|jsbundle|bundle)$/.test(basename)) return undefined
  return `app:///${basename}`
}
