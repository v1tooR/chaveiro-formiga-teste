/** Bloco 3 pela API real: Kong → PostgREST → RPC. */
const API = 'http://localhost:8000'
const ANON = process.env.ANON_KEY
let falhas = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { falhas++; console.log(`  \x1b[31m✗\x1b[0m ${m}`) }

async function login(email, senha) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j)}`)
  return j.access_token
}
const H = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
async function rpc(t, nome, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${nome}`, { method: 'POST', headers: H(t), body: JSON.stringify(args) })
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

const tk = await login('camila@demo.chaveiroformiga.com.br', 'demo1234')
const [cliente] = await get(tk, 'customers?select=id,name&limit=1')
const servicos = await get(tk, 'services?select=id,name,category_key&limit=2')

console.log('\n1 · UMA comanda, DOIS itens')

let r = await rpc(tk, 'create_order', {
  p_payload: {
    customer_id: cliente.id,
    notes: '[teste-automatizado]',
    items: [
      { service_id: servicos[0].id, quantity: 2, total_amount: 100, description: 'ITEM-A' },
      { service_id: servicos[1].id, quantity: 1, total_amount: 69, description: 'ITEM-B' },
    ],
    photos: [{ kind: 'antes', caption: 'Recebido', gradient_seed: 'x-1' }],
  },
})
if (r.status !== 200) { bad(`criação falhou: ${r.status} ${JSON.stringify(r.corpo)}`); process.exit(1) }
const comanda = r.corpo
ok(`comanda ${comanda.number} criada`)

if (Number(comanda.total_amount) === 169) ok('total é a soma dos itens (100 + 69)')
else bad(`total ${comanda.total_amount}, esperava 169`)
if (Number(comanda.quantity) === 3) ok('quantidade somada (2 + 1)')
else bad(`quantidade ${comanda.quantity}, esperava 3`)
if (/ \+1$/.test(comanda.service_name)) ok(`nome agregado: "${comanda.service_name}"`)
else bad(`nome sem sufixo: "${comanda.service_name}"`)

const itens = await get(tk, `order_items?order_id=eq.${comanda.id}&select=id,position,service_name,total_amount,status_key&order=position`)
if (itens.length === 2) ok('dois itens gravados, posições 1 e 2')
else bad(`${itens.length} itens`)

console.log('\n2 · Status por item — a comanda segue o MENOS adiantado')

await rpc(tk, 'change_order_item_status', { p_item_id: itens[0].id, p_status_key: 'pronta' })
let o = (await get(tk, `orders?id=eq.${comanda.id}&select=status_key`))[0]
if (o.status_key === 'recebida') ok(`item 1 pronto, comanda continua "${o.status_key}" (item 2 é o mais lento)`)
else bad(`comanda virou "${o.status_key}", esperava recebida`)

await rpc(tk, 'change_order_item_status', { p_item_id: itens[1].id, p_status_key: 'execucao' })
o = (await get(tk, `orders?id=eq.${comanda.id}&select=status_key`))[0]
if (o.status_key === 'execucao') ok('item 2 em execução → comanda em execução')
else bad(`comanda "${o.status_key}", esperava execucao`)

console.log('\n3 · Entrega parcial')

r = await rpc(tk, 'change_order_item_status', {
  p_item_id: itens[0].id, p_status_key: 'entregue', p_delivery: { delivered_to_name: 'Maria Souza' },
})
if (r.status === 400 && /fotografar ESTA peça pronta/i.test(r.corpo?.message ?? '')) {
  ok('entrega do item recusada sem a foto "Depois" DELE')
} else bad(`esperava recusa por foto do item; veio ${r.status} ${JSON.stringify(r.corpo)}`)

// Foto amarrada ao item 2 não pode liberar o item 1.
await anexarFoto(tk, comanda.id, 'depois', itens[1].id)
r = await rpc(tk, 'change_order_item_status', {
  p_item_id: itens[0].id, p_status_key: 'entregue', p_delivery: { delivered_to_name: 'Maria Souza' },
})
if (r.status === 400) ok('foto do item 2 não libera a entrega do item 1')
else bad('foto de outro item liberou a entrega — o vínculo não está sendo respeitado')

// Foto DO item 1, mas sem imagem: também não pode liberar.
await fetch(`${API}/rest/v1/order_photos`, { method: 'POST', headers: H(tk),
  body: JSON.stringify({ order_id: comanda.id, order_item_id: itens[0].id, kind: 'depois', caption: 'vazia', gradient_seed: 'y-9' }) })
r = await rpc(tk, 'change_order_item_status', {
  p_item_id: itens[0].id, p_status_key: 'entregue', p_delivery: { delivered_to_name: 'Maria Souza' },
})
if (r.status === 400 && /sem imagem/.test(r.corpo?.message ?? '')) ok('gradiente no item certo também não libera')
else bad(`gradiente liberou a entrega: ${r.status} ${JSON.stringify(r.corpo)}`)

await anexarFoto(tk, comanda.id, 'depois', itens[0].id)
r = await rpc(tk, 'change_order_item_status', {
  p_item_id: itens[0].id, p_status_key: 'entregue',
  p_delivery: { delivered_to_name: 'Maria Souza', delivered_to_document: 'MG-1234' },
})
if (r.status === 200 && r.corpo?.delivered_to_name === 'Maria Souza') ok('item 1 entregue e registrado')
else bad(`entrega do item 1 falhou: ${r.status} ${JSON.stringify(r.corpo)}`)

o = (await get(tk, `orders?id=eq.${comanda.id}&select=status_key,delivered_at`))[0]
if (o.status_key === 'execucao' && !o.delivered_at) {
  ok('comanda CONTINUA aberta — o sapato ainda está na loja')
} else bad(`comanda fechou cedo: status=${o.status_key} delivered_at=${o.delivered_at}`)

console.log('\n4 · Último item sai → comanda finaliza')

r = await rpc(tk, 'change_order_item_status', {
  p_item_id: itens[1].id, p_status_key: 'entregue', p_delivery: { delivered_to_name: 'Maria Souza' },
})
if (r.status !== 200) bad(`entrega do item 2 falhou: ${JSON.stringify(r.corpo)}`)
o = (await get(tk, `orders?id=eq.${comanda.id}&select=status_key,delivered_at`))[0]
if (o.status_key === 'entregue' && o.delivered_at) ok('comanda entregue, com delivered_at')
else bad(`comanda não finalizou: ${o.status_key} / ${o.delivered_at}`)

console.log('\n5 · Relatórios leem dos itens')
const top = await rpc(tk, 'report_top_services', {})
if (top.status === 200 && !top.corpo.some((s) => / \+\d+$/.test(s.service_name))) {
  ok('ranking de serviços sem nomes agregados ("X +1")')
} else bad(`ranking contaminado: ${JSON.stringify(top.corpo?.slice(0, 3))}`)

const cat = await rpc(tk, 'report_by_category', {})
if (cat.status === 200 && cat.corpo.length > 0) ok(`relatório por categoria: ${cat.corpo.length} categorias`)
else bad(`report_by_category: ${cat.status}`)

// A limpeza é do runner (scripts/testes.sh), não daqui.
//
// Apagar a comanda pelo PostgREST é IMPOSSÍVEL: `orders_select` tem
// `deleted_at IS NULL` no USING, e o PostgREST embrulha todo UPDATE num
// `RETURNING`, então a policy de leitura é aplicada à linha NOVA e rejeita
// (migration 20260730160000 documenta o mesmo caso em ledger_entries).
// O PATCH que estava aqui devolvia 403 e ninguém conferia — as comandas de
// teste iam se acumulando no banco de demonstração.

console.log(falhas === 0 ? '\n\x1b[32mTodos os testes passaram.\x1b[0m\n' : `\n\x1b[31m${falhas} falha(s).\x1b[0m\n`)
process.exit(falhas === 0 ? 0 : 1)
