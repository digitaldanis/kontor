import { memoryDatabase, type Database } from './store'

/**
 * The active store. The browser attaches the API-backed store at startup,
 * the server one per request, tests keep the in-memory default.
 */
export let db: Database = memoryDatabase()

export function setDatabase(database: Database) {
  db = database
}

export function uid(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}
