import type { PreparedSource } from './sourceImport'

export interface ImportItem {
  id: string
  name: string
  state: 'processing' | 'review' | 'saving' | 'saved' | 'error' | 'rejected'
  source?: PreparedSource
  file?: File
  sourcePath?: string
  error?: string
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('memoria-source-imports', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('queues')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function readImportQueue(vaultPath: string): Promise<ImportItem[]> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('queues').objectStore('queues').get(vaultPath)
      request.onsuccess = () => resolve((request.result ?? []) as ImportItem[])
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

export async function writeImportQueue(vaultPath: string, items: ImportItem[]): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('queues', 'readwrite')
      transaction.objectStore('queues').put(items, vaultPath)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('Queue save interrupted'))
    })
  } finally { db.close() }
}
