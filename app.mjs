import express from 'express'
import session from 'express-session'
import MySQLStore from 'express-mysql-session'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import { config, one, query, check, money, json } from './src/db.js'
import { register, email } from './src/accounts.js'
import { staff } from './src/private.js'
import { order, accepting } from './src/orders.js'
import { billing, plan } from './src/billing.js'
const app = express(),
  prod = process.env.NODE_ENV === 'production'
check(
  process.env.SESSION_SECRET?.length >= 32,
  'Configure SESSION_SECRET com 32 caracteres ou mais.',
)
async function start() {
  if (process.env.MIGRATE_ON_START === 'true') {
    const { migrate } = await import('./scripts/migrate.js')
    await migrate()
  }
  const sessions = new (MySQLStore(session))(config)
  await sessions.onReady()
  await query('SELECT id FROM stores LIMIT 1')
  app.locals.csrf = ''
  app.locals.user = null
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0))
  app.set('view engine', 'ejs')
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'form-action': [
            "'self'",
            'https://mercadopago.com.br',
            'https://*.mercadopago.com.br',
            'https://mercadopago.com',
            'https://*.mercadopago.com',
          ],
          'upgrade-insecure-requests': prod ? [] : null,
        },
      },
      strictTransportSecurity: prod ? undefined : false,
    }),
  )
  app.use('/assets', express.static('public'))
  app.use(express.urlencoded({ extended: false, limit: '100kb' }))
  app.use(express.json({ limit: '100kb' }))
  app.use(
    session({
      name: 'mesa.sid',
      store: sessions,
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: 12 * 3600000 },
    }),
  )
  app.use(async (req, res, next) => {
    req.user =
      req.session.uid &&
      (await one('SELECT id,name,role,store_id,version FROM users WHERE id=?', [req.session.uid]))
    if (req.user?.version !== req.session.version) req.user = null
    req.session.csrf ??= randomBytes(24).toString('hex')
    res.locals = {
      ...res.locals,
      user: req.user,
      csrf: req.session.csrf,
      money,
      zone: 'America/Sao_Paulo',
      date: (v, z) =>
        DateTime.fromSQL(v, { zone: 'utc' })
          .setZone(z || res.locals.zone)
          .toFormat('dd/MM HH:mm'),
    }
    if (req.user?.store_id)
      res.locals.zone = (await one('SELECT zone FROM stores WHERE id=?', [req.user.store_id])).zone
    res.set('Cache-Control', 'no-store')
    next()
  })
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 25 },
  })
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.is('multipart/form-data')) {
      check(req.user?.role === 'dono', 'Sem permissão.', 403)
      return upload.single('image')(req, res, next)
    }
    next()
  })
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path !== '/webhooks/mercado-pago')
      check(
        (req.get('x-csrf-token') || req.body?._csrf) === req.session.csrf,
        'Sessão expirada. Recarregue a página.',
        403,
      )
    next()
  })
  const limit = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    message: 'Muitas tentativas. Tente novamente em 15 minutos.',
  })
  app.get('/', (req, res) => res.render('landing', { plan }))
  app.get(['/login', '/cadastro'], (req, res) =>
    req.user ? res.redirect('/painel') : res.render('auth', { signup: req.path === '/cadastro' }),
  )
  async function login(req, uid) {
    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    )
    req.session.csrf = randomBytes(24).toString('hex')
    req.session.uid = uid
    req.session.version = (await one('SELECT version FROM users WHERE id=?', [uid])).version
    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    )
  }
  app.post('/cadastro', limit, async (req, res) => {
    await login(req, await register(req.body))
    res.redirect('/assinar')
  })
  app.post('/login', limit, async (req, res) => {
    const u = await one('SELECT * FROM users WHERE email=?', [email(req.body.email)])
    check(
      u &&
        typeof req.body.password === 'string' &&
        (await bcrypt.compare(req.body.password, u.hash)),
      'E-mail ou senha incorretos.',
      401,
    )
    await login(req, u.id)
    res.redirect('/painel')
  })
  app.post('/sair', (req, res, next) =>
    req.session.destroy((err) => (err ? next(err) : res.clearCookie('mesa.sid').redirect('/'))),
  )
  app.use('/', billing)
  app.use('/painel', staff)
  app.get('/img/:id', async (req, res) => {
    const img = await one('SELECT data FROM images WHERE id=?', [req.params.id])
    check(img, 'Imagem não encontrada.', 404)
    res.type('webp').set('Cache-Control', 'public,max-age=31536000,immutable').send(img.data)
  })
  app.use(['/m/:token', '/l/:slug', '/previa'], async (req, res, next) => {
    let store,
      table = null
    if (req.params.token) {
      table = await one('SELECT * FROM tables_rest WHERE token=?', [req.params.token])
      if (table) store = await one('SELECT * FROM stores WHERE id=?', [table.store_id])
    } else if (req.params.slug)
      store = await one('SELECT * FROM stores WHERE slug=?', [req.params.slug])
    else {
      check(req.user?.role === 'dono', 'Sem permissão.', 403)
      store = await one('SELECT * FROM stores WHERE id=?', [req.user.store_id])
    }
    check(store, 'Cardápio não encontrado.', 404)
    const preview = req.baseUrl === '/previa'
    if (req.params.slug && req.user) {
      if (req.method === 'POST' && req.path === '/iniciar') {
        await new Promise((resolve, reject) =>
          req.session.destroy((err) => (err ? reject(err) : resolve())),
        )
        return res.clearCookie('mesa.sid').redirect(req.baseUrl)
      }
      if (req.method === 'GET') return res.render('kiosk-login', { store, base: req.baseUrl })
      check(false, 'Encerre o acesso da equipe para usar este tablet.', 403)
    }
    if (req.method === 'POST' && req.path === '/pedido') {
      check(!preview, 'Prévia do cardápio.', 403)
      return res.json(await order(store.id, table?.token, req.body))
    }
    if (req.path !== '/' || req.method !== 'GET') return next()
    check(store.published || preview, 'Cardápio ainda não publicado.', 404)
    const categories = await query(
      'SELECT * FROM categories WHERE store_id=? ORDER BY position,id',
      [store.id],
    )
    const products = await query(
      'SELECT * FROM products WHERE store_id=? AND available=1 ORDER BY name',
      [store.id],
    )
    res.render('menu', {
      store,
      table,
      preview,
      categories,
      products: products.map((p) => ({ ...p, groups: json(p.groups_json) })),
      open: accepting(store, table),
      base: req.baseUrl,
    })
  })
  async function trackedOrder(token, withItems = false) {
    const o = await one(
      'SELECT o.*,s.name,s.zone,s.slug,t.token AS table_token FROM orders o JOIN stores s ON s.id=o.store_id LEFT JOIN tables_rest t ON t.id=o.table_id WHERE o.token=?',
      [token],
    )
    check(o, 'Pedido não encontrado.', 404)
    if (withItems) o.items = await query('SELECT * FROM items WHERE order_id=? ORDER BY id', [o.id])
    return o
  }
  const orderMessage = (o) =>
    o.stage === 'aguarda caixa'
      ? 'Pague no caixa e informe o número do pedido.'
      : o.stage === 'aguarda aceite'
        ? 'Pedido enviado. Aguardando a confirmação da cozinha.'
        : o.stage === 'aceito'
          ? 'A cozinha aceitou seu pedido.'
          : o.stage === 'em preparo'
            ? 'Seu pedido está sendo preparado.'
            : o.stage === 'pronto'
              ? 'Seu pedido está pronto. Procure a equipe.'
              : o.stage === 'cancelado'
                ? 'Pedido cancelado. Fale com o caixa.'
                : o.stage === 'entregue'
                  ? 'Pedido entregue. Bom apetite!'
                  : 'Acompanhe aqui o andamento do preparo.'
  const orderTitle = (o) =>
    o.stage === 'cancelado'
      ? 'Pedido cancelado'
      : o.stage === 'entregue'
        ? 'Pedido entregue'
        : o.stage === 'pronto'
          ? 'Pedido pronto!'
          : o.stage === 'em preparo'
            ? 'Preparando seu pedido'
            : o.stage === 'aceito'
              ? 'Pedido confirmado'
              : 'Pedido recebido!'
  app.get('/acompanhar/:token/status', async (req, res) => {
    const o = await trackedOrder(req.params.token)
    res.json({
      id: o.id,
      stage: o.stage,
      payment: o.payment,
      title: orderTitle(o),
      message: orderMessage(o),
      updatedAt: new Date().toISOString(),
    })
  })
  app.get('/acompanhar/:token', async (req, res) => {
    const o = await trackedOrder(req.params.token, true)
    res.render('receipt', {
      o,
      json,
      title: orderTitle(o),
      message: orderMessage(o),
      orderAgain: o.table_token ? '/m/' + o.table_token : '/l/' + o.slug,
    })
  })
  async function visitAccount(token) {
    const visit = await one(
      'SELECT v.*,s.name,s.slug,s.zone,t.name AS table_name,t.token AS table_token FROM visits v JOIN stores s ON s.id=v.store_id LEFT JOIN tables_rest t ON t.id=v.table_id WHERE v.token=?',
      [token],
    )
    check(visit, 'Conta de atendimento não encontrada.', 404)
    const orders = await query('SELECT * FROM orders WHERE visit_id=? ORDER BY id', [visit.id])
    if (orders.length) {
      const placeholders = orders.map(() => '?').join(',')
      const items = await query(
        `SELECT * FROM items WHERE order_id IN (${placeholders}) ORDER BY id`,
        orders.map((order) => order.id),
      )
      for (const order of orders) order.items = items.filter((item) => item.order_id === order.id)
    }
    const valid = orders.filter((order) => order.stage !== 'cancelado')
    const total = valid.reduce((sum, order) => sum + order.total, 0)
    const paid = valid
      .filter((order) => order.payment === 'pago')
      .reduce((sum, order) => sum + order.total, 0)
    return {
      visit,
      orders,
      total,
      paid,
      due: Math.max(0, total - paid),
      orderAgain: visit.table_token ? '/m/' + visit.table_token : '/l/' + visit.slug,
    }
  }
  app.get('/conta/:token', async (req, res) => {
    const account = await visitAccount(req.params.token)
    if (req.query.partial === '1') return res.render('visit-content', { account, json })
    res.render('visit', { account, json })
  })
  app.use((req, res) => res.status(404).render('error', { message: 'Página não encontrada.' }))
  app.use((err, req, res, next) => {
    const status =
      err.status ||
      (err.code === 'ER_DUP_ENTRY' ? 409 : err instanceof multer.MulterError ? 400 : 500)
    if (status >= 500) console.error(req.method, err.code || err.name, err.stack?.split('\n')[1])
    const message =
      err.code === 'ER_DUP_ENTRY'
        ? 'E-mail ou endereço já cadastrado.'
        : err instanceof multer.MulterError
          ? 'Confira o arquivo. O limite é de 5 MB.'
          : status === 500
            ? 'Não foi possível concluir. Confira a conexão com o banco.'
            : err.message
    if (req.is('application/json')) res.status(status).json({ message })
    else res.status(status).render('error', { message })
  })
  app.listen(process.env.PORT || 3000, '0.0.0.0', () =>
    console.log('Mesa Aberta na porta ' + (process.env.PORT || 3000)),
  )
}

start().catch((error) => {
  console.error('Falha ao iniciar a aplicação:', error)
  process.exit(1)
})
