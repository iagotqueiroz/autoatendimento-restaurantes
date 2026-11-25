import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { one, query, check, num, str } from './db.js'
export async function imageId(file, store, db) {
  if (!file) return null
  let buffer
  try {
    const pipeline = sharp(file.buffer, { limitInputPixels: 20000000 })
    const meta = await pipeline.metadata()
    check(['jpeg', 'png', 'webp'].includes(meta.format))
    buffer = await pipeline
      .rotate()
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
  } catch {
    check(false, 'Use uma imagem JPEG, PNG ou WebP de até 5 MB e 20 megapixels.')
  }
  return (await query('INSERT INTO images(store_id,data) VALUES(?,?)', [store, buffer], db))
    .insertId
}
export function cents(raw) {
  check(/^\d{1,5}([.,]\d{1,2})?$/.test(String(raw)), 'Preço inválido.')
  const [a, b = ''] = String(raw).replace(',', '.').split('.')
  return Number(a) * 100 + Number(b.padEnd(2, '0'))
}
export function parseGroups(raw) {
  // Um grupo por linha: nome | mínimo | máximo | opção=preço, separando opções por ponto e vírgula.
  return String(raw || '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const [name, min, max, choices, ...rest] = line.split('|').map((s) => s.trim())
      check(choices && !rest.length, 'Confira o formato do grupo de opções.')
      const options = choices.split(';').map((choice) => {
        const [label, price] = choice.split('=')
        return { id: randomUUID(), name: str(label), price: cents(price?.trim()) }
      })
      return {
        name: str(name),
        min: num(min, 0, options.length),
        max: num(max, Math.max(1, Number(min)), options.length),
        options,
      }
    })
}
export async function saveProduct(store, data, file, db) {
  const cat = await one(
    'SELECT id FROM categories WHERE store_id=? AND id=?',
    [store, num(data.category, 1)],
    db,
  )
  check(cat, 'Categoria inválida.')
  const id = data.id ? num(data.id, 1) : null
  const old =
    id &&
    (await one('SELECT * FROM products WHERE store_id=? AND id=? FOR UPDATE', [store, id], db))
  check(!id || old, 'Produto não encontrado.', 404)
  const image = await imageId(file, store, db),
    price = cents(data.price),
    promo = data.promo ? cents(data.promo) : null
  check(promo === null || promo <= price, 'A promoção supera o preço normal.')
  const description = String(data.description || '')
  check(description.length <= 600)
  const groups = parseGroups(data.groups)
  // Mantém a identidade das opções que continuam com o mesmo nome no mesmo grupo.
  const prior = old
    ? typeof old.groups_json === 'string'
      ? JSON.parse(old.groups_json)
      : old.groups_json
    : []
  for (const g of groups)
    for (const o of g.options) {
      const same = prior.find((x) => x.name === g.name)?.options.find((x) => x.name === o.name)
      if (same) o.id = same.id
    }
  const args = [
    str(data.name),
    cat.id,
    description,
    price,
    promo,
    image ?? old?.image ?? null,
    JSON.stringify(groups),
  ]
  if (old)
    await query(
      'UPDATE products SET name=?,category_id=?,description=?,price=?,promo=?,image=?,groups_json=? WHERE store_id=? AND id=?',
      [...args, store, id],
      db,
    )
  else
    await query(
      'INSERT INTO products(name,category_id,description,price,promo,image,groups_json,store_id) VALUES(?,?,?,?,?,?,?,?)',
      [...args, store],
      db,
    )
}
