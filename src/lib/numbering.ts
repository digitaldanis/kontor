import type { NumberSequence } from './types'

const COUNTER = /\{(0+1|#+|N)\}/

export function validatePattern(pattern: string): string | null {
  if (!pattern.trim()) return 'Bitte ein Schema angeben.'
  if (!COUNTER.test(pattern)) return 'Das Schema braucht einen Zähler, z. B. {0001}.'
  const unknown = pattern.match(/\{[^}]*\}/g)?.filter((t) => !/^\{(YYYY|YY|MM|DD|0+1|#+|N)\}$/.test(t))
  if (unknown?.length) return `Unbekannter Platzhalter: ${unknown.join(', ')}`
  return null
}

/**
 * The counter restarts whenever the coarsest date token in the pattern
 * changes, so "RE-{YYYY}-{0001}" counts per year and a pattern without
 * any date token counts forever.
 */
export function counterKey(pattern: string, date: Date): string {
  const y = String(date.getFullYear())
  if (pattern.includes('{MM}')) return `${y}-${pad(date.getMonth() + 1, 2)}`
  if (pattern.includes('{YYYY}') || pattern.includes('{YY}')) return y
  return 'all'
}

export function formatDocumentNumber(pattern: string, date: Date, counter: number): string {
  return pattern
    .replace(/\{YYYY\}/g, String(date.getFullYear()))
    .replace(/\{YY\}/g, String(date.getFullYear()).slice(-2))
    .replace(/\{MM\}/g, pad(date.getMonth() + 1, 2))
    .replace(/\{DD\}/g, pad(date.getDate(), 2))
    .replace(/\{(0+1|#+|N)\}/g, (_, token: string) => {
      const width = token === 'N' ? 1 : token.length
      return pad(counter, width)
    })
}

export function peekNextNumber(seq: NumberSequence, date: Date): string {
  const key = counterKey(seq.pattern, date)
  return formatDocumentNumber(seq.pattern, date, (seq.counters[key] ?? 0) + 1)
}

/** Returns the next number and the updated sequence. Pure, persist the result atomically. */
export function takeNextNumber(seq: NumberSequence, date: Date): { number: string; sequence: NumberSequence } {
  const key = counterKey(seq.pattern, date)
  const next = (seq.counters[key] ?? 0) + 1
  return {
    number: formatDocumentNumber(seq.pattern, date, next),
    sequence: { ...seq, counters: { ...seq.counters, [key]: next } },
  }
}

function pad(n: number, width: number) {
  return String(n).padStart(width, '0')
}
