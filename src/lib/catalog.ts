import { db, now, uid } from './db'
import type { CatalogItem, LineItem } from './types'

export function emptyCatalogItem(partial: Partial<CatalogItem> = {}): CatalogItem {
  return { id: uid(), name: '', description: '', unit: 'Std.', priceCents: 0, taxRate: 19, archived: false, createdAt: now(), updatedAt: now(), ...partial }
}

export async function saveCatalogItem(item: CatalogItem): Promise<CatalogItem> {
  if (!item.name.trim()) throw new Error('Bitte einen Namen angeben.')
  const saved = { ...item, name: item.name.trim(), updatedAt: now() }
  await db.catalog.put(saved)
  return saved
}

export async function deleteCatalogItem(id: string): Promise<CatalogItem | undefined> {
  const item = await db.catalog.get(id)
  await db.catalog.delete(id)
  return item
}

/** Ranks catalog entries for a search term: name prefix first, then name, then description. */
export function searchCatalog(items: CatalogItem[], query: string): CatalogItem[] {
  const q = query.trim().toLowerCase()
  const active = items.filter((i) => !i.archived)
  if (!q) return [...active].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const score = (i: CatalogItem) => {
    const name = i.name.toLowerCase()
    if (name.startsWith(q)) return 0
    if (name.includes(q)) return 1
    if (i.description.toLowerCase().includes(q)) return 2
    return 3
  }
  return active
    .map((i) => ({ i, s: score(i) }))
    .filter((x) => x.s < 3)
    .sort((a, b) => a.s - b.s || a.i.name.localeCompare(b.i.name, 'de'))
    .map((x) => x.i)
}

export function catalogToLine(item: CatalogItem, smallBusiness: boolean): Omit<LineItem, 'id'> {
  return {
    title: item.name,
    description: item.description,
    quantity: 1,
    unit: item.unit,
    unitPriceCents: item.priceCents,
    taxRate: smallBusiness ? 0 : item.taxRate,
    discountPercent: 0,
  }
}

export function lineToCatalog(line: LineItem): CatalogItem {
  return emptyCatalogItem({ name: line.title, description: line.description, unit: line.unit, priceCents: line.unitPriceCents, taxRate: line.taxRate })
}
