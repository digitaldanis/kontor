import { api, revive } from './api'
import type * as catalog from './catalog'
import type * as demo from './demo'
import { checkAttachment } from './expenses'
import type * as expenses from './expenses'
import type * as projects from './projects'
import type * as recurring from './recurring'
import { invalidate } from './remote'
import type * as repo from './repo'
import type { Attachment } from './types'

type Fn = (...args: never[]) => Promise<unknown>

/** Runs a domain operation on the server; it executes there in one transaction. */
function remote<F extends Fn>(name: string): F {
  return (async (...args: unknown[]) => {
    const res = await api<{ result: unknown; changed: string[] }>(`/api/ops/${name}`, { body: { args } })
    invalidate(res.changed)
    return revive(res.result)
  }) as unknown as F
}

export const updateSettings = remote<typeof repo.updateSettings>('updateSettings')
export const saveCustomer = remote<typeof repo.saveCustomer>('saveCustomer')
export const deleteCustomer = remote<typeof repo.deleteCustomer>('deleteCustomer')
export const createDraft = remote<typeof repo.createDraft>('createDraft')
export const saveDocument = remote<typeof repo.saveDocument>('saveDocument')
export const finalizeDocument = remote<typeof repo.finalizeDocument>('finalizeDocument')
export const cancelInvoice = remote<typeof repo.cancelInvoice>('cancelInvoice')
export const createCreditNote = remote<typeof repo.createCreditNote>('createCreditNote')
export const duplicateDocument = remote<typeof repo.duplicateDocument>('duplicateDocument')
export const deleteDraft = remote<typeof repo.deleteDraft>('deleteDraft')
export const addPayment = remote<typeof repo.addPayment>('addPayment')
export const removePayment = remote<typeof repo.removePayment>('removePayment')
export const setPaid = remote<typeof repo.setPaid>('setPaid')
export const setQuoteStatus = remote<typeof repo.setQuoteStatus>('setQuoteStatus')
export const markSent = remote<typeof repo.markSent>('markSent')
export const saveReminder = remote<typeof repo.saveReminder>('saveReminder')
export const deleteReminder = remote<typeof repo.deleteReminder>('deleteReminder')
export const startTimer = remote<typeof repo.startTimer>('startTimer')
export const updateTimer = remote<typeof repo.updateTimer>('updateTimer')
export const stopTimer = remote<typeof repo.stopTimer>('stopTimer')
export const discardTimer = remote<typeof repo.discardTimer>('discardTimer')
export const saveTimeEntry = remote<typeof repo.saveTimeEntry>('saveTimeEntry')
export const deleteTimeEntry = remote<typeof repo.deleteTimeEntry>('deleteTimeEntry')
export const invoiceTimeEntries = remote<typeof repo.invoiceTimeEntries>('invoiceTimeEntries')
export const releaseTimeEntries = remote<typeof repo.releaseTimeEntries>('releaseTimeEntries')
export const saveCatalogItem = remote<typeof catalog.saveCatalogItem>('saveCatalogItem')
export const deleteCatalogItem = remote<typeof catalog.deleteCatalogItem>('deleteCatalogItem')
export const saveProject = remote<typeof projects.saveProject>('saveProject')
export const ensureProject = remote<typeof projects.ensureProject>('ensureProject')
export const saveRecurring = remote<typeof recurring.saveRecurring>('saveRecurring')
export const runRecurring = remote<typeof recurring.runRecurring>('runRecurring')
export const saveExpense = remote<typeof expenses.saveExpense>('saveExpense')
export const deleteExpense = remote<typeof expenses.deleteExpense>('deleteExpense')
export const seedDemo = remote<typeof demo.seedDemo>('seedDemo')

/** Uploads a receipt file; it is stored on the server, not in the browser. */
export async function storeAttachment(file: File): Promise<Attachment> {
  const error = checkAttachment(file)
  if (error) throw new Error(error)
  const meta = await api<Attachment>('/api/files', {
    raw: file,
    headers: { 'Content-Type': file.type || 'application/xml', 'X-File-Name': encodeURIComponent(file.name) },
  })
  invalidate(['attachments'])
  return meta
}
