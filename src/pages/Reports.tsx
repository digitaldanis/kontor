import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, ChevronLeft, ChevronRight, Download, Info } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart } from '../components/BarChart'
import { useFeedback } from '../components/feedback'
import { Button, EmptyState, IconButton, PageHeader, Segmented, Stat } from '../components/ui'
import { downloadFile, invoicesToCsv } from '../lib/backup'
import { durationMinutes, formatDuration, toISODate } from '../lib/dates'
import { db } from '../lib/db'
import { customerName, recipientName } from '../lib/defaults'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { formatMoney, formatNumber } from '../lib/money'
import { countsAsRevenue, netOf } from '../lib/status'
import { euer, vatReturn } from '../lib/expenses'
import { sumBuckets, vatEntries, type Taxation } from '../lib/tax'
import type { Expense, InvoiceDocument } from '../lib/types'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export function Reports() {
  useDocumentTitle('Berichte')
  const { run } = useFeedback()
  const [year, setYear] = useState(new Date().getFullYear())
  const [taxPeriod, setTaxPeriod] = useState<'month' | 'quarter'>('quarter')
  const settings = useSettings()
  const [taxationChoice, setTaxation] = useState<Taxation | null>(null)
  const taxation = taxationChoice ?? settings?.taxation ?? 'accrual'
  const data = useLiveQuery(async () => {
    const [docs, entries, customers, expenses] = await Promise.all([db.documents.toArray(), db.timeEntries.toArray(), db.customers.toArray(), db.expenses.toArray()])
    return { docs, entries, customers, expenses }
  })

  if (!data) return <div className="page" />
  const y = String(year)
  const docs = data.docs.filter((d) => countsAsRevenue(d) && d.issueDate.startsWith(y))
  const entries = data.entries.filter((e) => toISODate(new Date(e.start)).startsWith(y))
  const customerById = new Map(data.customers.map((c) => [c.id, c]))
  const accrual = vatEntries(data.docs, 'accrual')
  const taxEntries = taxation === 'accrual' ? accrual : vatEntries(data.docs, 'cash')

  const monthly = MONTHS.map((label, i) => {
    const key = `${y}-${String(i + 1).padStart(2, '0')}`
    const list = docs.filter((d) => d.issueDate.startsWith(key))
    const t = sumBuckets(accrual.filter((e) => e.date.startsWith(key))).reduce(
      (s, b) => ({ net: s.net + b.netCents, tax: s.tax + b.taxCents, gross: s.gross + b.netCents + b.taxCents }),
      { net: 0, tax: 0, gross: 0 },
    )
    const paid = data.docs.flatMap((d) => (d.kind === 'invoice' ? d.payments : [])).filter((p) => p.date.startsWith(key)).reduce((s, p) => s + p.amountCents, 0)
    const minutes = entries.filter((e) => toISODate(new Date(e.start)).startsWith(key)).reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
    return { key, label, ...t, paid, minutes, count: list.filter((d) => d.kind === 'invoice').length }
  })
  const total = monthly.reduce((s, m) => ({ net: s.net + m.net, tax: s.tax + m.tax, gross: s.gross + m.gross, paid: s.paid + m.paid, minutes: s.minutes + m.minutes }), { net: 0, tax: 0, gross: 0, paid: 0, minutes: 0 })

  // VAT overview by period, rate and tax mode
  const periods = taxPeriod === 'quarter' ? ['Q1', 'Q2', 'Q3', 'Q4'] : MONTHS
  const taxRows = periods.map((label, i) => {
    const inPeriod = taxEntries.filter((e) => {
      if (!e.date.startsWith(y)) return false
      const m = Number(e.date.slice(5, 7)) - 1
      return taxPeriod === 'quarter' ? Math.floor(m / 3) === i : m === i
    })
    const buckets = sumBuckets(inPeriod).map((b) => ({ label: b.label, net: b.netCents, tax: b.taxCents }))
    return { label, buckets, tax: buckets.reduce((s, b) => s + b.tax, 0) }
  })

  const byCustomer = new Map<string, { name: string; net: number; minutes: number }>()
  for (const d of docs) {
    const key = d.customerId ?? `free:${recipientName(d.recipient)}`
    const c = d.customerId ? customerById.get(d.customerId) : undefined
    const row = byCustomer.get(key) ?? { name: c ? customerName(c) : recipientName(d.recipient), net: 0, minutes: 0 }
    row.net += netOf(d)
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
  const hasData = docs.length > 0 || entries.length > 0 || data.expenses.some((e) => e.date.startsWith(y))

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
              <div className="row wrap">
              <Segmented
                label="Versteuerung"
                value={taxation}
                onChange={setTaxation}
                options={[
                  { value: 'accrual', label: 'Soll' },
                  { value: 'cash', label: 'Ist' },
                ]}
              />
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
            </div>
            <div className="card-body stack-sm">
              <div className="callout small">
                <Info size={16} aria-hidden />
                <span>
                  {taxation === 'accrual'
                    ? 'Soll-Versteuerung: Umsätze zählen nach Rechnungsdatum.'
                    : 'Ist-Versteuerung: Umsätze zählen, wenn das Geld eingeht – Teilzahlungen anteilig nach Netto und Steuer.'}{' '}
                  Als Orientierung für die Voranmeldung gedacht – keine Steuerberatung.
                </span>
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

          <VatReturnCard docs={data.docs} expenses={data.expenses} year={year} taxation={taxation} smallBusiness={!!settings?.smallBusiness} />

          <EuerCard docs={data.docs} expenses={data.expenses} year={year} smallBusiness={!!settings?.smallBusiness} />

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

const QUARTERS = ['1. Quartal', '2. Quartal', '3. Quartal', '4. Quartal']
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function periodRange(year: number, period: string): [string, string] {
  if (period === 'year') return [`${year}-01-01`, `${year}-12-31`]
  const [kind, n] = [period[0], Number(period.slice(1))]
  const startMonth = kind === 'q' ? n * 3 : n
  const endMonth = kind === 'q' ? startMonth + 2 : startMonth
  const last = new Date(year, endMonth + 1, 0).getDate()
  return [`${year}-${String(startMonth + 1).padStart(2, '0')}-01`, `${year}-${String(endMonth + 1).padStart(2, '0')}-${last}`]
}

function VatReturnCard({ docs, expenses, year, taxation, smallBusiness }: { docs: InvoiceDocument[]; expenses: Expense[]; year: number; taxation: Taxation; smallBusiness: boolean }) {
  const current = new Date()
  const [period, setPeriod] = useState(year === current.getFullYear() ? `q${Math.floor(current.getMonth() / 3)}` : 'q0')
  const [from, to] = periodRange(year, period)
  const r = vatReturn(docs, expenses, from, to, taxation)
  const euro = (n: number) => `${n.toLocaleString('de-DE')} €`
  const rows: [string, string, string][] = [
    ['81', 'Steuerpflichtige Umsätze 19 %', euro(r.kz81)],
    ['', 'darauf Steuer', formatMoney(r.kz81Tax)],
    ['86', 'Steuerpflichtige Umsätze 7 %', euro(r.kz86)],
    ['', 'darauf Steuer', formatMoney(r.kz86Tax)],
    ...r.otherRates.map((o): [string, string, string] => ['35/36', `Umsätze zu ${formatNumber(o.rate)} %`, `${formatMoney(o.baseCents)} / ${formatMoney(o.taxCents)}`]),
    ['41', 'Innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.', euro(r.kz41)],
    ['21', 'Nicht steuerbare sonstige Leistungen (EU, Reverse Charge)', euro(r.kz21)],
    ['45', 'Übrige nicht steuerbare Umsätze (Leistungsort nicht im Inland)', euro(r.kz45)],
    ['66', 'Vorsteuerbeträge aus Rechnungen anderer Unternehmer', formatMoney(r.kz66)],
    ['83', r.kz83 >= 0 ? 'Verbleibende Umsatzsteuer-Vorauszahlung' : 'Verbleibender Überschuss (Erstattung)', formatMoney(r.kz83)],
  ]
  return (
    <section className="card">
      <div className="card-header">
        <h2>USt-Voranmeldung</h2>
        <select className="select" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Voranmeldungszeitraum">
          {QUARTERS.map((q, i) => (
            <option key={q} value={`q${i}`}>
              {q} {year}
            </option>
          ))}
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={`m${i}`}>
              {m} {year}
            </option>
          ))}
          <option value="year">Gesamtes Jahr {year}</option>
        </select>
      </div>
      <div className="card-body stack-sm">
        <div className="callout warning small">
          <Info size={16} aria-hidden />
          <span>
            Kennzahlen als Hilfe zum Ausfüllen in ELSTER, {taxation === 'cash' ? 'nach Zahlungseingang (Ist)' : 'nach Rechnungsdatum (Soll)'} – <strong>keine Steuerberatung</strong> und ohne Gewähr. Sonderfälle wie § 13b-Leistungen, die du bezogen hast, sind nicht enthalten.
          </span>
        </div>
        {smallBusiness ? (
          <p className="muted small">Als Kleinunternehmer gibst du in der Regel keine Umsatzsteuer-Voranmeldung ab.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Kz.</th>
                  <th>Bezeichnung</th>
                  <th className="num">Betrag</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([kz, label, value], i) => (
                  <tr key={i} className={kz === '83' ? 'total-row' : ''}>
                    <td className="muted tabular">{kz}</td>
                    <td>{kz === '83' ? <strong>{label}</strong> : label}</td>
                    <td className="num">{kz === '83' ? <strong>{value}</strong> : value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function EuerCard({ docs, expenses, year, smallBusiness }: { docs: InvoiceDocument[]; expenses: Expense[]; year: number; smallBusiness: boolean }) {
  const r = euer(docs, expenses, `${year}-01-01`, `${year}-12-31`, smallBusiness)
  return (
    <section className="card">
      <div className="card-header">
        <h2>Einnahmen-Überschuss {year}</h2>
        <Link to="/ausgaben" className="small">
          Ausgaben
        </Link>
      </div>
      <div className="card-body stack-sm">
        <div className="callout small">
          <Info size={16} aria-hidden />
          <span>Vereinfachte Übersicht nach Zu- und Abfluss (Zahlungsdatum). Abschreibungen, Privatanteile und Zahlungen ans Finanzamt fehlen – zur Orientierung, keine Steuerberatung.</span>
        </div>
        <div className="grid grid-3">
          <Stat label="Betriebseinnahmen" value={formatMoney(r.incomeNetCents)} sub={smallBusiness ? 'brutto' : `netto · USt ${formatMoney(r.incomeVatCents)}`} tone="green" />
          <Stat label="Betriebsausgaben" value={formatMoney(r.expenseNetCents)} sub={smallBusiness ? 'brutto' : `netto · Vorsteuer ${formatMoney(r.inputVatCents)}`} tone="orange" />
          <Stat label={r.resultCents >= 0 ? 'Überschuss' : 'Verlust'} value={formatMoney(r.resultCents)} sub="Einnahmen − Ausgaben" tone={r.resultCents >= 0 ? 'blue' : 'red'} />
        </div>
        {r.byCategory.length > 0 && (
          <ul className="list">
            {r.byCategory.map((c) => (
              <li key={c.category} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row between">
                  <span className="title">{c.category}</span>
                  <strong className="tabular">{formatMoney(c.netCents)}</strong>
                </div>
                <div className="progress" aria-hidden>
                  <span style={{ width: `${(c.netCents / Math.max(1, r.byCategory[0].netCents)) * 100}%`, background: 'var(--orange)' }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
