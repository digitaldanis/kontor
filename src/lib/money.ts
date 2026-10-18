const formatters = new Map<string, Intl.NumberFormat>()

export function formatMoney(cents: number, currency = 'EUR'): string {
  let fmt = formatters.get(currency)
  if (!fmt) {
    fmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency })
    formatters.set(currency, fmt)
  }
  return fmt.format(cents / 100)
}

export function formatAmount(cents: number): string {
  return (cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatNumber(value: number, maxFraction = 2): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: maxFraction })
}

/** Parses user input like "1.234,56", "1234.5" or "12" into cents. */
export function parseMoney(input: string): number | null {
  const n = parseDecimal(input)
  if (n === null) return null
  return Math.round(n * 100)
}

export function parseDecimal(input: string): number | null {
  let s = input.trim().replace(/\s|€/g, '')
  if (!s) return null
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // whichever separator comes last is the decimal separator
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (hasComma) {
    s = s.replace(',', '.')
  }
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Integer division with commercial rounding (half away from zero). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const q = (n * 2n + d) / (d * 2n)
  return negative ? -q : q
}

export function toScaled(value: number, decimals: number): bigint {
  const factor = 10 ** decimals
  return BigInt(Math.sign(value) * Math.round(Math.abs(value) * factor))
}
