import { t, uiLocale } from '../lib/i18n'
import { useLiveQuery } from '../lib/live'
import { ChevronLeft, ChevronRight, Clock, Plus, ReceiptText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BarChart } from '../components/BarChart'
import { BillTimeDialog, TimeEntryDialog, TimeEntryList, TimerCard } from '../components/TimeComponents'
import { emptyEntry } from '../lib/repo'
import { Button, EmptyState, IconButton, PageHeader, Segmented } from '../components/ui'
import { minutesToHours } from '../lib/calc'
import { durationMinutes, formatDuration, formatMonth, isoWeek, startOfMonth, startOfWeek, today, toISODate } from '../lib/dates'
import { db } from '../lib/db'
import { customerName } from '../lib/defaults'
import { useCustomers, useDocumentTitle, useNewParam, useSettings } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import { billableMinutes } from '../lib/projects'
import { entryRate } from '../lib/repo'
import type { TimeEntry } from '../lib/types'
import { ProjectsPanel } from '../components/Projects'
import { useBudgetWarnings } from '../lib/hooks'
import './time.css'

type Period = 'week' | 'month'

function periodRange(period: Period, offset: number): { from: Date; to: Date; label: string; days: Date[] } {
  const now = new Date()
  let from: Date
  let to: Date
  if (period === 'week') {
    from = startOfWeek(now)
    from.setDate(from.getDate() + offset * 7)
    to = new Date(from)
    to.setDate(to.getDate() + 7)
  } else {
    from = startOfMonth(new Date(now.getFullYear(), now.getMonth() + offset, 1))
    to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
  }
  const days: Date[] = []
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) days.push(new Date(d))
  const last = new Date(to.getTime() - 86_400_000)
  const label =
    period === 'week'
      ? `KW ${isoWeek(from)} · ${from.toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}`
      : formatMonth(from)
  return { from, to, label, days }
}

export function TimeTracking() {
  useDocumentTitle(t('Zeiterfassung'))
  const settings = useSettings()
  const customers = useCustomers(true)
  const [period, setPeriod] = useState<Period>('week')
  const [offset, setOffset] = useState(0)
  const [customerFilter, setCustomerFilter] = useState('')
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  const [billing, setBilling] = useState<string | null>(null)
  const range = useMemo(() => periodRange(period, offset), [period, offset])

  const entries = useLiveQuery(
    () => db.timeEntries.where('start').between(range.from.toISOString(), range.to.toISOString()).toArray(),
    [range.from.getTime(), range.to.getTime()],
  )
  const unbilled = useLiveQuery(async () => {
    const all = await db.timeEntries.filter((e) => !e.invoiceId && e.billable).toArray()
    const map = new Map<string, { minutes: number; entries: TimeEntry[] }>()
    for (const e of all) {
      const s = map.get(e.customerId) ?? { minutes: 0, entries: [] }
      s.minutes += durationMinutes(e.start, e.end)
      s.entries.push(e)
      map.set(e.customerId, s)
    }
    return map
  })

  const filtered = (entries ?? []).filter((e) => !customerFilter || e.customerId === customerFilter)
  const total = filtered.reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
  const billable = filtered.filter((e) => e.billable).reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
  const byDay = new Map<string, number>()
  for (const e of filtered) {
    const k = toISODate(new Date(e.start))
    byDay.set(k, (byDay.get(k) ?? 0) + durationMinutes(e.start, e.end))
  }
  const todayKey = today()
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]))

  const unbilledRows = [...(unbilled?.entries() ?? [])]
    .map(([id, s]) => {
      const c = customerById.get(id)
      const amount = settings ? s.entries.reduce((sum, e) => sum + Math.round(minutesToHours(billableMinutes(e, settings.timeRounding)) * entryRate(e, c, settings)), 0) : 0
      return { id, customer: c, minutes: s.minutes, amount }
    })
    .filter((r) => r.customer)
    .sort((a, b) => b.amount - a.amount)

  const activeCustomers = (customers ?? []).filter((c) => !c.archived)
  useNewParam(() => activeCustomers[0] && setEditing(emptyEntry(activeCustomers[0].id)), !!customers)
  const warnings = useBudgetWarnings()

  return (
    <div className="page">
      <PageHeader
        title={t('Zeiterfassung')}
        subtitle={t('Stoppuhr starten oder Zeiten nachtragen – abgerechnet wird später mit einem Klick.')}
        actions={
          activeCustomers.length > 0 && (
            <Button icon={Plus} onClick={() => setEditing(emptyEntry(customerFilter || activeCustomers[0].id))}>
              {t('Zeit nachtragen')}
            </Button>
          )
        }
      />

      <div className="stack">
        <TimerCard />

        {unbilledRows.length > 0 && (
          <section className="card">
            <div className="card-header">
              <h2>{t('Bereit zur Abrechnung')}</h2>
            </div>
            <ul className="list" style={{ marginTop: 8 }}>
              {unbilledRows.map((r) => (
                <li key={r.id} className="list-item">
                  <div className="grow">
                    <div className="title">{customerName(r.customer!)}</div>
                    <div className="sub">
                      {formatDuration(r.minutes)} {t('offen ·')} {formatMoney(r.amount)} {t('netto')}
                    </div>
                  </div>
                  <Button size="sm" icon={ReceiptText} onClick={() => setBilling(r.id)}>
                    {t('Abrechnen')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card">
          <div className="card-header time-toolbar">
            <div className="row" style={{ gap: 4 }}>
              <IconButton icon={ChevronLeft} label={t('Vorheriger Zeitraum')} onClick={() => setOffset(offset - 1)} />
              <IconButton icon={ChevronRight} label={t('Nächster Zeitraum')} onClick={() => setOffset(offset + 1)} />
              <h2 style={{ marginLeft: 6 }}>{range.label}</h2>
              {offset !== 0 && (
                <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
                  {t('Heute')}
                </Button>
              )}
            </div>
            <div className="row wrap">
              {activeCustomers.length > 1 && (
                <select className="select" style={{ width: 'auto', minHeight: 32, paddingTop: 4, paddingBottom: 4 }} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} aria-label={t('Nach Kunde filtern')}>
                  <option value="">{t('Alle Kunden')}</option>
                  {activeCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {customerName(c)}
                    </option>
                  ))}
                </select>
              )}
              <Segmented
                label={t('Zeitraum')}
                value={period}
                onChange={(p) => {
                  setPeriod(p)
                  setOffset(0)
                }}
                options={[
                  { value: 'week', label: t('Woche') },
                  { value: 'month', label: t('Monat') },
                ]}
              />
            </div>
          </div>
          <div className="card-body">
            <div className="time-summary">
              <div>
                <span className="faint small">{t('Gesamt')}</span>
                <strong className="tabular">{formatDuration(total)}</strong>
              </div>
              <div>
                <span className="faint small">{t('Abrechenbar')}</span>
                <strong className="tabular">{formatDuration(billable)}</strong>
              </div>
              <div>
                <span className="faint small">{t('Einträge')}</span>
                <strong className="tabular">{filtered.length}</strong>
              </div>
            </div>
            <div className={period === 'month' ? 'bars-month' : ''}>
              <BarChart
                label={t('Stunden pro Tag, {p0}', { p0: range.label })}
                bars={range.days.map((d) => {
                  const key = toISODate(d)
                  const m = byDay.get(key) ?? 0
                  return {
                    key,
                    value: m,
                    display: formatDuration(m),
                    hint: d.toLocaleDateString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short' }),
                    label: period === 'week' ? d.toLocaleDateString(uiLocale(), { weekday: 'short' }) : d.getDate() % 5 === 0 || d.getDate() === 1 ? String(d.getDate()) : '',
                    current: key === todayKey,
                  }
                })}
              />
            </div>
          </div>
        </section>

        {activeCustomers.length > 0 && (
          <details className="card projects-card">
            <summary className="card-header">
              <h2>{t('Projekte & Budgets')}</h2>
              {!!warnings?.length && <span className="badge orange">{warnings.length > 1 ? t('{n} Warnungen', { n: warnings.length }) : t('1 Warnung')}</span>}
            </summary>
            <ProjectsPanel customers={activeCustomers} showCustomer />
          </details>
        )}

        {filtered.length === 0 ? (
          <div className="card">
            <EmptyState icon={Clock} title={t('Keine Zeiten in diesem Zeitraum')} compact>
              {t('Starte oben die Stoppuhr oder trage eine Zeit nach. Jeder Eintrag bekommt eine kurze Beschreibung, damit später klar ist, was gemacht wurde.')}
            </EmptyState>
          </div>
        ) : (
          <div className="card">
            <TimeEntryList entries={filtered} customers={customers ?? []} onEdit={setEditing} />
          </div>
        )}
      </div>

      <TimeEntryDialog entry={editing} onClose={() => setEditing(null)} />
      <BillTimeDialog customerId={billing} open={!!billing} onClose={() => setBilling(null)} />
    </div>
  )
}
