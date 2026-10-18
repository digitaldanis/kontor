import { downloadFile } from './backup'
import { buildCii, type EInvoiceProfile } from './einvoice'
import { buildInvoiceView, sellerFor } from './invoiceView'
import type { InvoiceDocument, Settings } from './types'

function baseName(doc: InvoiceDocument): string {
  const label = doc.kind === 'quote' ? 'Angebot' : doc.kind === 'cancellation' ? 'Storno' : 'Rechnung'
  return `${label}-${(doc.number ?? 'Entwurf').replace(/[^\w.-]+/g, '_')}`
}

export async function downloadPdf(doc: InvoiceDocument, settings: Settings, withXml = false): Promise<void> {
  // pdf-lib is fairly large, load it only when someone actually exports
  const { renderInvoicePdf } = await import('./pdf')
  const view = buildInvoiceView(doc, settings)
  const xml = withXml ? buildCii(doc, sellerFor(doc, settings).seller, 'facturx') : undefined
  const bytes = await renderInvoicePdf(view, { xml })
  downloadFile(`${baseName(doc)}${withXml ? '-ZUGFeRD' : ''}.pdf`, bytes as BlobPart, 'application/pdf')
}

export function downloadXml(doc: InvoiceDocument, settings: Settings, profile: EInvoiceProfile): void {
  const xml = buildCii(doc, sellerFor(doc, settings).seller, profile)
  downloadFile(`${baseName(doc)}-${profile === 'xrechnung' ? 'XRechnung' : 'CII'}.xml`, xml, 'application/xml')
}

export function printDocument(): void {
  window.print()
}
