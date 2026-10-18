import { describe, expect, it } from 'vitest'
import { catalogToLine, emptyCatalogItem, searchCatalog } from '../catalog'

const items = [
  emptyCatalogItem({ name: 'Webdesign', description: 'Gestaltung' }),
  emptyCatalogItem({ name: 'Hosting', description: 'Webspace und Domain' }),
  emptyCatalogItem({ name: 'Beratung Web', description: '' }),
  emptyCatalogItem({ name: 'Alt', archived: true }),
]

describe('catalog search', () => {
  it('ranks prefix matches before other matches', () => {
    expect(searchCatalog(items, 'web').map((i) => i.name)).toEqual(['Webdesign', 'Beratung Web', 'Hosting'])
  })

  it('hides archived entries and sorts by name without a query', () => {
    expect(searchCatalog(items, '').map((i) => i.name)).toEqual(['Beratung Web', 'Hosting', 'Webdesign'])
  })

  it('turns an entry into a line item, without VAT for small businesses', () => {
    const line = catalogToLine(emptyCatalogItem({ name: 'X', priceCents: 1200, taxRate: 7, unit: 'Stk.' }), true)
    expect(line).toMatchObject({ title: 'X', unitPriceCents: 1200, taxRate: 0, unit: 'Stk.', quantity: 1 })
  })
})
