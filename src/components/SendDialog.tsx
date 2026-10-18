import { markSent } from '../lib/actions'
import { t } from '../lib/i18n'
import { Eye, Mail, Paperclip, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, now } from '../lib/db'
import { buildAttachments, composeMail, sendViaMailto, sendViaServer, serverMailReady, type AttachmentChoice, type MailDraft } from '../lib/mail'
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
      toast(t('Bitte eine Empfängeradresse angeben.'), 'error')
      return
    }
    setBusy(true)
    const ok = await run(async () => {
      const files = await buildAttachments(doc, settings, choice, reminder)
      if (server) await sendViaServer(draft, files, settings.company.email || undefined, doc.id)
      else sendViaMailto(draft, files)
      return true
    }, server ? t('E-Mail versendet') : undefined)
    setBusy(false)
    if (ok) {
      if (!server) toast(t('Die Datei wurde heruntergeladen – bitte im Mailprogramm anhängen.'))
      await finish()
    }
  }

  const preview = async () => {
    setBusy(true)
    await run(async () => {
      const [first] = await buildAttachments(doc, settings, choice, reminder)
      const url = URL.createObjectURL(new Blob([first.bytes as BlobPart], { type: first.contentType }))
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    })
    setBusy(false)
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
      title={reminder ? t('{p0} senden', { p0: reminder.title }) : t('Per E-Mail senden')}
      description={server === false ? undefined : server ? t('Versand über den verbundenen Kontor-Server (SMTP).') : t('Prüfe den Versandweg …')}
      footer={
        <>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button icon={Eye} onClick={preview} disabled={busy}>
            {t('Anhang ansehen')}
          </Button>
          <Button variant="primary" icon={server ? Send : Mail} onClick={send} disabled={busy || server === null}>
            {server ? t('Senden') : t('Im Mailprogramm öffnen')}
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        {server === false && (
          <div className="callout info small">
            <Paperclip size={16} aria-hidden />
            <span>
              {t('Es ist noch kein SMTP-Versand eingerichtet. Kontor lädt die Datei herunter und öffnet dein Mailprogramm mit Betreff und Text –')} <strong>{t('hänge die heruntergeladene Datei dort bitte an.')}</strong>{' '}
              <Link to="/einstellungen#konto">{t('SMTP einrichten')}</Link>
            </span>
          </div>
        )}
        <div className="form-grid">
          <TextField className="span-3" label={t('An')} type="email" value={draft.to} onChange={(to) => setDraft({ ...draft, to })} placeholder={t('kunde@example.de')} />
          <TextField className="span-3" label={t('Kopie (CC)')} value={draft.cc} onChange={(cc) => setDraft({ ...draft, cc })} placeholder={t('optional')} />
          <TextField className="span-6" label={t('Betreff')} value={draft.subject} onChange={(subject) => setDraft({ ...draft, subject })} />
          <TextAreaField className="span-6" label={t('Nachricht')} value={draft.body} onChange={(body) => setDraft({ ...draft, body })} rows={9} />
        </div>
        {withEInvoice && (
          <div className="stack-sm" style={{ gap: 6 }}>
            <strong className="small">{t('Anhang')}</strong>
            <Segmented
              label={t('Anhang')}
              value={choice}
              onChange={setChoice}
              options={[
                { value: 'zugferd', label: t('ZUGFeRD-PDF') },
                { value: 'pdf', label: t('PDF') },
                { value: 'xrechnung', label: t('PDF + XRechnung') },
              ]}
            />
            <span className="hint small faint">{t('ZUGFeRD ist ein normales PDF mit eingebetteten Rechnungsdaten – lesbar für Menschen und Buchhaltungssoftware.')}</span>
          </div>
        )}
      </div>
    </Dialog>
  )
}
