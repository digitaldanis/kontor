import { Mail, Paperclip, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, now } from '../lib/db'
import { buildAttachments, composeMail, sendViaMailto, sendViaServer, serverMailReady, type AttachmentChoice, type MailDraft } from '../lib/mail'
import { markSent } from '../lib/repo'
import type { InvoiceDocument, Reminder, Settings } from '../lib/types'
import { useFeedback } from './feedback'
import { Button, Dialog, Segmented, TextAreaField, TextField } from './ui'

export function SendDialog({ doc, reminder, settings, open, onClose }: { doc: InvoiceDocument; reminder?: Reminder; settings: Settings; open: boolean; onClose: () => void }) {
  const { run, toast } = useFeedback()
  const [draft, setDraft] = useState<MailDraft>(() => composeMail(doc, settings, reminder))
  const [choice, setChoice] = useState<AttachmentChoice>(doc.kind === 'quote' ? 'pdf' : 'zugferd')
  const [server, setServer] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    void serverMailReady().then((ok) => alive && setServer(ok))
    return () => {
      alive = false
    }
  }, [open])

  const reset = () => {
    setDraft(composeMail(doc, settings, reminder))
    setServer(null)
  }

  const finish = async () => {
    await markSent(doc.id)
    if (reminder) await db.reminders.update(reminder.id, { sentAt: now() })
    onClose()
    reset()
  }

  const send = async () => {
    if (!draft.to.trim()) {
      toast('Bitte eine Empfängeradresse angeben.', 'error')
      return
    }
    setBusy(true)
    const ok = await run(async () => {
      const files = await buildAttachments(doc, settings, choice, reminder)
      if (server) await sendViaServer(draft, files, settings.company.email || undefined)
      else sendViaMailto(draft, files)
      return true
    }, server ? 'E-Mail versendet' : undefined)
    setBusy(false)
    if (ok) {
      if (!server) toast('Die Datei wurde heruntergeladen – bitte im Mailprogramm anhängen.')
      await finish()
    }
  }

  const withEInvoice = !reminder && doc.kind !== 'quote'

  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose()
        reset()
      }}
      wide
      title={reminder ? `${reminder.title} senden` : 'Per E-Mail senden'}
      description={server === false ? undefined : server ? 'Versand über den verbundenen Kontor-Server (SMTP).' : 'Prüfe den Versandweg …'}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon={server ? Send : Mail} onClick={send} disabled={busy || server === null}>
            {server ? 'Senden' : 'Im Mailprogramm öffnen'}
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        {server === false && (
          <div className="callout info small">
            <Paperclip size={16} aria-hidden />
            <span>
              Ohne Server kann der Browser keine E-Mails verschicken. Kontor lädt die Datei herunter und öffnet dein Mailprogramm mit Betreff und Text – <strong>hänge die heruntergeladene Datei dort bitte an.</strong>{' '}
              <Link to="/einstellungen#server">Server verbinden</Link>
            </span>
          </div>
        )}
        <div className="form-grid">
          <TextField className="span-3" label="An" type="email" value={draft.to} onChange={(to) => setDraft({ ...draft, to })} placeholder="kunde@example.de" />
          <TextField className="span-3" label="Kopie (CC)" value={draft.cc} onChange={(cc) => setDraft({ ...draft, cc })} placeholder="optional" />
          <TextField className="span-6" label="Betreff" value={draft.subject} onChange={(subject) => setDraft({ ...draft, subject })} />
          <TextAreaField className="span-6" label="Nachricht" value={draft.body} onChange={(body) => setDraft({ ...draft, body })} rows={9} />
        </div>
        {withEInvoice && (
          <div className="stack-sm" style={{ gap: 6 }}>
            <strong className="small">Anhang</strong>
            <Segmented
              label="Anhang"
              value={choice}
              onChange={setChoice}
              options={[
                { value: 'zugferd', label: 'ZUGFeRD-PDF' },
                { value: 'pdf', label: 'PDF' },
                { value: 'xrechnung', label: 'PDF + XRechnung' },
              ]}
            />
            <span className="hint small faint">ZUGFeRD ist ein normales PDF mit eingebetteten Rechnungsdaten – lesbar für Menschen und Buchhaltungssoftware.</span>
          </div>
        )}
      </div>
    </Dialog>
  )
}
