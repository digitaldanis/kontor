import { useEffect, useState } from 'react'
import { COUNTRIES, isEU } from '../lib/countries'
import { saveCustomer } from '../lib/repo'
import type { Customer } from '../lib/types'
import { useFeedback } from './feedback'
import { Button, Dialog, Field, MoneyInput, NumberInput, SelectField, TextAreaField, TextField } from './ui'

export function CustomerDialog({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean
  customer: Customer | null
  onClose: () => void
  onSaved?: (c: Customer) => void
}) {
  const [c, setC] = useState<Customer | null>(customer)
  const [tried, setTried] = useState(false)
  const { run } = useFeedback()

  useEffect(() => {
    if (open) {
      setC(customer)
      setTried(false)
    }
  }, [open, customer])

  if (!c) return null
  const set = <K extends keyof Customer>(key: K) => (v: Customer[K]) => setC({ ...c, [key]: v })
  const nameMissing = !c.company.trim() && !c.contactPerson.trim()
  const foreignEU = c.country !== 'DE' && isEU(c.country)

  const save = async () => {
    setTried(true)
    if (nameMissing) return
    const saved = await run(() => saveCustomer(c), 'Kunde gespeichert')
    if (saved) {
      onSaved?.(saved)
      onClose()
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={customer?.number ? 'Kunde bearbeiten' : 'Neuer Kunde'}
      description="Die Anschrift wird in neue Rechnungen übernommen."
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="stack"
      >
        <div className="form-grid">
          <TextField className="span-3" label="Firma" value={c.company} onChange={set('company')} autoFocus error={tried && nameMissing ? 'Firma oder Ansprechpartner angeben' : null} />
          <TextField className="span-3" label="Ansprechpartner" value={c.contactPerson} onChange={set('contactPerson')} placeholder="z. B. Frau Erika Mustermann" />
          <TextField className="span-6" label="Adresszusatz" value={c.addressExtra} onChange={set('addressExtra')} placeholder="optional, z. B. Abteilung Buchhaltung" />
          <TextField className="span-4" label="Straße und Hausnummer" value={c.street} onChange={set('street')} />
          <TextField className="span-2" label="PLZ" value={c.zip} onChange={set('zip')} />
          <TextField className="span-3" label="Ort" value={c.city} onChange={set('city')} />
          <SelectField className="span-3" label="Land" value={c.country} onChange={set('country')}>
            {COUNTRIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </SelectField>
          <TextField
            className="span-3"
            label="USt-IdNr."
            value={c.vatId}
            onChange={(v) => set('vatId')(v.toUpperCase())}
            hint={foreignEU ? 'Nötig für Reverse Charge bei Unternehmen im EU-Ausland' : 'Optional'}
          />
          <TextField className="span-3" label="E-Mail" type="email" value={c.email} onChange={set('email')} />
          <TextField className="span-3" label="Telefon" type="tel" value={c.phone} onChange={set('phone')} />
          <Field className="span-3" label="Stundensatz" hint="Leer = Standard aus den Einstellungen">
            <MoneyInput value={c.hourlyRateCents} onChange={set('hourlyRateCents')} allowEmpty placeholder="Standard" aria-label="Stundensatz" />
          </Field>
          <Field className="span-3" label="Zahlungsziel" hint="Leer = Standard">
            <NumberInput value={c.paymentTermDays ?? 0} onChange={(n) => set('paymentTermDays')(n > 0 ? Math.round(n) : null)} suffix="Tage" maxFraction={0} aria-label="Zahlungsziel" />
          </Field>
          <TextField className="span-3" label="Leitweg-ID" value={c.leitwegId} onChange={set('leitwegId')} hint="Nur für öffentliche Auftraggeber (XRechnung)" />
          <TextAreaField className="span-6" label="Notizen" value={c.notes} onChange={set('notes')} rows={3} placeholder="Interne Notizen, erscheinen nicht auf der Rechnung" />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
