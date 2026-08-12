/**
 * Fotos das comandas — upload real no bucket privado `order-photos`.
 *
 * Antes o front simulava: gerava um gradiente determinístico a partir de
 * um seed, ou lia o arquivo local como dataURL só para preview. Agora o
 * arquivo vai para o Storage.
 *
 * Bucket é PRIVADO — foto de item de cliente (chave, documento à vista na
 * peça) não pode ficar numa URL pública adivinhável. A leitura usa URL
 * assinada de vida curta.
 *
 * Caminho: `<order_id>/<uuid>.<ext>` — a policy do Storage e a constraint
 * `order_photos_path_scoped` dependem desse prefixo.
 */

import { supabase, exigir } from '@/lib/supabase'
import { mapFoto } from '@/lib/mappers'
import type { Foto } from '@/types'

const BUCKET = 'order-photos'
/** 1h: tempo de sobra para a tela ficar aberta, curto para link vazado. */
const VALIDADE_URL = 3600

function extensao(file: File): string {
  const porNome = file.name.match(/\.([a-z0-9]+)$/i)?.[1]
  if (porNome) return porNome.toLowerCase()
  return (file.type.split('/')[1] || 'jpg').toLowerCase()
}

const MIME_POR_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

/**
 * O tipo declarado no upload, deduzido da extensão quando o navegador não
 * sabe dizer.
 *
 * `file.type` vem vazio para .heic no Windows, entre outros. O código
 * antigo mandava `image/jpeg` como padrão — o bucket aceitava (jpeg está
 * na lista), mas o arquivo ficava gravado com o tipo errado, e depois
 * voltava pela URL assinada como JPEG que não é JPEG. Nenhum navegador
 * renderiza isso.
 */
function tipoMime(file: File): string {
  if (file.type) return file.type
  return MIME_POR_EXT[extensao(file)] ?? 'image/jpeg'
}

/** Sobe o arquivo e cria a linha em order_photos. */
export async function enviarFoto(
  comandaId: string,
  file: File,
  tipo: string,
  legenda: string,
  /**
   * Item a que a foto pertence. Sem ele a foto fica da COMANDA — e desde a
   * migration 20260807100000 é a foto do ITEM que libera a entrega dele.
   * Numa comanda de várias peças, foto sem item não destrava nada.
   */
  itemId?: string | null,
): Promise<Foto> {
  const caminho = `${comandaId}/${crypto.randomUUID()}.${extensao(file)}`

  const up = await supabase.storage.from(BUCKET).upload(caminho, file, {
    contentType: tipoMime(file),
    upsert: false,
  })
  if (up.error) throw new Error(up.error.message)

  try {
    const linha = exigir(
      await supabase
        .from('order_photos')
        .insert({
          order_id: comandaId,
          ...(itemId && { order_item_id: itemId }),
          kind: tipo,
          caption: legenda,
          storage_path: caminho,
          // Mantido para render imediato e como fallback se a URL
          // assinada falhar por rede.
          gradient_seed: `${tipo}-${Math.floor(Math.random() * 999)}`,
        })
        .select('*')
        .single(),
    )

    const foto = mapFoto(linha)
    foto.dataUrl = (await urlAssinada(caminho)) ?? undefined
    return foto
  } catch (e) {
    // A linha falhou (RLS, comanda finalizada): o binário não pode ficar
    // órfão ocupando o bucket.
    await supabase.storage.from(BUCKET).remove([caminho])
    throw e
  }
}

/**
 * Anexa o arquivo a uma foto que JÁ existe em order_photos.
 *
 * Existe por causa de uma ordem que não dá para inverter:
 *
 *   • `create_order` exige ao menos uma foto e recusa a comanda sem ela —
 *     a checagem é atômica, dentro da transação que cria a comanda.
 *   • O caminho no bucket é `<order_id>/…`, garantido dos dois lados
 *     (policy do Storage e constraint `order_photos_path_scoped`). Sem o
 *     id da comanda não há para onde subir.
 *
 * Então o cadastro manda as fotos no payload — que é o que satisfaz a
 * exigência — e o arquivo sobe logo depois, preenchendo `storage_path`.
 *
 * Se o upload falhar, a linha fica só com o gradiente. A comanda existe e
 * o operador é avisado para reanexar na ficha.
 */
export async function anexarArquivo(
  comandaId: string,
  fotoId: string,
  file: File,
): Promise<string | null> {
  const caminho = `${comandaId}/${crypto.randomUUID()}.${extensao(file)}`

  const up = await supabase.storage.from(BUCKET).upload(caminho, file, {
    contentType: tipoMime(file),
    upsert: false,
  })
  if (up.error) throw new Error(up.error.message)

  try {
    exigir({
      ...(await supabase
        .from('order_photos')
        .update({ storage_path: caminho })
        .eq('id', fotoId)
        .select('id')
        .single()),
    })
  } catch (e) {
    // Sem a linha apontando para ele, o binário é lixo no bucket que
    // ninguém mais consegue localizar para apagar.
    await supabase.storage.from(BUCKET).remove([caminho])
    throw e
  }

  return urlAssinada(caminho)
}

// `registrarFotoSemArquivo` foi removida junto com o botão "Sem foto".
// Ela criava a linha em order_photos com `storage_path` nulo, e é
// exatamente isso que a exigência de foto conta — um clique fechava a
// regra sem nenhuma imagem. Quem não tem a foto na mão agora usa a
// câmera (CapturaCamera) ou anexa o arquivo.

export async function removerFoto(fotoId: string): Promise<void> {
  // O trigger `order_photos_cleanup_storage` apaga o binário; basta
  // remover a linha.
  exigir({ ...(await supabase.from('order_photos').delete().eq('id', fotoId)), data: true })
}

export async function marcarTipoFoto(fotoId: string, tipo: string): Promise<void> {
  exigir({ ...(await supabase.from('order_photos').update({ kind: tipo }).eq('id', fotoId)), data: true })
}

export async function urlAssinada(caminho: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(caminho, VALIDADE_URL)
  if (error) return null
  return data?.signedUrl ?? null
}

/* ------------------------------------------------------------------ *
 * URLs assinadas: cache + agrupamento entre componentes
 * ------------------------------------------------------------------ */

/**
 * Agrupar dentro de UMA grade não bastava.
 *
 * Cada `<GradeFotos>` é uma instância com o seu próprio efeito, e o Kanban
 * da Produção renderiza um por card — até 400. O resultado eram até 400
 * POSTs em `/storage/v1/object/sign`, refeitos a cada re-render, e foi a
 * causa dominante dos 5-8 s de carregamento que o QA mediu.
 *
 * A correção tem duas partes, as duas aqui e não nas telas:
 *
 *   • CACHE por caminho, com margem de 5 min antes do vencimento. Um
 *     re-render não repete assinatura nenhuma.
 *   • COALESCÊNCIA: pedidos feitos no mesmo tick entram num único
 *     `createSignedUrls`. Os 400 cards montam juntos, então viram 1
 *     requisição.
 */
const cacheUrl = new Map<string, { url: string; expiraEm: number }>()
const MARGEM_MS = 5 * 60 * 1000

let loteAberto: Set<string> | null = null
let lotePromessa: Promise<void> | null = null

/**
 * Estado de módulo + HMR não se dão bem, e em desenvolvimento isso morde.
 *
 * `loteAberto`/`lotePromessa` são mutáveis e vivem no módulo. Quando o Vite
 * troca este arquivo a quente, um componente pode ficar esperando uma
 * promessa da instância ANTIGA enquanto o resto do app já usa a nova — o
 * `.then()` que preencheria a foto pertence a um efeito que o HMR
 * desmontou, então ele nunca chama `setComUrl`. O sintoma é a URL assinada
 * ser pedida com sucesso e a imagem nunca aparecer, porque o `<img>` nem
 * chega a ser criado.
 *
 * Zerar o lote no dispose faz cada recarga a quente começar limpa. O cache
 * de URLs também vai, porque URL assinada é barata de refazer e cache
 * atravessando recarga esconde justamente este tipo de problema.
 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loteAberto = null
    lotePromessa = null
    cacheUrl.clear()
  })
}

function assinarEmLote(caminhos: string[]): Promise<void> {
  if (!loteAberto) {
    loteAberto = new Set()
    // Microtask: tudo que for pedido durante esta rodada de render entra
    // no mesmo lote. `queueMicrotask` acorda antes da pintura, então não
    // custa um frame.
    lotePromessa = new Promise<void>((resolve) => {
      queueMicrotask(async () => {
        const pedidos = [...loteAberto!]
        loteAberto = null
        lotePromessa = null
        if (!pedidos.length) return resolve()

        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrls(pedidos, VALIDADE_URL)

        if (error) {
          console.error('[fotos] não foi possível assinar as URLs:', error, pedidos)
        } else if (data) {
          const agora = Date.now()
          for (const d of data) {
            if (d.signedUrl && d.path) {
              cacheUrl.set(d.path, { url: d.signedUrl, expiraEm: agora + VALIDADE_URL * 1000 })
            } else {
              // Um item pode falhar sozinho no lote (arquivo removido do
              // bucket, por exemplo) e o `error` geral vir nulo. Sem este
              // aviso a foto some da tela sem nenhum rastro.
              console.error('[fotos] item sem URL assinada no lote:', d)
            }
          }
        }
        resolve()
      })
    })
  }
  for (const c of caminhos) loteAberto.add(c)
  return lotePromessa!
}

function doCache(caminho: string): string | null {
  const hit = cacheUrl.get(caminho)
  if (hit && hit.expiraEm - MARGEM_MS > Date.now()) return hit.url
  if (hit) cacheUrl.delete(caminho)
  return null
}

/** Invalida o cache de uma foto — usar quando o arquivo muda ou some. */
export function esquecerUrl(caminho: string) {
  cacheUrl.delete(caminho)
}

/**
 * Resolve as URLs de várias fotos, usando cache e um único round-trip
 * por tick para o app inteiro.
 */
export async function resolverUrls(fotos: Foto[]): Promise<Foto[]> {
  const pendentes = fotos
    .filter((f) => f.storagePath && !f.dataUrl && !doCache(f.storagePath))
    .map((f) => f.storagePath!)

  if (pendentes.length) await assinarEmLote(pendentes)

  return fotos.map((f) => {
    if (!f.storagePath || f.dataUrl) return f
    const url = doCache(f.storagePath)
    return url ? { ...f, dataUrl: url } : f
  })
}
