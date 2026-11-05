import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs'

const maxProofBytes = 2 * 1024 * 1024

/** Host-only reader: capture before launching the app, not after its proof. */
export function captureNativeMetroLog(path: string | undefined): () => string {
  if (!path) return () => ''
  const initial = statSync(path)
  return () => {
    const descriptor = openSync(path, 'r')
    try {
      const current = fstatSync(descriptor)
      assertLogUnchanged(current.dev === initial.dev)
      assertLogUnchanged(current.ino === initial.ino)
      assertLogUnchanged(current.size >= initial.size)
      const length = current.size - initial.size
      if (length > maxProofBytes) throw new Error('Metro proof output exceeds 2 MiB')
      return readAppendedBytes(descriptor, initial.size, length)
    } finally {
      closeSync(descriptor)
    }
  }
}

function assertLogUnchanged(unchanged: boolean): void {
  if (!unchanged) throw new Error('Metro proof log was replaced or truncated during this run')
}

function readAppendedBytes(descriptor: number, start: number, length: number): string {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const count = readSync(descriptor, buffer, offset, length - offset, start + offset)
    if (count === 0) throw new Error('Metro proof log changed while being read')
    offset += count
  }
  return buffer.toString('utf8')
}
