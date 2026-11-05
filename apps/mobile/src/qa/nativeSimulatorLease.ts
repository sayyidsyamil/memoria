import { createServer, type Server } from 'node:net'

const nativeQaPort = 47891

/** Host-only exclusion: the OS releases this loopback lease if a QA process exits. */
export async function withNativeSimulatorLease<T>(operation: (port: number) => Promise<T>, port = nativeQaPort): Promise<T> {
  const server = createServer((socket) => socket.destroy())
  await listen(server, port)
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing native QA lease address')
    return await operation(address.port)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function listen(server: Server, port: number) {
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
  } catch (cause) {
    throw new Error(`Native simulator QA port ${port} is unavailable; another QA run or local service may own it.`, { cause })
  }
}
