import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, ChevronLeft, ChevronRight, Download, Info } from 'lucide-react'
import { useState } from 'react'
import { BarChart } from '../components/BarChart'
import { useFeedback } from '../components/feedback'
import { Button, EmptyState, IconButton, PageHeader, Segmented, Stat } from '../components/ui'
import { downloadFile, invoicesToCsv } from '../lib/backup'
import { calculateTotals } from '../lib/calc'
import { durationMinutes, formatDuration, toISODate } from '../lib/dates'
import { db } from '../lib/db'
import { customerName, recipientName, TAX_MODE_LABELS } from '../lib/defaults'
import { useDocumentTitle } from '../lib/hooks'
import { formatMoney, formatNumber } from '../lib/money'
import { countsAsRevenue } from '../lib/status'
import type { TaxMode } from '../lib/types'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export function Reports() {
  useDocumentTitle('Berichte')
  const { run } = useFeedback()
  const [year, setYear] = useState(new Date().getFullYear())
  const [taxPeriod, setTaxPeriod] = useState<'month' | 'quarter'>('quarter')
  const data = useLiveQuery(async () => {
    const [docs, entries, customers] = await Promise.all([db.documents.toArray(), db.timeEntries.toArray(), db.customers.toArray()])
    return { docs, entries, customers }
  })

  if (!data) return <div className="page" />
  const y = String(year)
  const docs = data.docs.filter((d) => countsAsRevenue(d) && d.issueDate.startsWith(y))
  const entries = data.entries.filter((e) => toISODate(new Date(e.start)).startsWith(y))
  const customerById = new Map(data.customers.map((c) => [c.id, c]))

  const monthly = MONTHS.map((label, i) => {
    const key = `${y}-${String(i + 1).padStart(2, '0')}`
    const list = docs.filter((d) => d.issueDate.startsWith(key))
    const t = list.reduce(
      (s, d) => {
        const x = calculateTotals(d.items, d.taxMode)
        return { net: s.net + x.netCents, tax: s.tax + x.taxCents, gross: s.gross + x.grossCents }
      },
      { net: 0, tax: 0, gross: 0 },
    )
    const paid = data.docs.filter((d) => d.paidAt?.startsWith(key)).reduce((s, d) => s + calculateTotals(d.items, d.taxMode).grossCents, 0)
    const minutes = entries.filter((e) => toISODate(new Date(e.start)).startsWith(key)).reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
    return { key, label, ...t, paid, minutes, count: list.filter((d) => d.kind === 'invoice').length }
  })
  const total = monthly.reduce((s, m) => ({ net: s.net + m.net, tax: s.tax + m.tax, gross: s.gross + m.gross, paid: s.paid + m.paid, minutes: s.minutes + m.minutes }), { net: 0, tax: 0, gross: 0, paid: 0, minutes: 0 })

  // VAT overview by period, rate and tax mode
  const periods = taxPeriod === 'quarter' ? ['Q1', 'Q2', 'Q3', 'Q4'] : MONTHS
  const taxRows = periods.map((label, i) => {
    const inPeriod = docs.filter((d) => {
      const m = Number(d.issueDate.slice(5, 7)) - 1
      return taxPeriod === 'quarter' ? Math.floor(m / 3) === i : m === i
    })
    const buckets = new Map<string, { label: string; net: number; tax: number }>()
    for (const d of inPeriod) {
      const t = calculateTotals(d.items, d.taxMode)
      for (const g of t.groups) {
        const key = d.taxMode === 'standard' ? `s${g.rate}` : d.taxMode
        const name = d.taxMode === 'standard' ? `${formatNumber(g.rate)} % USt` : TAX_MODE_LABELS[d.taxMode as TaxMode]
        const b = buckets.get(key) ?? { label: name, net: 0, tax: 0 }
        b.net += g.netCents
        b.tax += g.taxCents
        buckets.set(key, b)
      }
    }
    return { label, buckets: [...buckets.values()].sort((a, b) => b.tax - a.tax), tax: [...buckets.values()].reduce((s, b) => s + b.tax, 0) }
  })

  const byCustomer = new Map<string, { name: string; net: number; minutes: number }>()
  for (const d of docs) {
    const key = d.customerId ?? `free:${recipientName(d.recipient)}`
    const c = d.customerId ? customerById.get(d.customerId) : undefined
    const row = byCustomer.get(key) ?? { name: c ? customerName(c) : recipientName(d.recipient), net: 0, minutes: 0 }
    row.net += calculateTotals(d.items, d.taxMode).netCents
    byCustomer.set(key, row)
  }
  for (const e of entries) {
    const c = customerById.get(e.customerId)
    const row = byCustomer.get(e.customerId) ?? { name: c ? customerName(c) : 'Unbekannt', net: 0, minutes: 0 }
    row.minutes += durationMinutes(e.start, e.end)
    byCustomer.set(e.customerId, row)
  }
  const customers = [...byCustomer.values()].sort((a, b) => b.net - a.net || b.minutes - a.minutes)
  const maxCustomer = Math.max(1, ...customers.map((c) => c.net))

  const byProject = new Map<string, number>()
  for (const e of entries) {
    const c = customerById.get(e.customerId)
    const key = `${e.project || 'Ohne Projekt'} · ${c ? customerName(c) : ''}`
    byProject.set(key, (byProject.get(key) ?? 0) + durationMinutes(e.start, e.end))
  }
  const projects = [...byProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const billableMinutes = entries.filter((e) => e.billable).reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
  const hasData = docs.length > 0 || entries.length > 0

  return (
    <div className="page">
      <PageHeader
        title="Berichte"
        subtitle="Umsatz, Umsatzsteuer und Stunden auf einen Blick."
        actions={
          <>
            <div className="row" style={{ gap: 2 }}>
              <IconButton icon={ChevronLeft} label="Vorheriges Jahr" onClick={() => setYear(year - 1)} />
              <strong className="tabular" style={{ minWidth: 48, textAlign: 'center', fontSize: 17 }}>
                {year}
              </strong>
              <IconButton icon={ChevronRight} label="Nächstes Jahr" onClick={() => setYear(year + 1)} />
            </div>
            <Button
              icon={Download}
              onClick={() =>
                run(async () => {
                  downloadFile(`kontor-rechnungen-${year}.csv`, invoicesToCsv(data.docs.filter((d) => d.issueDate.startsWith(y)), data.customers), 'text/csv;charset=utf-8')
                }, 'CSV exportiert')
              }
            >
              CSV {year}
            </Button>
          </>
        }
      />

      {!hasData ? (
        <div className="card">
          <EmptyState icon={BarChart3} title={`Keine Daten für ${year}`}>
            Sobald du Rechnungen abschließt oder Zeiten erfasst, erscheinen hier deine Auswertungen.
          </EmptyState>
        </div>
      ) : (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="Umsatz netto" value={formatMoney(total.net)} sub={`${monthly.reduce((s, m) => s + m.count, 0)} Rechnungen`} tone="green" />
            <Stat label="Umsatzsteuer" value={formatMoney(total.tax)} sub="ausgewiesen" tone="orange" />
            <Stat label="Zahlungseingänge" value={formatMoney(total.paid)} sub="brutto, nach Zahldatum" tone="blue" />
            <Stat label="Erfasste Stunden" value={formatDuration(total.minutes)} sub={`${total.minutes ? Math.round((billableMinutes / total.minutes) * 100) : 0} % abrechenbar`} tone="purple" />
          </div>

          <section className="card">
            <div className="card-header">
              <h2>Umsatz pro Monat</h2>
            </div>
            <div className="card-body">
              <BarChart
                label={`Nettoumsatz pro Monat ${year}`}
                bars={monthly.map((m) => ({ key: m.key, label: m.label, hint: `${m.label} ${year}`, value: Math.max(0, m.net), display: formatMoney(m.net), current: m.key === toISODate(new Date()).slice(0, 7) }))}
              />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Monat</th>
                    <th className="num">Netto</th>
                    <th className="num">USt</th>
                    <th className="num">Brutto</th>
                    <th className="num">Eingänge</th>
                    <th className="num">Stunden</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((m) => (
                    <tr key={m.key}>
                      <td>{m.label}</td>
                      <td className="num">{m.net ? formatMoney(m.net) : <span className="faint">–</span>}</td>
                      <td className="num muted">{m.tax ? formatMoney(m.tax) : '–'}</td>
                      <td className="num">{m.gross ? formatMoney(m.gross) : '–'}</td>
                      <td className="num muted">{m.paid ? formatMoney(m.paid) : '–'}</td>
                      <td className="num muted">{m.minutes ? formatDuration(m.minutes) : '–'}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td>
                      <strong>Summe</strong>
                    </td>
                    <td className="num">
                      <strong>{formatMoney(total.net)}</strong>
                    </td>
                    <td className="num">{formatMoney(total.tax)}</td>
                    <td className="num">{formatMoney(total.gross)}</td>
                    <td className="num">{formatMoney(total.paid)}</td>
                    <td className="num">{formatDuration(total.minutes)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Umsatzsteuer-Übersicht</h2>
              <Segmented
                label="Zeitraum"
                value={taxPeriod}
                onChange={setTaxPeriod}
                options={[
                  { value: 'quarter', label: 'Quartal' },
                  { value: 'month', label: 'Monat' },
                ]}
              />
            </div>
            <div className="card-body stack-sm">
              <div className="callout small">
                <Info size={16} aria-hidden />
                <span>Nach Rechnungsdatum (Soll-Versteuerung). Als Orientierung für die Voranmeldung gedacht – keine Steuerberatung. Bei Ist-Versteuerung zählen die Zahlungseingänge.</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Zeitraum</th>
                      <th>Art</th>
                      <th className="num">Bemessungsgrundlage</th>
                      <th className="num">Steuer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxRows
                      .filter((r) => r.buckets.length)
                      .flatMap((r) =>
                        r.buckets.map((b, i) => (
                          <tr key={`${r.label}-${b.label}`}>
                            <td>{i === 0 ? <strong>{r.label}</strong> : ''}</td>
                            <td>{b.label}</td>
                            <td className="num">{formatMoney(b.net)}</td>
                            <td className="num">{formatMoney(b.tax)}</td>
                          </tr>
                        )),
                      )}
                    {taxRows.every((r) => !r.buckets.length) && (
                      <tr>
                        <td colSpan={4} className="muted">
                          Keine abgeschlossenen Rechnungen in {year}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <div className="grid grid-2">
            <section className="card">
              <div className="card-header">
                <h2>Nach Kunde</h2>
              </div>
              <ul className="list" style={{ marginTop: 8 }}>
                {customers.slice(0, 10).map((c) => (
                  <li key={c.name} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <div className="row between">
                      <span className="title">{c.name}</span>
                      <strong className="tabular">{formatMoney(c.net)}</strong>
                    </div>
                    <div className="progress" aria-hidden>
                      <span style={{ width: `${(Math.max(0, c.net) / maxCustomer) * 100}%` }} />
                    </div>
                    <span className="sub">{c.minutes ? `${formatDuration(c.minutes)} erfasst` : 'keine Zeiten'}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <div className="card-header">
                <h2>Stunden nach Projekt</h2>
              </div>
              {projects.length === 0 ? (
                <p className="card-body muted small">Keine Zeiten in {year}.</p>
              ) : (
                <ul className="list" style={{ marginTop: 8 }}>
                  {projects.map(([name, minutes]) => (
                    <li key={name} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                      <div className="row between">
                        <span className="title">{name.replace(/ · $/, '')}</span>
                        <strong className="tabular">{formatDuration(minutes)}</strong>
                      </div>
                      <div className="progress" aria-hidden>
                        <span style={{ width: `${(minutes / projects[0][1]) * 100}%`, background: 'var(--purple)' }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
