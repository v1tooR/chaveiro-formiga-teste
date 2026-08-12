/**
 * Testa os blocos 1 e 2 pela API real (Kong → PostgREST → RPC).
 * Não usa psql: o objetivo é justamente pegar o que só aparece no caminho
 * HTTP — resolução de sobrecarga da RPC, RLS por papel e a mensagem que
 * chega ao front.
 */
const API = 'http://localhost:8000'
const ANON = process.env.ANON_KEY

let falhas = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { falhas++; console.log(`  \x1b[31m✗\x1b[0m ${m}`) }

async function login(email, senha) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j)}`)
  return j.access_token
}

const H = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

async function rpc(token, nome, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${nome}`, {
    method: 'POST', headers: H(token), body: JSON.stringify(args),
  })
  return { status: r.status, corpo: await r.json().catch(() => null) }
}

async function get(token, caminho) {
  const r = await fetch(`${API}/rest/v1/${caminho}`, { headers: H(token) })
  return r.json()
}

/** JPEG 1x1 válido — o bucket recusa mime fora da lista de imagens. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)

/**
 * Anexa uma foto COM ARQUIVO, do jeito que a tela faz.
 *
 * Desde a migration 20260807220000 a entrega exige `storage_path IS NOT
 * NULL` — linha só com gradiente deixou de valer. Este teste antes
 * inseria a linha crua, que é justamente o furo que a migration fechou.
 */
async function anexarFoto(token, orderId, kind, itemId = null) {
  const r = await fetch(`${API}/rest/v1/order_photos`, {
    method: 'POST',
    headers: { ...H(token), Prefer: 'return=representation' },
    body: JSON.stringify({
      order_id: orderId,
      ...(itemId && { order_item_id: itemId }),
      kind,
      caption: kind,
      gradient_seed: `t-${crypto.randomUUID()}`,
    }),
  })
  const [linha] = await r.json()
  const caminho = `${orderId}/${crypto.randomUUID()}.jpg`
  await fetch(`${API}/storage/v1/object/order-photos/${caminho}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: JPEG,
  })
  await fetch(`${API}/rest/v1/order_photos?id=eq.${linha.id}`, {
    method: 'PATCH', headers: H(token), body: JSON.stringify({ storage_path: caminho }),
  })
  return linha
}

const camila = await login('camila@demo.chaveiroformiga.com.br', 'demo1234')
const consulta = await login('consulta@demo.chaveiroformiga.com.br', 'demo1234')

const [cliente] = await get(camila, 'customers?select=id,name&limit=1')
const [servico] = await get(camila, 'services?select=id,name&limit=1')
console.log(`\ncliente: ${cliente.name} · serviço: ${servico.name}\n`)

const base = {
  customer_id: cliente.id,
  notes: '[teste-automatizado]', service_id: servico.id, quantity: 1,
  total_amount: 120, down_payment: 0, description: 'Teste automatizado',
}

console.log('BLOCO 2 — foto obrigatória no recebimento')

let r = await rpc(camila, 'create_order', { p_payload: { ...base, photos: [] } })
if (r.status === 400 && /É obrigatório anexar ao menos uma foto/.test(r.corpo?.message ?? '')) {
  ok('comanda sem foto recusada, com a mensagem em português')
} else {
  bad(`esperava 400 com mensagem acentuada; veio ${r.status} ${JSON.stringify(r.corpo)}`)
}

const numAntes = (await get(camila, 'app_settings?select=order_next_number'))[0].order_next_number

r = await rpc(camila, 'create_order', {
  p_payload: { ...base, photos: [{ kind: 'antes', caption: 'Recebido', gradient_seed: 'x-1' }] },
})
if (r.status === 200 && r.corpo?.id) ok(`comanda ${r.corpo.number} criada com foto`)
else bad(`criação com foto falhou: ${r.status} ${JSON.stringify(r.corpo)}`)
const comanda = r.corpo

const numDepois = (await get(camila, 'app_settings?select=order_next_number'))[0].order_next_number
if (numDepois === numAntes + 1) ok('a recusa não queimou número da numeração')
else bad(`numeração pulou: ${numAntes} → ${numDepois}`)

console.log('\nBLOCO 1 — registro da entrega')

await rpc(camila, 'change_order_status', { p_order_id: comanda.id, p_status_key: 'pronta' })

r = await rpc(camila, 'change_order_status', { p_order_id: comanda.id, p_status_key: 'entregue' })
if (r.status === 400 && /Informe quem está retirando/.test(r.corpo?.message ?? '')) {
  ok('entrega sem nome de quem retirou recusada')
} else {
  bad(`esperava recusa por falta de nome; veio ${r.status} ${JSON.stringify(r.corpo)}`)
}

r = await rpc(camila, 'change_order_status', {
  p_order_id: comanda.id, p_status_key: 'entregue',
  p_delivery: { delivered_to_name: 'Maria Souza' },
})
if (r.status === 400 && /fotografar a peça pronta/.test(r.corpo?.message ?? '')) {
  ok('entrega sem foto "depois" recusada, mesmo com o nome preenchido')
} else {
  bad(`esperava recusa por falta de foto; veio ${r.status} ${JSON.stringify(r.corpo)}`)
}

// Marcação "depois" SEM imagem: não pode liberar a entrega.
await fetch(`${API}/rest/v1/order_photos`, {
  method: 'POST', headers: H(camila),
  body: JSON.stringify({ order_id: comanda.id, kind: 'depois', caption: 'Concluído', gradient_seed: 'x-2' }),
})
r = await rpc(camila, 'change_order_status', {
  p_order_id: comanda.id, p_status_key: 'entregue',
  p_delivery: { delivered_to_name: 'Maria Souza' },
})
if (r.status === 400 && /sem imagem/.test(r.corpo?.message ?? '')) {
  ok('marcação "Depois" sem imagem não libera a entrega (20260807220000)')
} else {
  bad(`gradiente liberou a entrega; veio ${r.status} ${JSON.stringify(r.corpo)}`)
}

await anexarFoto(camila, comanda.id, 'depois')

r = await rpc(camila, 'change_order_status', {
  p_order_id: comanda.id, p_status_key: 'entregue',
  p_delivery: { delivered_to_name: 'Maria Souza', delivered_to_document: 'MG-12.345.678', delivery_note: 'Conferido no balcão' },
})
if (r.status === 200 && r.corpo?.delivered_to_name === 'Maria Souza') {
  ok('entrega aceita e registrada')
} else {
  bad(`entrega completa falhou: ${r.status} ${JSON.stringify(r.corpo)}`)
}

const [v] = await get(camila, `order_list_view?id=eq.${comanda.id}&select=delivered_to_name,delivered_to_document,delivery_note,delivered_by_name,delivered_at`)
if (v?.delivered_to_document === 'MG-12.345.678' && v?.delivery_note === 'Conferido no balcão') {
  ok('documento e observação chegam pela view')
} else bad(`view incompleta: ${JSON.stringify(v)}`)
if (v?.delivered_by_name) ok(`quem entregou registrado: ${v.delivered_by_name}`)
else bad('delivered_by_name vazio')
if (v?.delivered_at) ok('delivered_at gravado pela trigger (regra 22)')
else bad('delivered_at nulo')

const eventos = await get(camila, `order_events?order_id=eq.${comanda.id}&select=title,detail`)
// Desde o bloco 3 o evento e por ITEM ("Item entregue"); antes era
// "Entrega registrada" no nivel da comanda. O detalhe segue trazendo quem
// retirou, que e o que importa.
if (eventos.some((e) => /Entrega registrada|Item entregue/.test(e.title) && /Maria Souza/.test(e.detail ?? ''))) {
  ok('evento no histórico com quem retirou')
} else bad(`histórico sem o evento: ${JSON.stringify(eventos.map((e) => e.title))}`)

console.log('\nRLS — o perfil de consulta não pode entregar')
r = await rpc(consulta, 'change_order_status', {
  p_order_id: comanda.id, p_status_key: 'entregue', p_delivery: { delivered_to_name: 'Invasor' },
})
if (r.status === 403 || /Sem permissão/.test(r.corpo?.message ?? '')) ok('viewer barrado pela RPC')
else bad(`viewer não foi barrado: ${r.status} ${JSON.stringify(r.corpo)}`)

console.log(falhas === 0 ? '\n\x1b[32mTodos os testes passaram.\x1b[0m\n' : `\n\x1b[31m${falhas} falha(s).\x1b[0m\n`)
process.exit(falhas === 0 ? 0 : 1)
