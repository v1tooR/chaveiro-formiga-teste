/**
 * Percorre o caminho EXATO que a tela passou a fazer depois da câmera:
 *
 *   1. create_order com TODAS as fotos no payload, sem storage_path
 *   2. upload do binário em <order_id>/<uuid>.jpg
 *   3. PATCH da linha com o storage_path
 *   4. URL assinada
 *   5. entrega, que exige a foto "depois"
 *
 * O passo 2 é o que nenhum teste anterior tocava: o bucket é privado e a
 * policy de Storage nunca tinha sido exercitada com um token de atendente.
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

/** JPEG 1x1 válido — o bucket recusa mime fora da lista de imagens. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)

const tk = await login('camila@demo.chaveiroformiga.com.br', 'demo1234')
const [cliente] = await get(tk, 'customers?select=id,name&limit=1')
const [servico] = await get(tk, 'services?select=id,name&limit=1')

console.log('\n1 · create_order com a foto NO PAYLOAD (a foto tem arquivo, mas ele ainda não subiu)')

const seedAntes = `sapataria-${crypto.randomUUID()}`
let r = await rpc(tk, 'create_order', {
  p_payload: {
    customer_id: cliente.id,
    notes: '[teste-automatizado]',
    items: [{ service_id: servico.id, quantity: 1, total_amount: 90, description: 'Teste câmera' }],
    photos: [{ kind: 'antes', caption: 'Item recebido', gradient_seed: seedAntes, storage_path: null }],
  },
})
if (r.status !== 200) { bad(`create_order falhou: ${r.status} ${JSON.stringify(r.corpo)}`); process.exit(1) }
const comanda = r.corpo
ok(`comanda ${comanda.number} criada`)

const fotos = await get(tk, `order_photos?order_id=eq.${comanda.id}&select=id,gradient_seed,storage_path`)
const linha = fotos.find((f) => f.gradient_seed === seedAntes)
if (linha) ok('a linha é reencontrada pelo seed — é assim que a tela correlaciona')
else { bad(`seed não encontrado entre ${JSON.stringify(fotos)}`); process.exit(1) }

console.log('\n2 · upload real no bucket privado, com token de ATENDENTE')

const caminho = `${comanda.id}/${crypto.randomUUID()}.jpg`
let up = await fetch(`${API}/storage/v1/object/order-photos/${caminho}`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${tk}`, 'Content-Type': 'image/jpeg' },
  body: JPEG,
})
if (up.ok) ok(`binário aceito em ${caminho.slice(0, 20)}…`)
else bad(`upload recusado: ${up.status} ${await up.text()}`)

console.log('\n3 · PATCH do storage_path')
let pr = await fetch(`${API}/rest/v1/order_photos?id=eq.${linha.id}`, {
  method: 'PATCH', headers: { ...H(tk), Prefer: 'return=representation' },
  body: JSON.stringify({ storage_path: caminho }),
})
if (pr.ok) ok('storage_path gravado (constraint order_photos_path_scoped aceita o prefixo)')
else bad(`PATCH recusado: ${pr.status} ${await pr.text()}`)

// O caminho TEM que ser recusado se apontar para outra comanda.
const pr2 = await fetch(`${API}/rest/v1/order_photos?id=eq.${linha.id}`, {
  method: 'PATCH', headers: H(tk),
  body: JSON.stringify({ storage_path: `${crypto.randomUUID()}/roubada.jpg` }),
})
if (!pr2.ok) ok('caminho de outra comanda recusado pela constraint')
else bad('a constraint deixou passar caminho de outra comanda')

console.log('\n4 · URL assinada')
const sr = await fetch(`${API}/storage/v1/object/sign/order-photos/${caminho}`, {
  method: 'POST', headers: H(tk), body: JSON.stringify({ expiresIn: 3600 }),
})
const sj = await sr.json().catch(() => null)
if (sr.ok && sj?.signedURL) {
  const img = await fetch(`${API}/storage/v1${sj.signedURL}`)
  const buf = Buffer.from(await img.arrayBuffer())
  if (img.ok && buf.length === JPEG.length) ok(`imagem volta pela URL assinada (${buf.length} bytes)`)
  else bad(`URL assinada devolveu ${img.status}, ${buf.length} bytes`)
} else bad(`assinatura falhou: ${sr.status} ${JSON.stringify(sj)}`)

console.log('\n5 · entrega — a foto "depois" também sobe pelo caminho novo')

const [item] = await get(tk, `order_items?order_id=eq.${comanda.id}&select=id`)
await rpc(tk, 'change_order_item_status', { p_item_id: item.id, p_status_key: 'pronta' })

r = await rpc(tk, 'change_order_item_status', {
  p_item_id: item.id, p_status_key: 'entregue', p_delivery: { delivered_to_name: 'Maria Souza' },
})
if (r.status === 400 && /fotografar a peça pronta/.test(r.corpo?.message ?? '')) ok('entrega recusada sem a foto "depois"')
else bad(`esperava recusa; veio ${r.status} ${JSON.stringify(r.corpo)}`)

const dep = await fetch(`${API}/rest/v1/order_photos`, {
  method: 'POST', headers: { ...H(tk), Prefer: 'return=representation' },
  body: JSON.stringify({ order_id: comanda.id, kind: 'depois', caption: 'Serviço concluído', gradient_seed: `sapataria-${crypto.randomUUID()}` }),
})
const [fotoDep] = await dep.json()
const cam2 = `${comanda.id}/${crypto.randomUUID()}.jpg`
up = await fetch(`${API}/storage/v1/object/order-photos/${cam2}`, {
  method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tk}`, 'Content-Type': 'image/jpeg' }, body: JPEG,
})
await fetch(`${API}/rest/v1/order_photos?id=eq.${fotoDep.id}`, {
  method: 'PATCH', headers: H(tk), body: JSON.stringify({ storage_path: cam2 }),
})
if (up.ok) ok('foto "depois" com arquivo no bucket')

r = await rpc(tk, 'change_order_item_status', {
  p_item_id: item.id, p_status_key: 'entregue',
  p_delivery: { delivered_to_name: 'Maria Souza', delivered_to_document: 'MG-999' },
})
if (r.status === 200) ok('entrega aceita')
else bad(`entrega falhou: ${r.status} ${JSON.stringify(r.corpo)}`)

const [v] = await get(tk, `order_list_view?id=eq.${comanda.id}&select=delivered_to_name,photo_count`)
if (v?.delivered_to_name === 'Maria Souza') ok('recibo tem quem retirou')
else bad(`espelho da entrega vazio: ${JSON.stringify(v)}`)
if (v?.photo_count === 2) ok('duas fotos na comanda')
else bad(`photo_count = ${v?.photo_count}`)

console.log('\n6 · a comanda sem foto nenhuma continua recusada')
r = await rpc(tk, 'create_order', {
  p_payload: {
    customer_id: cliente.id,
    notes: '[teste-automatizado]',
    items: [{ service_id: servico.id, quantity: 1, total_amount: 50, description: 'sem foto' }],
    photos: [],
  },
})
if (r.status === 400 && /É obrigatório anexar/.test(r.corpo?.message ?? '')) ok('exigência de foto intacta')
else bad(`esperava recusa; veio ${r.status} ${JSON.stringify(r.corpo)}`)

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
