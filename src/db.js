import 'dotenv/config'
import mysql from 'mysql2/promise'
export const config = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
}
if (!config.database || !config.user) throw Error('Configure DB_NAME e DB_USER no .env.')
export const pool = mysql.createPool({ ...config, connectionLimit: 10 })
export async function query(sql, params = [], db = pool) {
  const [rows] = await db.execute(sql, params)
  return rows
}
export async function one(sql, params = [], db = pool) {
  return (await query(sql, params, db))[0]
}
export async function transaction(task) {
  const db = await pool.getConnection()
  try {
    await db.beginTransaction()
    const result = await task(db)
    await db.commit()
    return result
  } catch (err) {
    await db.rollback()
    throw err
  } finally {
    db.release()
  }
}
export function check(condition, message = 'Dados inválidos.', status = 400) {
  if (!condition) throw Object.assign(Error(message), { status })
}
export function str(value, max = 100) {
  check(typeof value === 'string' && value.trim() && value.trim().length <= max)
  return value.trim()
}
export function num(value, min = 0, max = 2147483647) {
  const n = Number(value)
  check(value !== '' && Number.isSafeInteger(n) && n >= min && n <= max)
  return n
}
export const money = (n) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n / 100)
export const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v)
