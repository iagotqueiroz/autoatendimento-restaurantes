const menu = document.querySelector('#menu'),
  products = JSON.parse(menu.dataset.products)
const by = (id) => document.getElementById(id),
  dialog = by('dialog'),
  content = by('content')
const kiosk = menu.dataset.kiosk === 'true',
  table = menu.dataset.table === 'true',
  preview = menu.dataset.preview === 'true',
  key = 'mesa.cart:' + menu.dataset.base,
  visitKey = 'mesa.visit:' + menu.dataset.base
const uuid = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(18)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('')
const empty = () => ({
  items: [],
  attempt: uuid(),
  mode: '',
  pending: false,
  visit: table ? localStorage.getItem(visitKey) || '' : '',
})
let cart = JSON.parse(localStorage.getItem(key) || 'null') || empty()
const money = (n) => (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const total = () => cart.items.reduce((n, i) => n + i.quantity * i.unit, 0)
function save() {
  localStorage.setItem(key, JSON.stringify(cart))
  by('bag').textContent =
    'Ver carrinho (' + cart.items.reduce((n, i) => n + i.quantity, 0) + ') · ' + money(total())
}
function el(tag, text, parent = content) {
  const e = document.createElement(tag)
  e.textContent = text
  parent.append(e)
  return e
}
function button(text, fn, parent = content) {
  const b = el('button', text, parent)
  b.type = 'button'
  b.onclick = fn
  return b
}
function modal() {
  content.replaceChildren()
  if (!dialog.open) dialog.showModal()
}
by('close').onclick = () => dialog.close()
function detail(id, index = -1) {
  if (cart.pending) return review()
  const p = products.find((x) => x.id === id),
    old = cart.items[index]
  if (!p) return review('Este produto ficou indisponível. Remova o item.')
  modal()
  if (p.image) {
    const photo = el('img', '')
    photo.src = '/img/' + p.image
    photo.alt = p.name
    photo.className = 'detail-photo'
  }
  el('h2', p.name)
  el('p', p.description)
  const inputs = []
  for (const g of p.groups) {
    const field = el('fieldset', '')
    el('legend', g.name + ' · escolha de ' + g.min + ' a ' + g.max, field)
    for (const o of g.options) {
      const label = el('label', '', field),
        input = el('input', '', label)
      label.className = 'check'
      input.type = 'checkbox'
      input.checked = old?.options.includes(o.id) || false
      label.append(o.name + ' · ' + money(o.price))
      inputs.push({ g, o, input })
      input.onchange = update
    }
  }
  const label = el('label', 'Quantidade'),
    qty = el('input', '', label)
  qty.type = 'number'
  qty.min = 1
  qty.max = 99
  qty.value = old?.quantity || 1
  qty.oninput = update
  const note = el('textarea', '', el('label', 'Observação'))
  note.maxLength = 300
  note.value = old?.note || ''
  const action = button('', () => {
    const selected = inputs.filter((x) => x.input.checked)
    const item = {
      id: p.id,
      name: p.name,
      image: p.image,
      quantity: Number(qty.value),
      note: note.value,
      options: selected.map((x) => x.o.id),
      labels: selected.map((x) => x.o.name),
      unit: unit(),
    }
    if (index < 0) cart.items.push(item)
    else cart.items[index] = item
    save()
    if (index < 0) dialog.close()
    else review()
  })
  function unit() {
    return inputs.reduce((s, x) => s + (x.input.checked ? x.o.price : 0), p.promo ?? p.price)
  }
  function update() {
    const valid = p.groups.every((g) => {
      const n = inputs.filter((x) => x.g === g && x.input.checked).length
      return n >= g.min && n <= g.max
    })
    action.disabled = !valid || !qty.checkValidity() || !qty.value
    action.textContent =
      (old ? 'Salvar item' : 'Adicionar') + ' · ' + money(unit() * Number(qty.value))
  }
  update()
}
function review(message = '') {
  modal()
  el('h2', 'Revisar pedido')
  el('p', 'Confira os itens antes de enviar para a cozinha.').className = 'cart-review-intro'
  for (const [index, i] of cart.items.entries()) {
    const line = el('article', '')
    line.className = 'cart-review-line'
    if (i.image) {
      const photo = el('img', '', line)
      photo.src = '/img/' + i.image
      photo.alt = ''
      photo.className = 'cart-review-thumb'
    } else {
      const placeholder = el('span', i.name.charAt(0).toUpperCase(), line)
      placeholder.className = 'cart-review-placeholder'
    }
    const info = el('div', '', line)
    info.className = 'cart-review-info'
    el('h3', i.quantity + ' × ' + i.name, info)
    const details = [...(i.labels || []), i.note].filter(Boolean).join(' · ')
    if (details) el('p', details, info)
    el('b', money(i.quantity * i.unit), line)
    if (!cart.pending) {
      const actions = el('div', '', info)
      actions.className = 'cart-review-actions'
      button('Editar', () => detail(i.id, index), actions).className = 'quiet'
      button(
        'Remover',
        () => {
          cart.items.splice(index, 1)
          save()
          review()
        },
        actions,
      ).className = 'quiet'
    }
  }
  if (message) {
    const alert = el('p', message)
    alert.setAttribute('role', 'alert')
  }
  const checkout = el('div', '')
  checkout.className = 'checkout'
  el('h3', 'Total　' + money(total()), checkout)
  if (!cart.items.length) el('p', 'Seu carrinho está vazio.')
  else if (preview) el('p', 'Prévia do cardápio.')
  else
    button(
      cart.pending ? 'Consultar ou repetir envio' : 'Confirmar pedido',
      async (e) => {
        e.target.disabled = true
        cart.pending = true
        save()
        try {
          const r = await fetch(menu.dataset.base + '/pedido', {
            method: 'POST',
            signal: AbortSignal.timeout(20000),
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': document.querySelector('meta[name=csrf-token]').content,
            },
            body: JSON.stringify(cart),
          })
          const result = await r.json()
          if (!r.ok) {
            if (r.status < 500) {
              cart.pending = false
              save()
            }
            return review(
              result.message + ' Se o cardápio mudou, recarregue a página e edite o item.',
            )
          }
          localStorage.removeItem(key)
          if (table && result.visit) localStorage.setItem(visitKey, result.visit)
          cart = empty()
          dialog.close()
          if (!kiosk) {
            location.assign(result.visit ? '/conta/' + result.visit : '/acompanhar/' + result.token)
            return
          }
          by('browse').hidden = true
          const done = by('done')
          done.hidden = false
          el('h1', 'Pedido nº ' + result.id, done)
          el(
            'p',
            result.policy === 'antes'
              ? 'Pague no caixa e informe o pedido nº ' + result.id
              : 'Aguarde o chamado da equipe para retirar.',
            done,
          )
          if (result.visit)
            button('Pagar com Pix ou cartão', () => location.assign('/conta/' + result.visit), done)
          button('Concluir e voltar ao início', () => location.replace(menu.dataset.base), done)
          let seconds = 20
          const counter = el('p', 'Reinício em 20 s', done)
          setInterval(() => {
            counter.textContent = 'Reinício em ' + --seconds + ' s'
            if (seconds <= 0) location.replace(menu.dataset.base)
          }, 1000)
        } catch {
          review(
            'Envio sem confirmação. Seu carrinho está salvo. Tente novamente com a mesma tentativa.',
          )
        }
      },
      checkout,
    )
}
document
  .querySelectorAll('[data-product]')
  .forEach((b) => (b.onclick = () => detail(Number(b.dataset.product))))
const search = by('menu-search')
if (search) {
  const normalize = (value) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  search.addEventListener('input', () => {
    const term = normalize(search.value.trim())
    let visible = 0
    document.querySelectorAll('.menu-category').forEach((category) => {
      let categoryVisible = 0
      category.querySelectorAll('[data-product]').forEach((product) => {
        const match = !term || normalize(product.textContent).includes(term)
        product.hidden = !match
        if (match) categoryVisible++
      })
      category.hidden = categoryVisible === 0
      visible += categoryVisible
    })
    by('search-empty').hidden = visible !== 0
  })
}
by('bag').onclick = () => review()
if (kiosk) {
  function browse() {
    by('welcome').hidden = true
    by('browse').hidden = false
  }
  by('start').onclick = () => {
    by('start').hidden = true
    by('modes').hidden = false
  }
  document.querySelectorAll('[data-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        cart.mode = b.dataset.mode
        save()
        browse()
      }),
  )
  if (cart.mode) browse()
}
save()
if (cart.pending) review('Confira o resultado do último envio.')
