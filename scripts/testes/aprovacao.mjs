/** Bloco 4 — aprovação de orçamento, pela API real. */
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
  if (!j.access_token) throw new Error(`login: ${JSON.stringify(j)}`)
  return j.access_token
}
const H = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
async function rpc(t, nome, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${nome}`, { method: 'POST', headers: H(t), body: JSON.stringify(args) })
  return { status: r.status, corpo: await r.json().catch(() => null) }
}
const get = async (t, p) => (await fetch(`${API}/rest/v1/${p}`, { headers: H(t) })).json()

const tk = await login('camila@demo.chaveiroformiga.com.br', 'demo1234')
const [cliente] = await get(tk, 'customers?select=id,name&limit=1')
const [servico] = await get(tk, 'services?select=id&limit=1')

const novo = async (valor = 200) => {
  const r = await rpc(tk, 'create_order', {
    p_payload: {
      customer_id: cliente.id,
      notes: '[teste-automatizado]',
      items: [{ service_id: servico.id, quantity: 1, total_amount: valor, description: 'APROV-TESTE' }],
      photos: [{ kind: 'antes', caption: 'x', gradient_seed: 'a-1' }],
    },
  })
  if (r.status !== 200) throw new Error(`create_order: ${JSON.stringify(r.corpo)}`)
  const [i] = await get(tk, `order_items?order_id=eq.${r.corpo.id}&select=id,total_amount`)
  await rpc(tk, 'change_order_item_status', { p_item_id: i.id, p_status_key: 'aprovacao' })
  return { comanda: r.corpo, item: i }
}

console.log('\n1 · Canais de aprovação são domínio, não texto livre')
const canais = await get(tk, 'approval_channels?select=key,label&order=sort_order')
if (canais.length === 4) ok(`4 canais: ${canais.map((c) => c.key).join(', ')}`)
else bad(`${canais.length} canais`)

console.log('\n2 · Sair de "aprovação" exige o lastro')
let { item } = await novo()

let r = await rpc(tk, 'change_order_item_status', { p_item_id: item.id, p_status_key: 'execucao' })
if (r.status === 400 && /Informe quem aprovou/.test(r.corpo?.message ?? '')) ok('recusado sem quem aprovou')
else bad(`esperava recusa por nome; veio ${r.status} ${JSON.stringify(r.corpo)}`)

r = await rpc(tk, 'change_order_item_status', {
  p_item_id: item.id, p_status_key: 'execucao', p_approval: { approved_by_name: 'Fernanda' },
})
if (r.status === 400 && /por onde o cliente aprovou/i.test(r.corpo?.message ?? '')) ok('recusado sem o canal')
else bad(`esperava recusa por canal; veio ${r.status} ${JSON.stringify(r.corpo)}`)

r = await rpc(tk, 'change_order_item_status', {
  p_item_id: item.id, p_status_key: 'execucao',
  p_approval: { approved_by_name: 'Fernanda', approval_channel_key: 'pombo' },
})
if (r.status === 400 && /Canal de aprovação/.test(r.corpo?.message ?? '')) ok('canal inválido recusado')
else bad(`canal invalido passou: ${r.status} ${JSON.stringify(r.corpo)}`)

r = await rpc(tk, 'change_order_item_status', {
  p_item_id: item.id, p_status_key: 'execucao',
  p_approval: { approved_by_name: 'Fernanda Couto', approval_channel_key: 'whatsapp' },
})
if (r.status === 200 && r.corpo?.approved_by_name === 'Fernanda Couto') ok('aprovação registrada e serviço liberado')
else bad(`aprovação falhou: ${r.status} ${JSON.stringify(r.corpo)}`)
if (Number(r.corpo?.approved_amount) === 200) ok('valor aprovado veio do item (200)')
else bad(`approved_amount = ${r.corpo?.approved_amount}`)

const ev = await get(tk, `order_events?order_id=eq.${r.corpo.order_id}&select=title,detail`)
if (ev.some((e) => e.title === 'Orçamento aprovado' && /Fernanda Couto/.test(e.detail ?? '')))
  ok('evento no histórico com quem aprovou e o canal')
else bad('histórico sem o evento de aprovação')

console.log('\n3 · Recusa do cliente NÃO pede lastro')
const b = await novo()
r = await rpc(tk, 'change_order_item_status', { p_item_id: b.item.id, p_status_key: 'cancelada' })
if (r.status === 200) ok('cancelar a partir de "aprovação" passa sem exigir quem aprovou')
else bad(`cancelamento barrado: ${r.status} ${JSON.stringify(r.corpo)}`)

console.log('\n4 · Não repete o pedido a cada mudança de coluna')
r = await rpc(tk, 'change_order_item_status', { p_item_id: item.id, p_status_key: 'pronta' })
if (r.status === 200) ok('item já aprovado anda no Kanban sem reabrir o formulário')
else bad(`pediu de novo: ${r.status} ${JSON.stringify(r.corpo)}`)

console.log('\n5 · Divergência entre o aprovado e o cobrado')
const c = await novo(150)
await rpc(tk, 'change_order_item_status', {
  p_item_id: c.item.id, p_status_key: 'execucao',
  p_approval: { approved_by_name: 'Fernanda', approval_channel_key: 'telefone', approved_amount: 150 },
})
await rpc(tk, 'update_order_item', { p_item_id: c.item.id, p_patch: { total_amount: 230 } })
const [v] = await get(tk, `order_item_approval_view?order_item_id=eq.${c.item.id}&select=approved_amount,total_amount,approval_difference,approval_diverges,approval_channel_label,approval_taken_by_name`)
if (v?.approval_diverges === true && Number(v.approval_difference) === 80)
  ok(`divergência detectada: aprovado ${v.approved_amount}, hoje ${v.total_amount} (+${v.approval_difference})`)
else bad(`view não sinalizou: ${JSON.stringify(v)}`)
if (v?.approval_channel_label === 'Telefone') ok('canal resolvido para o rótulo')
else bad(`canal: ${v?.approval_channel_label}`)
if (v?.approval_taken_by_name) ok(`quem registrou: ${v.approval_taken_by_name}`)
else bad('approval_taken_by_name vazio')

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
