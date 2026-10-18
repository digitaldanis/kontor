import { useLiveQuery } from 'dexie-react-hooks'
import { Clock, Pencil, Play, ReceiptText, Square, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { calculateTotals, minutesToHours } from '../lib/calc'
import {
  combineDateTime,
  durationMinutes,
  formatClock,
  formatDate,
  formatDuration,
  formatLongDate,
  formatTime,
  timeOfDay,
  today,
  toISODate,
} from '../lib/dates'
import { db, now, uid } from '../lib/db'
import { customerName } from '../lib/defaults'
import { useCustomers, useNow, useSettings, useTimer } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import {
  deleteTimeEntry,
  discardTimer,
  entryRate,
  invoiceTimeEntries,
  saveTimeEntry,
  startTimer,
  stopTimer,
  updateTimer,
  type TimeGrouping,
} from '../lib/repo'
import type { Customer, RunningTimer, TimeEntry } from '../lib/types'
import { useFeedback } from './feedback'
import { Button, Dialog, EmptyState, Field, IconButton, MoneyInput, Segmented, SelectField, TextAreaField, TextField, Toggle } from './ui'

function useProjects(customerId: string) {
  return useLiveQuery(async () => {
    if (!customerId) return []
    const entries = await db.timeEntries.where('customerId').equals(customerId).toArray()
    return [...new Set(entries.map((e) => e.project).filter(Boolean))].sort()
  }, [customerId]) ?? []
}

export function TimerCard({ defaultCustomerId }: { defaultCustomerId?: string }) {
  const timer = useTimer()
  const customers = useCustomers()
  const { run } = useFeedback()
  const navigate = useNavigate()
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? '')
  const [project, setProject] = useState('')
  const [description, setDescription] = useState('')
  const [billable, setBillable] = useState(true)
  const projects = useProjects(customerId)

  useEffect(() => {
    if (!customerId && customers?.length) setCustomerId(defaultCustomerId ?? customers[0].id)
  }, [customers, customerId, defaultCustomerId])

  if (customers && customers.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={Clock} title="Zuerst einen Kunden anlegen" compact action={<Button variant="primary" onClick={() => navigate('/kunden')}>Zu den Kunden</Button>}>
          Zeiten werden immer einem Kunden zugeordnet, damit du sie später abrechnen kannst.
        </EmptyState>
      </div>
    )
  }

  if (timer) return <RunningTimerCard timer={timer} customer={customers?.find((c) => c.id === timer.customerId)} />

  return (
    <div className="card card-pad timer-card">
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          if (!customerId) return
          run(() => startTimer({ customerId, project, description, billable }))
          setDescription('')
        }}
      >
        <SelectField className="span-2" label="Kunde" value={customerId} onChange={setCustomerId}>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>
              {customerName(c)}
            </option>
          ))}
        </SelectField>
        <TextField className="span-2" label="Tätigkeit" value={description} onChange={setDescription} placeholder="Woran arbeitest du?" />
        <Field className="span-2" label="Projekt">
          <input className="input" list="start-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="optional" />
        </Field>
        <datalist id="start-projects">
          {projects.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <div className="span-6 row wrap between">
          <Toggle checked={billable} onChange={setBillable} label="Abrechenbar" />
          <Button type="submit" variant="success" size="lg" icon={Play} disabled={!customerId}>
            Stoppuhr starten
          </Button>
        </div>
      </form>
    </div>
  )
}

function RunningTimerCard({ timer, customer }: { timer: RunningTimer; customer?: Customer }) {
  const { run, toast } = useFeedback()
  const nowMs = useNow(true)
  const projects = useProjects(timer.customerId)
  const [description, setDescription] = useState(timer.description)
  const [project, setProject] = useState(timer.project)

  useEffect(() => {
    if (description === timer.description && project === timer.project) return
    const t = setTimeout(() => updateTimer({ description, project }), 300)
    return () => clearTimeout(t)
  }, [description, project, timer.description, timer.project])

  const seconds = (nowMs - new Date(timer.startedAt).getTime()) / 1000

  return (
    <div className="card card-pad timer-card running">
      <div className="timer-display">
        <span className="pulse" aria-hidden />
        <span className="timer-clock" role="timer" aria-label="Laufende Zeit">
          {formatClock(seconds)}
        </span>
        <span className="muted small">
          seit {formatTime(timer.startedAt)} Uhr · {customer ? customerName(customer) : 'Kunde'}
        </span>
      </div>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <TextField className="span-4" label="Was machst du gerade?" value={description} onChange={setDescription} placeholder="z. B. Startseite gestalten" />
        <Field className="span-2" label="Projekt">
          <input className="input" list="timer-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="optional" />
        </Field>
      </div>
      <datalist id="timer-projects">
        {projects.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="row wrap" style={{ marginTop: 16 }}>
        <Button
          variant="danger"
          size="lg"
          icon={Square}
          onClick={() =>
            run(async () => {
              await updateTimer({ description, project })
              const entry = await stopTimer()
              toast(entry ? `${formatDuration(durationMinutes(entry.start, entry.end))} gespeichert` : 'Unter einer Minute – nicht gespeichert')
            })
          }
        >
          Stoppen
        </Button>
        <Button variant="ghost" icon={X} onClick={() => run(discardTimer, 'Stoppuhr verworfen')}>
          Verwerfen
        </Button>
      </div>
    </div>
  )
}

export function emptyEntry(customerId: string): TimeEntry {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(Math.max(8, start.getHours() - 1))
  const end = new Date(start.getTime() + 60 * 60_000)
  return {
    id: uid(),
    customerId,
    project: '',
    description: '',
    details: '',
    start: start.toISOString(),
    end: end.toISOString(),
    billable: true,
    rateCents: null,
    invoiceId: null,
    createdAt: now(),
    updatedAt: now(),
  }
}

export function TimeEntryDialog({ entry, onClose }: { entry: TimeEntry | null; onClose: () => void }) {
  const customers = useCustomers()
  const { run } = useFeedback()
  const [e, setE] = useState<TimeEntry | null>(entry)
  const [date, setDate] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tried, setTried] = useState(false)
  const projects = useProjects(e?.customerId ?? '')

  useEffect(() => {
    setE(entry)
    setTried(false)
    if (entry) {
      setDate(toISODate(new Date(entry.start)))
      setFrom(timeOfDay(entry.start))
      setTo(timeOfDay(entry.end))
    }
  }, [entry])

  if (!e) return null
  const locked = !!e.invoiceId
  const start = date && from ? combineDateTime(date, from) : e.start
  let end = date && to ? combineDateTime(date, to) : e.end
  // past midnight
  if (end <= start && to) end = new Date(new Date(end).getTime() + 86_400_000).toISOString()
  const minutes = durationMinutes(start, end)

  const save = async () => {
    setTried(true)
    if (!e.description.trim() || !e.customerId || minutes <= 0) return
    const ok = await run(async () => {
      await saveTimeEntry({ ...e, start, end })
      return true
    }, 'Zeiteintrag gespeichert')
    if (ok) onClose()
  }

  return (
    <Dialog
      open={!!entry}
      onClose={onClose}
      wide
      title={entry && entry.createdAt === entry.updatedAt && !entry.invoiceId ? 'Zeit erfassen' : 'Zeiteintrag'}
      description={locked ? 'Dieser Eintrag ist bereits einer Rechnung zugeordnet und kann nur eingeschränkt geändert werden.' : undefined}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(ev) => {
          ev.preventDefault()
          save()
        }}
      >
        <SelectField className="span-3" label="Kunde" value={e.customerId} onChange={(customerId) => setE({ ...e, customerId })} disabled={locked}>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>
              {customerName(c)}
            </option>
          ))}
        </SelectField>
        <Field className="span-3" label="Projekt">
          <input className="input" list="entry-projects" value={e.project} onChange={(ev) => setE({ ...e, project: ev.target.value })} placeholder="optional" />
        </Field>
        <datalist id="entry-projects">
          {projects.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <TextField className="span-6" label="Tätigkeit *" value={e.description} onChange={(description) => setE({ ...e, description })} placeholder="z. B. Abstimmung Konzept" error={tried && !e.description.trim() ? 'Bitte beschreiben, was gemacht wurde' : null} autoFocus />
        <TextAreaField className="span-6" label="Details" value={e.details} onChange={(details) => setE({ ...e, details })} rows={2} placeholder="Was genau wurde gemacht? Erscheint auf Wunsch in der Rechnung." />
        <TextField className="span-2" label="Datum" type="date" value={date} onChange={setDate} disabled={locked} />
        <TextField className="span-1" label="Von" type="time" value={from} onChange={setFrom} disabled={locked} />
        <TextField className="span-1" label="Bis" type="time" value={to} onChange={setTo} disabled={locked} />
        <Field className="span-2" label="Dauer">
          <div className="input tabular" aria-live="polite" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-3)', color: minutes > 0 ? undefined : 'var(--red)' }}>
            {minutes > 0 ? formatDuration(minutes) : 'Ungültig'}
          </div>
        </Field>
        <Field className="span-3" label="Abweichender Stundensatz" hint="Leer = Satz des Kunden">
          <MoneyInput value={e.rateCents} onChange={(rateCents) => setE({ ...e, rateCents })} allowEmpty placeholder="Kundensatz" disabled={locked} aria-label="Stundensatz" />
        </Field>
        <div className="span-3" style={{ alignSelf: 'center' }}>
          <Toggle checked={e.billable} onChange={(billable) => setE({ ...e, billable })} label="Abrechenbar" description="Nicht abrechenbare Zeiten zählen nur für die Statistik." />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export function TimeEntryList({
  entries,
  customers,
  onEdit,
  showCustomer = true,
}: {
  entries: TimeEntry[]
  customers: Customer[]
  onEdit: (e: TimeEntry) => void
  showCustomer?: boolean
}) {
  const settings = useSettings()
  const { run, confirm } = useFeedback()
  const navigate = useNavigate()
  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const days = useMemo(() => {
    const map = new Map<string, TimeEntry[]>()
    for (const e of [...entries].sort((a, b) => b.start.localeCompare(a.start))) {
      const key = toISODate(new Date(e.start))
      map.set(key, [...(map.get(key) ?? []), e])
    }
    return [...map.entries()]
  }, [entries])

  if (!settings) return null

  return (
    <div className="time-days">
      {days.map(([day, list]) => {
        const total = list.reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
        return (
          <section key={day} className="time-day">
            <header className="time-day-header">
              <h3>{day === today() ? 'Heute' : formatLongDate(day)}</h3>
              <span className="muted tabular small">{formatDuration(total)}</span>
            </header>
            <ul className="list">
              {list.map((e) => {
                const c = byId.get(e.customerId)
                const minutes = durationMinutes(e.start, e.end)
                const rate = entryRate(e, c, settings)
                return (
                  <li key={e.id} className="list-item time-entry">
                    <div className="grow">
                      <div className="title">{e.description}</div>
                      <div className="sub">
                        {[showCustomer && c ? customerName(c) : '', e.project, `${formatTime(e.start)}–${formatTime(e.end)}`].filter(Boolean).join(' · ')}
                      </div>
                      {e.details && <div className="sub" style={{ whiteSpace: 'normal' }}>{e.details}</div>}
                    </div>
                    <div className="right">
                      <div className="tabular" style={{ fontWeight: 600 }}>{formatDuration(minutes)}</div>
                      <div className="small">
                        {e.invoiceId ? (
                          <button type="button" className="badge green plain" style={{ border: 0, cursor: 'pointer' }} onClick={() => navigate(`/rechnungen/${e.invoiceId}`)}>
                            abgerechnet
                          </button>
                        ) : e.billable ? (
                          <span className="faint tabular">{formatMoney(Math.round((minutesToHours(minutes) * rate)))}</span>
                        ) : (
                          <span className="faint">nicht abrechenbar</span>
                        )}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 2 }}>
                      <IconButton icon={Pencil} label="Bearbeiten" onClick={() => onEdit(e)} />
                      <IconButton
                        icon={Trash2}
                        label="Löschen"
                        danger
                        disabled={!!e.invoiceId}
                        onClick={async () => {
                          if (await confirm({ title: 'Zeiteintrag löschen?', message: `„${e.description}“ (${formatDuration(minutes)}) wird entfernt.`, confirmLabel: 'Löschen', danger: true }))
                            run(() => deleteTimeEntry(e.id), 'Eintrag gelöscht')
                        }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

export function BillTimeDialog({ customerId, open, onClose }: { customerId: string | null; open: boolean; onClose: () => void }) {
  const settings = useSettings()
  const navigate = useNavigate()
  const { run } = useFeedback()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [grouping, setGrouping] = useState<TimeGrouping>('entry')
  const [target, setTarget] = useState('new')
  const data = useLiveQuery(async () => {
    if (!customerId) return null
    const [customer, entries, drafts] = await Promise.all([
      db.customers.get(customerId),
      db.timeEntries.where('customerId').equals(customerId).filter((e) => !e.invoiceId && e.billable).toArray(),
      db.documents.where('customerId').equals(customerId).filter((d) => d.status === 'draft' && d.kind === 'invoice').toArray(),
    ])
    return { customer, entries: entries.sort((a, b) => a.start.localeCompare(b.start)), drafts }
  }, [customerId])

  useEffect(() => {
    if (open && data) setSelected(new Set(data.entries.map((e) => e.id)))
    if (open) setTarget('new')
    // only when the dialog opens or the customer changes
  }, [open, data?.entries.length, customerId])

  if (!data || !settings) return null
  const chosen = data.entries.filter((e) => selected.has(e.id))
  const minutes = chosen.reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
  const amount = calculateTotals(
    chosen.map((e) => ({ id: e.id, title: '', description: '', unit: '', taxRate: 0, discountPercent: 0, quantity: minutesToHours(durationMinutes(e.start, e.end)), unitPriceCents: entryRate(e, data.customer, settings) })),
  ).netCents

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const submit = async () => {
    if (!customerId) return
    const doc = await run(() => invoiceTimeEntries(customerId, [...selected], grouping, target === 'new' ? undefined : target), 'Positionen übernommen')
    if (doc) {
      onClose()
      navigate(`/rechnungen/${doc.id}`)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Zeiten abrechnen"
      description={data.customer ? `Offene Zeiten für ${customerName(data.customer)} als Rechnungspositionen übernehmen.` : undefined}
      footer={
        <>
          <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            {chosen.length} Einträge · {formatDuration(minutes)} · {formatMoney(amount)} netto
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon={ReceiptText} onClick={submit} disabled={!chosen.length}>
            In Rechnung übernehmen
          </Button>
        </>
      }
    >
      {data.entries.length === 0 ? (
        <EmptyState icon={Clock} title="Alles abgerechnet" compact>
          Für diesen Kunden gibt es keine offenen, abrechenbaren Zeiten.
        </EmptyState>
      ) : (
        <div className="stack">
          <div className="row wrap between">
            <Segmented
              label="Positionen"
              value={grouping}
              onChange={setGrouping}
              options={[
                { value: 'entry', label: 'Je Eintrag' },
                { value: 'day', label: 'Je Tag' },
                { value: 'project', label: 'Je Projekt' },
              ]}
            />
            {data.drafts.length > 0 && (
              <select className="select" style={{ width: 'auto' }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Ziel">
                <option value="new">Neue Rechnung</option>
                {data.drafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    Zu Entwurf vom {formatDate(d.issueDate)} hinzufügen
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
            <ul className="list">
              <li className="list-item" style={{ padding: '10px 16px' }}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={selected.size === data.entries.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(data.entries.map((x) => x.id)) : new Set())}
                  aria-label="Alle auswählen"
                />
                <span className="grow small muted">Alle auswählen</span>
              </li>
              {data.entries.map((e) => {
                const m = durationMinutes(e.start, e.end)
                return (
                  <li key={e.id}>
                    <label className="list-item" style={{ padding: '10px 16px', cursor: 'pointer' }}>
                      <input type="checkbox" className="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                      <span className="grow">
                        <span className="title" style={{ display: 'block' }}>{e.description}</span>
                        <span className="sub" style={{ display: 'block' }}>{[formatDate(e.start), e.project, e.details].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="tabular right">
                        {formatDuration(m)}
                        <span className="faint small" style={{ display: 'block' }}>{formatMoney(entryRate(e, data.customer, settings))}/h</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  )
}
