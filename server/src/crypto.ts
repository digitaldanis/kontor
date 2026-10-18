import bcrypt from 'bcryptjs'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const BCRYPT_ROUNDS = 12

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return bcrypt.compare(password, stored)
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
