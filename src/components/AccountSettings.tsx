import { LogOut, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { t, uiLocale } from '../lib/i18n'
import { logout, useSession } from '../lib/session'
import { useFeedback } from './feedback'
import { Button, Dialog, Field, IconButton, NumberInput, TextField, Toggle } from './ui'

interface Member {
  id: string
  email: string
  name: string
  role: 'owner' | 'member'
  created_at: string
}

export function AccountSettings() {
  const { user } = useSession()
  const { run, toast } = useFeedback()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  if (!user) return null
  return (
    <div className="form-section">
      <h3>{t('Konto')}</h3>
      <p className="muted">
        {t('Angemeldet als {email} ({role}).', { email: user.email, role: user.role === 'owner' ? t('Inhaber') : t('Mitglied') })}
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await api('/api/auth/password', { body: { current, next } })
            setCurrent('')
            setNext('')
            toast(t('Passwort geändert'))
          })
        }}
      >
        <TextField className="span-3" label={t('Aktuelles Passwort')} type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <TextField className="span-3" label={t('Neues Passwort')} type="password" value={next} onChange={setNext} autoComplete="new-password" hint={t('Mindestens 10 Zeichen.')} />
        <div className="span-6 row wrap">
          <Button type="submit" disabled={!current || next.length < 10}>
            {t('Passwort ändern')}
          </Button>
          <Button variant="ghost" icon={LogOut} onClick={() => void logout()}>
            {t('Abmelden')}
          </Button>
        </div>
      </form>
    </div>
  )
}

export function TeamSettings() {
  const { user } = useSession()
  const { run, confirm } = useFeedback()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const load = () => api<{ users: Member[] }>('/api/team').then((r) => setMembers(r.users))

  useEffect(() => {
    void load().catch(() => setMembers([]))
  }, [])

  const owner = user?.role === 'owner'
  return (
    <div className="form-section">
      <h3>{t('Team')}</h3>
      <p className="muted">{t('Alle Personen arbeiten im selben Arbeitsbereich. Mitglieder können alles außer Team, SMTP und Wiederherstellen.')}</p>
      <ul className="list">
        {(members ?? []).map((m) => (
          <li key={m.id} className="list-item">
            <span className="grow">
              <span className="title" style={{ display: 'block' }}>
                {m.name || m.email}
              </span>
              <span className="sub">
                {m.email} · {m.role === 'owner' ? t('Inhaber') : t('Mitglied')} · {t('seit')} {new Date(m.created_at).toLocaleDateString(uiLocale())}
              </span>
            </span>
            {owner && m.role !== 'owner' && (
              <IconButton
                icon={Trash2}
                danger
                label={t('Entfernen')}
                onClick={async () => {
                  if (!(await confirm({ title: t('{p0} entfernen?', { p0: m.email }), message: t('Die Person kann sich danach nicht mehr anmelden. Ihre Einträge bleiben erhalten.'), confirmLabel: t('Entfernen'), danger: true }))) return
                  await run(async () => {
                    await api(`/api/team/${m.id}`, { method: 'DELETE' })
                    await load()
                  }, t('Mitglied entfernt'))
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {owner && (
        <Button icon={UserPlus} onClick={() => setAdding(true)} style={{ marginTop: 12 }}>
          {t('Mitglied hinzufügen')}
        </Button>
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t('Mitglied hinzufügen')}
        description={t('Gib der Person das Startpasswort weiter; sie kann es unter Einstellungen → Konto ändern.')}
        footer={
          <>
            <Button onClick={() => setAdding(false)}>{t('Abbrechen')}</Button>
            <Button
              variant="primary"
              disabled={!form.email || form.password.length < 10}
              onClick={async () => {
                const ok = await run(async () => {
                  await api('/api/team', { body: form })
                  await load()
                  return true
                }, t('Mitglied angelegt'))
                if (ok) {
                  setAdding(false)
                  setForm({ name: '', email: '', password: '' })
                }
              }}
            >
              {t('Anlegen')}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <TextField className="span-6" label={t('Name')} value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <TextField className="span-6" label={t('E-Mail')} type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} autoComplete="off" />
          <TextField className="span-6" label={t('Startpasswort')} type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} autoComplete="new-password" hint={t('Mindestens 10 Zeichen.')} />
        </div>
      </Dialog>
    </div>
  )
}

interface SmtpForm {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
  hasPassword: boolean
  configured: boolean
  serverDefault: boolean
  canStorePassword: boolean
}

export function SmtpSettings() {
  const { user } = useSession()
  const { run, toast } = useFeedback()
  const [form, setForm] = useState<SmtpForm | null>(null)

  useEffect(() => {
    let alive = true
    void api<Omit<SmtpForm, 'password'>>('/api/mail/settings')
      .then((s) => alive && setForm({ ...s, password: '' }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!form) return null
  const set = (patch: Partial<SmtpForm>) => setForm({ ...form, ...patch })
  const owner = user?.role === 'owner'

  return (
    <div className="form-section">
      <h3>{t('E-Mail-Versand (SMTP)')}</h3>
      <p className="muted">
        {t('Kontor verschickt Rechnungen und Mahnungen über deinen Mailserver. Das Passwort wird verschlüsselt auf dem Server gespeichert und nie an den Browser zurückgegeben.')}
        {form.serverDefault && !form.configured ? ' ' + t('Der Server hat bereits ein Standardkonto – eigene Angaben sind optional.') : ''}
      </p>
      {!form.canStorePassword && <p className="callout warning small">{t('KONTOR_SECRET ist auf dem Server nicht gesetzt – ein SMTP-Passwort kann erst danach gespeichert werden.')}</p>}
      <fieldset disabled={!owner} className="plain-fieldset">
        <div className="form-grid">
          <TextField className="span-3" label={t('SMTP-Server')} value={form.host} onChange={(host) => set({ host })} placeholder="smtp.example.com" />
          <Field className="span-1" label={t('Port')}>
            <NumberInput value={form.port} onChange={(port) => set({ port: Math.round(port) })} maxFraction={0} aria-label={t('Port')} />
          </Field>
          <div className="span-2" style={{ alignSelf: 'end' }}>
            <Toggle checked={form.secure} onChange={(secure) => set({ secure, port: secure ? 465 : 587 })} label={t('SSL/TLS')} description={t('Port 465; sonst STARTTLS')} />
          </div>
          <TextField className="span-3" label={t('Benutzername')} value={form.user} onChange={(user) => set({ user })} autoComplete="off" />
          <TextField className="span-3" label={t('Passwort')} type="password" value={form.password} onChange={(password) => set({ password })} autoComplete="new-password" placeholder={form.hasPassword ? t('gespeichert – leer lassen zum Beibehalten') : ''} />
          <TextField className="span-6" label={t('Absender')} value={form.from} onChange={(from) => set({ from })} placeholder="Northlight Studio <billing@example.com>" />
        </div>
      </fieldset>
      <div className="row wrap" style={{ marginTop: 12 }}>
        {owner && (
          <Button
            variant="primary"
            onClick={() =>
              run(async () => {
                await api('/api/mail/settings', { method: 'PUT', body: { host: form.host, port: form.port, secure: form.secure, user: form.user, password: form.password || undefined, from: form.from } })
                setForm({ ...form, password: '', hasPassword: form.hasPassword || !!form.password, configured: true })
                toast(t('SMTP-Zugang gespeichert'))
              })
            }
          >
            {t('Speichern')}
          </Button>
        )}
        <Button
          onClick={() =>
            run(async () => {
              const to = user?.email ?? ''
              await api('/api/mail/send', { body: { to, subject: t('Kontor: Testnachricht'), text: t('Der E-Mail-Versand aus Kontor funktioniert.') } })
              toast(t('Testmail an {p0} gesendet', { p0: to }))
            })
          }
          disabled={!form.configured && !form.serverDefault}
        >
          {t('Testmail an mich')}
        </Button>
      </div>
    </div>
  )
}
