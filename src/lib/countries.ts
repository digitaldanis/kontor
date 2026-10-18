export interface Country {
  code: string
  name: string
  eu: boolean
}

const EU = 'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' ')

const NAMES: Record<string, string> = {
  DE: 'Deutschland',
  AT: 'Österreich',
  CH: 'Schweiz',
  BE: 'Belgien',
  BG: 'Bulgarien',
  CY: 'Zypern',
  CZ: 'Tschechien',
  DK: 'Dänemark',
  EE: 'Estland',
  ES: 'Spanien',
  FI: 'Finnland',
  FR: 'Frankreich',
  GR: 'Griechenland',
  HR: 'Kroatien',
  HU: 'Ungarn',
  IE: 'Irland',
  IT: 'Italien',
  LT: 'Litauen',
  LU: 'Luxemburg',
  LV: 'Lettland',
  MT: 'Malta',
  NL: 'Niederlande',
  PL: 'Polen',
  PT: 'Portugal',
  RO: 'Rumänien',
  SE: 'Schweden',
  SI: 'Slowenien',
  SK: 'Slowakei',
  LI: 'Liechtenstein',
  NO: 'Norwegen',
  IS: 'Island',
  GB: 'Vereinigtes Königreich',
  US: 'Vereinigte Staaten',
  CA: 'Kanada',
  AU: 'Australien',
  TR: 'Türkei',
  UA: 'Ukraine',
  RS: 'Serbien',
  JP: 'Japan',
  CN: 'China',
  IN: 'Indien',
  AE: 'Vereinigte Arabische Emirate',
  IL: 'Israel',
  SG: 'Singapur',
  BR: 'Brasilien',
  MX: 'Mexiko',
  ZA: 'Südafrika',
}

export const COUNTRIES: Country[] = Object.entries(NAMES)
  .map(([code, name]) => ({ code, name, eu: EU.includes(code) }))
  .sort((a, b) => {
    if (a.code === 'DE') return -1
    if (b.code === 'DE') return 1
    return a.name.localeCompare(b.name, 'de')
  })

const englishNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null

export function countryName(code: string, lang: 'de' | 'en' = 'de'): string {
  if (lang === 'en') return englishNames?.of(code) ?? NAMES[code] ?? code
  return NAMES[code] ?? code
}

export function isEU(code: string): boolean {
  return EU.includes(code)
}

/** Rough structural check, not a VIES lookup. Greece uses "EL" as VAT prefix. */
export function looksLikeVatId(vatId: string): boolean {
  return /^(ATU\d{8}|BE[01]\d{9}|DE\d{9}|EL\d{9}|[A-Z]{2}[0-9A-Z+*]{2,13})$/.test(normalizeVatId(vatId))
}

export function normalizeVatId(vatId: string): string {
  return vatId.replace(/[\s.-]/g, '').toUpperCase()
}

export function vatIdCountry(vatId: string): string {
  const prefix = normalizeVatId(vatId).slice(0, 2)
  return prefix === 'EL' ? 'GR' : prefix
}
