import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import { one, query, transaction, check, num, json } from './db.js'
export function accepting(store, table) {
  const now = DateTime.now().setZone(store.zone),
    clock = now.toFormat('HH:mm:ss')
  const a = store.opens,
    b = store.closes
  return Boolean(
    store.published &&
    store.taking &&
    store.subscription !== 'suspensa' &&
    now.toISODate() <= store.expires &&
    (table ? store.tables_enabled : store.kiosk_enabled) &&
    (a === b || (a < b ? clock >= a && clock < b : clock >= a || clock < b)),
  )
}
export async function order(storeId, tableToken, input) {
  check(
    typeof input.attempt === 'string' && /^[a-f0-9-]{36}$/.test(input.attempt),
    'Tentativa inválida.',
  )
  return transaction(async (db) => {
    const store = await one('SELECT * FROM stores WHERE id=? FOR UPDATE', [storeId], db)
    const table = tableToken
      ? await one(
          'SELECT * FROM tables_rest WHERE store_id=? AND token=?',
          [storeId, tableToken],
          db,
        )
      : null
    check(!tableToken || table, 'Mesa inválida.', 404)
    const old = await one(
      'SELECT o.id,o.token,o.table_id,o.policy,v.token AS visit FROM orders o LEFT JOIN visits v ON v.id=o.visit_id WHERE o.store_id=? AND o.attempt=?',
      [storeId, input.attempt],
      db,
    )
    if (old) {
      check(old.table_id === (table?.id ?? null))
      return old
    }
    check(accepting(store, table), 'A loja está fechada para este canal.', 409)
    check(table || ['Comer aqui', 'Levar'].includes(input.mode), 'Escolha a modalidade.')
    check(
      Array.isArray(input.items) && input.items.length > 0 && input.items.length <= 50,
      'Carrinho inválido.',
    )
    let total = 0
    const lines = []
    for (const i of input.items) {
      const p = await one(
        'SELECT * FROM products WHERE store_id=? AND id=? FOR UPDATE',
        [storeId, num(i.id, 1)],
        db,
      )
      check(p?.available, (p?.name || 'Produto') + ' indisponível. Revise o carrinho.', 409)
      const groups = json(p.groups_json),
        selected = i.options
      check(
        Array.isArray(selected) &&
          selected.every((id) => typeof id === 'string') &&
          new Set(selected).size === selected.length,
        'Seleção inválida.',
      )
      const extras = []
      for (const g of groups) {
        const choices = g.options.filter((o) => selected.includes(o.id))
        check(
          choices.length >= g.min && choices.length <= g.max,
          'Revise as opções de ' + g.name + '.',
          409,
        )
        extras.push(...choices)
      }
      check(extras.length === selected.length, 'Um adicional foi alterado. Revise o item.', 409)
      const base = p.promo ?? p.price,
        unit = extras.reduce((a, o) => a + o.price, base)
      check(
        unit === i.unit,
        p.name +
          ' agora custa ' +
          (unit / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) +
          '. Revise o item.',
        409,
      )
      const quantity = num(i.quantity, 1, 99),
        note = i.note ?? ''
      check(typeof note === 'string' && note.length <= 300)
      total += quantity * unit
      check(total <= 2147483647, 'Total acima do limite.')
      lines.push([p.id, p.image, p.name, base, JSON.stringify(extras), quantity, note])
    }
    let visit = null
    if (table) {
      if (input.visit) {
        check(
          typeof input.visit === 'string' && /^[a-f0-9]{64}$/.test(input.visit),
          'Conta da mesa inválida.',
        )
        visit = await one(
          'SELECT * FROM visits WHERE token=? AND store_id=? FOR UPDATE',
          [input.visit, storeId],
          db,
        )
        check(visit?.table_id === table.id, 'Esta conta não pertence à mesa informada.', 409)
        if (visit.status !== 'aberta') visit = null
      }
      if (!visit) {
        const visitToken = randomBytes(32).toString('hex')
        const result = await query(
          "INSERT INTO visits(store_id,table_id,token,channel,mode) VALUES(?,?,?,'mesa','Mesa')",
          [storeId, table.id, visitToken],
          db,
        )
        visit = { id: result.insertId, token: visitToken }
      }
    }
    if (!visit) {
      const visitToken = randomBytes(32).toString('hex')
      const result = await query(
        'INSERT INTO visits(store_id,table_id,token,channel,mode) VALUES(?,?,?,?,?)',
        [storeId, null, visitToken, 'totem', input.mode],
        db,
      )
      visit = { id: result.insertId, token: visitToken }
    }
    const policy = table ? store.table_pay : store.kiosk_pay,
      token = randomBytes(32).toString('hex')
    const r = await query(
      'INSERT INTO orders(store_id,attempt,token,visit_id,table_id,origin,mode,policy,total,stage) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [
        storeId,
        input.attempt,
        token,
        visit?.id ?? null,
        table?.id ?? null,
        table?.name ?? 'Balcão',
        table ? 'Mesa' : input.mode,
        policy,
        total,
        policy === 'antes' ? 'aguarda caixa' : 'aguarda aceite',
      ],
      db,
    )
    for (const line of lines)
      await query(
        'INSERT INTO items(order_id,product_id,image,name,base,options_json,quantity,note) VALUES(?,?,?,?,?,?,?,?)',
        [r.insertId, ...line],
        db,
      )
    await query(
      "INSERT INTO events(order_id,actor,action) VALUES(?,'Cliente','Pedido criado')",
      [r.insertId],
      db,
    )
    if (visit)
      await query('UPDATE visits SET updated=UTC_TIMESTAMP() WHERE id=?', [visit.id], db)
    return { id: r.insertId, token, policy, visit: visit?.token ?? null }
  })
}
export async function change(user, id, action, data) {
  return transaction(async (db) => {
    const o = await one(
      'SELECT * FROM orders WHERE store_id=? AND id=? FOR UPDATE',
      [user.store_id, id],
      db,
    )
    check(o, 'Pedido não encontrado.', 404)
    const cashier = ['dono', 'caixa'].includes(user.role),
      kitchen = ['dono', 'cozinha'].includes(user.role)
    const next = {
      'aguarda aceite': 'aceito',
      aceito: 'em preparo',
      'em preparo': 'pronto',
      pronto: 'entregue',
    }
    let reason = null
    if (action === 'pagar') {
      check(cashier, 'Sem permissão.', 403)
      check(o.payment === 'pendente' && o.stage !== 'cancelado', 'Pagamento já resolvido.', 409)
      check(['Dinheiro', 'Pix presencial', 'Cartão'].includes(data.method))
      await query(
        "UPDATE orders SET payment='pago',method=?,cashier=?,paid_at=UTC_TIMESTAMP(),stage=IF(stage='aguarda caixa','aguarda aceite',stage) WHERE id=?",
        [data.method, user.name, id],
        db,
      )
    } else if (action === 'devolver') {
      check(cashier, 'Sem permissão.', 403)
      check(o.payment === 'a devolver', 'Nenhuma devolução pendente.', 409)
      await query("UPDATE orders SET payment='devolvido' WHERE id=?", [id], db)
    } else if (action === 'cancelar') {
      check(cashier, 'Sem permissão.', 403)
      check(!['entregue', 'cancelado'].includes(o.stage), 'Pedido encerrado.', 409)
      reason = data.reason?.trim()
      check(reason && reason.length <= 300, 'Informe o motivo.')
      await query(
        "UPDATE orders SET stage='cancelado', payment=IF(payment='pago','a devolver','cancelado') WHERE id=?",
        [id],
        db,
      )
    } else {
      check(action === 'entregue' ? cashier : kitchen, 'Sem permissão.', 403)
      check(next[o.stage] === action, 'Etapa inválida.', 409)
      await query('UPDATE orders SET stage=? WHERE id=?', [action, id], db)
    }
    await query(
      'INSERT INTO events(order_id,actor,action,reason) VALUES(?,?,?,?)',
      [id, user.name, action, reason],
      db,
    )
    if (o.visit_id) {
      const pending = await one(
        "SELECT COUNT(*) AS total FROM orders WHERE visit_id=? AND stage<>'cancelado' AND (stage<>'entregue' OR payment<>'pago')",
        [o.visit_id],
        db,
      )
      if (Number(pending.total) === 0)
        await query(
          "UPDATE visits SET status='encerrada',updated=UTC_TIMESTAMP() WHERE id=?",
          [o.visit_id],
          db,
        )
      else await query('UPDATE visits SET updated=UTC_TIMESTAMP() WHERE id=?', [o.visit_id], db)
    }
  })
}
