import fs from 'node:fs/promises'
import { pool } from '../src/db.js'
export async function migrate() {
  const db = await pool.getConnection()
  try {
    const [[lock]] = await db.query(
      "SELECT GET_LOCK(CONCAT('mesa-migrate-',LEFT(SHA2(DATABASE(),256),35)),30) AS ok",
    )
    if (!lock.ok) throw Error('Outra migração está em execução.')
    await db.query(
      'CREATE TABLE IF NOT EXISTS migrations (name VARCHAR(180) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
    )
    const [done] = await db.query('SELECT name FROM migrations')
    for (const file of (await fs.readdir('migrations')).filter((x) => x.endsWith('.sql')).sort()) {
      if (done.some((x) => x.name === file)) continue
      const sql = await fs.readFile('migrations/' + file, 'utf8')
      for (const statement of sql.split(/;\s*(?:\n|$)/).filter((x) => x.trim()))
        await db.query(statement)
      await db.execute('INSERT INTO migrations(name) VALUES(?)', [file])
      console.log('Aplicada ' + file)
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK(CONCAT('mesa-migrate-',LEFT(SHA2(DATABASE(),256),35)))")
    db.release()
  }
}
