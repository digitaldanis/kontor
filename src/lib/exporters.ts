import { downloadFile } from './backup'
import { db } from './db'
import { buildCii, type EInvoiceProfile } from './einvoice'
import { buildInvoiceView, sellerFor } from './invoiceView'
import type { InvoiceDocument, Settings } from './types'

export function baseName(doc: InvoiceDocument): string {
  const label = doc.kind === 'quote' ? 'Angebot' : doc.kind === 'cancellation' ? 'Storno' : doc.kind === 'creditNote' ? 'Gutschrift' : 'Rechnung'
  return `${label}-${(doc.number ?? 'Entwurf').replace(/[^\w.-]+/g, '_')}`
}

async function referenceDate(doc: InvoiceDocument): Promise<string | undefined> {
  const id = doc.cancelsId ?? doc.creditsId
  if (!id) return undefined
  return (await db.documents.get(id))?.issueDate
}

export async function buildXml(doc: InvoiceDocument, settings: Settings, profile: EInvoiceProfile): Promise<string> {
  return buildCii(doc, sellerFor(doc, settings).seller, profile, { referenceDate: await referenceDate(doc) })
}

export async function renderPdf(doc: InvoiceDocument, settings: Settings, withXml = false): Promise<{ bytes: Uint8Array; filename: string }> {
  // pdf-lib is fairly large, load it only when someone actually exports
  const { renderInvoicePdf } = await import('./pdf')
  const view = buildInvoiceView(doc, settings)
  const xml = withXml ? await buildXml(doc, settings, 'facturx') : undefined
  const bytes = await renderInvoicePdf(view, { xml })
  return { bytes, filename: `${baseName(doc)}${withXml ? '-ZUGFeRD' : ''}.pdf` }
}

export async function downloadPdf(doc: InvoiceDocument, settings: Settings, withXml = false): Promise<void> {
  const { bytes, filename } = await renderPdf(doc, settings, withXml)
  downloadFile(filename, bytes as BlobPart, 'application/pdf')
}

export async function downloadXml(doc: InvoiceDocument, settings: Settings, profile: EInvoiceProfile): Promise<void> {
  const xml = await buildXml(doc, settings, profile)
  downloadFile(`${baseName(doc)}-${profile === 'xrechnung' ? 'XRechnung' : 'CII'}.xml`, xml, 'application/xml')
}

export function printDocument(): void {
  window.print()
}
