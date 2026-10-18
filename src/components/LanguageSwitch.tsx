import { Languages } from 'lucide-react'
import { setUiLanguage, t, uiLanguage, type UiLanguage } from '../lib/i18n'

/** Interface language per device; switching reloads so all formatters follow. */
export function LanguageSwitch() {
  return (
    <label className="language-switch">
      <Languages size={16} aria-hidden />
      <span className="sr-only">{t('Sprache der Oberfläche')}</span>
      <select
        className="select"
        value={uiLanguage()}
        onChange={(e) => {
          setUiLanguage(e.target.value as UiLanguage)
          window.location.reload()
        }}
      >
        <option value="de">{t('Deutsch')}</option>
        <option value="en">{t('English')}</option>
      </select>
    </label>
  )
}
