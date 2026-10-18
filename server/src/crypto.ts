import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 32, SCRYPT)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Session tokens are only stored as hashes, a leaked database doesn't reveal them. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(`kontor-smtp:${secret}`).digest()
}

/** AES-256-GCM, output is iv.tag.ciphertext in base64url. */
export function encrypt(plain: string, secret: string): string {
  if (!secret) throw new Error('KONTOR_SECRET ist nicht gesetzt – Zugangsdaten können nicht verschlüsselt gespeichert werden.')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.')
}

export function decrypt(sealed: string, secret: string): string {
  const [iv, tag, data] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
