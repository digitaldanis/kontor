import { describe, expect, it } from 'vitest'
import { counterKey, formatDocumentNumber, peekNextNumber, takeNextNumber, validatePattern } from '../numbering'

const d = (s: string) => new Date(`${s}T12:00:00`)

describe('formatDocumentNumber', () => {
  it('fills date tokens and pads the counter', () => {
    expect(formatDocumentNumber('RE-{YYYY}-{0001}', d('2026-03-05'), 7)).toBe('RE-2026-0007')
    expect(formatDocumentNumber('{YY}{MM}-{001}', d('2026-03-05'), 12)).toBe('2603-012')
    expect(formatDocumentNumber('R{N}', d('2026-03-05'), 1234)).toBe('R1234')
  })

  it('does not truncate counters wider than the padding', () => {
    expect(formatDocumentNumber('RE-{01}', d('2026-01-01'), 120)).toBe('RE-120')
  })
})

describe('sequence', () => {
  it('counts gaplessly within a year', () => {
    let seq = { pattern: 'RE-{YYYY}-{0001}', counters: {} as Record<string, number> }
    const numbers: string[] = []
    for (let i = 0; i < 3; i++) {
      const next = takeNextNumber(seq, d('2026-06-01'))
      numbers.push(next.number)
      seq = next.sequence
    }
    expect(numbers).toEqual(['RE-2026-0001', 'RE-2026-0002', 'RE-2026-0003'])
    expect(peekNextNumber(seq, d('2026-12-31'))).toBe('RE-2026-0004')
  })

  it('restarts the counter in a new year', () => {
    const seq = { pattern: 'RE-{YYYY}-{0001}', counters: { '2026': 41 } }
    expect(peekNextNumber(seq, d('2026-12-31'))).toBe('RE-2026-0042')
    expect(peekNextNumber(seq, d('2027-01-01'))).toBe('RE-2027-0001')
  })

  it('never restarts without a date token', () => {
    expect(counterKey('K-{0001}', d('2030-01-01'))).toBe('all')
  })

  it('takes is pure', () => {
    const seq = { pattern: 'RE-{0001}', counters: { all: 1 } }
    takeNextNumber(seq, d('2026-01-01'))
    expect(seq.counters.all).toBe(1)
  })
})

describe('validatePattern', () => {
  it('requires a counter', () => {
    expect(validatePattern('RE-{YYYY}')).toMatch(/Zähler/)
    expect(validatePattern('RE-{YYYY}-{0001}')).toBeNull()
  })
  it('rejects unknown tokens', () => {
    expect(validatePattern('RE-{FOO}-{0001}')).toMatch(/FOO/)
  })
})
