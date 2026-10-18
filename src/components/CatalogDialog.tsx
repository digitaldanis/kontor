import { t } from '../lib/i18n'
import { useLiveQuery } from 'dexie-react-hooks'
import { Package, Search } from 'lucide-react'
import { useState } from 'react'
import { searchCatalog } from '../lib/catalog'
import { db } from '../lib/db'
import { TAX_RATES, UNITS } from '../lib/defaults'
import { formatMoney } from '../lib/money'
import type { CatalogItem } from '../lib/types'
import { Button, Dialog, EmptyState, Field, MoneyInput, SelectField, TextAreaField, TextField } from './ui'

export function CatalogItemDialog({ item, onClose, onSave }: { item: CatalogItem | null; onClose: () => void; onSave: (i: CatalogItem) => void }) {
  const [draft, setDraft] = useState<CatalogItem | null>(item)
  const [tried, setTried] = useState(false)
  const [lastId, setLastId] = useState(item?.id)
  if (item?.id !== lastId) {
    setLastId(item?.id)
    setDraft(item)
    setTried(false)
  }
  if (!draft) return null
  const set = (patch: Partial<CatalogItem>) => setDraft({ ...draft, ...patch })
  const save = () => {
    setTried(true)
    if (draft.name.trim()) onSave(draft)
  }
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      title={item?.name ? t('Leistung bearbeiten') : t('Neue Leistung')}
      description={t('Gespeicherte Leistungen fügst du im Rechnungseditor per Suche ein.')}
      footer={
        <>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button variant="primary" onClick={save}>
            {t('Speichern')}
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <TextField className="span-6" label={t('Name *')} value={draft.name} onChange={(name) => set({ name })} autoFocus error={tried && !draft.name.trim() ? t('Bitte einen Namen angeben') : null} placeholder={t('z. B. Webdesign')} />
        <TextAreaField className="span-6" label={t('Beschreibung')} value={draft.description} onChange={(description) => set({ description })} rows={2} />
        <Field className="span-2" label={t('Preis netto')}>
          <MoneyInput value={draft.priceCents} onChange={(v) => set({ priceCents: v ?? 0 })} aria-label={t('Preis netto')} />
        </Field>
        <SelectField className="span-2" label={t('Einheit')} value={draft.unit} onChange={(unit) => set({ unit })}>
          {[...new Set([...UNITS, draft.unit])].map((u) => (
            <option key={u}>{u}</option>
          ))}
        </SelectField>
        <SelectField className="span-2" label={t('Steuersatz')} value={String(draft.taxRate)} onChange={(v) => set({ taxRate: Number(v) })}>
          {[...new Set([...TAX_RATES, draft.taxRate])].map((r) => (
            <option key={r} value={r}>
              {r} %
            </option>
          ))}
        </SelectField>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/** Search over the catalog; Enter inserts the first hit. */
export function CatalogPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (i: CatalogItem) => void }) {
  const all = useLiveQuery(() => db.catalog.toArray(), [])
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const hits = searchCatalog(all ?? [], q)
  const pick = (i: CatalogItem | undefined) => {
    if (!i) return
    onPick(i)
    setQ('')
    onClose()
  }
  return (
    <Dialog open={open} onClose={onClose} title={t('Leistung einfügen')} description={t('Aus deinem Leistungskatalog')}>
      {all && all.length === 0 ? (
        <EmptyState icon={Package} title={t('Noch keine Leistungen')} compact>
          {t('Lege unter „Leistungen“ wiederkehrende Positionen mit Preis und Steuersatz an oder speichere eine Position im Editor als Leistung.')}
        </EmptyState>
      ) : (
        <div className="stack-sm">
          <label className="search" style={{ maxWidth: 'none' }}>
            <span className="sr-only">{t('Leistungen suchen')}</span>
            <Search size={16} aria-hidden />
            <input
              className="input"
              type="search"
              placeholder={t('Suchen …')}
              value={q}
              autoFocus
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(hits.length - 1, a + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(0, a - 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  pick(hits[active])
                }
              }}
              aria-controls="catalog-hits"
            />
          </label>
          <ul id="catalog-hits" className="list card" role="listbox" style={{ boxShadow: 'none', border: '1px solid var(--border)', maxHeight: 360, overflowY: 'auto' }}>
            {hits.length === 0 && <li className="list-item muted small">{t('Keine Treffer')}</li>}
            {hits.map((i, idx) => (
              <li key={i.id} role="option" aria-selected={idx === active}>
                <button type="button" className={`list-item picker-item ${idx === active ? 'active' : ''}`} onClick={() => pick(i)} onMouseEnter={() => setActive(idx)}>
                  <span className="grow">
                    <span className="title" style={{ display: 'block' }}>{i.name}</span>
                    {i.description && <span className="sub" style={{ display: 'block' }}>{i.description}</span>}
                  </span>
                  <span className="tabular small">
                    {formatMoney(i.priceCents)} / {i.unit}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  )
}
