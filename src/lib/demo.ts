import { addDays, combineDateTime, today } from './dates'
import { db, uid } from './db'
import { createDraft, emptyCustomer, finalizeDocument, getSettings, invoiceTimeEntries, newLineItem, saveCustomer, setPaid, updateSettings } from './repo'
import { emptyCatalogItem } from './catalog'
import { emptyExpense, vatFromGross } from './expenses'
import { addMonths, newRecurring, saveRecurring, templateFromDocument } from './recurring'
import { ensureProject } from './projects'
import type { Customer, TimeEntry } from './types'

/** Fills an empty installation with believable example data. */
export async function seedDemo(): Promise<void> {
  const s = await getSettings()
  await updateSettings({
    company: {
      ...s.company,
      name: 'Northlight Studio',
      owner: 'Lena Berger',
      street: 'Kastanienallee 21',
      zip: '10435',
      city: 'Berlin',
      country: 'DE',
      taxNumber: '30/245/67890',
      vatId: 'DE298765432',
      email: 'hello@northlight.example',
      phone: '030 1234567',
      website: 'northlight.example',
      bankName: 'GLS Bank',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
    },
    onboarded: true,
    documentLanguage: 'en',
  })

  const make = (c: Partial<Customer>) => saveCustomer({ ...emptyCustomer(), ...c })
  const acme = await make({ company: 'Bean & Brew Coffee Roasters GmbH', contactPerson: 'Jonas Weber', street: 'Speicherstadt 4', zip: '20457', city: 'Hamburg', email: 'jonas@beanandbrew.example', hourlyRateCents: 9500, language: 'en' })
  const verein = await make({ company: 'Greenfield Sports Club e. V.', contactPerson: 'Petra Schulz', street: 'Am Sportplatz 1', zip: '04109', city: 'Leipzig', email: 'board@greenfield.example', hourlyRateCents: 7000, language: 'en' })
  const wien = await make({ company: 'Alpine View Hotels GmbH', contactPerson: 'Thomas Huber', street: 'Mariahilfer Straße 88', zip: '1070', city: 'Vienna', country: 'AT', vatId: 'ATU12345678', email: 't.huber@alpineview.example', hourlyRateCents: 11000, language: 'en' })
  await make({ company: 'Harbour Digital Ltd', contactPerson: 'Amelia Clarke', street: '12 Wharf Road', zip: 'N1 7GR', city: 'London', country: 'GB', email: 'accounts@harbourdigital.example', hourlyRateCents: 12000, language: 'en', currency: 'EUR' })

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
  add(acme, 40, '09:00', '12:30', 'Online shop relaunch', 'Brand workshop', 'Moodboards and colour palette agreed')
  add(acme, 38, '13:30', '17:00', 'Online shop relaunch', 'Home page wireframes')
  add(acme, 9, '09:15', '11:45', 'Online shop relaunch', 'Product page design', 'Variants for filter coffee and espresso')
  add(acme, 6, '14:00', '18:15', 'Online shop relaunch', 'Shopping cart implementation')
  add(acme, 2, '10:00', '11:30', 'Newsletter', 'Template for the autumn campaign')
  add(verein, 12, '18:00', '20:00', 'Website', 'Members area set up')
  add(verein, 3, '17:30', '19:00', 'Website', 'Fixture page updated')
  add(wien, 20, '08:30', '12:00', 'Booking flow', 'UX review of the booking process', 'Heatmaps analysed, recommendations written')
  add(wien, 19, '13:00', '16:30', 'Booking flow', 'Prototype for the new room picker')
  await db.timeEntries.bulkPut(entries)
  for (const e of entries) await ensureProject(e.customerId, e.project)
  await db.projects.where('[customerId+name]').equals([acme.id, 'Online shop relaunch']).modify({ budgetMinutes: 16 * 60, budgetCents: 150000 })
  await db.catalog.bulkPut([
    emptyCatalogItem({ name: 'Concept and consulting', description: 'Workshop, alignment and concept', unit: 'Std.', priceCents: 9500 }),
    emptyCatalogItem({ name: 'Web design', description: 'Design and implementation', unit: 'Std.', priceCents: 8500 }),
    emptyCatalogItem({ name: 'Maintenance plan', description: 'Updates, backups and monitoring', unit: 'Monat', priceCents: 4900 }),
    emptyCatalogItem({ name: 'Reference book', unit: 'Stk.', priceCents: 3990, taxRate: 7 }),
  ])

  // An older paid invoice, an overdue one and an open one from time entries
  const settings = await getSettings()
  const old = await createDraft('invoice', { customerId: verein.id })
  old.issueDate = addDays(today(), -75)
  old.serviceFrom = addDays(today(), -80)
  old.dueDate = addDays(old.issueDate, 14)
  old.items = [newLineItem(settings, { title: 'Logo refresh', description: 'including three rounds of revisions', quantity: 1, unit: 'Pauschal', unitPriceCents: 45000 })]
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
  draft.items = [newLineItem(settings, { title: 'Website maintenance', description: `Monthly plan ${new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(new Date())}`, quantity: 1, unit: 'Monat', unitPriceCents: 4900 })]
  await db.documents.put(draft)

  await saveRecurring({
    ...newRecurring(verein.id, { ...templateFromDocument(draft), items: draft.items.map((i) => ({ ...i, description: 'Monthly plan {Monat} {Jahr}' })) }, addMonths(today(), 1).slice(0, 8) + '01'),
    name: 'Website maintenance',
  })

  await db.expenses.bulkPut([
    emptyExpense({ date: addDays(today(), -20), paidAt: addDays(today(), -20), vendor: 'Adobe Systems', description: 'Creative Cloud', category: 'Software & Abos', grossCents: 7139, vatCents: vatFromGross(7139, 19) }),
    emptyExpense({ date: addDays(today(), -12), paidAt: addDays(today(), -12), vendor: 'Deutsche Bahn', description: 'Train to Hamburg, client meeting', category: 'Reisekosten', grossCents: 8990, vatCents: vatFromGross(8990, 7), taxRate: 7 }),
    emptyExpense({ date: addDays(today(), -5), paidAt: null, vendor: 'North Hosting GmbH', description: 'Web hosting', category: 'Telefon & Internet', grossCents: 2380, vatCents: 380, invoiceNumber: 'NH-4711' }),
  ])
}
