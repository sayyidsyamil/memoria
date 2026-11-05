type DocumentReader<T> = { isReady: () => boolean; read: () => Promise<T> }

export async function readReadyEditorDocument<T>(reader: DocumentReader<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (!reader.isReady()) {
    if (Date.now() >= deadline) throw new Error('editorNotReady')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('editorReadTimedOut')), Math.max(0, deadline - Date.now()))
      }),
    ])
  } finally { clearTimeout(timer) }
}
