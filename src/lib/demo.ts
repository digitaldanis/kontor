import { addDays, combineDateTime, today } from './dates'
import { db, uid } from './db'
import { createDraft, emptyCustomer, finalizeDocument, getSettings, invoiceTimeEntries, newLineItem, saveCustomer, setPaid, updateSettings } from './repo'
import type { Customer, TimeEntry } from './types'

/** Fills an empty installation with believable example data. */
export async function seedDemo(): Promise<void> {
  const s = await getSettings()
  await updateSettings({
    company: {
      ...s.company,
      name: 'Studio Nordlicht',
      owner: 'Lena Berger',
      street: 'Kastanienallee 21',
      zip: '10435',
      city: 'Berlin',
      country: 'DE',
      taxNumber: '30/245/67890',
      vatId: 'DE298765432',
      email: 'hallo@studio-nordlicht.de',
      phone: '030 1234567',
      website: 'studio-nordlicht.de',
      bankName: 'GLS Bank',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
    },
    onboarded: true,
  })

  const make = (c: Partial<Customer>) => saveCustomer({ ...emptyCustomer(), ...c })
  const acme = await make({ company: 'Kaffeerösterei Bohnenglück GmbH', contactPerson: 'Jonas Weber', street: 'Speicherstadt 4', zip: '20457', city: 'Hamburg', email: 'jonas@bohnenglueck.de', hourlyRateCents: 9500 })
  const verein = await make({ company: 'Sportverein Grün-Weiß e. V.', contactPerson: 'Petra Schulz', street: 'Am Sportplatz 1', zip: '04109', city: 'Leipzig', email: 'vorstand@gruen-weiss.de', hourlyRateCents: 7000 })
  const wien = await make({ company: 'Alpenblick Hotels GmbH', contactPerson: 'Mag. Thomas Huber', street: 'Mariahilfer Straße 88', zip: '1070', city: 'Wien', country: 'AT', vatId: 'ATU12345678', email: 't.huber@alpenblick.at', hourlyRateCents: 11000 })

  const entries: TimeEntry[] = []
  const add = (customer: Customer, daysAgo: number, from: string, to: string, project: string, description: string, details = '') => {
    const date = addDays(today(), -daysAgo)
    entries.push({
      id: uid(),
      customerId: customer.id,
      project,
      description,
      details,
      start: combineDateTime(date, from),
      end: combineDateTime(date, to),
      billable: true,
      rateCents: null,
      invoiceId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }
  add(acme, 40, '09:00', '12:30', 'Relaunch Onlineshop', 'Workshop Markenauftritt', 'Moodboards und Farbwelt abgestimmt')
  add(acme, 38, '13:30', '17:00', 'Relaunch Onlineshop', 'Wireframes Startseite')
  add(acme, 9, '09:15', '11:45', 'Relaunch Onlineshop', 'Produktseiten gestalten', 'Varianten für Filterkaffee und Espresso')
  add(acme, 6, '14:00', '18:15', 'Relaunch Onlineshop', 'Umsetzung Warenkorb')
  add(acme, 2, '10:00', '11:30', 'Newsletter', 'Template für Herbstaktion')
  add(verein, 12, '18:00', '20:00', 'Website', 'Mitgliederbereich eingerichtet')
  add(verein, 3, '17:30', '19:00', 'Website', 'Spielplan-Seite aktualisiert')
  add(wien, 20, '08:30', '12:00', 'Buchungsstrecke', 'UX-Analyse Buchungsprozess', 'Heatmaps ausgewertet, Empfehlungen erstellt')
  add(wien, 19, '13:00', '16:30', 'Buchungsstrecke', 'Prototyp neue Zimmerauswahl')
  await db.timeEntries.bulkPut(entries)

  // An older paid invoice, an overdue one and an open one from time entries
  const settings = await getSettings()
  const old = await createDraft('invoice', { customerId: verein.id })
  old.issueDate = addDays(today(), -75)
  old.serviceFrom = addDays(today(), -80)
  old.dueDate = addDays(old.issueDate, 14)
  old.items = [newLineItem(settings, { title: 'Logo-Überarbeitung', description: 'inkl. drei Korrekturschleifen', quantity: 1, unit: 'Pauschal', unitPriceCents: 45000 })]
  await db.documents.put(old)
  await finalizeDocument(old.id)
  await setPaid(old.id, addDays(today(), -66))

  const overdue = await createDraft('invoice', { customerId: acme.id })
  overdue.issueDate = addDays(today(), -30)
  overdue.dueDate = addDays(today(), -16)
  overdue.serviceFrom = addDays(today(), -40)
  overdue.serviceTo = addDays(today(), -38)
  overdue.layout = 'classic'
  await db.documents.put(overdue)
  await invoiceTimeEntries(acme.id, entries.filter((e) => e.customerId === acme.id).slice(0, 2).map((e) => e.id), 'entry', overdue.id)
  await finalizeDocument(overdue.id)

  const rc = await invoiceTimeEntries(wien.id, entries.filter((e) => e.customerId === wien.id).map((e) => e.id), 'entry')
  rc.issueDate = addDays(today(), -14)
  rc.dueDate = addDays(rc.issueDate, 14)
  await db.documents.put(rc)
  await finalizeDocument(rc.id)

  const draft = await createDraft('invoice', { customerId: verein.id })
  draft.items = [newLineItem(settings, { title: 'Wartung Website', description: `Monatspauschale ${new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(new Date())}`, quantity: 1, unit: 'Monat', unitPriceCents: 4900 })]
  await db.documents.put(draft)
}
