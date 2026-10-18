import {
  degrees,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib'
import type { InvoiceView } from './invoiceView'

const MM = 72 / 25.4
const PAGE_W = 210
const PAGE_H = 297
const LEFT = 25
const RIGHT = 190
const CONTENT_W = RIGHT - LEFT
const BOTTOM_LIMIT = PAGE_H - 36

const TEXT = rgb(0.114, 0.114, 0.122)
const MUTED = rgb(0.42, 0.42, 0.44)
const LINE = rgb(0.89, 0.89, 0.9)
const SOFT_BG = rgb(0.961, 0.965, 0.973)
const WHITE = rgb(1, 1, 1)

// Characters outside WinAnsi cannot be encoded with the standard fonts.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
function sanitize(text: string): string {
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) out += ch
    else if (ch === '\t') out += ' '
    else if (ch === ' ' || ch === ' ' || ch === ' ') out += ' '
    else if (ch === '−') out += '-'
    else if (ch !== '\r') out += '?'
  }
  return out
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

interface Fonts {
  regular: PDFFont
  bold: PDFFont
  serif: PDFFont
}

function wrap(text: string, font: PDFFont, size: number, maxWidthMm: number): string[] {
  const max = maxWidthMm * MM
  const lines: string[] = []
  for (const paragraph of sanitize(text).split('\n')) {
    const words = paragraph.split(/ +/)
    let line = ''
    for (let word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= max) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      // hard-break words that are longer than the line
      while (font.widthOfTextAtSize(word, size) > max) {
        let i = word.length
        while (i > 1 && font.widthOfTextAtSize(word.slice(0, i), size) > max) i--
        lines.push(word.slice(0, i))
        word = word.slice(i)
      }
      line = word
    }
    lines.push(line)
  }
  return lines
}

class Writer {
  pages: PDFPage[] = []
  page!: PDFPage
  y = 0

  pdf: PDFDocument
  fonts: Fonts
  view: InvoiceView
  accent: RGB

  constructor(pdf: PDFDocument, fonts: Fonts, view: InvoiceView, accent: RGB) {
    this.pdf = pdf
    this.fonts = fonts
    this.view = view
    this.accent = accent
  }

  addPage() {
    this.page = this.pdf.addPage([PAGE_W * MM, PAGE_H * MM])
    this.pages.push(this.page)
  }

  /** Draws text with its top edge at y (mm from top). */
  text(s: string, x: number, y: number, opts: { size?: number; font?: PDFFont; color?: RGB; align?: 'left' | 'right' | 'center'; spacing?: number } = {}) {
    const size = opts.size ?? 9.5
    const font = opts.font ?? this.fonts.regular
    const clean = sanitize(s)
    if (!clean) return
    let width = font.widthOfTextAtSize(clean, size)
    if (opts.spacing) width += opts.spacing * (clean.length - 1)
    let px = x * MM
    if (opts.align === 'right') px -= width
    if (opts.align === 'center') px -= width / 2
    const baseline = PAGE_H * MM - y * MM - size * 0.78
    if (opts.spacing) {
      let cx = px
      for (const ch of clean) {
        this.page.drawText(ch, { x: cx, y: baseline, size, font, color: opts.color ?? TEXT })
        cx += font.widthOfTextAtSize(ch, size) + opts.spacing
      }
      return
    }
    this.page.drawText(clean, { x: px, y: baseline, size, font, color: opts.color ?? TEXT })
  }

  lines(lines: string[], x: number, y: number, size: number, lineHeight: number, opts: { font?: PDFFont; color?: RGB; align?: 'left' | 'right' } = {}) {
    lines.forEach((l, i) => this.text(l, x, y + i * lineHeight, { size, ...opts }))
    return lines.length * lineHeight
  }

  rect(x: number, y: number, w: number, h: number, color: RGB, radius = 0) {
    if (radius <= 0) {
      this.page.drawRectangle({ x: x * MM, y: (PAGE_H - y - h) * MM, width: w * MM, height: h * MM, color })
      return
    }
    const r = Math.min(radius, h / 2, w / 2) * MM
    const X = x * MM
    const Y = (PAGE_H - y) * MM
    const W = w * MM
    const H = h * MM
    // SVG path in PDF space with flipped y, see drawSvgPath
    const path = `M ${r} 0 H ${W - r} Q ${W} 0 ${W} ${r} V ${H - r} Q ${W} ${H} ${W - r} ${H} H ${r} Q 0 ${H} 0 ${H - r} V ${r} Q 0 0 ${r} 0 Z`
    this.page.drawSvgPath(path, { x: X, y: Y, color, borderWidth: 0 })
  }

  hline(x1: number, x2: number, y: number, thickness = 0.4, color: RGB = LINE) {
    this.page.drawLine({ start: { x: x1 * MM, y: (PAGE_H - y) * MM }, end: { x: x2 * MM, y: (PAGE_H - y) * MM }, thickness, color })
  }
}

const PT = 0.3528 // 1pt in mm

function lh(size: number, factor = 1.42) {
  return size * PT * factor
}

interface Column {
  key: 'pos' | 'title' | 'quantity' | 'unitPrice' | 'discount' | 'taxRate' | 'total'
  label: string
  width: number
  align: 'left' | 'right'
}

export async function renderInvoicePdf(view: InvoiceView, options: { xml?: string; documentTitle?: string } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    serif: await pdf.embedFont(StandardFonts.TimesRoman),
  }
  const accent = hexToRgb(view.accent || '#0a66d8')
  const w = new Writer(pdf, fonts, view, accent)
  const layout = view.layout

  let logo: PDFImage | null = null
  if (view.logo) {
    try {
      const src = view.logo.pngDataUrl ?? view.logo.dataUrl
      logo = src.startsWith('data:image/jpeg') ? await pdf.embedJpg(dataUrlBytes(src)) : await pdf.embedPng(dataUrlBytes(src))
    } catch {
      logo = null
    }
  }

  w.addPage()
  drawFirstPageHeader(w, logo)

  // Title and intro
  w.y = 103
  const number = view.meta[0]?.value
  if (layout === 'minimal') {
    w.text(view.title.toUpperCase(), LEFT, w.y, { size: 11, font: fonts.bold, spacing: 1.5 })
    w.y += lh(11) + 6
  } else if (layout === 'classic') {
    w.text(`${view.title}${number && number !== 'Entwurf' ? ` ${number}` : ''}`, LEFT, w.y, { size: 18, font: fonts.serif })
    w.y += lh(18, 1.2) + 5
  } else {
    w.text(`${view.title}${number && number !== 'Entwurf' ? ` ${number}` : ''}`, LEFT, w.y, { size: 20, font: fonts.bold, color: accent })
    w.y += lh(20, 1.2) + 5
  }
  if (view.intro) {
    w.y += w.lines(wrap(view.intro, fonts.regular, 9.5, CONTENT_W), LEFT, w.y, 9.5, lh(9.5)) + 4
  }

  drawItems(w)
  drawTotals(w)

  if (view.taxNote) {
    const noteLines = wrap(view.taxNote, fonts.regular, 8.8, CONTENT_W - 8)
    const h = noteLines.length * lh(8.8) + 5
    ensureSpace(w, h + 4)
    if (layout !== 'minimal') w.rect(LEFT, w.y, CONTENT_W, h, SOFT_BG)
    w.rect(LEFT, w.y, layout === 'minimal' ? 0.25 : 0.45, h, accent)
    w.lines(noteLines, LEFT + 3.5, w.y + 2.5, 8.8, lh(8.8))
    w.y += h + 5
  }

  if (view.closing) {
    for (const line of wrap(view.closing, fonts.regular, 9.5, CONTENT_W)) {
      ensureSpace(w, lh(9.5))
      w.text(line, LEFT, w.y, { size: 9.5 })
      w.y += lh(9.5)
    }
  }

  // Footer, page numbers and watermark on every page
  const total = w.pages.length
  w.pages.forEach((p, i) => {
    w.page = p
    drawFooter(w)
    drawFoldMarks(w)
    if (total > 1) w.text(`Seite ${i + 1} von ${total}`, RIGHT, PAGE_H - 33, { size: 7.5, color: MUTED, align: 'right' })
    if (view.isDraft) {
      p.drawText('ENTWURF', {
        x: 38 * MM,
        y: 95 * MM,
        size: 96,
        font: fonts.bold,
        color: rgb(0.93, 0.93, 0.94),
        rotate: degrees(24),
        opacity: 0.6,
      })
    }
  })

  pdf.setTitle(options.documentTitle ?? `${view.label} ${number ?? ''}`.trim())
  pdf.setAuthor(sanitize(view.seller.name))
  pdf.setSubject(view.label)
  pdf.setCreator('Kontor')
  pdf.setProducer('Kontor (pdf-lib)')
  pdf.setLanguage('de-DE')

  if (options.xml) embedFacturX(pdf, options.xml, `${view.label} ${number ?? ''}`)

  return pdf.save()
}

function drawFirstPageHeader(w: Writer, logo: PDFImage | null) {
  const { view, fonts, accent } = w
  const layout = view.layout

  if (layout === 'modern') w.rect(0, 0, PAGE_W, 4, accent)

  const maxW = layout === 'minimal' ? 45 : 62
  const maxH = layout === 'minimal' ? 14 : 22
  const brandRight = layout === 'classic'
  if (logo) {
    const ratio = logo.width / logo.height
    let lw = maxW
    let lh2 = lw / ratio
    if (lh2 > maxH) {
      lh2 = maxH
      lw = lh2 * ratio
    }
    const x = brandRight ? RIGHT - lw : LEFT
    w.page.drawImage(logo, { x: x * MM, y: (PAGE_H - 14 - lh2) * MM, width: lw * MM, height: lh2 * MM })
  } else {
    const size = layout === 'minimal' ? 11 : 15
    w.text(view.seller.name || 'Deine Firma', brandRight ? RIGHT : LEFT, 14, { size, font: fonts.bold, align: brandRight ? 'right' : 'left' })
  }

  if (layout === 'classic') {
    const s = view.seller
    const lines = [s.name, s.street, [s.zip, s.city].filter(Boolean).join(' '), s.phone, s.email].filter(Boolean)
    w.lines(lines, LEFT, 14, 8, lh(8, 1.45), { color: MUTED })
  }

  // Address window (DIN 5008 form B): 45 mm from top, 20 mm from left
  w.text(truncate(view.senderLine, fonts.regular, 6.5, 80), 25, 45 + 17.7 - 1.5 - lh(6.5), { size: 6.5, color: MUTED })
  if (layout !== 'minimal') w.hline(25, 100, 45 + 17.7 - 1.2, 0.3, LINE)
  const recipient = view.recipientLines.length ? view.recipientLines : []
  recipient.slice(0, 6).forEach((l, i) => w.text(truncate(l, fonts.regular, 10, 80), 25, 45 + 17.7 + 1 + i * lh(10, 1.38), { size: 10 }))

  // Info block
  let y = layout === 'modern' ? 50 : 50
  const metaRowH = lh(8.5) + 0.8
  if (layout === 'modern') w.rect(125, 47, RIGHT - 125, view.meta.length * metaRowH + 6, SOFT_BG, 2.5)
  const padX = layout === 'modern' ? 4 : 0
  for (const m of view.meta) {
    const label = layout === 'minimal' ? m.label.toUpperCase() : m.label
    w.text(label, 125 + padX, y + (layout === 'minimal' ? 0.5 : 0), { size: layout === 'minimal' ? 6.8 : 8.5, color: MUTED, spacing: layout === 'minimal' ? 0.5 : 0 })
    w.text(m.value, RIGHT - padX, y, { size: 8.5, font: m.strong ? fonts.bold : fonts.regular, align: 'right' })
    y += metaRowH
  }
}

function truncate(s: string, font: PDFFont, size: number, maxMm: number) {
  let t = sanitize(s)
  if (font.widthOfTextAtSize(t, size) <= maxMm * MM) return t
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxMm * MM) t = t.slice(0, -1)
  return `${t}…`
}

function columns(view: InvoiceView): Column[] {
  const cols: Column[] = [
    { key: 'pos', label: 'Pos.', width: 9, align: 'left' },
    { key: 'title', label: 'Leistung', width: 0, align: 'left' },
    { key: 'quantity', label: 'Menge', width: 24, align: 'right' },
    { key: 'unitPrice', label: 'Einzelpreis', width: 25, align: 'right' },
  ]
  if (view.showDiscount) cols.push({ key: 'discount', label: 'Rabatt', width: 15, align: 'right' })
  if (view.showTaxColumn) cols.push({ key: 'taxRate', label: 'USt', width: 13, align: 'right' })
  cols.push({ key: 'total', label: 'Gesamt', width: 26, align: 'right' })
  const fixed = cols.reduce((s, c) => s + c.width, 0)
  cols[1].width = CONTENT_W - fixed
  return cols
}

function drawTableHeader(w: Writer, cols: Column[]) {
  const { view, fonts, accent } = w
  const layout = view.layout
  const h = 7
  const inset = layout === 'modern' ? 2 : 0
  if (layout === 'modern') w.rect(LEFT, w.y, CONTENT_W, h, accent, 1.5)
  let x = LEFT
  cols.forEach((c, i) => {
    const pad = i === 0 ? inset : i === cols.length - 1 ? -inset : 0
    const color = layout === 'modern' ? WHITE : layout === 'classic' ? TEXT : MUTED
    const tx = c.align === 'right' ? x + c.width - (i === cols.length - 1 ? 0 : 1.5) + pad : x + (i === 0 ? 0 : 1.5) + pad
    w.text(c.label.toUpperCase(), tx, w.y + 2.1, { size: 7.2, font: layout === 'minimal' ? fonts.regular : fonts.bold, color, align: c.align, spacing: 0.25 })
    x += c.width
  })
  if (layout === 'classic') w.hline(LEFT, RIGHT, w.y + h, 0.8, accent)
  else if (layout === 'minimal') w.hline(LEFT, RIGHT, w.y + h, 0.4, LINE)
  else if (layout !== 'modern') w.hline(LEFT, RIGHT, w.y + h, 0.8, TEXT)
  w.y += h + 1
}

function newContinuationPage(w: Writer) {
  w.addPage()
  const number = w.view.meta[0]?.value
  w.text(`${w.view.title} ${number && number !== 'Entwurf' ? number : ''}`.trim(), LEFT, 16, { size: 8.5, color: MUTED })
  w.text(w.view.seller.name, RIGHT, 16, { size: 8.5, color: MUTED, align: 'right' })
  w.hline(LEFT, RIGHT, 22, 0.4, LINE)
  w.y = 28
}

function ensureSpace(w: Writer, h: number) {
  if (w.y + h > BOTTOM_LIMIT) newContinuationPage(w)
}

function drawItems(w: Writer) {
  const { view, fonts } = w
  const cols = columns(view)
  const titleCol = cols[1]
  const layout = view.layout
  const inset = layout === 'modern' ? 2 : 0

  ensureSpace(w, 20)
  drawTableHeader(w, cols)

  if (!view.items.length) {
    w.text('Noch keine Positionen', LEFT + CONTENT_W / 2, w.y + 4, { size: 9, color: MUTED, align: 'center' })
    w.y += 12
  }

  for (const item of view.items) {
    const titleLines = wrap(item.title || 'Ohne Bezeichnung', layout === 'minimal' ? fonts.regular : fonts.bold, 9, titleCol.width - 3)
    const descLines = item.description ? wrap(item.description, fonts.regular, 8.3, titleCol.width - 3) : []
    const padY = layout === 'minimal' ? 2.6 : 2.2
    const rowH = padY * 2 + titleLines.length * lh(9) + (descLines.length ? 0.5 + descLines.length * lh(8.3) : 0)

    if (w.y + rowH > BOTTOM_LIMIT) {
      newContinuationPage(w)
      drawTableHeader(w, cols)
    }

    let x = LEFT
    const top = w.y + padY
    cols.forEach((c, i) => {
      const pad = i === 0 ? inset : i === cols.length - 1 ? -inset : 0
      if (c.key === 'title') {
        let ty = top
        ty += w.lines(titleLines, x + 1.5, ty, 9, lh(9), { font: layout === 'minimal' ? fonts.regular : fonts.bold })
        if (descLines.length) w.lines(descLines, x + 1.5, ty + 0.5, 8.3, lh(8.3), { color: MUTED })
      } else {
        const value = c.key === 'pos' ? String(item.pos) : c.key === 'quantity' ? `${item.quantity} ${item.unit}` : item[c.key]
        const tx = c.align === 'right' ? x + c.width - (i === cols.length - 1 ? 0 : 1.5) + pad : x + pad
        w.text(value, tx, top, { size: 9, color: c.key === 'pos' ? MUTED : TEXT, align: c.align })
      }
      x += c.width
    })
    w.y += rowH
    if (layout !== 'minimal') w.hline(LEFT, RIGHT, w.y, 0.4, LINE)
  }
  w.y += 4
}

function drawTotals(w: Writer) {
  const { view, fonts, accent } = w
  const layout = view.layout
  const width = 78
  const x = RIGHT - width
  const rowH = lh(9.5) + 2
  const needed = view.totals.length * rowH + 14
  ensureSpace(w, needed)

  for (const row of view.totals) {
    if (row.strong) {
      w.y += 1.5
      const size = layout === 'minimal' ? 12 : 10.5
      const h = lh(size) + 4.5
      if (layout === 'modern') {
        w.rect(x, w.y, width, h, accent, 2)
        w.text(row.label, x + 3, w.y + 2.3, { size, font: fonts.bold, color: WHITE })
        w.text(row.value, RIGHT - 3, w.y + 2.3, { size, font: fonts.bold, color: WHITE, align: 'right' })
      } else {
        w.hline(x, RIGHT, w.y, layout === 'minimal' ? 0.4 : 0.8, layout === 'minimal' ? LINE : TEXT)
        const font = fonts.bold
        w.text(row.label, x, w.y + 2.3, { size, font })
        w.text(row.value, RIGHT, w.y + 2.3, { size, font, color: layout === 'minimal' ? accent : TEXT, align: 'right' })
        if (layout === 'classic') {
          w.hline(x, RIGHT, w.y + h, 0.6, TEXT)
          w.hline(x, RIGHT, w.y + h + 0.8, 0.6, TEXT)
        }
      }
      w.y += h + 6
    } else {
      w.text(row.label, x, w.y + 1, { size: 9.5, color: MUTED })
      w.text(row.value, RIGHT, w.y + 1, { size: 9.5, align: 'right' })
      w.y += rowH
    }
  }
}

function drawFooter(w: Writer) {
  const { view, accent } = w
  const cols = view.footerColumns
  const size = 6.8
  const line = lh(size, 1.4)
  const maxLines = Math.max(1, ...cols.map((c) => c.length))
  const top = PAGE_H - 10 - maxLines * line - 2.5
  let y = top
  if (view.footerText) {
    const lines = wrap(view.footerText, w.fonts.regular, size, CONTENT_W).slice(0, 3)
    y -= lines.length * line + 2
    w.lines(lines, LEFT, y, size, line, { color: MUTED })
    y = top
  }
  if (view.layout === 'modern') w.hline(LEFT, RIGHT, y, 1.2, accent)
  else if (view.layout !== 'minimal') w.hline(LEFT, RIGHT, y, 0.4, LINE)
  if (!cols.length) return
  const gap = 6
  const colW = (CONTENT_W - gap * (cols.length - 1)) / cols.length
  cols.forEach((col, i) => {
    const x = LEFT + i * (colW + gap)
    col.forEach((l, j) => w.text(truncate(l, w.fonts.regular, size, colW), x, y + 2.5 + j * line, { size, color: MUTED }))
  })
}

function drawFoldMarks(w: Writer) {
  const c = rgb(0.71, 0.71, 0.73)
  for (const [y, len] of [
    [105, 5],
    [148.5, 7],
    [210, 5],
  ]) {
    w.page.drawLine({ start: { x: 0, y: (PAGE_H - y) * MM }, end: { x: len * MM, y: (PAGE_H - y) * MM }, thickness: 0.3, color: c })
  }
}

/**
 * Embeds the CII XML as factur-x.xml with AFRelationship and the Factur-X
 * XMP extension schema. The PDF itself is not validated as PDF/A-3, which is
 * why the export is labelled experimental in the UI.
 */
function embedFacturX(pdf: PDFDocument, xml: string, title: string) {
  const ctx = pdf.context
  const bytes = new TextEncoder().encode(xml)
  const date = new Date()
  const fileStream = ctx.flateStream(bytes, {
    Type: 'EmbeddedFile',
    Subtype: 'text/xml',
    Params: { Size: bytes.length, ModDate: PDFString.fromDate(date), CreationDate: PDFString.fromDate(date) },
  })
  const fileRef = ctx.register(fileStream)
  const spec = ctx.obj({
    Type: 'Filespec',
    F: PDFString.of('factur-x.xml'),
    UF: PDFHexString.fromText('factur-x.xml'),
    EF: { F: fileRef, UF: fileRef },
    Desc: PDFString.of('Factur-X/ZUGFeRD invoice data'),
    AFRelationship: 'Alternative',
  })
  const specRef = ctx.register(spec)
  const catalog = pdf.catalog
  catalog.set(PDFName.of('Names'), ctx.obj({ EmbeddedFiles: { Names: [PDFHexString.fromText('factur-x.xml'), specRef] } }))
  catalog.set(PDFName.of('AF'), ctx.obj([specRef]))

  const iso = date.toISOString()
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>${iso}</xmp:CreateDate>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
   <xmp:CreatorTool>Kontor</xmp:CreatorTool>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>Kontor (pdf-lib)</pdf:Producer>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
  const meta = ctx.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })
  catalog.set(PDFName.of('Metadata'), ctx.register(meta))
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string)
}
