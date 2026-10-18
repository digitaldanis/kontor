import * as catalog from '../../src/lib/catalog'
import { seedDemo } from '../../src/lib/demo'
import * as expenses from '../../src/lib/expenses'
import * as projects from '../../src/lib/projects'
import * as recurring from '../../src/lib/recurring'
import * as repo from '../../src/lib/repo'

type Op = (...args: never[]) => Promise<unknown>

/**
 * Domain operations the client may run. They execute on the server against
 * the workspace store, inside one transaction each.
 */
export const OPS: Record<string, Op> = {
  updateSettings: repo.updateSettings,
  saveCustomer: repo.saveCustomer,
  deleteCustomer: repo.deleteCustomer,
  createDraft: repo.createDraft,
  saveDocument: repo.saveDocument,
  finalizeDocument: repo.finalizeDocument,
  cancelInvoice: repo.cancelInvoice,
  createCreditNote: repo.createCreditNote,
  duplicateDocument: repo.duplicateDocument,
  deleteDraft: repo.deleteDraft,
  addPayment: repo.addPayment,
  removePayment: repo.removePayment,
  setPaid: repo.setPaid,
  setQuoteStatus: repo.setQuoteStatus,
  markSent: repo.markSent,
  saveReminder: repo.saveReminder,
  deleteReminder: repo.deleteReminder,
  startTimer: repo.startTimer,
  updateTimer: repo.updateTimer,
  stopTimer: repo.stopTimer,
  discardTimer: repo.discardTimer,
  saveTimeEntry: repo.saveTimeEntry,
  deleteTimeEntry: repo.deleteTimeEntry,
  invoiceTimeEntries: repo.invoiceTimeEntries,
  releaseTimeEntries: repo.releaseTimeEntries,
  saveCatalogItem: catalog.saveCatalogItem,
  deleteCatalogItem: catalog.deleteCatalogItem,
  saveProject: projects.saveProject,
  ensureProject: projects.ensureProject,
  saveRecurring: recurring.saveRecurring,
  runRecurring: recurring.runRecurring,
  saveExpense: expenses.saveExpense,
  deleteExpense: expenses.deleteExpense,
  seedDemo,
}

/** Ops that change finalized records or numbering get an entry in the audit log. */
export const AUDITED_OPS = new Set(['finalizeDocument', 'cancelInvoice', 'createCreditNote', 'addPayment', 'removePayment', 'setPaid', 'markSent', 'deleteCustomer', 'seedDemo', 'updateSettings'])

/** Turns binary data into JSON-safe values for the response. */
export function toJson(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('base64') }
  if (Array.isArray(value)) return value.map(toJson)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = toJson(v)
    return out
  }
  return value
}
