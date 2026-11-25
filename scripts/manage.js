import prompts from 'prompts'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pool, one, query, transaction, check } from '../src/db.js'
import { migrate } from './migrate.js'
import { email, hash, register } from '../src/accounts.js'
import { saveProduct } from '../src/catalog.js'
const action = process.argv[2]
try {
  if (action === 'migrate') {
    await migrate()
    console.log('Banco atualizado.')
  } else if (action === 'admin' || action === 'recover' || action === 'admin-sql') {
    const input = await prompts([
      { type: 'text', name: 'email', message: 'E-mail da conta' },
      { type: 'password', name: 'password', message: 'Nova senha (mínimo 10 caracteres)' },
    ])
    const address = email(input.email),
      encoded = await hash(input.password)
    if (action === 'admin-sql') {
      const addressHex = Buffer.from(address).toString('hex')
      const hashHex = Buffer.from(encoded).toString('hex')
      console.log(
        "INSERT INTO users(name,email,hash,role) VALUES('Administrador',CONVERT(0x" +
          addressHex +
          ' USING utf8mb4),CONVERT(0x' +
          hashHex +
          " USING utf8mb4),'admin');",
      )
    } else if (action === 'admin') {
      await query("INSERT INTO users(name,email,hash,role) VALUES('Administrador',?,?,'admin')", [
        address,
        encoded,
      ])
    } else {
      const r = await query('UPDATE users SET hash=?,version=version+1 WHERE email=?', [
        encoded,
        address,
      ])
      check(r.affectedRows, 'Conta não encontrada.')
    }
    if (action !== 'admin-sql') console.log('Acesso configurado.')
  } else if (action === 'demo') {
    check(process.env.NODE_ENV !== 'production', 'Use a demonstração apenas em desenvolvimento.')
    const { password } = await prompts({
      type: 'password',
      name: 'password',
      message: 'Defina a senha das contas de demonstração (mínimo 10 caracteres)',
    })
    for (const [slug, store] of [
      ['casa-do-almoco', 'Casa do Almoço'],
      ['chapa-do-bairro', 'Chapa do Bairro'],
    ]) {
      if (await one('SELECT id FROM stores WHERE slug=?', [slug])) {
        console.log('Endereço existente, ignorado: ' + slug)
        continue
      }
      await transaction(async (db) => {
        const uid = await register(
          {
            store,
            slug,
            name: 'Dono de demonstração',
            email: 'dono@' + slug + '.example',
            password,
          },
          db,
        )
        const { store_id: id } = await one('SELECT store_id FROM users WHERE id=?', [uid], db)
        for (const role of ['caixa', 'cozinha'])
          await query(
            'INSERT INTO users(store_id,name,email,role,hash) VALUES(?,?,?,?,?)',
            [id, role, role + '@' + slug + '.example', role, await hash(password)],
            db,
          )
        const c = await query(
          "INSERT INTO categories(store_id,name) VALUES(?,'Especialidades')",
          [id],
          db,
        )
        await saveProduct(
          id,
          {
            category: c.insertId,
            name: slug === 'casa-do-almoco' ? 'Frango crocante' : 'Hambúrguer da casa',
            description: 'Especialidade da casa, preparada na hora.',
            price: '32,00',
            promo: '29,90',
            groups: 'Bebida | 1 | 1 | Água=0; Suco=3,00',
          },
          slug === 'casa-do-almoco' ? { buffer: await readFile('public/restaurante.webp') } : null,
          db,
        )
        await query(
          "INSERT INTO tables_rest(store_id,name,token) VALUES(?,'Mesa 1',?)",
          [id, randomUUID()],
          db,
        )
        await query('UPDATE stores SET published=1 WHERE id=?', [id], db)
      })
      console.log('Loja criada: ' + slug)
    }
  } else throw Error('Comando desconhecido.')
} catch (err) {
  console.error(err.code || err.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
