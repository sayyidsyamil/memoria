import type { ServerResponse } from 'node:http'
import type { ChangeEvent } from '../../../packages/protocol/src/index.ts'

/** Which paths a connection may hear about; every path when left out. */
export interface PathFilter {
  readonly isOwner: boolean
  canRead(path: string): boolean
}

interface Connection {
  response: ServerResponse
  id: number
  filter?: PathFilter
}

let nextId = 1

/**
 * Manages Server-Sent Events connections for the change feed.
 * Emits events when commits, pulls, and pushes occur.
 */
export class ChangeEmitter {
  private readonly connections = new Set<Connection>()
  private readonly log: (message: string) => void

  constructor(log?: (message: string) => void) {
    this.log = log ?? (() => {})
  }

  /** Registers a new SSE connection; the returned function ends it. */
  connect(response: ServerResponse, filter?: PathFilter): () => void {
    const connection: Connection = { response, id: nextId++, filter }
    this.connections.add(connection)

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    response.on('close', () => {
      this.connections.delete(connection)
    })

    // Send initial connected event
    this.sendEvent(connection, { type: 'commit', head: 'connected' })
    return () => {
      this.connections.delete(connection)
      response.end()
    }
  }

  /** Emit an event to all connected clients. */
  emit(event: ChangeEvent): void {
    if (this.connections.size === 0) return

    const disconnected: Connection[] = []
    for (const connection of this.connections) {
      try {
        this.sendEvent(connection, event)
      } catch (error) {
        this.log(`failed to send event to connection ${connection.id}: ${String(error)}`)
        disconnected.push(connection)
      }
    }

    for (const connection of disconnected) {
      this.connections.delete(connection)
    }
  }

  /** Close all connections. */
  close(): void {
    for (const { response } of this.connections) {
      response.end()
    }
    this.connections.clear()
  }

  private sendEvent(connection: Connection, event: ChangeEvent): void {
    const visible = visibleTo(connection.filter, event)
    if (!visible) return
    const data = JSON.stringify(visible)
    connection.response.write(`data: ${data}\n\n`)
  }
}

/** The event as a connection may see it: a commit that touched none of its paths is not sent. */
function visibleTo(filter: PathFilter | undefined, event: ChangeEvent): ChangeEvent | null {
  if (!filter || filter.isOwner || !event.paths) return event
  const paths = event.paths.filter((path) => filter.canRead(path))
  return paths.length > 0 ? { ...event, paths } : null
}
