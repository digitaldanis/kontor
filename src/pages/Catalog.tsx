import { t } from '../lib/i18n'
import { useLiveQuery } from 'dexie-react-hooks'
import { Package, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { CatalogItemDialog } from '../components/CatalogDialog'
import { useFeedback } from '../components/feedback'
import { Button, EmptyState, IconButton, PageHeader } from '../components/ui'
import { deleteCatalogItem, emptyCatalogItem, saveCatalogItem, searchCatalog } from '../lib/catalog'
import { db } from '../lib/db'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { formatMoney, formatNumber } from '../lib/money'
import type { CatalogItem } from '../lib/types'

export function Catalog() {
  useDocumentTitle(t('Leistungen'))
  const settings = useSettings()
  const { run, undoable } = useFeedback()
  const items = useLiveQuery(() => db.catalog.toArray(), [])
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<CatalogItem | null>(null)
  const list = searchCatalog(items ?? [], q)

  const create = () => setEditing(emptyCatalogItem({ unit: settings?.defaults.unit ?? 'Std.', taxRate: settings?.smallBusiness ? 0 : (settings?.defaults.taxRate ?? 19), priceCents: settings?.defaults.hourlyRateCents ?? 0 }))

  const remove = async (i: CatalogItem) => {
    await run(() => deleteCatalogItem(i.id))
    undoable(t('„{p0}“ gelöscht', { p0: i.name }), () => db.catalog.put(i))
  }

  return (
    <div className="page">
      <PageHeader
        title={t('Leistungen')}
        subtitle={t('Dein Katalog für wiederkehrende Positionen – im Rechnungseditor per Suche einfügen.')}
        actions={
          <Button variant="primary" icon={Plus} onClick={create}>
            {t('Neue Leistung')}
          </Button>
        }
      />
      {items && items.length > 0 && (
        <div className="toolbar">
          <label className="search">
            <span className="sr-only">{t('Leistungen durchsuchen')}</span>
            <Search size={16} aria-hidden />
            <input className="input" type="search" placeholder={t('Name oder Beschreibung …')} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      )}
      <div className="card">
        {items && items.length === 0 ? (
          <EmptyState icon={Package} title={t('Noch keine Leistungen')} action={<Button variant="primary" icon={Plus} onClick={create}>{t('Erste Leistung anlegen')}</Button>}>
            {t('Lege Leistungen wie „Webdesign“, „Wartungspauschale“ oder „Fahrtkosten“ einmal mit Preis, Einheit und Steuersatz an.')}
          </EmptyState>
        ) : list.length === 0 && items ? (
          <EmptyState icon={Search} title={t('Keine Treffer')} compact>
            {t('Für „{q}“ wurde keine Leistung gefunden.', { q })}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>{t('Leistung')}</th>
                  <th className="hide-sm">{t('Einheit')}</th>
                  <th className="num hide-sm">{t('USt')}</th>
                  <th className="num">{t('Preis netto')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => setEditing(i)}>
                    <td className="primary-cell">
                      <a href="#/leistungen" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(i) }} style={{ color: 'inherit' }}>
                        {i.name}
                      </a>
                      {i.description && <small>{i.description}</small>}
                    </td>
                    <td className="muted hide-sm">{i.unit}</td>
                    <td className="num muted hide-sm">{formatNumber(i.taxRate)} %</td>
                    <td className="num">
                      <strong>{formatMoney(i.priceCents)}</strong>
                    </td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      <IconButton icon={Trash2} label={t('Löschen')} danger onClick={() => remove(i)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <CatalogItemDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSave={async (i) => {
          const saved = await run(() => saveCatalogItem(i), t('Leistung gespeichert'))
          if (saved) setEditing(null)
        }}
      />
    </div>
  )
}
