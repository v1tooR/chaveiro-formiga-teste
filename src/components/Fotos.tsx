import { Camera, ImagePlus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Foto } from '@/types'
import { cx } from '@/lib/utils'
import { useDominioMaps } from '@/lib/dominio'
import { resolverUrls } from '@/lib/api/fotos'
import { FotoBox, SemFoto } from './dominio'
import { CapturaCamera } from './CapturaCamera'
import { Erro, Modal, Spinner, useToast } from './ui'

/**
 * Grade de fotos da comanda.
 *
 * O upload agora é real: o arquivo vai para o bucket privado
 * `order-photos` e a leitura usa URL assinada. Antes o componente só
 * gerava um gradiente a partir de um seed, ou lia o arquivo local como
 * dataURL para preview.
 *
 * `onArquivo` recebe o File e faz o upload (quem sabe o id da comanda é a
 * tela). `onAdd` continua existindo para o fluxo de criação, onde a
 * comanda ainda não tem id — as fotos ficam em memória até o create_order.
 */
export function GradeFotos({
  fotos,
  categoria,
  onAdd,
  onArquivo,
  onRemove,
  onTipo,
  editavel = true,
  interativo = true,
  tiposPermitidos,
  colunas = 'grid-cols-3 sm:grid-cols-4',
  altura = 'h-24',
}: {
  fotos: Foto[]
  categoria: string
  /** Registro sem arquivo (gradiente) — usado no fluxo de criação. */
  onAdd?: (f: Foto) => void
  /** Upload real de arquivo. */
  onArquivo?: (file: File, tipo: string, legenda: string) => Promise<void> | void
  onRemove?: (id: string) => void
  onTipo?: (id: string, tipo: string) => void
  editavel?: boolean
  /**
   * Abre o zoom ao clicar na foto. Desligue quando a grade estiver
   * DENTRO de outro elemento clicável: `FotoBox` vira `<button>` quando
   * recebe `onClick`, e `<button>` dentro de `<button>` é DOM inválido —
   * o React reclama e o clique dispara os dois handlers de uma vez.
   */
  interativo?: boolean
  /**
   * Restringe as marcações oferecidas. Usado pelo cadastro, que só recebe
   * peça — ver o comentário na filtragem abaixo.
   */
  tiposPermitidos?: string[]
  colunas?: string
  altura?: string
}) {
  const { push } = useToast()
  const dom = useDominioMaps()
  const inputRef = useRef<HTMLInputElement>(null)

  const todosTipos = dom.TIPOS_FOTO.length
    ? dom.TIPOS_FOTO
    : [{ key: 'antes', label: 'Antes', legendaPadrao: 'Item recebido' }]

  /**
   * O cadastro passa ['antes', 'detalhe'] e some com "Depois".
   *
   * "Depois" é a peça PRONTA, e a exigência da entrega procura exatamente
   * por ela. Oferecer essa marcação no momento em que o cliente está
   * entregando o sapato deixava abrir a comanda e entregá-la em seguida
   * sem nunca fotografar o serviço feito — a foto do "depois" já existia
   * desde o recebimento, tirada da peça suja.
   *
   * O `filter` degrada para a lista inteira se `tiposPermitidos` não
   * casar com nada: uma loja que renomeie as chaves em `photo_kinds` fica
   * com marcações a mais, não com a grade travada sem nenhuma.
   */
  const filtrados = tiposPermitidos
    ? todosTipos.filter((t) => tiposPermitidos.includes(t.key))
    : todosTipos
  const tipos = filtrados.length ? filtrados : todosTipos

  const [zoom, setZoom] = useState<Foto | null>(null)
  const [camera, setCamera] = useState(false)
  const [tipoNovo, setTipoNovo] = useState<string>(tipos[0].key)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Resolve as URLs assinadas das fotos que têm arquivo no Storage.
  // `resolverUrls` agrupa e cacheia entre TODAS as grades (ver fotos.ts).
  const [comUrl, setComUrl] = useState<Foto[]>(fotos)

  // A dependência é o CONTEÚDO, não a identidade do array.
  //
  // Os maiores consumidores passam array literal — `fotos={[foto]}` no
  // Kanban, `fotos={c.fotos.slice(0, 4)}` no Atendimento — recriado a
  // cada render do card. Com `[fotos]` na dependência, o efeito disparava
  // a cada tecla digitada na busca, em até 400 cards ao mesmo tempo.
  // Mesma técnica do `tabelas?.join('-')` em hooks.ts.
  const chave = fotos.map((f) => `${f.id}:${f.storagePath ?? ''}:${f.dataUrl ? 1 : 0}`).join('|')

  const fotosRef = useRef(fotos)
  fotosRef.current = fotos

  useEffect(() => {
    let vivo = true
    const atuais = fotosRef.current
    if (!atuais.some((f) => f.storagePath && !f.dataUrl)) {
      setComUrl(atuais)
      return
    }
    void resolverUrls(atuais).then((r) => {
      if (vivo) setComUrl(r)
    })
    return () => {
      vivo = false
    }
  }, [chave])

  const legendaPadrao = (tipo: string) =>
    tipos.find((t) => t.key === tipo)?.legendaPadrao ?? 'Foto do item'

  async function selecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Zerado antes do await: sem isso, escolher o MESMO arquivo duas vezes
    // seguidas não dispara `change` na segunda.
    e.target.value = ''
    if (!file) return
    try {
      await processarArquivo(file)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar a foto.')
    }
  }

  /**
   * Caminho único do arquivo, venha do seletor ou da câmera.
   *
   * LANÇA em vez de tratar: o modal da câmera precisa do erro para manter a
   * prévia na tela e deixar o operador tentar de novo. Quem chama pelo
   * seletor é que converte em `setErro`.
   *
   * A foto da câmera chega com nome gerado (`foto-<ts>.jpg`), que não serve
   * de legenda — nesse caso cai na legenda padrão do tipo.
   */
  async function processarArquivo(file: File, daCamera = false) {
    setErro(null)

    // ⚠️ `file.type` VEM VAZIO com frequência, e recusar por isso rejeita
    // foto boa.
    //
    // O caso que importa aqui é o HEIC do iPhone: o Windows não registra
    // MIME para .heic/.heif, então o navegador entrega `type: ""` e a
    // checagem antiga barrava com "Selecione um arquivo de imagem" — para
    // uma foto que é, obviamente, uma imagem. Acontece o mesmo com .jfif e
    // .avif em máquinas sem os tipos registrados.
    //
    // Numa loja onde todo mundo fotografa com o celular, isso é o caminho
    // principal, não uma borda.
    //
    // Quem recusa de verdade continua sendo o bucket (`allowed_mime_types`).
    // Aqui a checagem existe só para dar mensagem boa antes da viagem.
    const ext = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? ''
    const pareceImagem =
      file.type.startsWith('image/') ||
      (file.type === '' && ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'jfif', 'avif'].includes(ext))

    if (!pareceImagem) {
      throw new Error(
        file.type
          ? `"${file.name}" não é uma imagem (${file.type}). Escolha uma foto.`
          : `Não reconheci "${file.name}" como imagem. Escolha um arquivo .jpg, .png, .webp ou .heic.`,
      )
    }
    // Espelha o limite do bucket: falhar aqui dá uma mensagem clara em vez
    // do erro cru do Storage.
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('A imagem tem mais de 10 MB. Reduza o tamanho e tente novamente.')
    }

    const legenda = daCamera
      ? legendaPadrao(tipoNovo)
      : file.name.replace(/\.[^.]+$/, '').slice(0, 28) || legendaPadrao(tipoNovo)

    if (onArquivo) {
      setEnviando(true)
      try {
        await onArquivo(file, tipoNovo, legenda)
        push({ tipo: 'ok', titulo: 'Foto anexada', descricao: legenda })
      } finally {
        setEnviando(false)
      }
      return
    }

    // Fluxo de criação: a comanda ainda não existe, então a foto fica em
    // memória (com preview local) e sobe junto no create_order.
    //
    // O FileReader é assíncrono e o modal da câmera só pode fechar depois
    // que a foto entrou na lista — daí a promessa em volta.
    if (!onAdd) return

    await new Promise<void>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
      reader.onload = () => {
        onAdd({
          id: `tmp_${crypto.randomUUID()}`,
          tipo: tipoNovo,
          legenda,
          // `<categoria>-<uuid>`: o prefixo escolhe a paleta do gradiente
          // (FotoBox, dominio.tsx:192) e o uuid faz o seed servir de chave
          // de correlação — é por ele que NovoAtendimento reencontra, na
          // comanda recém-criada, a linha de cada foto para anexar o
          // arquivo. Com o antigo `Math.random()*999` duas fotos da mesma
          // categoria podiam colidir e o arquivo ia para a linha errada.
          seed: `${categoria}-${crypto.randomUUID()}`,
          dataUrl: String(reader.result),
          arquivo: file,
          criadoEm: new Date().toISOString(),
        } as Foto & { arquivo: File })
        push({ tipo: 'ok', titulo: 'Foto anexada', descricao: legenda })
        resolve()
      }
      reader.readAsDataURL(file)
    })
  }

  return (
    <div>
      {editavel && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-ink-500">Marcar como:</span>
          {tipos.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTipoNovo(t.key)}
              aria-pressed={tipoNovo === t.key}
              className={cx('chip', tipoNovo === t.key && 'chip-on')}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {erro && (
        <div className="mb-3">
          <Erro compacto mensagem={erro} onTentarNovamente={() => setErro(null)} />
        </div>
      )}

      <div className={cx('grid gap-2', colunas)}>
        {comUrl.map((f) => (
          <div key={f.id} className="group relative">
            <FotoBox
              foto={f}
              className={altura}
              onClick={interativo ? () => setZoom(f) : undefined}
            />

            {editavel && onRemove && (
              <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => onRemove(f.id)}
                  aria-label="Remover foto"
                  className="grid h-6 w-6 place-items-center rounded-md bg-ink-950/70 text-white hover:bg-danger transition"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )}
          </div>
        ))}

        {editavel && (
          <>
            {/*
              Onde ficava "Sem foto", que registrava um gradiente e nenhuma
              imagem. A exigência de foto (create_order e a entrega) só
              pergunta se existe linha em order_photos, então aquele botão
              cumpria a regra sem cumprir o propósito dela — e estava ao lado
              do botão certo, com o mesmo peso visual.
            */}
            <button
              type="button"
              onClick={() => setCamera(true)}
              disabled={enviando}
              className={cx(
                'flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink-300',
                'bg-ink-50 text-ink-500 transition hover:border-brass-400 hover:bg-brass-50 hover:text-brass-700',
                'disabled:opacity-50',
                altura,
              )}
            >
              <Camera size={17} />
              <span className="text-[10.5px] font-semibold">Câmera</span>
            </button>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={enviando}
              className={cx(
                'flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink-300',
                'bg-ink-50 text-ink-500 transition hover:border-brass-400 hover:bg-brass-50 hover:text-brass-700',
                'disabled:opacity-50',
                altura,
              )}
            >
              {enviando ? <Spinner /> : <ImagePlus size={17} />}
              <span className="text-[10.5px] font-semibold">{enviando ? 'Enviando…' : 'Escolher'}</span>
            </button>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              // `capture` abre a câmera direto no celular do balcão.
              capture="environment"
              className="hidden"
              onChange={selecionarArquivo}
              aria-label="Selecionar imagem"
            />
          </>
        )}

        {!editavel && comUrl.length === 0 && <SemFoto className={cx(altura, 'col-span-full')} />}
      </div>

      {/* Zoom */}
      <Modal
        open={!!zoom}
        onClose={() => setZoom(null)}
        title={zoom?.legenda ?? 'Foto'}
        subtitle={zoom ? `Marcada como "${zoom.tipo}"` : undefined}
        size="lg"
        footer={
          zoom && onTipo ? (
            <div className="flex w-full items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-ink-500">Alterar marcação:</span>
                {tipos.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => {
                      onTipo(zoom.id, t.key)
                      setZoom({ ...zoom, tipo: t.key })
                      push({ tipo: 'ok', titulo: `Foto marcada como "${t.label}".` })
                    }}
                    className={cx('chip', zoom.tipo === t.key && 'chip-on')}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button className="btn-ghost" onClick={() => setZoom(null)}>
                Fechar
              </button>
            </div>
          ) : undefined
        }
      >
        {zoom && <FotoBox foto={zoom} className="h-[46vh] w-full" mostrarTipo={false} />}
      </Modal>

      <CapturaCamera
        open={camera}
        onClose={() => setCamera(false)}
        titulo={`Fotografar — ${tipos.find((t) => t.key === tipoNovo)?.label ?? tipoNovo}`}
        subtitulo={`A foto entra marcada como "${
          tipos.find((t) => t.key === tipoNovo)?.label ?? tipoNovo
        }". Para mudar, feche e troque a marcação antes de fotografar.`}
        onCapturar={(file) => processarArquivo(file, true)}
      />
    </div>
  )
}

/**
 * Contador compacto de fotos para listas.
 * Recebe a QUANTIDADE, não o array: a listagem paginada traz
 * `photo_count` da view em vez de carregar as fotos de cada linha.
 */
export function FotoContagem({ qtd }: { qtd: number }) {
  if (!qtd) {
    return (
      <span className="badge bg-ink-100 text-ink-400">
        <X size={11} />
        sem foto
      </span>
    )
  }
  return (
    <span className="badge bg-ink-100 text-ink-600 num">
      <Camera size={11} />
      {qtd}
    </span>
  )
}
