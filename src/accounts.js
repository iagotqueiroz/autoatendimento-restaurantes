import bcrypt from 'bcryptjs'
import { transaction, query, str, check } from './db.js'
export function slug(raw) {
  const s = str(raw, 80).toLowerCase()
  check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s), 'Use letras minúsculas, números e hífens no endereço.')
  return s
}
export function email(raw) {
  const e = str(raw, 190).toLowerCase()
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), 'E-mail inválido.')
  return e
}
export async function hash(password) {
  check(
    typeof password === 'string' && password.length >= 10 && Buffer.byteLength(password) <= 72,
    'Use pelo menos 10 caracteres e até 72 bytes na senha.',
  )
  return bcrypt.hash(password, 12)
}
export async function register(data, connection) {
  const encoded = await hash(data.password)
  const create = async (db) => {
    const store = await query(
      "INSERT INTO stores(name,slug,subscription,expires) VALUES(?,?,'pendente',UTC_DATE())",
      [str(data.store), slug(data.slug)],
      db,
    )
    const user = await query(
      'INSERT INTO users(store_id,name,email,hash,role) VALUES(?,?,?,?,?)',
      [store.insertId, str(data.name), email(data.email), encoded, 'dono'],
      db,
    )
    return user.insertId
  }
  return connection ? create(connection) : transaction(create)
}
