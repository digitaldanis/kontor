import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/** Writes a consistent copy of the database and removes copies older than `keepDays`. */
export function backupDatabase(sql: DatabaseSync, dataDir: string, keepDays: number, at = new Date()): string | null {
  if (dataDir === ':memory:') return null
  const dir = join(dataDir, 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const target = join(dir, `kontor-${stamp}.sqlite`)
  if (!existsSync(target)) sql.prepare('VACUUM INTO ?').run(target)
  const limit = at.getTime() - keepDays * 86_400_000
  for (const f of readdirSync(dir)) {
    if (!/^kontor-.*\.sqlite$/.test(f)) continue
    const path = join(dir, f)
    if (statSync(path).mtime.getTime() < limit) rmSync(path)
  }
  return target
}
