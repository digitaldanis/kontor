import { ArrowLeft, ArrowRight, Clock, FileText, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFeedback } from '../components/feedback'
import { BrandMark } from '../components/Layout'
import { AccentPicker, BankFields, CompanyFields, LayoutPicker, LogoField, TaxFields } from '../components/SettingsFields'
import { Button, Toggle } from '../components/ui'
import { db } from '../lib/db'
import { seedDemo } from '../lib/demo'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { updateSettings } from '../lib/repo'
import type { Settings } from '../lib/types'
import './onboarding.css'

const STEPS = ['Willkommen', 'Firma', 'Steuern', 'Bank', 'Aussehen']

export function Onboarding() {
  useDocumentTitle('Willkommen')
  const stored = useSettings()
  const navigate = useNavigate()
  const { run } = useFeedback()
  const [draft, setDraft] = useState<Settings | null>(null)
  const [step, setStep] = useState(0)
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    if (stored && !draft) setDraft(stored)
  }, [stored, draft])

  if (!draft) return null
  const c = draft.company

  const stepValid = () => {
    if (step === 1) return !!(c.name.trim() && c.street.trim() && c.zip.trim() && c.city.trim())
    if (step === 2) return !!(c.taxNumber.trim() || c.vatId.trim())
    return true
  }

  const next = async () => {
    if (!stepValid()) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    if (step < STEPS.length - 1) {
      setStep(step + 1)
      return
    }
    await run(async () => {
      await updateSettings({ ...draft, onboarded: true })
      navigate('/', { replace: true })
    }, 'Alles eingerichtet')
  }

  const demo = () =>
    run(async () => {
      const hasData = (await db.documents.count()) + (await db.customers.count()) > 0
      if (!hasData) await seedDemo()
      else await updateSettings({ onboarded: true })
      navigate('/', { replace: true })
    }, 'Beispieldaten geladen')

  return (
    <div className="onboarding">
      <div className="onboarding-card card">
        <div className="onboarding-progress" aria-label={`Schritt ${step + 1} von ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span key={s} className={i <= step ? 'done' : ''} />
          ))}
        </div>

        {step === 0 && (
          <div className="onboarding-hero">
            <BrandMark />
            <h1>Willkommen bei Kontor</h1>
            <p className="lead">Rechnungen schreiben und Zeiten erfassen – an einem Ort. In zwei Minuten bist du startklar.</p>
            <ul className="onboarding-features">
              <li>
                <FileText size={20} aria-hidden />
                <span>
                  <strong>Rechnungen nach § 14 UStG</strong>
                  Pflichtangaben werden geprüft, Nummern fortlaufend vergeben.
                </span>
              </li>
              <li>
                <Clock size={20} aria-hidden />
                <span>
                  <strong>Zeiterfassung pro Kunde</strong>
                  Stoppuhr starten, später mit einem Klick abrechnen.
                </span>
              </li>
              <li>
                <ShieldCheck size={20} aria-hidden />
                <span>
                  <strong>Deine Daten bleiben bei dir</strong>
                  Alles wird lokal in diesem Browser gespeichert.
                </span>
              </li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="stack">
            <div>
              <h2>Wer stellt die Rechnungen?</h2>
              <p className="muted">Name und Anschrift sind Pflichtangaben auf jeder Rechnung.</p>
            </div>
            <CompanyFields value={c} onChange={(company) => setDraft({ ...draft, company })} showErrors={showErrors} />
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <div>
              <h2>Steuerliche Angaben</h2>
              <p className="muted">Mindestens Steuernummer oder USt-IdNr. muss auf der Rechnung stehen.</p>
            </div>
            <TaxFields value={c} onChange={(company) => setDraft({ ...draft, company })} showErrors={showErrors} />
            <Toggle
              checked={draft.smallBusiness}
              onChange={(smallBusiness) => setDraft({ ...draft, smallBusiness, defaults: { ...draft.defaults, taxRate: smallBusiness ? 0 : 19 } })}
              label="Ich bin Kleinunternehmer (§ 19 UStG)"
              description="Dann weist Kontor keine Umsatzsteuer aus und ergänzt den passenden Hinweis."
            />
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <div>
              <h2>Wohin soll das Geld?</h2>
              <p className="muted">Optional – erscheint in der Fußzeile jeder Rechnung. Du kannst das auch später ergänzen.</p>
            </div>
            <BankFields value={c} onChange={(company) => setDraft({ ...draft, company })} />
          </div>
        )}

        {step === 4 && (
          <div className="stack">
            <div>
              <h2>Wie sollen deine Rechnungen aussehen?</h2>
              <p className="muted">Lade dein Logo hoch und wähle Layout und Farbe.</p>
            </div>
            <LogoField logo={draft.logo} onChange={(logo) => setDraft({ ...draft, logo })} />
            <LayoutPicker settings={draft} value={draft.defaults.layout} onChange={(layout) => setDraft({ ...draft, defaults: { ...draft.defaults, layout } })} accent={draft.defaults.accentColor} />
            <AccentPicker value={draft.defaults.accentColor} onChange={(accentColor) => setDraft({ ...draft, defaults: { ...draft.defaults, accentColor } })} />
          </div>
        )}

        {showErrors && !stepValid() && (
          <p className="error-text small" role="alert" style={{ color: 'var(--red)', marginTop: 12 }}>
            Bitte fülle die markierten Felder aus.
          </p>
        )}

        <div className="onboarding-actions">
          {step > 0 ? (
            <Button icon={ArrowLeft} onClick={() => setStep(step - 1)}>
              Zurück
            </Button>
          ) : (
            <Button variant="ghost" icon={Sparkles} onClick={demo}>
              Erst mal mit Beispieldaten ausprobieren
            </Button>
          )}
          <Button variant="primary" size="lg" onClick={next}>
            {step === 0 ? "Los geht's" : step === STEPS.length - 1 ? 'Fertig' : 'Weiter'}
            {step < STEPS.length - 1 && <ArrowRight size={17} aria-hidden />}
          </Button>
        </div>
      </div>
      <p className="faint small onboarding-foot">Kontor ersetzt keine Steuerberatung. Alle Angaben ohne Gewähr.</p>
    </div>
  )
}
