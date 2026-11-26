import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { check } from './db.js'

function key() {
  const value = process.env.PAYMENT_TOKEN_ENCRYPTION_KEY || ''
  check(
    /^[a-f0-9]{64}$/i.test(value),
    'Configure PAYMENT_TOKEN_ENCRYPTION_KEY com 64 caracteres hexadecimais.',
    503,
  )
  return Buffer.from(value, 'hex')
}

export function seal(value) {
  check(typeof value === 'string' && value, 'Credencial inválida.', 502)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function open(value) {
  const [version, iv, tag, encrypted] = String(value || '').split('.')
  check(version === 'v1' && iv && tag && encrypted, 'Credencial protegida inválida.', 500)
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
