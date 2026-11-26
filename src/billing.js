import express from 'express'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { one, query, transaction, check } from './db.js'

export const billing = express.Router()
const monthlyCents = Number(process.env.PLAN_MONTHLY_CENTS || 8990)
check(
  Number.isSafeInteger(monthlyCents) && monthlyCents >= 100,
  'PLAN_MONTHLY_CENTS precisa ser um valor inteiro em centavos.',
)
export const plan = {
  code: 'mensal',
  name: 'Plano Mesa Aberta',
  cents: monthlyCents,
}

const token = () => process.env.MERCADO_PAGO_ACCESS_TOKEN
const billingError = (message, detail) =>
  Object.assign(Error(message), { status: 502, billing: true, detail })
const publicUrl = () => {
  try {
    return new URL(process.env.PUBLIC_URL)
  } catch {
    check(false, 'Configure PUBLIC_URL com o endereço completo da plataforma.', 503)
  }
}

export function hasAccess(store) {
  return Boolean(
    store &&
    ['ativa', 'teste'].includes(store.subscription) &&
    DateTime.now().toISODate() <= store.expires,
  )
}

export async function mercadoPago(path, options = {}) {
  if (!token())
    throw billingError(
      'O token do Mercado Pago não foi encontrado. Confira a variável MERCADO_PAGO_ACCESS_TOKEN.',
      'missing_access_token',
    )
  let response
  try {
    response = await fetch('https://api.mercadopago.com' + path, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + token(),
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  } catch {
    throw billingError(
      'O servidor não conseguiu se conectar ao Mercado Pago. Tente novamente em alguns minutos.',
      'network_error',
    )
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const cause = Array.isArray(body.cause)
      ? body.cause
          .map((item) => item.description || item.code)
          .filter(Boolean)
          .join('; ')
      : ''
    const detail = [body.error, body.message, cause].filter(Boolean).join(' · ')
    const message =
      response.status === 401 || response.status === 403
        ? 'O Mercado Pago recusou o Access Token. Confira se você copiou a credencial correta e se ela está ativa.'
        : response.status === 400
          ? 'O Mercado Pago recusou os dados do checkout. Confira a configuração da aplicação e o domínio público.'
          : 'O Mercado Pago não conseguiu criar o checkout agora. Tente novamente em alguns minutos.'
    throw billingError(message, `HTTP ${response.status}${detail ? ' · ' + detail : ''}`)
  }
  return body
}

async function ownerStore(req) {
  check(
    req.user?.role === 'dono',
    'Entre como responsável pela loja para acessar a assinatura.',
    403,
  )
  return one('SELECT * FROM stores WHERE id=?', [req.user.store_id])
}

export async function processPayment(paymentId) {
  if (!/^\d{1,30}$/.test(String(paymentId || ''))) return
  const payment = await mercadoPago('/v1/payments/' + paymentId)
  const checkoutId = String(payment.external_reference || payment.metadata?.checkout_id || '')
  if (!/^[a-f0-9-]{36}$/.test(checkoutId)) return

  await transaction(async (db) => {
    const checkout = await one(
      'SELECT * FROM billing_checkouts WHERE id=? FOR UPDATE',
      [checkoutId],
      db,
    )
    if (!checkout || checkout.provider !== 'mercado_pago') return
    const amount = Math.round(Number(payment.transaction_amount) * 100)
    check(payment.currency_id === 'BRL' && amount === checkout.amount, 'Pagamento divergente.', 409)
    const status = String(payment.status || 'desconhecido').slice(0, 30)
    await query(
      'UPDATE billing_checkouts SET status=?,updated=UTC_TIMESTAMP() WHERE id=?',
      [status, checkout.id],
      db,
    )
    const old = await one(
      'SELECT id,credited FROM billing_payments WHERE provider=? AND external_id=? FOR UPDATE',
      ['mercado_pago', String(payment.id)],
      db,
    )
    const method =
      String(payment.payment_method_id || payment.payment_type_id || '').slice(0, 80) || null
    const approvedAt = payment.date_approved ? new Date(payment.date_approved) : null
    if (old)
      await query(
        'UPDATE billing_payments SET status=?,amount=?,method=?,paid_at=? WHERE id=?',
        [status, amount, method, approvedAt, old.id],
        db,
      )
    else
      await query(
        'INSERT INTO billing_payments(store_id,checkout_id,provider,external_id,status,amount,method,paid_at) VALUES(?,?,?,?,?,?,?,?)',
        [
          checkout.store_id,
          checkout.id,
          'mercado_pago',
          String(payment.id),
          status,
          amount,
          method,
          approvedAt,
        ],
        db,
      )
    if (status === 'approved' && !old?.credited) {
      await query(
        "UPDATE stores SET subscription='ativa',expires=DATE_ADD(GREATEST(expires,UTC_DATE()),INTERVAL 1 MONTH) WHERE id=?",
        [checkout.store_id],
        db,
      )
      await query(
        'UPDATE billing_payments SET credited=TRUE WHERE provider=? AND external_id=?',
        ['mercado_pago', String(payment.id)],
        db,
      )
    }
  })
}

billing.post('/webhooks/mercado-pago', async (req, res) => {
  const type = req.body?.type || req.query.type || req.query.topic
  const paymentId = req.body?.data?.id || req.query['data.id'] || req.query.id
  if (type === 'payment') await processPayment(paymentId)
  res.sendStatus(200)
})

billing.get('/assinar', async (req, res) => {
  if (!req.user) return res.redirect('/login?destino=assinar')
  const store = await ownerStore(req)
  const error = req.session.billingError
  delete req.session.billingError
  res.render('billing', {
    store,
    plan,
    active: hasAccess(store),
    providerReady: Boolean(token() && process.env.PUBLIC_URL),
    result: req.query.result,
    error,
  })
})

billing.post('/assinar/checkout', async (req, res) => {
  const store = await ownerStore(req)
  check(!hasAccess(store), 'Sua assinatura já está ativa.', 409)
  const base = publicUrl()
  check(
    base.protocol === 'https:' || process.env.NODE_ENV !== 'production',
    'Configure PUBLIC_URL com HTTPS.',
    503,
  )
  const checkoutId = randomUUID()
  const payer = await one('SELECT email FROM users WHERE id=?', [req.user.id])
  await query(
    "INSERT INTO billing_checkouts(id,store_id,provider,status,amount) VALUES(?,?,'mercado_pago','criado',?)",
    [checkoutId, store.id, plan.cents],
  )
  let preference
  try {
    preference = await mercadoPago('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          {
            id: plan.code,
            title: plan.name + ' — 1 mês',
            description: 'Acesso à plataforma de cardápio e autoatendimento por 1 mês',
            category_id: 'services',
            quantity: 1,
            currency_id: 'BRL',
            unit_price: plan.cents / 100,
          },
        ],
        payer: { email: payer.email },
        external_reference: checkoutId,
        metadata: { checkout_id: checkoutId, store_id: store.id },
        notification_url: new URL('/webhooks/mercado-pago', base).href,
        back_urls: {
          success: new URL('/assinar/retorno?result=success', base).href,
          pending: new URL('/assinar/retorno?result=pending', base).href,
          failure: new URL('/assinar/retorno?result=failure', base).href,
        },
        auto_return: 'approved',
        payment_methods: { installments: 1 },
        statement_descriptor: 'MESA ABERTA',
      }),
    })
  } catch (error) {
    if (!error.billing) throw error
    console.error('Falha no checkout do Mercado Pago:', error.detail)
    await query("UPDATE billing_checkouts SET status='erro',updated=UTC_TIMESTAMP() WHERE id=?", [
      checkoutId,
    ])
    req.session.billingError = error.message
    return res.redirect(303, '/assinar')
  }
  await query(
    "UPDATE billing_checkouts SET preference_id=?,status='checkout',updated=UTC_TIMESTAMP() WHERE id=?",
    [preference.id, checkoutId],
  )
  const testCredential = token().startsWith('TEST-')
  const destination = testCredential
    ? preference.sandbox_init_point || preference.init_point
    : preference.init_point || preference.sandbox_init_point
  check(destination && new URL(destination).protocol === 'https:', 'Checkout inválido.', 502)
  res.redirect(303, destination)
})

billing.get('/assinar/retorno', async (req, res) => {
  if (!req.user) return res.redirect('/login')
  if (req.query.payment_id) await processPayment(req.query.payment_id)
  const result = ['success', 'pending', 'failure'].includes(req.query.result)
    ? req.query.result
    : 'pending'
  res.redirect('/assinar?result=' + result)
})
