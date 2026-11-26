import express from 'express'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { check, one, query, transaction } from './db.js'
import { open, seal } from './secrets.js'

export const payments = express.Router()

const oauthConfig = () => {
  const clientId = process.env.MP_MARKETPLACE_CLIENT_ID
  const clientSecret = process.env.MP_MARKETPLACE_CLIENT_SECRET
  check(clientId && clientSecret, 'A integração marketplace ainda não foi configurada.', 503)
  check(
    /^[a-f0-9]{64}$/i.test(process.env.PAYMENT_TOKEN_ENCRYPTION_KEY || ''),
    'A chave de proteção dos pagamentos ainda não foi configurada.',
    503,
  )
  let base
  try {
    base = new URL(process.env.PUBLIC_URL)
  } catch {
    check(false, 'Configure PUBLIC_URL com o endereço completo da plataforma.', 503)
  }
  check(base.protocol === 'https:' || process.env.NODE_ENV !== 'production', 'PUBLIC_URL precisa usar HTTPS.', 503)
  return {
    clientId,
    clientSecret,
    redirectUri: new URL('/pagamentos/mercado-pago/retorno', base).href,
  }
}

export const marketplaceReady = () =>
  Boolean(
    process.env.MP_MARKETPLACE_CLIENT_ID &&
      process.env.MP_MARKETPLACE_CLIENT_SECRET &&
      /^[a-f0-9]{64}$/i.test(process.env.PAYMENT_TOKEN_ENCRYPTION_KEY || '') &&
      process.env.PUBLIC_URL,
  )

function owner(req) {
  check(req.user?.role === 'dono', 'Entre como responsável pela loja.', 403)
  return req.user
}

function sameState(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function exchange(code, config) {
  let response
  try {
    response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    check(false, 'Não foi possível falar com o Mercado Pago. Tente novamente.', 502)
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Falha OAuth Mercado Pago:', response.status, result.error || result.message || '')
    check(false, 'O Mercado Pago não concluiu a autorização. Tente conectar novamente.', 502)
  }
  check(result.access_token && result.user_id, 'O Mercado Pago retornou uma autorização incompleta.', 502)
  return result
}

async function providerRequest(account, path, options = {}) {
  let response
  try {
    response = await fetch('https://api.mercadopago.com' + path, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + open(account.access_token_encrypted),
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    check(false, 'Não foi possível falar com o Mercado Pago. Tente novamente.', 502)
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Falha Mercado Pago restaurante:', response.status, result.error || result.message || '')
    check(
      false,
      response.status === 401 || response.status === 403
        ? 'A autorização Mercado Pago do restaurante expirou. Peça ao responsável para reconectar a conta.'
        : 'O Mercado Pago não conseguiu iniciar o pagamento. Tente novamente.',
      502,
    )
  }
  return result
}

const connectedAccount = (storeId, db) =>
  one(
    "SELECT * FROM store_payment_accounts WHERE store_id=? AND provider='mercado_pago' AND status='conectada'",
    [storeId],
    db,
  )

const feePercent = () => {
  const value = Number(process.env.MARKETPLACE_FEE_PERCENT || 0)
  check(Number.isFinite(value) && value >= 0 && value <= 20, 'MARKETPLACE_FEE_PERCENT inválido.', 503)
  return value
}

payments.post('/pagamentos/mercado-pago/conectar', async (req, res) => {
  const user = owner(req)
  const config = oauthConfig()
  const state = randomBytes(32).toString('hex')
  req.session.marketplaceOauth = {
    state,
    storeId: user.store_id,
    userId: user.id,
    expires: Date.now() + 10 * 60000,
  }
  const destination = new URL('https://auth.mercadopago.com/authorization')
  destination.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    platform_id: 'mp',
    redirect_uri: config.redirectUri,
    state,
  })
  res.redirect(303, destination.href)
})

payments.get('/pagamentos/mercado-pago/retorno', async (req, res) => {
  const user = owner(req)
  const pending = req.session.marketplaceOauth
  delete req.session.marketplaceOauth
  check(
    pending &&
      pending.storeId === user.store_id &&
      pending.userId === user.id &&
      pending.expires >= Date.now() &&
      sameState(pending.state, req.query.state),
    'Esta autorização expirou ou não pertence a esta sessão. Conecte novamente.',
    403,
  )
  if (req.query.error) return res.redirect('/painel/loja/configuracoes?payment=cancelled')
  check(typeof req.query.code === 'string' && req.query.code.length <= 500, 'Código de autorização inválido.')
  const result = await exchange(req.query.code, oauthConfig())
  const externalUserId = String(result.user_id)
  const expiresAt = Number(result.expires_in)
    ? new Date(Date.now() + Number(result.expires_in) * 1000)
    : null
  await transaction(async (db) => {
    const attached = await one(
      'SELECT store_id FROM store_payment_accounts WHERE provider=? AND external_user_id=? FOR UPDATE',
      ['mercado_pago', externalUserId],
      db,
    )
    check(
      !attached || attached.store_id === user.store_id,
      'Esta conta Mercado Pago já está conectada a outro restaurante.',
      409,
    )
    await query(
      `INSERT INTO store_payment_accounts(store_id,provider,external_user_id,access_token_encrypted,refresh_token_encrypted,scope,expires_at,status)
       VALUES(?,?,?,?,?,?,?,'conectada')
       ON DUPLICATE KEY UPDATE external_user_id=VALUES(external_user_id),access_token_encrypted=VALUES(access_token_encrypted),refresh_token_encrypted=VALUES(refresh_token_encrypted),scope=VALUES(scope),expires_at=VALUES(expires_at),status='conectada',updated=UTC_TIMESTAMP()`,
      [
        user.store_id,
        'mercado_pago',
        externalUserId,
        seal(result.access_token),
        result.refresh_token ? seal(result.refresh_token) : null,
        String(result.scope || '').slice(0, 500) || null,
        expiresAt,
      ],
      db,
    )
  })
  res.redirect('/painel/loja/configuracoes?payment=connected')
})

payments.post('/conta/:token/pagar', async (req, res) => {
  const visit = await one('SELECT * FROM visits WHERE token=?', [req.params.token])
  check(visit, 'Conta de atendimento não encontrada.', 404)
  const account = await connectedAccount(visit.store_id)
  check(account, 'Este restaurante ainda não habilitou o pagamento online.', 409)
  let checkout
  await transaction(async (db) => {
    await one('SELECT id FROM visits WHERE id=? FOR UPDATE', [visit.id], db)
    const active = await one(
      "SELECT * FROM order_payment_checkouts WHERE visit_id=? AND status IN ('criado','checkout','pending','in_process') ORDER BY created DESC LIMIT 1 FOR UPDATE",
      [visit.id],
      db,
    )
    if (active?.checkout_url) {
      checkout = active
      return
    }
    check(!active, 'Já existe um pagamento sendo preparado. Aguarde alguns segundos.', 409)
    const orders = await query(
      "SELECT id,total FROM orders WHERE visit_id=? AND stage<>'cancelado' AND payment='pendente' ORDER BY id FOR UPDATE",
      [visit.id],
      db,
    )
    check(orders.length, 'Esta conta não possui saldo pendente.', 409)
    const amount = orders.reduce((sum, order) => sum + order.total, 0)
    const id = randomUUID()
    await query(
      "INSERT INTO order_payment_checkouts(id,store_id,visit_id,provider,status,amount) VALUES(?,?,?,'mercado_pago','criado',?)",
      [id, visit.store_id, visit.id, amount],
      db,
    )
    for (const order of orders)
      await query(
        'INSERT INTO order_payment_items(checkout_id,order_id,amount) VALUES(?,?,?)',
        [id, order.id, order.total],
        db,
      )
    checkout = { id, amount }
  })
  if (checkout.checkout_url) return res.redirect(303, checkout.checkout_url)
  const base = new URL(process.env.PUBLIC_URL)
  const percentage = feePercent()
  const marketplaceFee = Math.round((checkout.amount * percentage) / 100) / 100
  let preference
  try {
    preference = await providerRequest(account, '/checkout/preferences', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': checkout.id },
      body: JSON.stringify({
        items: [
          {
            id: checkout.id,
            title: 'Conta do atendimento',
            description: 'Pedidos realizados no restaurante',
            category_id: 'food',
            quantity: 1,
            currency_id: 'BRL',
            unit_price: checkout.amount / 100,
          },
        ],
        external_reference: checkout.id,
        metadata: { checkout_id: checkout.id, visit_id: visit.id, store_id: visit.store_id },
        notification_url: new URL('/webhooks/mercado-pago/pedidos', base).href,
        back_urls: {
          success: new URL('/conta/' + visit.token + '?payment=success', base).href,
          pending: new URL('/conta/' + visit.token + '?payment=pending', base).href,
          failure: new URL('/conta/' + visit.token + '?payment=failure', base).href,
        },
        auto_return: 'approved',
        payment_methods: { installments: 1 },
        ...(marketplaceFee > 0 ? { marketplace_fee: marketplaceFee } : {}),
      }),
    })
  } catch (error) {
    await query(
      "UPDATE order_payment_checkouts SET status='erro',updated=UTC_TIMESTAMP() WHERE id=?",
      [checkout.id],
    )
    throw error
  }
  const destination = preference.init_point || preference.sandbox_init_point
  check(destination && new URL(destination).protocol === 'https:', 'Checkout inválido.', 502)
  await query(
    "UPDATE order_payment_checkouts SET preference_id=?,checkout_url=?,status='checkout',updated=UTC_TIMESTAMP() WHERE id=?",
    [preference.id, destination, checkout.id],
  )
  res.redirect(303, destination)
})

export async function processOrderPayment(paymentId, providerUserId) {
  if (!/^\d{1,30}$/.test(String(paymentId || ''))) return
  if (!/^\d{1,30}$/.test(String(providerUserId || ''))) return
  const account = await one(
    "SELECT * FROM store_payment_accounts WHERE provider='mercado_pago' AND external_user_id=? AND status='conectada'",
    [String(providerUserId)],
  )
  if (!account) return
  const payment = await providerRequest(account, '/v1/payments/' + paymentId)
  const checkoutId = String(payment.external_reference || payment.metadata?.checkout_id || '')
  if (!/^[a-f0-9-]{36}$/.test(checkoutId)) return
  await transaction(async (db) => {
    const checkout = await one(
      'SELECT * FROM order_payment_checkouts WHERE id=? AND store_id=? FOR UPDATE',
      [checkoutId, account.store_id],
      db,
    )
    if (!checkout) return
    const amount = Math.round(Number(payment.transaction_amount) * 100)
    check(payment.currency_id === 'BRL' && amount === checkout.amount, 'Pagamento divergente.', 409)
    if (payment.collector_id)
      check(String(payment.collector_id) === String(account.external_user_id), 'Recebedor divergente.', 409)
    const status = String(payment.status || 'desconhecido').slice(0, 30)
    const method =
      String(payment.payment_method_id || payment.payment_type_id || '').slice(0, 80) || null
    await query(
      'UPDATE order_payment_checkouts SET status=?,external_payment_id=?,method=?,updated=UTC_TIMESTAMP() WHERE id=?',
      [status, String(payment.id), method, checkout.id],
      db,
    )
    if (status === 'approved' && !checkout.credited) {
      const paidAt = payment.date_approved ? new Date(payment.date_approved) : new Date()
      await query(
        `UPDATE orders o JOIN order_payment_items i ON i.order_id=o.id
         SET o.payment=IF(o.stage='cancelado','a devolver','pago'),o.method=?,o.cashier='Mercado Pago',o.paid_at=?
         WHERE i.checkout_id=? AND o.payment='pendente'`,
        [method || 'Online', paidAt, checkout.id],
        db,
      )
      await query('UPDATE order_payment_checkouts SET credited=TRUE WHERE id=?', [checkout.id], db)
      const pending = await one(
        "SELECT COUNT(*) AS total FROM orders WHERE visit_id=? AND stage<>'cancelado' AND (stage<>'entregue' OR payment<>'pago')",
        [checkout.visit_id],
        db,
      )
      if (Number(pending.total) === 0)
        await query(
          "UPDATE visits SET status='encerrada',updated=UTC_TIMESTAMP() WHERE id=?",
          [checkout.visit_id],
          db,
        )
    }
  })
}

payments.post('/webhooks/mercado-pago/pedidos', async (req, res) => {
  const type = req.body?.type || req.query.type || req.query.topic
  const paymentId = req.body?.data?.id || req.query['data.id'] || req.query.id
  const providerUserId = req.body?.user_id || req.query.user_id
  if (type === 'payment') await processOrderPayment(paymentId, providerUserId)
  res.sendStatus(200)
})
