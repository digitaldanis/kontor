import { t } from '../lib/i18n'
import { runRecurring, saveRecurring } from '../lib/actions'
import { useLiveQuery } from '../lib/live'
import { Pause, Play, Plus, Repeat, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { calculateTotals } from '../lib/calc'
import { catalogToLine } from '../lib/catalog'
import { formatDate, today } from '../lib/dates'
import { db, now } from '../lib/db'
import { customerName, TAX_RATES } from '../lib/defaults'
import { useCustomers, useSettings } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import { INTERVAL_LABELS, intervalText, newRecurring } from '../lib/recurring'
import { newLineItem } from '../lib/repo'
import type { LineItem, RecurringInterval, RecurringInvoice } from '../lib/types'
import { CatalogPicker } from './CatalogDialog'
import { useFeedback } from './feedback'
import { Button, Dialog, EmptyState, Field, IconButton, MoneyInput, NumberInput, SelectField, TextAreaField, TextField, Toggle } from './ui'

export function RecurringList() {
  const settings = useSettings()
  const customers = useCustomers(true)
  const { run, undoable, toast } = useFeedback()
  const list = useLiveQuery(() => db.recurring.toArray(), [])
  const [editing, setEditing] = useState<RecurringInvoice | null>(null)
  const byId = new Map((customers ?? []).map((c) => [c.id, c]))
  const active = (customers ?? []).filter((c) => !c.archived)

  const create = () => {
    if (!settings || !active.length) return
    setEditing(
      newRecurring(active[0].id, {
        title: 'Rechnung',
        items: [newLineItem(settings, { title: 'Monatliche Pauschale {Monat} {Jahr}', unit: 'Monat' })],
        introText: settings.texts[settings.documentLanguage].intro,
        closingText: settings.texts[settings.documentLanguage].closing,
        footerText: settings.defaults.footerText,
        currency: settings.defaults.currency,
        language: settings.documentLanguage,
        layout: settings.defaults.layout,
        accentColor: settings.defaults.accentColor,
        buyerReference: '',
        discount: null,
      }, today()),
    )
  }

  const remove = async (r: RecurringInvoice) => {
    await run(() => db.recurring.delete(r.id))
    undoable(t('Serie „{p0}“ gelöscht', { p0: r.name }), () => db.recurring.put(r))
  }

  const sorted = [...(list ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.nextRun.localeCompare(b.nextRun))

  return (
    <>
      <div className="card">
        {list && list.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title={t('Keine Serienrechnungen')}
            action={
              active.length ? (
                <Button variant="primary" icon={Plus} onClick={create}>
                  {t('Serie anlegen')}
                </Button>
              ) : (
                <Link to="/kunden" className="btn primary">{t('Zuerst einen Kunden anlegen')}</Link>
              )
            }
          >
            {t('Für Wartungsverträge, Hosting oder Retainer: Kontor legt zum Stichtag automatisch einen Entwurf an, den du nur noch prüfst und abschließt.')}
          </EmptyState>
        ) : (
          <>
            <ul className="list">
              {sorted.map((r) => {
                const c = byId.get(r.customerId)
                const net = calculateTotals(r.template.items).netCents
                return (
                  <li key={r.id} className="list-item">
                    <button type="button" className="grow plain-button" onClick={() => setEditing(r)}>
                      <span className="title" style={{ display: 'block' }}>{r.name}</span>
                      <span className="sub" style={{ display: 'block' }}>
                        {[c ? customerName(c) : t('Kunde fehlt'), intervalText(r.interval, r.every), r.active ? t('nächster Entwurf {p0}', { p0: formatDate(r.nextRun) }) : t('pausiert')].join(' · ')}
                      </span>
                    </button>
                    <strong className="tabular">{formatMoney(net, r.template.currency)}</strong>
                    <span className="small faint hide-sm">{t('netto')}</span>
                    <IconButton
                      icon={r.active ? Pause : Play}
                      label={r.active ? t('Pausieren') : t('Fortsetzen')}
                      onClick={() => run(() => db.recurring.update(r.id, { active: !r.active, updatedAt: now() }), r.active ? t('Serie pausiert') : t('Serie läuft wieder'))}
                    />
                    <IconButton icon={Trash2} label={t('Löschen')} danger onClick={() => remove(r)} />
                  </li>
                )
              })}
            </ul>
            <div className="card-body row wrap">
              <Button icon={Plus} onClick={create} disabled={!active.length}>
                {t('Serie anlegen')}
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  const created = await run(() => runRecurring(today()))
                  if (created) toast(created.length ? t('{p0} Entwürfe erstellt', { p0: created.length }) : t('Keine Serie ist heute fällig'))
                }}
              >
                {t('Jetzt prüfen')}
              </Button>
            </div>
          </>
        )}
      </div>
      <RecurringDialog rec={editing} onClose={() => setEditing(null)} />
    </>
  )
}

export function RecurringDialog({ rec, onClose }: { rec: RecurringInvoice | null; onClose: () => void }) {
  const settings = useSettings()
  const customers = useCustomers()
  const { run, toast } = useFeedback()
  const [draft, setDraft] = useState<RecurringInvoice | null>(rec)
  const [lastId, setLastId] = useState(rec?.id)
  const [picking, setPicking] = useState(false)
  if (rec?.id !== lastId) {
    setLastId(rec?.id)
    setDraft(rec)
  }
  if (!draft || !settings) return null
  const set = (patch: Partial<RecurringInvoice>) => setDraft({ ...draft, ...patch })
  const setItems = (items: LineItem[]) => set({ template: { ...draft.template, items } })
  const patchItem = (id: string, p: Partial<LineItem>) => setItems(draft.template.items.map((i) => (i.id === id ? { ...i, ...p } : i)))
  const started = draft.runs > 0

  const save = async () => {
    const saved = await run(() => saveRecurring(draft), t('Serie gespeichert'))
    if (saved) {
      onClose()
      const created = await runRecurring(today())
      if (created.length) toast(t('{p0} Entwurf{p1} erstellt', { p0: created.length, p1: created.length > 1 ? 'e' : '' }))
    }
  }

  return (
    <Dialog
      open={!!rec}
      onClose={onClose}
      wide
      title={rec?.createdAt === rec?.updatedAt && !started ? t('Neue Serienrechnung') : t('Serienrechnung')}
      description={t('Zum Stichtag entsteht ein Entwurf mit dem jeweiligen Leistungszeitraum. Platzhalter {Monat}, {Jahr}, {Quartal} und {Zeitraum} werden ersetzt.')}
      footer={
        <>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button variant="primary" onClick={save}>
            {t('Speichern')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <TextField className="span-3" label={t('Bezeichnung')} value={draft.name} onChange={(name) => set({ name })} />
          <SelectField className="span-3" label={t('Kunde')} value={draft.customerId} onChange={(customerId) => set({ customerId })}>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {customerName(c)}
              </option>
            ))}
          </SelectField>
          <SelectField className="span-2" label={t('Intervall')} value={draft.interval} onChange={(v) => set({ interval: v as RecurringInterval })} disabled={started}>
            {(Object.keys(INTERVAL_LABELS) as RecurringInterval[]).map((k) => (
              <option key={k} value={k}>
                {t(INTERVAL_LABELS[k])}
              </option>
            ))}
          </SelectField>
          <Field className="span-1" label={t('Alle')}>
            <NumberInput value={draft.every} onChange={(n) => set({ every: Math.max(1, Math.round(n)) })} maxFraction={0} aria-label={t('Intervall-Faktor')} disabled={started} />
          </Field>
          <TextField className="span-3" label={started ? t('Gestartet am') : t('Erster Entwurf am')} type="date" value={draft.startDate} onChange={(startDate) => set({ startDate })} disabled={started} hint={started ? t('Nächster Entwurf: {p0}', { p0: formatDate(draft.nextRun) }) : undefined} />
          <TextField className="span-3" label={t('Endet am')} type="date" value={draft.endDate} onChange={(endDate) => set({ endDate })} hint={t('optional')} />
          <div className="span-3" style={{ alignSelf: 'center' }}>
            <Toggle checked={draft.active} onChange={(active) => set({ active })} label={t('Aktiv')} />
          </div>
        </div>

        <div className="stack-sm">
          <strong>{t('Positionen')}</strong>
          {draft.template.items.map((i) => (
            <div key={i.id} className="form-grid recurring-item">
              <TextField className="span-3" label={t('Bezeichnung')} value={i.title} onChange={(title) => patchItem(i.id, { title })} />
              <Field className="span-1" label={t('Menge')}>
                <NumberInput value={i.quantity} onChange={(quantity) => patchItem(i.id, { quantity })} aria-label={t('Menge')} />
              </Field>
              <Field className="span-1" label={t('Preis')}>
                <MoneyInput value={i.unitPriceCents} onChange={(v) => patchItem(i.id, { unitPriceCents: v ?? 0 })} aria-label={t('Einzelpreis')} />
              </Field>
              <SelectField className="span-1" label={t('USt')} value={String(i.taxRate)} onChange={(v) => patchItem(i.id, { taxRate: Number(v) })} disabled={settings.smallBusiness}>
                {[...new Set([...TAX_RATES, i.taxRate])].map((r) => (
                  <option key={r} value={r}>
                    {r} %
                  </option>
                ))}
              </SelectField>
              <TextAreaField className="span-6" label={t('Beschreibung')} value={i.description} onChange={(description) => patchItem(i.id, { description })} rows={1} />
              <div className="span-6 row" style={{ justifyContent: 'flex-end' }}>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setItems(draft.template.items.filter((x) => x.id !== i.id))}>
                  {t('Entfernen')}
                </Button>
              </div>
            </div>
          ))}
          <div className="row wrap">
            <Button size="sm" icon={Plus} onClick={() => setItems([...draft.template.items, newLineItem(settings)])}>
              {t('Position')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
              {t('Aus Leistungen')}
            </Button>
            <span className="spacer" />
            <span className="small muted">{formatMoney(calculateTotals(draft.template.items).netCents, draft.template.currency)} {t('netto je Rechnung')}</span>
          </div>
        </div>
      </div>
      <CatalogPicker open={picking} onClose={() => setPicking(false)} onPick={(c) => setItems([...draft.template.items, newLineItem(settings, catalogToLine(c, settings.smallBusiness))])} />
    </Dialog>
  )
}
