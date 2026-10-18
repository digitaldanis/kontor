import { EN } from './i18n.en'

export type UiLanguage = 'de' | 'en'

const KEY = 'kontor.language'
let current: UiLanguage = detect()

function detect(): UiLanguage {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'de' || stored === 'en') return stored
  } catch {
    // no storage
  }
  if (typeof navigator !== 'undefined' && navigator.language && !navigator.language.toLowerCase().startsWith('de')) return 'en'
  return 'de'
}

export function uiLanguage(): UiLanguage {
  return current
}

export function uiLocale(): string {
  return current === 'en' ? 'en-GB' : 'de-DE'
}

/** Switches the interface language; the app reloads so every formatter picks it up. */
export function setUiLanguage(lang: UiLanguage) {
  current = lang
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // no storage
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

/**
 * Translates a German source text. The German text is the key, so a missing
 * translation simply shows German. `{name}` placeholders are filled from `params`.
 */
export function t(source: string, params?: Record<string, unknown>): string {
  let text = current === 'en' ? (EN[source] ?? source) : source
  if (params) text = text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
  return text
}
