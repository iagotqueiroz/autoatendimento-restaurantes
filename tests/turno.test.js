import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import dotenv from 'dotenv'
import { request, chromium } from 'playwright'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import sharp from 'sharp'
const loaded = dotenv.config({ path: '.env.test', override: true, quiet: true })
assert.ok(
  !loaded.error && loaded.parsed.DB_NAME.endsWith('_test'),
  'Crie .env.test com um DB_NAME exclusivo terminado em _test.',
)
const { pool, query, one, json } = await import('../src/db.js')
const { migrate } = await import('../scripts/migrate.js')
const base = 'http://127.0.0.1:' + Number(process.env.TEST_PORT || 3319),
  suffix = randomUUID().slice(0, 8)
let server, A, B, client, table, store, product, category, options, paid, later, menu, image
const contexts = []
async function start() {
  server = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      PORT: new URL(base).port,
      PUBLIC_URL: base,
      NODE_ENV: 'test',
      TRUST_PROXY: '0',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(() => {
      throw Error('Servidor encerrou')
    }),
  ])
}
async function stop() {
  if (server && server.exitCode === null) {
    const done = once(server, 'exit')
    server.kill()
    await done
  }
}
async function context() {
  const ctx = await request.newContext({ baseURL: base })
  contexts.push(ctx)
  return ctx
}
async function csrf(ctx, path = '/login') {
  const r = await ctx.get(path)
  assert.equal(r.status(), 200)
  return (await r.text()).match(/name="csrf-token" content="([^"]+)"/)[1]
}
async function signup(tag) {
  const ctx = await context(),
    slug = tag + '-' + suffix
  const response = await ctx.post('/cadastro', {
    form: {
      _csrf: await csrf(ctx),
      name: tag,
      slug,
      store: slug,
      email: slug + '@test.example',
      password: randomUUID(),
      role: 'admin',
    },
  })
  assert.equal(response.status(), 200)
  assert.match(await response.text(), /Ative sua loja para continuar/)
  await query("UPDATE stores SET subscription='teste',expires='2099-01-01' WHERE slug=?", [slug])
  const panel = await ctx.get('/painel/loja')
  assert.equal(panel.status(), 200)
  assert.match(await panel.text(), /Minha loja/)
  return { ctx, slug, token: await csrf(ctx, '/painel/loja') }
}
const ownerPost = (account, path, data) =>
  account.ctx.post('/painel/loja/' + path, { form: { ...data, _csrf: account.token } })
const submit = (path, input) =>
  client.ctx.post(path + '/pedido', { data: input, headers: { 'x-csrf-token': client.token } })
function basket() {
  return {
    attempt: randomUUID(),
    mode: 'Levar',
    items: [{ id: product, unit: 2250, quantity: 2, options: [options[1].id], note: 'Sem gelo' }],
  }
}
const act = (id, action, extra = {}) =>
  A.ctx.post('/painel/pedidos/' + id, {
    form: { _csrf: A.token, action, ...extra },
    maxRedirects: 0,
  })
before(async () => {
  await migrate()
  await start()
})
after(async () => {
  await stop()
  for (const c of contexts) await c.dispose()
  await pool.end()
})
test('01 · Cadastro, produto com foto, publicação e QR decodificado', async () => {
  A = await signup('a')
  B = await signup('b')
  store = (await one('SELECT id FROM stores WHERE slug=?', [A.slug])).id
  assert.equal((await ownerPost(A, 'categorias', { name: 'Pratos', position: '0' })).status(), 200)
  category = (await one('SELECT id FROM categories WHERE store_id=?', [store])).id
  const photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
    .png()
    .toBuffer()
  const r = await A.ctx.post('/painel/loja/produtos', {
    multipart: {
      _csrf: A.token,
      name: 'Prato teste',
      category: String(category),
      price: '25,00',
      promo: '20,00',
      groups: 'Bebida | 1 | 1 | Água=0; Suco=2,50',
      image: { name: 'prato.png', mimeType: 'image/png', buffer: photo },
    },
  })
  assert.equal(r.status(), 200)
  const p = await one('SELECT * FROM products WHERE store_id=?', [store])
  product = p.id
  options = json(p.groups_json)[0].options
  image = p.image
  assert.equal((await ownerPost(A, 'mesas', { name: 'Mesa 5' })).status(), 200)
  table = await one('SELECT * FROM tables_rest WHERE store_id=?', [store])
  assert.equal(
    (
      await ownerPost(A, 'config', {
        name: 'Loja A',
        slug: A.slug,
        zone: 'America/Sao_Paulo',
        opens: '00:00',
        closes: '00:00',
        tables_enabled: 'on',
        kiosk_enabled: 'on',
        published: 'on',
        taking: 'on',
        table_pay: 'depois',
        kiosk_pay: 'antes',
      })
    ).status(),
    200,
  )
  const png = PNG.sync.read(await (await A.ctx.get('/painel/qr/' + table.id)).body())
  menu = '/m/' + table.token
  assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height).data, base + menu)
  client = { ctx: await context() }
  client.token = await csrf(client.ctx, menu)
})
test('02 · Isolamento de leitura, alteração e referências; CSRF', async () => {
  assert.equal((await B.ctx.get('/painel/qr/' + table.id)).status(), 404)
  assert.equal(
    (
      await ownerPost(B, 'produtos', { id: product, category, name: 'Inválido', price: '1' })
    ).status(),
    400,
  )
  await ownerPost(B, 'disponibilidade', { id: product })
  assert.equal((await one('SELECT available FROM products WHERE id=?', [product])).available, 1)
  assert.equal(
    (await A.ctx.post('/painel/loja/mesas', { form: { name: 'Inválida' } })).status(),
    403,
  )
  assert.equal((await A.ctx.get('/painel/plataforma')).status(), 403)
})
test('03 · Limites, adicional externo, promoção e mudança de preço', async () => {
  for (const selection of [[], ['outra-loja'], options.map((x) => x.id)]) {
    const i = basket()
    i.items[0].options = selection
    assert.ok((await submit(menu, i)).status() >= 400)
  }
  const i = basket()
  i.items[0].unit = 100
  assert.equal((await submit(menu, i)).status(), 409)
})
test('04 · QR, clique simultâneo e repetição depois da perda da resposta', async () => {
  const i = basket()
  const results = await Promise.all([submit(menu, i), submit(menu, i)])
  for (const r of results) assert.equal(r.status(), 200)
  const values = await Promise.all(results.map((r) => r.json()))
  later = values[0].id
  assert.equal(later, values[1].id)
  assert.equal((await (await submit(menu, i)).json()).id, later)
  const o = await one('SELECT * FROM orders WHERE id=?', [later])
  assert.equal(o.table_id, table.id)
  assert.equal(o.origin, 'Mesa 5')
  assert.equal(o.policy, 'depois')
  assert.equal(o.total, 4500)
  assert.match(
    await (await A.ctx.get('/painel/cozinha')).text(),
    new RegExp('Pedido #' + later + '<'),
  )
  assert.equal(
    (
      await B.ctx.post('/painel/pedidos/' + later, { form: { _csrf: B.token, action: 'aceito' } })
    ).status(),
    404,
  )
  assert.equal((await client.ctx.get('/acompanhar/' + later)).status(), 404)
  assert.equal((await client.ctx.get('/acompanhar/' + values[0].token)).status(), 200)
})
test('05 · Antecipado, baixa concorrente, fila da cozinha e devolução', async () => {
  const r = await submit('/l/' + A.slug, basket())
  assert.equal(r.status(), 200)
  paid = (await r.json()).id
  const o = await one('SELECT * FROM orders WHERE id=?', [paid])
  assert.equal(o.mode, 'Levar')
  assert.equal(o.origin, 'Balcão')
  assert.doesNotMatch(
    await (await A.ctx.get('/painel/cozinha')).text(),
    new RegExp('Pedido #' + paid + '<'),
  )
  const responses = await Promise.all([
    act(paid, 'pagar', { method: 'Pix presencial' }),
    act(paid, 'pagar', { method: 'Dinheiro' }),
  ])
  assert.deepEqual(responses.map((r) => r.status()).sort(), [302, 409])
  assert.match(
    await (await A.ctx.get('/painel/cozinha')).text(),
    new RegExp('Pedido #' + paid + '<'),
  )
  assert.equal((await act(paid, 'cancelar', { reason: 'Cliente desistiu' })).status(), 302)
  assert.equal((await one('SELECT payment FROM orders WHERE id=?', [paid])).payment, 'a devolver')
  assert.equal((await act(paid, 'devolver')).status(), 302)
})
test('06 · Preparo, entrega e pagamento posterior independentes', async () => {
  assert.equal((await act(later, 'pronto')).status(), 409)
  for (const stage of ['aceito', 'em preparo', 'pronto', 'entregue'])
    assert.equal((await act(later, stage)).status(), 302)
  assert.equal((await one('SELECT payment FROM orders WHERE id=?', [later])).payment, 'pendente')
  assert.equal((await act(later, 'pagar', { method: 'Cartão' })).status(), 302)
})
test('07 · Fechamento, suspensão, vencimento e item pausado', async () => {
  for (const [column, value, original] of [
    ['taking', 0, 1],
    ['subscription', 'suspensa', 'teste'],
    ['expires', '2000-01-01', '2099-01-01'],
    ['tables_enabled', 0, 1],
  ]) {
    await query('UPDATE stores SET ' + column + '=? WHERE id=?', [value, store])
    assert.equal((await submit(menu, basket())).status(), 409)
    await query('UPDATE stores SET ' + column + '=? WHERE id=?', [original, store])
  }
  await ownerPost(A, 'disponibilidade', { id: product })
  assert.equal((await submit(menu, basket())).status(), 409)
  await ownerPost(A, 'disponibilidade', { id: product })
})
test('08 · Tablet no Chromium, compra e carrinho limpo para o próximo cliente', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  try {
    const page = await browser.newPage()
    await page.goto(base + '/l/' + A.slug)
    await page.getByText('Iniciar pedido').click()
    await page.getByRole('button', { name: 'Comer aqui' }).click()
    await page.locator('[data-product]').click()
    await page.getByLabel(/Suco/).check()
    await page.getByRole('button', { name: /Adicionar/ }).click()
    await page.locator('#bag').click()
    await page.getByText('Confirmar pedido', { exact: true }).click()
    await page.getByText('Concluir e voltar ao início').click()
    await page.getByText('Iniciar pedido').click()
    await page.getByRole('button', { name: 'Levar', exact: true }).click()
    assert.match(await page.locator('#bag').innerText(), /\(0\)/)
    assert.equal(
      (await one('SELECT mode FROM orders WHERE store_id=? ORDER BY id DESC LIMIT 1', [store]))
        .mode,
      'Comer aqui',
    )
  } finally {
    await browser.close()
  }
})
test('09 · Histórico, imagens e sessão após migração repetida e reinício', async () => {
  const img = await A.ctx.get('/img/' + image)
  assert.equal(img.headers()['content-type'], 'image/webp')
  const bytes = await img.body()
  await ownerPost(A, 'produtos', {
    id: product,
    category,
    name: 'Prato atualizado',
    price: '99,00',
    groups: '',
  })
  await stop()
  await migrate()
  await start()
  assert.deepEqual(await (await A.ctx.get('/img/' + image)).body(), bytes)
  assert.equal((await A.ctx.get('/painel/loja', { maxRedirects: 0 })).status(), 200)
  const item = await one('SELECT * FROM items WHERE order_id=?', [later])
  assert.equal(item.name, 'Prato teste')
  assert.equal(item.base, 2000)
  assert.equal(json(item.options_json)[0].price, 250)
})

test('10 · Caixa e cozinha com logins próprios e suspensão administrativa', async () => {
  const { hash } = await import('../src/accounts.js')
  const pass = randomUUID(),
    auth = {}
  async function signIn(role) {
    const ctx = await context()
    const r = await ctx.post('/login', {
      form: { _csrf: await csrf(ctx), email: role + suffix + '@test.example', password: pass },
    })
    assert.equal(r.status(), 200)
    assert.equal(new URL(r.url()).pathname, '/painel/' + (role === 'admin' ? 'plataforma' : role))
    return { ctx, token: await csrf(ctx, '/painel') }
  }
  for (const role of ['caixa', 'cozinha']) {
    const r = await ownerPost(A, 'equipe', {
      role,
      name: role,
      email: role + suffix + '@test.example',
      password: pass,
    })
    assert.equal(r.status(), 200)
    auth[role] = await signIn(role)
  }
  const adminEmail = 'admin' + suffix + '@test.example'
  await query('INSERT INTO users(name,email,role,hash) VALUES(?,?,?,?)', [
    'Admin',
    adminEmail,
    'admin',
    await hash(pass),
  ])
  auth.admin = await signIn('admin')
  const input = basket()
  input.items[0].unit = 9900
  input.items[0].options = []
  const r = await submit(menu, input)
  assert.equal(r.status(), 200)
  const { id } = await r.json()
  const update = (status) =>
    auth.admin.ctx.post('/painel/plataforma/' + store, {
      form: { _csrf: auth.admin.token, status, expires: '2099-05-01' },
    })
  assert.equal((await update('suspensa')).status(), 200)
  assert.equal((await submit(menu, { ...input, attempt: randomUUID() })).status(), 409)
  assert.equal((await auth.cozinha.ctx.get('/painel/caixa')).status(), 402)
  assert.equal((await auth.caixa.ctx.get('/painel/loja')).status(), 402)
  assert.equal((await update('ativa')).status(), 200)
  assert.equal((await auth.cozinha.ctx.get('/painel/caixa')).status(), 403)
  assert.equal((await auth.caixa.ctx.get('/painel/loja')).status(), 403)
  const action = (u, step) =>
    u.ctx.post('/painel/pedidos/' + id, {
      form: { _csrf: u.token, action: step, method: 'Dinheiro' },
      maxRedirects: 0,
    })
  assert.equal((await action(auth.cozinha, 'pagar')).status(), 403)
  assert.equal((await action(auth.caixa, 'aceito')).status(), 403)
  assert.equal((await action(auth.caixa, 'pagar')).status(), 302)
  assert.equal((await action(auth.cozinha, 'aceito')).status(), 302)
})

test('11 · Celular recupera o pedido após perder a resposta do servidor', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(base + menu)
    await page.locator('[data-product]').click()
    await page.getByRole('button', { name: /Adicionar/ }).click()
    await page.locator('#bag').click()
    const path = '**' + menu + '/pedido'
    let firstId
    await page.route(path, async (route) => {
      const response = await route.fetch()
      firstId = (await response.json()).id
      await route.abort('connectionreset')
    })
    await page.getByText('Confirmar pedido', { exact: true }).click()
    await page.getByText('Consultar ou repetir envio').waitFor()
    await page.unroute(path)
    await page.reload()
    await page.getByText('Consultar ou repetir envio').click()
    await page.waitForURL('**/acompanhar/*')
    assert.equal(await page.locator('h1').innerText(), 'Pedido #' + firstId)
    const orders = await query('SELECT id FROM orders WHERE store_id=? AND id>=?', [store, firstId])
    assert.equal(orders.length, 1)
  } finally {
    await browser.close()
  }
})

test('12 · Ativar tablet em navegador da equipe encerra a sessão privilegiada', async () => {
  const path = '/l/' + A.slug
  assert.match(await (await A.ctx.get(path)).text(), /Encerrar acesso e abrir balcão/)
  const r = await A.ctx.post(path + '/iniciar', { form: { _csrf: A.token } })
  assert.equal(r.status(), 200)
  assert.match(await r.text(), /Iniciar pedido/)
  const denied = await A.ctx.get('/painel/loja', { maxRedirects: 0 })
  assert.equal(denied.headers().location, '/login')
})

test('13 · Dono configura grupo de adicionais pelo formulário no navegador', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  try {
    const owner = await signup('editor')
    const ctx = await browser.newContext({
      baseURL: base,
      storageState: await owner.ctx.storageState(),
    })
    const page = await ctx.newPage()
    await page.goto('/painel/loja/categorias')
    const cat = page.locator('#categorias form').last()
    await cat.getByLabel('Nova categoria').fill('Sobremesas')
    await cat.getByText('Criar categoria').click()
    await page.goto('/painel/loja/produtos')
    await page.getByText('Cadastrar produto', { exact: false }).click()
    const form = page.locator('#produtos details form').first()
    await form.getByLabel('Nome do produto', { exact: true }).fill('Sorvete')
    await form.getByLabel('Preço normal (R$)', { exact: true }).fill('10,00')
    await form.getByText('Adicionar grupo', { exact: false }).click()
    await form.getByLabel('Nome do grupo').fill('Cobertura')
    await form.getByLabel('Opção', { exact: true }).fill('Chocolate')
    await form.getByLabel('Adicional (R$)').fill('1,50')
    await form.getByText('Cadastrar produto').click()
    await page.getByRole('heading', { name: 'Sorvete' }).waitFor()
    await page.goto('/painel/loja')
    await page.getByRole('button', { name: 'Publicar cardápio', exact: true }).click()
    await page.getByText('Cardápio publicado. O link da loja já pode receber visitantes.').waitFor()
    const saved = await one(
      'SELECT p.groups_json,s.published FROM products p JOIN stores s ON s.id=p.store_id WHERE s.slug=?',
      [owner.slug],
    )
    const [group] = json(saved.groups_json)
    assert.equal(group.name, 'Cobertura')
    assert.equal(group.options[0].price, 150)
    assert.equal(saved.published, 1)
  } finally {
    await browser.close()
  }
})

test('14 · Landing page e bloqueio até a confirmação do pagamento', async () => {
  const visitor = await context()
  const home = await visitor.get('/')
  assert.equal(home.status(), 200)
  assert.match(await home.text(), /Menos espera/)
  assert.match(await home.text(), /R\$\s*89,90/)
  const slug = 'pagamento-' + suffix
  const response = await visitor.post('/cadastro', {
    form: {
      _csrf: await csrf(visitor),
      name: 'Pagamento',
      slug,
      store: 'Loja aguardando pagamento',
      email: slug + '@test.example',
      password: randomUUID(),
    },
  })
  assert.equal(response.status(), 200)
  assert.match(await response.text(), /Ative sua loja para continuar/)
  assert.equal(
    (await one('SELECT subscription FROM stores WHERE slug=?', [slug])).subscription,
    'pendente',
  )
  const blocked = await visitor.get('/painel/loja', { maxRedirects: 0 })
  assert.equal(blocked.status(), 302)
  assert.equal(blocked.headers().location, '/assinar')
})

test('15 · Pagamento em análise libera somente uma mensalidade quando aprovado', async () => {
  const slug = 'webhook-' + suffix
  const storeResult = await query(
    "INSERT INTO stores(name,slug,subscription,expires) VALUES(?,?,'pendente','2099-01-01')",
    ['Loja do webhook', slug],
  )
  const storeId = storeResult.insertId
  const checkoutId = randomUUID()
  await query(
    "INSERT INTO billing_checkouts(id,store_id,provider,status,amount) VALUES(?,?,'mercado_pago','checkout',8990)",
    [checkoutId, storeId],
  )
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'token-de-teste'
  const originalFetch = global.fetch
  const paymentId = String(Date.now())
  let status = 'pending'
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      id: Number(paymentId),
      status,
      currency_id: 'BRL',
      transaction_amount: 89.9,
      external_reference: checkoutId,
      payment_method_id: 'pix',
      date_approved: status === 'approved' ? '2026-11-26T10:00:00-03:00' : null,
    }),
  })
  try {
    const { processPayment } = await import('../src/billing.js')
    await processPayment(paymentId)
    assert.equal(
      (await one('SELECT subscription FROM stores WHERE id=?', [storeId])).subscription,
      'pendente',
    )
    status = 'approved'
    await processPayment(paymentId)
    await processPayment(paymentId)
    const saved = await one('SELECT subscription,expires FROM stores WHERE id=?', [storeId])
    assert.equal(saved.subscription, 'ativa')
    assert.equal(saved.expires, '2099-02-01')
    const payments = await query('SELECT status,credited FROM billing_payments WHERE store_id=?', [
      storeId,
    ])
    assert.deepEqual(payments, [{ status: 'approved', credited: 1 }])
  } finally {
    global.fetch = originalFetch
    delete process.env.MERCADO_PAGO_ACCESS_TOKEN
  }
})

test('16 · Erro do Mercado Pago é traduzido sem expor o token', async () => {
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'token-secreto-de-teste'
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'unauthorized', message: 'invalid access token' }),
  })
  try {
    const { mercadoPago } = await import('../src/billing.js')
    await assert.rejects(mercadoPago('/checkout/preferences'), (error) => {
      assert.equal(error.billing, true)
      assert.match(error.message, /recusou o Access Token/)
      assert.doesNotMatch(error.message + error.detail, /token-secreto-de-teste/)
      return true
    })
  } finally {
    global.fetch = originalFetch
    delete process.env.MERCADO_PAGO_ACCESS_TOKEN
  }
})
