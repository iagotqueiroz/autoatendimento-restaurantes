import express from 'express'
import { randomUUID } from 'node:crypto'
import { IANAZone } from 'luxon'
import QRCode from 'qrcode'
import { one, query, transaction, check, num, str, json } from './db.js'
import { slug, email, hash } from './accounts.js'
import { saveProduct, imageId } from './catalog.js'
import { change } from './orders.js'
import { hasAccess } from './billing.js'
export const staff = express.Router()
export const access =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return res.redirect('/login')
    check(roles.includes(req.user.role), 'Sem permissão.', 403)
    next()
  }
staff.use(access('dono', 'caixa', 'cozinha', 'admin'))
staff.use(async (req, res, next) => {
  if (req.user.role === 'admin') return next()
  const store = await one('SELECT subscription,expires FROM stores WHERE id=?', [req.user.store_id])
  if (hasAccess(store)) return next()
  if (req.user.role === 'dono') return res.redirect('/assinar')
  check(false, 'A assinatura da loja está inativa. Fale com o responsável pelo restaurante.', 402)
})
staff.get('/', (req, res) =>
  res.redirect(
    '/painel/' +
      { dono: 'loja', admin: 'plataforma', caixa: 'caixa', cozinha: 'cozinha' }[req.user.role],
  ),
)
staff.get('/plataforma', access('admin'), async (req, res) =>
  res.render('platform', {
    stores: await query(
      'SELECT s.*, t.started, t.ends FROM stores s LEFT JOIN trials t ON t.store_id=s.id ORDER BY s.id DESC',
    ),
  }),
)
staff.post('/plataforma/:id', access('admin'), async (req, res) => {
  const status = req.body.status
  check(['pendente', 'ativa', 'suspensa', 'teste'].includes(status))
  check(/^\d{4}-\d\d-\d\d$/.test(req.body.expires))
  await query('UPDATE stores SET subscription=?,expires=? WHERE id=?', [
    status,
    req.body.expires,
    num(req.params.id, 1),
  ])
  res.redirect('/painel/plataforma')
})
staff.get(['/loja', '/loja/:area'], access('dono'), async (req, res) => {
  const id = req.user.store_id
  const area = req.params.area || 'inicio'
  check(
    ['inicio', 'categorias', 'produtos', 'mesas', 'equipe', 'configuracoes'].includes(area),
    'Página não encontrada.',
    404,
  )
  const [store, categories, products, tables, team] = await Promise.all([
    one('SELECT * FROM stores WHERE id=?', [id]),
    query('SELECT * FROM categories WHERE store_id=? ORDER BY position,id', [id]),
    query('SELECT * FROM products WHERE store_id=? ORDER BY id DESC', [id]),
    query('SELECT * FROM tables_rest WHERE store_id=? ORDER BY id', [id]),
    query('SELECT id,name,email,role FROM users WHERE store_id=?', [id]),
  ])
  const notices = {
    publicado: 'Cardápio publicado. O link da loja já pode receber visitantes.',
    oculto: 'Cardápio retirado do ar. Os dados e pedidos foram preservados.',
    aberto: 'Recebimento de novos pedidos aberto.',
    pausado: 'Novos pedidos pausados. A equipe ainda pode concluir os pedidos em andamento.',
  }
  res.render('owner', {
    store,
    categories,
    products,
    tables,
    team,
    json,
    notice: notices[req.query.notice],
    area,
  })
})
staff.post('/loja/:section', access('dono'), async (req, res) => {
  const s = req.user.store_id,
    d = req.body,
    section = req.params.section
  await transaction(async (db) => {
    const store = await one('SELECT * FROM stores WHERE id=? FOR UPDATE', [s], db)
    if (section === 'publicacao') {
      check(['publicar', 'ocultar'].includes(d.action), 'Ação inválida.')
      if (d.action === 'publicar') {
        check(
          await one('SELECT id FROM products WHERE store_id=? LIMIT 1', [s], db),
          'Cadastre pelo menos um produto antes de publicar.',
        )
      }
      await query('UPDATE stores SET published=? WHERE id=?', [d.action === 'publicar', s], db)
    } else if (section === 'recebimento') {
      check(['abrir', 'pausar'].includes(d.action), 'Ação inválida.')
      if (d.action === 'abrir')
        check(store.published, 'Publique o cardápio antes de abrir pedidos.')
      await query('UPDATE stores SET taking=? WHERE id=?', [d.action === 'abrir', s], db)
    } else if (section === 'config') {
      check(IANAZone.isValidZone(d.zone), 'Fuso inválido.')
      check(
        [d.opens, d.closes].every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)),
        'Horário inválido.',
      )
      check([d.table_pay, d.kiosk_pay].every((x) => ['antes', 'depois'].includes(x)))
      const logo = await imageId(req.file, s, db)
      await query(
        'UPDATE stores SET name=?,slug=?,zone=?,opens=?,closes=?,published=?,taking=?,tables_enabled=?,kiosk_enabled=?,table_pay=?,kiosk_pay=?,logo=? WHERE id=?',
        [
          str(d.name),
          slug(d.slug),
          d.zone,
          d.opens,
          d.closes,
          d.published === undefined ? store.published : +!!d.published,
          d.taking === undefined ? store.taking : +!!d.taking,
          +!!d.tables_enabled,
          +!!d.kiosk_enabled,
          d.table_pay,
          d.kiosk_pay,
          logo ?? store.logo,
          s,
        ],
        db,
      )
    } else if (section === 'categorias') {
      const values = [str(d.name, 90), num(d.position)]
      if (d.id)
        await query(
          'UPDATE categories SET name=?,position=? WHERE store_id=? AND id=?',
          [...values, s, num(d.id, 1)],
          db,
        )
      else
        await query(
          'INSERT INTO categories(name,position,store_id) VALUES(?,?,?)',
          [...values, s],
          db,
        )
    } else if (section === 'produtos') await saveProduct(s, d, req.file, db)
    else if (section === 'disponibilidade')
      await query(
        'UPDATE products SET available=1-available WHERE store_id=? AND id=?',
        [s, num(d.id, 1)],
        db,
      )
    else if (section === 'mesas') {
      if (d.id)
        await query(
          'UPDATE tables_rest SET name=? WHERE store_id=? AND id=?',
          [str(d.name, 80), s, num(d.id, 1)],
          db,
        )
      else
        await query(
          'INSERT INTO tables_rest(name,store_id,token) VALUES(?,?,?)',
          [str(d.name, 80), s, randomUUID()],
          db,
        )
    } else if (section === 'equipe') {
      check(['caixa', 'cozinha'].includes(d.role))
      await query(
        'INSERT INTO users(store_id,name,email,role,hash) VALUES(?,?,?,?,?)',
        [s, str(d.name), email(d.email), d.role, await hash(d.password)],
        db,
      )
    } else if (section === 'remover-acesso') {
      await query(
        "DELETE FROM users WHERE store_id=? AND id=? AND role IN ('caixa','cozinha')",
        [s, num(d.id, 1)],
        db,
      )
    } else check(false, 'Seção desconhecida.', 404)
  })
  const notice =
    section === 'publicacao'
      ? d.action === 'publicar'
        ? 'publicado'
        : 'oculto'
      : section === 'recebimento'
        ? d.action === 'abrir'
          ? 'aberto'
          : 'pausado'
        : null
  const pages = {
    categorias: 'categorias',
    produtos: 'produtos',
    disponibilidade: 'produtos',
    mesas: 'mesas',
    equipe: 'equipe',
    'remover-acesso': 'equipe',
    config: 'configuracoes',
  }
  res.redirect(
    notice ? '/painel/loja?notice=' + notice : '/painel/loja/' + (pages[section] || 'inicio'),
  )
})
staff.get('/qr/:id', access('dono'), async (req, res) => {
  const t = await one('SELECT token FROM tables_rest WHERE id=? AND store_id=?', [
    num(req.params.id, 1),
    req.user.store_id,
  ])
  check(t, 'Mesa não encontrada.', 404)
  const publicUrl = new URL(process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`)
  check(
    process.env.NODE_ENV !== 'production' || publicUrl.protocol === 'https:',
    'O endereço público precisa usar HTTPS.',
  )
  res.attachment('mesa-' + req.params.id + '.png').send(
    await QRCode.toBuffer(new URL('/m/' + t.token, publicUrl).href, {
      width: 650,
      margin: 4,
    }),
  )
})
staff.get('/:view', access('dono', 'caixa', 'cozinha'), async (req, res) => {
  const view = req.params.view,
    kitchen = view === 'cozinha'
  check(kitchen || view === 'caixa', 'Página não encontrada.', 404)
  check(req.user.role === 'dono' || req.user.role === view, 'Sem permissão.', 403)
  let sql = 'SELECT * FROM orders WHERE store_id=?',
    params = [req.user.store_id]
  if (kitchen) sql += " AND stage IN ('aguarda aceite','aceito','em preparo')"
  else {
    if (req.query.q) {
      sql += ' AND (id=? OR origin LIKE ?)'
      params.push(Number(req.query.q) || 0, '%' + req.query.q + '%')
    }
    for (const key of ['payment', 'stage'])
      if (req.query[key]) {
        sql += ' AND ' + key + '=?'
        params.push(String(req.query[key]))
      }
  }
  const orders = await query(sql + ' ORDER BY id ' + (kitchen ? 'ASC' : 'DESC'), params)
  if (orders.length) {
    const ids = orders.map((o) => o.id),
      placeholders = ids.map(() => '?').join(',')
    const lines = await query(
      'SELECT i.* FROM items i JOIN orders o ON o.id=i.order_id WHERE o.store_id=? AND i.order_id IN (' +
        placeholders +
        ')',
      [req.user.store_id, ...ids],
    )
    const events = kitchen
      ? []
      : await query(
          'SELECT e.* FROM events e JOIN orders o ON o.id=e.order_id WHERE o.store_id=? AND e.order_id IN (' +
            placeholders +
            ') ORDER BY e.id',
          [req.user.store_id, ...ids],
        )
    for (const o of orders) {
      o.items = lines.filter((i) => i.order_id === o.id)
      o.events = events.filter((e) => e.order_id === o.id)
    }
  }
  res.render(req.query.partial === '1' ? 'cards' : 'board', {
    view,
    orders,
    filters: req.query,
    json,
  })
})
staff.post('/pedidos/:id', access('dono', 'cozinha', 'caixa'), async (req, res) => {
  await change(req.user, num(req.params.id, 1), req.body.action, req.body)
  res.redirect(req.body.view === 'cozinha' ? '/painel/cozinha' : '/painel/caixa')
})
