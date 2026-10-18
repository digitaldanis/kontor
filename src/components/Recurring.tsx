import { useLiveQuery } from 'dexie-react-hooks'
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
import { INTERVAL_LABELS, intervalText, newRecurring, runRecurring, saveRecurring } from '../lib/recurring'
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
        introText: settings.defaults.introText,
        closingText: settings.defaults.closingText,
        footerText: settings.defaults.footerText,
        currency: settings.defaults.currency,
        language: 'de',
        layout: settings.defaults.layout,
        accentColor: settings.defaults.accentColor,
        buyerReference: '',
        discount: null,
      }, today()),
    )
  }

  const remove = async (r: RecurringInvoice) => {
    await run(() => db.recurring.delete(r.id))
    undoable(`Serie „${r.name}“ gelöscht`, () => db.recurring.put(r))
  }

  const sorted = [...(list ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.nextRun.localeCompare(b.nextRun))

  return (
    <>
      <div className="card">
        {list && list.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="Keine Serienrechnungen"
            action={
              active.length ? (
                <Button variant="primary" icon={Plus} onClick={create}>
                  Serie anlegen
                </Button>
              ) : (
                <Link to="/kunden" className="btn primary">Zuerst einen Kunden anlegen</Link>
              )
            }
          >
            Für Wartungsverträge, Hosting oder Retainer: Kontor legt zum Stichtag automatisch einen Entwurf an, den du nur noch prüfst und abschließt.
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
                        {[c ? customerName(c) : 'Kunde fehlt', intervalText(r.interval, r.every), r.active ? `nächster Entwurf ${formatDate(r.nextRun)}` : 'pausiert'].join(' · ')}
                      </span>
                    </button>
                    <strong className="tabular">{formatMoney(net, r.template.currency)}</strong>
                    <span className="small faint hide-sm">netto</span>
                    <IconButton
                      icon={r.active ? Pause : Play}
                      label={r.active ? 'Pausieren' : 'Fortsetzen'}
                      onClick={() => run(() => db.recurring.update(r.id, { active: !r.active, updatedAt: now() }), r.active ? 'Serie pausiert' : 'Serie läuft wieder')}
                    />
                    <IconButton icon={Trash2} label="Löschen" danger onClick={() => remove(r)} />
                  </li>
                )
              })}
            </ul>
            <div className="card-body row wrap">
              <Button icon={Plus} onClick={create} disabled={!active.length}>
                Serie anlegen
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  const created = await run(() => runRecurring(today()))
                  if (created) toast(created.length ? `${created.length} Entwürfe erstellt` : 'Keine Serie ist heute fällig')
                }}
              >
                Jetzt prüfen
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
    const saved = await run(() => saveRecurring(draft), 'Serie gespeichert')
    if (saved) {
      onClose()
      const created = await runRecurring(today())
      if (created.length) toast(`${created.length} Entwurf${created.length > 1 ? 'e' : ''} erstellt`)
    }
  }

  return (
    <Dialog
      open={!!rec}
      onClose={onClose}
      wide
      title={rec?.createdAt === rec?.updatedAt && !started ? 'Neue Serienrechnung' : 'Serienrechnung'}
      description="Zum Stichtag entsteht ein Entwurf mit dem jeweiligen Leistungszeitraum. Platzhalter {Monat}, {Jahr}, {Quartal} und {Zeitraum} werden ersetzt."
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <TextField className="span-3" label="Bezeichnung" value={draft.name} onChange={(name) => set({ name })} />
          <SelectField className="span-3" label="Kunde" value={draft.customerId} onChange={(customerId) => set({ customerId })}>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {customerName(c)}
              </option>
            ))}
          </SelectField>
          <SelectField className="span-2" label="Intervall" value={draft.interval} onChange={(v) => set({ interval: v as RecurringInterval })} disabled={started}>
            {(Object.keys(INTERVAL_LABELS) as RecurringInterval[]).map((k) => (
              <option key={k} value={k}>
                {INTERVAL_LABELS[k]}
              </option>
            ))}
          </SelectField>
          <Field className="span-1" label="Alle">
            <NumberInput value={draft.every} onChange={(n) => set({ every: Math.max(1, Math.round(n)) })} maxFraction={0} aria-label="Intervall-Faktor" disabled={started} />
          </Field>
          <TextField className="span-3" label={started ? 'Gestartet am' : 'Erster Entwurf am'} type="date" value={draft.startDate} onChange={(startDate) => set({ startDate })} disabled={started} hint={started ? `Nächster Entwurf: ${formatDate(draft.nextRun)}` : undefined} />
          <TextField className="span-3" label="Endet am" type="date" value={draft.endDate} onChange={(endDate) => set({ endDate })} hint="optional" />
          <div className="span-3" style={{ alignSelf: 'center' }}>
            <Toggle checked={draft.active} onChange={(active) => set({ active })} label="Aktiv" />
          </div>
        </div>

        <div className="stack-sm">
          <strong>Positionen</strong>
          {draft.template.items.map((i) => (
            <div key={i.id} className="form-grid recurring-item">
              <TextField className="span-3" label="Bezeichnung" value={i.title} onChange={(title) => patchItem(i.id, { title })} />
              <Field className="span-1" label="Menge">
                <NumberInput value={i.quantity} onChange={(quantity) => patchItem(i.id, { quantity })} aria-label="Menge" />
              </Field>
              <Field className="span-1" label="Preis">
                <MoneyInput value={i.unitPriceCents} onChange={(v) => patchItem(i.id, { unitPriceCents: v ?? 0 })} aria-label="Einzelpreis" />
              </Field>
              <SelectField className="span-1" label="USt" value={String(i.taxRate)} onChange={(v) => patchItem(i.id, { taxRate: Number(v) })} disabled={settings.smallBusiness}>
                {[...new Set([...TAX_RATES, i.taxRate])].map((r) => (
                  <option key={r} value={r}>
                    {r} %
                  </option>
                ))}
              </SelectField>
              <TextAreaField className="span-6" label="Beschreibung" value={i.description} onChange={(description) => patchItem(i.id, { description })} rows={1} />
              <div className="span-6 row" style={{ justifyContent: 'flex-end' }}>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setItems(draft.template.items.filter((x) => x.id !== i.id))}>
                  Entfernen
                </Button>
              </div>
            </div>
          ))}
          <div className="row wrap">
            <Button size="sm" icon={Plus} onClick={() => setItems([...draft.template.items, newLineItem(settings)])}>
              Position
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
              Aus Leistungen
            </Button>
            <span className="spacer" />
            <span className="small muted">{formatMoney(calculateTotals(draft.template.items).netCents, draft.template.currency)} netto je Rechnung</span>
          </div>
        </div>
      </div>
      <CatalogPicker open={picking} onClose={() => setPicking(false)} onPick={(c) => setItems([...draft.template.items, newLineItem(settings, catalogToLine(c, settings.smallBusiness))])} />
    </Dialog>
  )
}
