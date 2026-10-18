import { useLayoutEffect, useRef, useState } from 'react'
import type { InvoiceView } from '../lib/invoiceView'
import './preview.css'

const PAGE_WIDTH_PX = (210 / 25.4) * 96

/** Renders an A4 page in real millimetres and scales it to the available width. */
export function ScaledPage({ children, maxScale = 1 }: { children: React.ReactNode; maxScale?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    const update = () => {
      const s = Math.min(maxScale, o.clientWidth / PAGE_WIDTH_PX)
      setScale(s)
      setHeight(i.offsetHeight * s)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [maxScale])

  return (
    <div ref={outer} className="scaled-page" style={{ height }}>
      <div ref={inner} className="scaled-inner" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}

export function InvoicePreview({ view }: { view: InvoiceView }) {
  const v = view
  const style = { '--inv-accent': v.accent } as React.CSSProperties
  const logo = v.logo ? <img className="inv-logo" src={v.logo.pngDataUrl ?? v.logo.dataUrl} alt="Logo" /> : null

  return (
    <article className={`inv-page inv-${v.layout}`} style={style} aria-label={`${v.label} Vorschau`}>
      <span className="inv-fold inv-fold-1" aria-hidden />
      <span className="inv-fold inv-fold-2" aria-hidden />
      <span className="inv-fold inv-punch" aria-hidden />
      {v.isDraft && <div className="inv-watermark" aria-hidden>Entwurf</div>}

      <header className="inv-head">
        {v.layout === 'modern' && <div className="inv-band" aria-hidden />}
        <div className="inv-brand">
          {logo ?? <div className="inv-company-name">{v.seller.name || 'Deine Firma'}</div>}
        </div>
        {v.layout === 'classic' && (
          <div className="inv-head-contact">
            {[v.seller.name, v.seller.street, [v.seller.zip, v.seller.city].filter(Boolean).join(' '), v.seller.phone, v.seller.email]
              .filter(Boolean)
              .map((l, i) => (
                <div key={i}>{l}</div>
              ))}
          </div>
        )}
      </header>

      <section className="inv-address" aria-label="Empfänger">
        <div className="inv-sender">{v.senderLine}</div>
        <div className="inv-recipient">
          {v.recipientLines.length ? v.recipientLines.map((l, i) => <div key={i}>{l}</div>) : <div className="inv-placeholder">Empfänger</div>}
        </div>
      </section>

      <section className="inv-meta" aria-label="Rechnungsdaten">
        {v.meta.map((m) => (
          <div key={m.label} className="inv-meta-row">
            <span>{m.label}</span>
            <span className={m.strong ? 'strong' : ''}>{m.value}</span>
          </div>
        ))}
      </section>

      <div className="inv-body">
        <h1 className="inv-title">{v.title}{v.layout !== 'minimal' && v.meta[0].value !== 'Entwurf' ? ` ${v.meta[0].value}` : ''}</h1>
        {v.intro && <p className="inv-text">{v.intro}</p>}

        <table className="inv-table">
          <thead>
            <tr>
              <th className="pos">Pos.</th>
              <th>Leistung</th>
              <th className="num">Menge</th>
              <th className="num">Einzelpreis</th>
              {v.showDiscount && <th className="num">Rabatt</th>}
              {v.showTaxColumn && <th className="num">USt</th>}
              <th className="num">Gesamt</th>
            </tr>
          </thead>
          <tbody>
            {v.items.length === 0 && (
              <tr>
                <td colSpan={7} className="inv-placeholder" style={{ padding: '6mm 0', textAlign: 'center' }}>
                  Noch keine Positionen
                </td>
              </tr>
            )}
            {v.items.map((item) => (
              <tr key={item.pos}>
                <td className="pos">{item.pos}</td>
                <td>
                  <div className="inv-item-title">{item.title || <span className="inv-placeholder">Bezeichnung</span>}</div>
                  {item.description && <div className="inv-item-desc">{item.description}</div>}
                </td>
                <td className="num">
                  {item.quantity} {item.unit}
                </td>
                <td className="num">{item.unitPrice}</td>
                {v.showDiscount && <td className="num">{item.discount}</td>}
                {v.showTaxColumn && <td className="num">{item.taxRate}</td>}
                <td className="num">{item.total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="inv-totals">
          {v.totals.map((row) => (
            <div key={row.label} className={`inv-total-row ${row.strong ? 'grand' : ''}`}>
              <span>{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>

        {v.taxNote && <p className="inv-note">{v.taxNote}</p>}
        {v.closing && <p className="inv-text">{v.closing}</p>}
      </div>

      <footer className="inv-footer">
        {v.footerText && <div className="inv-footer-text">{v.footerText}</div>}
        <div className="inv-footer-cols">
          {v.footerColumns.map((col, i) => (
            <div key={i}>
              {col.map((l, j) => (
                <div key={j}>{l}</div>
              ))}
            </div>
          ))}
        </div>
      </footer>
    </article>
  )
}
