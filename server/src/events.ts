import type { Response } from 'express'

/** Server-sent events: tells open browsers which collections changed. */
export class EventHub {
  private clients = new Map<string, Set<{ id: string; res: Response }>>()

  subscribe(workspaceId: string, clientId: string, res: Response) {
    let set = this.clients.get(workspaceId)
    if (!set) this.clients.set(workspaceId, (set = new Set()))
    const entry = { id: clientId, res }
    set.add(entry)
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
    res.on('close', () => {
      clearInterval(ping)
      set.delete(entry)
    })
  }

  publish(workspaceId: string, collections: string[], fromClient: string) {
    const payload = `data: ${JSON.stringify({ collections })}\n\n`
    for (const c of this.clients.get(workspaceId) ?? []) if (!fromClient || c.id !== fromClient) c.res.write(payload)
  }

  close() {
    for (const set of this.clients.values()) for (const c of set) c.res.end()
    this.clients.clear()
  }
}
