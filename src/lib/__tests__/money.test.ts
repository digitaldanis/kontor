import { describe, expect, it } from 'vitest'
import { parseDecimal, parseMoney } from '../money'

describe('parseMoney', () => {
  it('understands German and English notation', () => {
    expect(parseMoney('1.234,56')).toBe(123456)
    expect(parseMoney('1,234.56')).toBe(123456)
    expect(parseMoney('85')).toBe(8500)
    expect(parseMoney('85,5 €')).toBe(8550)
    expect(parseMoney('0,1')).toBe(10)
  })
  it('rejects garbage', () => {
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('')).toBeNull()
  })
  it('parses quantities', () => {
    expect(parseDecimal('1,5')).toBe(1.5)
    expect(parseDecimal('-2')).toBe(-2)
  })
})
