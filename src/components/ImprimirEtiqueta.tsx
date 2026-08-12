import { Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Comanda, ItemComanda } from '@/types'
import { useSessao } from '@/store/useSessao'
import { useAsync } from '@/lib/hooks'
import { listarItensDeComandas, marcarEtiquetasImpressas } from '@/lib/api/comandas'
import { TAMANHOS_ETIQUETA as TAMANHOS, type TamanhoEtiqueta } from '@/lib/constants'
import { comandaCod, cx, fmtData } from '@/lib/utils'
import { Erro, Modal, Spinner, useToast } from './ui'
import { Qr, urlCurtaComanda } from './Qr'

export type { TamanhoEtiqueta }

/** Etiqueta individual — usada no preview e na folha de impressão em lote. */
export function Etiqueta({
  comanda,
  item,
  cliente,
  tamanho,
  mostrarQr,
  mostrarResponsavel,
  prefixo = 'CF',
  empresa = 'Chaveiro Formiga',
}: {
  comanda: Comanda
  /**
   * A PEÇA a que esta etiqueta pertence. A etiqueta vai colada no item
   * físico, então uma comanda de três peças precisa de três etiquetas —
   * cada uma com seu serviço e seu código CF-0042/N.
   *
   * Ausente = comanda de um item só, ou pré-visualização sem os itens
   * carregados: cai no comportamento antigo, um rótulo por comanda.
   */
  item?: ItemComanda
  /** Opcional: por padrão usa o nome que já vem na comanda. */
  cliente?: string
  tamanho: TamanhoEtiqueta
  mostrarQr: boolean
  mostrarResponsavel: boolean
  prefixo?: string
  empresa?: string
}) {
  const nomeCliente = cliente ?? comanda.clienteNome
  const t = TAMANHOS[tamanho]
  const cod = comandaCod(comanda.numero, prefixo) + (item ? `/${item.posicao}` : '')
  const pequena = tamanho === 'pequena'

  return (
    <div
      className={cx(
        'flex flex-col justify-between rounded-lg border border-ink-300 bg-white overflow-hidden shrink-0',
        t.classe,
      )}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0">
          <p
            className={cx(
              'font-display font-extrabold uppercase leading-none tracking-tight text-ink-950',
              pequena ? 'text-[7.5px]' : 'text-[9px]',
            )}
          >
            {empresa}
          </p>
          <p className={cx('num font-extrabold leading-none text-ink-950 mt-1', pequena ? 'text-[13px]' : 'text-[17px]')}>
            {cod}
          </p>
        </div>

        {/*
          O QR da etiqueta é MAIOR que o antigo (26/36/44 px) porque agora
          precisa ser lido, não parecer lido.

          E usa o endereço CURTO (`/c/<numero>`, 29 módulos) em vez da URL
          com UUID (33 módulos). São 4 módulos de diferença, que viram
          ~1,6 mm no lado mínimo — e é o que faz o código caber até na
          etiqueta pequena, sem engolir o texto.

          A etiqueta é o artefato interno: fica grudada na peça, e é ela
          que o balcão escaneia para achar a ficha na prateleira.
        */}
        {mostrarQr && (
          <div className="shrink-0">
            <Qr
              texto={urlCurtaComanda(comanda.numero)}
              size={pequena ? 44 : tamanho === 'media' ? 54 : 62}
              aoNaoCaber={() => (
                <span className="block w-[40px] text-right text-[6.5px] font-semibold leading-tight text-ink-400">
                  sem espaço para QR legível
                </span>
              )}
            />
          </div>
        )}
      </div>

      <div className="min-w-0">
        <p className={cx('truncate font-bold text-ink-900 leading-tight', pequena ? 'text-[8.5px]' : 'text-[11px]')}>
          {nomeCliente}
        </p>
        <p className={cx('truncate text-ink-600 leading-tight', pequena ? 'text-[7.5px]' : 'text-[9.5px]')}>
          {item?.servicoNome ?? comanda.servicoNome}
        </p>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className={cx('num font-bold text-ink-900 leading-none', pequena ? 'text-[8px]' : 'text-[10px]')}>
            Prazo {fmtData(item?.prazoEm ?? comanda.prazoEm)}
          </p>
          {mostrarResponsavel && !pequena && (
            <p className="text-[9px] text-ink-500 leading-tight mt-0.5">Resp. {item?.responsavel ?? comanda.responsavel}</p>
          )}
        </div>

        {/*
          Aqui ficava `BarrasFake` — barras de largura aleatória, tiradas de
          um hash, com o comentário "Código de barras decorativo" e
          `aria-hidden`. Nenhum leitor lia. Saiu pelo mesmo motivo do QR
          falso: impresso numa etiqueta, promete uma leitura que não existe.

          Não virou código de barras de verdade porque isso é decisão de
          operação, não de código — só vale se a loja tiver leitor, e aí o
          formato (Code 128) e o que ele digita no campo de busca precisam
          ser combinados.
        */}
      </div>
    </div>
  )
}

export default function ImprimirEtiqueta({
  open,
  onClose,
  comandas,
  onImpressas,
}: {
  open: boolean
  onClose: () => void
  comandas: Comanda[]
  onImpressas?: () => void
}) {
  const { push } = useToast()
  const config = useSessao((s) => s.config)

  const [tamanho, setTamanho] = useState<TamanhoEtiqueta>(
    config?.etiquetas.tamanhoPadrao ?? 'media',
  )
  const [imprimindo, setImprimindo] = useState(false)
  /** Monta a folha com todas as etiquetas só no momento da impressão. */
  const [paraImpressao, setParaImpressao] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  /**
   * Uma etiqueta por PEÇA, não por comanda.
   *
   * A etiqueta vai colada no item físico: comanda com duas chaves e um
   * sapato precisa de três. A listagem de comandas não carrega os itens
   * (seriam N consultas por página), então eles vêm aqui.
   *
   * Enquanto carrega — ou se a consulta falhar — cai no comportamento
   * antigo, um rótulo por comanda. Impressão de etiqueta não pode ficar
   * bloqueada por causa de um round-trip.
   */
  const itens = useAsync(
    () => listarItensDeComandas(comandas.map((c) => c.id)),
    [open, comandas.map((c) => c.id).join(',')],
    { ativo: open && comandas.length > 0 },
  )

  const etiquetas = useMemo<{ comanda: Comanda; item?: ItemComanda; key: string }[]>(() => {
    const porComanda = new Map<string, ItemComanda[]>()
    for (const i of itens.dados ?? []) {
      const l = porComanda.get(i.comandaId)
      if (l) l.push(i)
      else porComanda.set(i.comandaId, [i])
    }
    return comandas.flatMap((c) => {
      const l = porComanda.get(c.id)
      if (!l || l.length === 0) return [{ comanda: c, key: c.id }]
      return l.map((i) => ({ comanda: c, item: i, key: i.id }))
    })
  }, [comandas, itens.dados])

  const jaImpressas = comandas.filter((c) => c.etiquetaImpressa).length
  const porFolha = config?.etiquetas.porFolha ?? 12

  /**
   * A RPC ignora comandas finalizadas (regra 24) e devolve quantas foram
   * realmente marcadas — o toast informa o número real, não o pedido.
   */
  async function imprimir() {
    setImprimindo(true)
    setErro(null)
    try {
      const marcadas = await marcarEtiquetasImpressas(comandas.map((c) => c.id))
      onImpressas?.()

      // Monta a folha com TODAS as etiquetas e espera o React pintar antes
      // de abrir a caixa de impressão. Dois frames: o primeiro entrega o
      // commit, o segundo garante que o layout já aconteceu — sem isso a
      // caixa pode abrir sobre um DOM ainda vazio.
      setParaImpressao(true)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

      window.print()
      setParaImpressao(false)
      push({
        tipo: 'ok',
        titulo: marcadas > 1 ? `${marcadas} etiquetas impressas` : 'Etiqueta impressa',
        descricao:
          marcadas < comandas.length
            ? `${comandas.length - marcadas} ignorada(s): comanda já finalizada.`
            : `Tamanho ${TAMANHOS[tamanho].label.toLowerCase()} · ${TAMANHOS[tamanho].medida}`,
      })
      onClose()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar a impressão.')
    } finally {
      setParaImpressao(false)
      setImprimindo(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={etiquetas.length > 1 ? `Imprimir ${etiquetas.length} etiquetas` : 'Imprimir etiqueta'}
      subtitle={
        jaImpressas > 0
          ? `${jaImpressas} de ${comandas.length} já foram impressas — será uma reimpressão`
          : 'Pré-visualização antes da impressão'
      }
      size="lg"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-accent" onClick={() => void imprimir()} disabled={imprimindo || comandas.length === 0}>
            {imprimindo ? <Spinner /> : <Printer size={15} />}
            {imprimindo
              ? 'Enviando…'
              : jaImpressas === comandas.length && jaImpressas > 0
                ? 'Reimprimir'
                : 'Imprimir'}
          </button>
        </>
      }
    >
      {erro && (
        <div className="mb-4">
          <Erro compacto mensagem={erro} onTentarNovamente={() => setErro(null)} />
        </div>
      )}

      <div className="no-print">
        <span className="label">Tamanho da etiqueta</span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TAMANHOS) as TamanhoEtiqueta[]).map((t) => (
            <button
              key={t}
              onClick={() => setTamanho(t)}
              className={cx('chip', tamanho === t && 'chip-on')}
            >
              {TAMANHOS[t].label}
              <span className="num opacity-70">{TAMANHOS[t].medida}</span>
            </button>
          ))}
        </div>
      </div>

      {/*
        A FOLHA — o que vai ao papel.

        Montada só durante a impressão, e fora da tela enquanto isso. São
        duas razões:

        1. A pré-visualização abaixo mostra no máximo 24 etiquetas por
           desempenho, mas o texto sempre prometeu que "todas serão
           impressas". Não eram: `window.print()` imprime o DOM, e o DOM
           tinha 24. Um lote de 40 saía com 16 etiquetas faltando, sem
           aviso nenhum.
        2. Manter as 400 montadas o tempo todo custa caro — cada QR são
           121 retângulos de SVG.
      */}
      {paraImpressao && (
        <div className="print-sheet fora-da-tela">
          <div className="flex flex-wrap gap-2">
            {etiquetas.map((e) => (
              <div key={e.key} className="print-evitar-quebra">
                <Etiqueta
                  comanda={e.comanda}
                  item={e.item}
                  tamanho={tamanho}
                  mostrarQr={config?.etiquetas.mostrarQr ?? true}
                  mostrarResponsavel={config?.etiquetas.mostrarResponsavel ?? true}
                  prefixo={config?.comandas.prefixo ?? 'CF'}
                  empresa={config?.empresa.nome ?? 'Chaveiro Formiga'}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="no-print mt-5">
        <span className="label">Pré-visualização</span>
        <div className="rounded-card border border-ink-200 bg-ink-50 p-5">
          <div className="flex flex-wrap gap-3 justify-center max-h-[46vh] overflow-y-auto scroll-x">
            {etiquetas.slice(0, 24).map((e) => (
              <Etiqueta
                key={e.key}
                comanda={e.comanda}
                item={e.item}
                tamanho={tamanho}
                mostrarQr={config?.etiquetas.mostrarQr ?? true}
                mostrarResponsavel={config?.etiquetas.mostrarResponsavel ?? true}
                prefixo={config?.comandas.prefixo ?? 'CF'}
                empresa={config?.empresa.nome ?? 'Chaveiro Formiga'}
              />
            ))}
          </div>

          {etiquetas.length > 24 && (
            <p className="mt-4 text-center text-[12.5px] text-ink-500">
              Exibindo 24 de <span className="num font-semibold">{etiquetas.length}</span> etiquetas — todas
              serão impressas.
            </p>
          )}
        </div>

        <p className="mt-2.5 num text-[12px] text-ink-500">
          {etiquetas.length} etiqueta(s) · {Math.ceil(etiquetas.length / porFolha)} folha(s) a {porFolha} por
          folha.
        </p>
      </div>
    </Modal>
  )
}

export { TAMANHOS }
