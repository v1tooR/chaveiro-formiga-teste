/**
 * Reproduz `resolverUrls` (src/lib/api/fotos.ts) usando o MESMO
 * supabase-js do front — é a única forma de ver o formato real que
 * `createSignedUrls` devolve nesta versão da biblioteca.
 *
 * Existe porque o Storage respondia 200 a tudo e mesmo assim a foto não
 * aparecia na tela: o navegador nunca chegava a pedir a imagem.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
)

const URL_BASE = env.VITE_SUPABASE_URL || 'http://localhost:8000'
console.log(`VITE_SUPABASE_URL = ${URL_BASE}\n`)

const supabase = createClient(URL_BASE, env.VITE_SUPABASE_ANON_KEY)
await supabase.auth.signInWithPassword({
  email: 'camila@demo.chaveiroformiga.com.br',
  password: 'demo1234',
})

const { data: fotos } = await supabase
  .from('order_photos')
  .select('id,caption,storage_path')
  .not('storage_path', 'is', null)
  .order('created_at', { ascending: false })
  .limit(1)

const caminho = fotos[0].storage_path
console.log(`foto: "${fotos[0].caption}"\ncaminho: ${caminho}\n`)

console.log('--- createSignedUrls (o que resolverUrls usa) ---')
const lote = await supabase.storage.from('order-photos').createSignedUrls([caminho], 3600)
console.log('error:', lote.error)
console.log('data :', JSON.stringify(lote.data, null, 2))

const item = lote.data?.[0]
console.log('\ncampos do item:', item ? Object.keys(item).join(', ') : '(nenhum)')
console.log(`item.signedUrl  = ${item?.signedUrl ?? '(ausente)'}`)
console.log(`item.path       = ${item?.path ?? '(ausente)'}`)

// A condição literal de fotos.ts:212
const passaNaCondicao = !!(item?.signedUrl && item?.path)
console.log(
  `\ncondição \`d.signedUrl && d.path\` → ${passaNaCondicao ? 'VERDADEIRA (cache preenchido)' : 'FALSA — o cache fica VAZIO e a foto nunca ganha dataUrl'}`,
)

console.log('\n--- createSignedUrl (singular, usado no upload) ---')
const um = await supabase.storage.from('order-photos').createSignedUrl(caminho, 3600)
console.log('error:', um.error)
console.log('signedUrl:', um.data?.signedUrl)

if (item?.signedUrl) {
  const r = await fetch(item.signedUrl)
  console.log(`\nbaixando a URL do lote: ${r.status} · ${r.headers.get('content-type')}`)
}
