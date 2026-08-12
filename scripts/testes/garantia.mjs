/** Bloco 5 — garantia e retrabalho, pela API real. */
const API = 'http://localhost:8000'
const ANON = process.env.ANON_KEY
let falhas = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { falhas++; console.log(`  \x1b[31m✗\x1b[0m ${m}`) }

async function login(e, s) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: s }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(JSON.stringify(j))
  return j.access_token
}
const H = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
async function rpc(t, n, a) {
  const r = await fetch(`${API}/rest/v1/rpc/${n}`, { method: 'POST', headers: H(t), body: JSON.stringify(a) })
  return { status: r.status, corpo: await r.json().catch(() => null) }
}
const get = async (t, p) => (await fetch(`${API}/rest/v1/${p}`, { headers: H(t) })).json()

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)

/** Foto COM arquivo — desde a 20260807220000 gradiente não libera entrega. */
async function anexarFoto(t, orderId, kind, itemId = null) {
  const r = await fetch(`${API}/rest/v1/order_photos`, {
    method: 'POST', headers: { ...H(t), Prefer: 'return=representation' },
    body: JSON.stringify({
      order_id: orderId, ...(itemId && { order_item_id: itemId }),
      kind, caption: kind, gradient_seed: `t-${crypto.randomUUID()}`,
    }),
  })
  const [linha] = await r.json()
  const caminho = `${orderId}/${crypto.randomUUID()}.jpg`
  await fetch(`${API}/storage/v1/object/order-photos/${caminho}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'image/jpeg' },
    body: JPEG,
  })
  await fetch(`${API}/rest/v1/order_photos?id=eq.${linha.id}`, {
    method: 'PATCH', headers: H(t), body: JSON.stringify({ storage_path: caminho }),
  })
  return linha
}
const patch = async (t, p, b) =>
  fetch(`${API}/rest/v1/${p}`, { method: 'PATCH', headers: H(t), body: JSON.stringify(b) })

const tk = await login('camila@demo.chaveiroformiga.com.br', 'demo1234')
// `attendant` nao escreve em `services` nem le o financeiro (RLS). Para
// mexer na garantia do catalogo e ler o ticket medio, o papel e outro.
const dono = await login('wallace@demo.chaveiroformiga.com.br', 'demo1234')
const [cliente] = await get(tk, 'customers?select=id,name&limit=1')
const [servico] = await get(tk, 'services?select=id,name&limit=1')

console.log('\n1 · Garantia é instantâneo do catálogo')
await patch(dono, `services?id=eq.${servico.id}`, { warranty_days: 90 })

let r = await rpc(tk, 'create_order', {
  p_payload: {
    customer_id: cliente.id,
    notes: '[teste-automatizado]',
    items: [{ service_id: servico.id, quantity: 1, total_amount: 200, description: 'GARANTIA-TESTE' }],
    photos: [{ kind: 'antes', caption: 'x', gradient_seed: 'g-1' }],
  },
})
if (r.status !== 200) { bad(`create_order: ${JSON.stringify(r.corpo)}`); process.exit(1) }
const comanda = r.corpo
let [item] = await get(tk, `order_items?order_id=eq.${comanda.id}&select=id,warranty_days,is_rework`)
if (item.warranty_days === 90) ok('item nasceu com 90 dias vindos do serviço (trigger)')
else bad(`warranty_days = ${item.warranty_days}`)

// O catálogo muda depois; o item não pode mudar junto.
await patch(dono, `services?id=eq.${servico.id}`, { warranty_days: 7 })
;[item] = await get(tk, `order_items?id=eq.${item.id}&select=id,warranty_days`)
if (item.warranty_days === 90) ok('mudar o catálogo depois não reescreve o combinado')
else bad(`instantâneo perdido: ${item.warranty_days}`)

console.log('\n2 · Retrabalho só de item entregue')
r = await rpc(tk, 'create_rework', { p_item_id: item.id, p_payload: { reason: 'Voltou a descolar' } })
if (r.status === 400 && /já entregue/.test(r.corpo?.message ?? '')) ok('recusado: peça ainda está na loja')
else bad(`esperava recusa; veio ${r.status} ${JSON.stringify(r.corpo)}`)

// entrega o item — foto COM arquivo (20260807220000 exige storage_path)
await anexarFoto(tk, comanda.id, 'depois', item.id)
r = await rpc(tk, 'change_order_item_status', {
  p_item_id: item.id, p_status_key: 'entregue', p_delivery: { delivered_to_name: 'Fernanda' },
})
if (r.status !== 200) bad(`entrega falhou: ${JSON.stringify(r.corpo)}`)

r = await rpc(tk, 'create_rework', { p_item_id: item.id, p_payload: {} })
if (r.status === 400 && /Descreva o que o cliente relatou/.test(r.corpo?.message ?? ''))
  ok('recusado sem o motivo do retorno')
else bad(`esperava recusa por motivo; veio ${r.status} ${JSON.stringify(r.corpo)}`)

console.log('\n3 · Retrabalho em garantia: gratuito e vinculado')
r = await rpc(tk, 'create_rework', { p_item_id: item.id, p_payload: { reason: 'Voltou a descolar na ponta' } })
if (r.status !== 200) { bad(`create_rework: ${JSON.stringify(r.corpo)}`); process.exit(1) }
const retrab = r.corpo
if (Number(retrab.total_amount) === 0) ok(`comanda ${retrab.number} criada com valor zero`)
else bad(`valor ${retrab.total_amount}`)
if (retrab.is_rework === true) ok('comanda marcada como retrabalho (espelho derivado)')
else bad('orders.is_rework nao derivou')

const [ri] = await get(tk, `order_items?order_id=eq.${retrab.id}&select=id,parent_item_id,is_rework`)
if (ri.parent_item_id === item.id && ri.is_rework === true) ok('item vinculado ao original')
else bad(`vinculo errado: ${JSON.stringify(ri)}`)

const lanc = await get(tk, `ledger_entries?order_id=eq.${retrab.id}&select=id`)
if (lanc.length === 0) ok('nenhum lançamento no financeiro — garantia não cobra')
else bad(`${lanc.length} lançamento(s) criados para retrabalho gratuito`)

const evOrig = await get(tk, `order_events?order_id=eq.${comanda.id}&select=title`)
if (evOrig.some((e) => e.title === 'Peça retornou para retrabalho'))
  ok('comanda original registrou o retorno')
else bad('original sem rastro do retorno')

console.log('\n4 · A view mostra a garantia')
const [w] = await get(tk, `order_item_warranty_view?order_item_id=eq.${item.id}&select=warranty_days,warranty_until,in_warranty,rework_count`)
if (w?.in_warranty === true && w.rework_count === 1)
  ok(`em garantia até ${String(w.warranty_until).slice(0, 10)}, 1 retrabalho`)
else bad(`view: ${JSON.stringify(w)}`)

console.log('\n5 · Retrabalho gratuito não contamina o ticket médio')
const kpi = await rpc(dono, 'dashboard_kpis', {})
const ticket = Number(kpi.corpo?.average_ticket)
if (ticket > 1) ok(`ticket médio segue realista: R$ ${ticket.toFixed(2)}`)
else bad(`ticket médio suspeito: ${kpi.corpo?.average_ticket}`)

console.log('\n6 · Relatório de retrabalho')
const rep = await rpc(tk, 'report_rework', {})
if (rep.status === 200 && rep.corpo.some((l) => l.grupo === 'servico' && l.retrabalhos > 0)) {
  const l = rep.corpo.find((x) => x.grupo === 'servico' && x.retrabalhos > 0)
  ok(`por serviço: ${l.service_name} — ${l.retrabalhos}/${l.entregues} = ${l.taxa}%`)
} else bad(`relatório sem retrabalho: ${JSON.stringify(rep.corpo?.slice(0, 3))}`)
if (rep.corpo?.some((l) => l.grupo === 'responsavel')) ok('por responsável presente')
else bad('faltou o agrupamento por responsável')

// limpeza
await patch(dono, `services?id=eq.${servico.id}`, { warranty_days: 0 })

console.log(falhas === 0 ? '\n\x1b[32mTodos os testes passaram.\x1b[0m\n' : `\n\x1b[31m${falhas} falha(s).\x1b[0m\n`)
process.exit(falhas === 0 ? 0 : 1)
