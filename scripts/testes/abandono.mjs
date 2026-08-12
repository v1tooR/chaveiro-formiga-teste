/**
 * Bloco 6 — item não retirado.
 *
 * O alerta depende de tempo, e tempo é o que um teste não tem. A saída é
 * empurrar `ready_at` para trás pelo PostgREST e deixar a trigger derivar
 * o resto — que é exatamente o caminho de produção, só com a data mexida.
 */
const API = process.env.SUPABASE_URL_LOCAL ?? 'http://localhost:8000'
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
const patch = async (t, p, corpo) =>
  fetch(`${API}/rest/v1/${p}`, { method: 'PATCH', headers: H(t), body: JSON.stringify(corpo) })

const diasAtras = (n) => new Date(Date.now() - n * 86400_000).toISOString()

// wallace é owner: mexer em app_settings é escrita no módulo `settings`,
// que atendimento não tem.
const tk = await login('wallace@demo.chaveiroformiga.com.br', 'demo1234')

const [cfgOriginal] = await get(tk, 'app_settings?select=id,abandoned_after_days')
const [cliente] = await get(tk, 'customers?select=id&limit=1')
const [servico] = await get(tk, 'services?select=id&limit=1')

console.log('\n1 · ready_at nasce quando a peça fica pronta')

let r = await rpc(tk, 'create_order', {
  p_payload: {
    customer_id: cliente.id,
    notes: '[teste-automatizado]',
    items: [{ service_id: servico.id, quantity: 1, total_amount: 70, description: 'Teste abandono' }],
    photos: [{ kind: 'antes', caption: 'Recebido', gradient_seed: `t-${crypto.randomUUID()}` }],
  },
})
if (r.status !== 200) { bad(`create_order: ${r.status} ${JSON.stringify(r.corpo)}`); process.exit(1) }
const comanda = r.corpo
const [item] = await get(tk, `order_items?order_id=eq.${comanda.id}&select=id,ready_at`)

if (item.ready_at === null) ok('comanda recém-aberta não tem ready_at')
else bad(`ready_at já preenchido na abertura: ${item.ready_at}`)

await rpc(tk, 'change_order_item_status', { p_item_id: item.id, p_status_key: 'execucao' })
let [i2] = await get(tk, `order_items?id=eq.${item.id}&select=ready_at`)
if (i2.ready_at === null) ok('"em execução" não conta como prateleira')
else bad(`ready_at gravado em execucao: ${i2.ready_at}`)

await rpc(tk, 'change_order_item_status', { p_item_id: item.id, p_status_key: 'pronta' })
;[i2] = await get(tk, `order_items?id=eq.${item.id}&select=ready_at`)
if (i2.ready_at) ok('"pronta" grava ready_at')
else bad('ready_at continuou nulo depois de pronta')
const primeiro = i2.ready_at

console.log('\n2 · voltar para a bancada NÃO reinicia a contagem')

await rpc(tk, 'change_order_item_status', { p_item_id: item.id, p_status_key: 'execucao' })
await rpc(tk, 'change_order_item_status', { p_item_id: item.id, p_status_key: 'pronta' })
;[i2] = await get(tk, `order_items?id=eq.${item.id}&select=ready_at`)
if (i2.ready_at === primeiro) {
  ok('ready_at preservado — a peça está na loja desde a primeira vez')
} else {
  bad(`ready_at reiniciou: ${primeiro} → ${i2.ready_at}. Comanda velha sairia do alerta a cada toque.`)
}

console.log('\n3 · o espelho na comanda e days_ready na view')

let [v] = await get(tk, `order_list_view?id=eq.${comanda.id}&select=ready_at,days_ready,status_key`)
if (v.ready_at) ok('orders.ready_at derivado pela trigger')
else bad('espelho vazio na comanda')
if (v.days_ready === 0) ok('days_ready = 0 no dia em que ficou pronta')
else bad(`days_ready = ${v.days_ready}, esperava 0`)

console.log('\n4 · empurrando a data para trás')

const ANTIGUIDADE = 120
await patch(tk, `order_items?id=eq.${item.id}`, { ready_at: diasAtras(ANTIGUIDADE) })
;[v] = await get(tk, `order_list_view?id=eq.${comanda.id}&select=days_ready`)
if (v.days_ready >= ANTIGUIDADE - 1 && v.days_ready <= ANTIGUIDADE + 1) {
  ok(`days_ready acompanha o item: ${v.days_ready} dias`)
} else bad(`days_ready = ${v.days_ready}, esperava ~${ANTIGUIDADE}`)

console.log('\n5 · o alerta')

await patch(tk, `app_settings?id=eq.${cfgOriginal.id}`, { abandoned_after_days: 90 })
let a = (await rpc(tk, 'dashboard_alerts', {})).corpo?.abandoned
if (a?.count >= 1) ok(`alerta acusa ${a.count} peça(s) esquecida(s)`)
else bad(`alerta não acusou: ${JSON.stringify(a)}`)
if (a?.days === 90) ok('o alerta informa o prazo configurado')
else bad(`days = ${a?.days}`)
if (a?.oldest >= ANTIGUIDADE - 1) ok(`mais antiga: ${a.oldest} dias`)
else bad(`oldest = ${a?.oldest}`)
if ((a?.sample ?? []).some((s) => s.number === comanda.number)) ok('a comanda aparece na amostra')
else bad(`amostra sem a comanda ${comanda.number}: ${JSON.stringify(a?.sample)}`)

console.log('\n6 · prazo maior que a espera não acusa')
await patch(tk, `app_settings?id=eq.${cfgOriginal.id}`, { abandoned_after_days: 365 })
a = (await rpc(tk, 'dashboard_alerts', {})).corpo?.abandoned
if (!(a?.sample ?? []).some((s) => s.number === comanda.number)) ok('120 dias não dispara alerta de 365')
else bad('comanda de 120 dias apareceu com prazo de 365')

console.log('\n7 · zero desliga')
await patch(tk, `app_settings?id=eq.${cfgOriginal.id}`, { abandoned_after_days: 0 })
a = (await rpc(tk, 'dashboard_alerts', {})).corpo?.abandoned
if (a?.count === 0) ok('prazo 0 desliga o alerta por completo')
else bad(`com prazo 0 o alerta acusou ${a?.count} — toda peça pronta hoje entraria`)

console.log('\n8 · peça entregue sai da prateleira')

await patch(tk, `app_settings?id=eq.${cfgOriginal.id}`, { abandoned_after_days: 90 })

const dep = await fetch(`${API}/rest/v1/order_photos`, {
  method: 'POST', headers: { ...H(tk), Prefer: 'return=representation' },
  body: JSON.stringify({ order_id: comanda.id, kind: 'depois', caption: 'ok', gradient_seed: `t-${crypto.randomUUID()}` }),
})
const [fotoDep] = await dep.json()
const caminho = `${comanda.id}/${crypto.randomUUID()}.jpg`
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
await fetch(`${API}/storage/v1/object/order-photos/${caminho}`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${tk}`, 'Content-Type': 'image/jpeg' },
  body: JPEG,
})
await patch(tk, `order_photos?id=eq.${fotoDep.id}`, { storage_path: caminho })

r = await rpc(tk, 'change_order_item_status', {
  p_item_id: item.id, p_status_key: 'entregue', p_delivery: { delivered_to_name: 'Cliente Sumido' },
})
if (r.status !== 200) bad(`entrega falhou: ${JSON.stringify(r.corpo)}`)

;[v] = await get(tk, `order_list_view?id=eq.${comanda.id}&select=ready_at,days_ready`)
if (v.ready_at === null) ok('comanda entregue deixa a prateleira (ready_at volta a nulo)')
else bad(`comanda entregue ainda com ready_at = ${v.ready_at}`)

a = (await rpc(tk, 'dashboard_alerts', {})).corpo?.abandoned
if (!(a?.sample ?? []).some((s) => s.number === comanda.number)) ok('e some do alerta')
else bad('comanda entregue continua no alerta de esquecidas')

// devolve a configuração como estava
await patch(tk, `app_settings?id=eq.${cfgOriginal.id}`, {
  abandoned_after_days: cfgOriginal.abandoned_after_days,
})

console.log(falhas === 0 ? '\n\x1b[32mTodos os testes passaram.\x1b[0m\n' : `\n\x1b[31m${falhas} falha(s).\x1b[0m\n`)
process.exit(falhas === 0 ? 0 : 1)
