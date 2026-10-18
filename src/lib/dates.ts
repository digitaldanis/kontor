/** Dates are stored as local "YYYY-MM-DD" strings, timestamps as ISO strings. */
import { uiLocale } from './i18n'

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function today(): string {
  return toISODate(new Date())
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 12)
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseISODate(toIso).getTime() - parseISODate(fromIso).getTime()) / 86_400_000)
}

const dateFmt = new Intl.DateTimeFormat(uiLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
const shortFmt = new Intl.DateTimeFormat(uiLocale(), { day: 'numeric', month: 'short' })
const longFmt = new Intl.DateTimeFormat(uiLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
const monthFmt = new Intl.DateTimeFormat(uiLocale(), { month: 'long', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(uiLocale(), { hour: '2-digit', minute: '2-digit' })

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–'
  return dateFmt.format(iso.length > 10 ? new Date(iso) : parseISODate(iso))
}

export function formatShortDate(iso: string): string {
  return shortFmt.format(iso.length > 10 ? new Date(iso) : parseISODate(iso))
}

export function formatLongDate(iso: string): string {
  return longFmt.format(iso.length > 10 ? new Date(iso) : parseISODate(iso))
}

export function formatMonth(d: Date): string {
  return monthFmt.format(d)
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso))
}

export function formatPeriod(from: string, to: string): string {
  if (!from && !to) return '–'
  if (!to || from === to) return formatDate(from || to)
  return `${formatDate(from)} – ${formatDate(to)}`
}

export function durationMinutes(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000))
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}:${pad(m)} h`
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${pad(m)}:${pad(s % 60)}`
}

/** Monday-based week start. */
export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (r.getDay() + 6) % 7
  r.setDate(r.getDate() - day)
  return r
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

/** Combines a local date and "HH:MM" into an ISO timestamp. */
export function combineDateTime(date: string, time: string): string {
  const [h, m] = time.split(':').map(Number)
  const d = parseISODate(date)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.toISOString()
}

export function timeOfDay(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}
