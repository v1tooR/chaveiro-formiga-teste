import { CheckSquare, Printer, RotateCcw, Search, Square, Tag } from 'lucide-react'
import { useState } from 'react'
import ImprimirEtiqueta, { Etiqueta } from '@/components/ImprimirEtiqueta'
import { CategoriaBadge, Kpi, PageHead, PrazoBadge } from '@/components/dominio'
import { Erro, Paginacao, Select, SkelCards, SkelLinhas, Vazio } from '@/components/ui'
import { TAMANHOS_ETIQUETA as TAMANHOS, type TamanhoEtiqueta } from '@/lib/constants'
import { useDominioMaps } from '@/lib/dominio'
import { useAsync, useLista } from '@/lib/hooks'
import { listarComandas, type FiltroComandas } from '@/lib/api/comandas'
import { usePodeEditar, useSessao } from '@/store/useSessao'
import { comandaCod, cx } from '@/lib/utils'
import type { Comanda } from '@/types'

export default function Etiquetas() {
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)
  const podeImprimir = usePodeEditar('labels')

  const prefixo = config?.comandas.prefixo ?? 'CF'
  const porFolha = config?.etiquetas.porFolha ?? 12

  const [tamanho, setTamanho] = useState<TamanhoEtiqueta>(config?.etiquetas.tamanhoPadrao ?? 'media')
  const [sel, setSel] = useState<Comanda[]>([])
  const [printOpen, setPrintOpen] = useState(false)

  /**
   * Fila de etiquetas: só comandas ainda na operação (regra 24).
   * O filtro roda no banco — antes era `.filter()` sobre o array completo.
   */
  const lista = useLista<Comanda, FiltroComandas>(
    listarComandas,
    { apenasAtivas: true, etiqueta: 'pendentes' },
    {
      ordem: { campo: 'number', direcao: 'desc' },
      tabelas: ['orders'],
      canal: 'etiquetas-fila',
    },
  )

  /** Contadores da fila, independentes da página exibida. */
  const contagem = useAsync(
    async () => {
      const [pendentes, impressas] = await Promise.all([
        listarComandas({ pagina: 1, tamanho: 1 }, { apenasAtivas: true, etiqueta: 'pendentes' }),
        listarComandas({ pagina: 1, tamanho: 1 }, { apenasAtivas: true, etiqueta: 'impressas' }),
      ])
      return { pendentes: pendentes.total, impressas: impressas.total }
    },
    [],
    { tabelas: ['orders'], canal: 'etiquetas-contagem' },
  )

  const filtro = lista.filtro
  const linhas = lista.pagina.linhas
  const selIds = new Set(sel.map((c) => c.id))
  const todasSelecionadas = linhas.length > 0 && linhas.every((c) => selIds.has(c.id))

  function alternar(c: Comanda) {
    setSel((s) => (s.some((x) => x.id === c.id) ? s.filter((x) => x.id !== c.id) : [...s, c]))
  }

  function alternarTodas() {
    if (todasSelecionadas) {
      const ids = new Set(linhas.map((c) => c.id))
      setSel((s) => s.filter((c) => !ids.has(c.id)))
    } else {
      setSel((s) => {
        const existentes = new Set(s.map((c) => c.id))
        return [...s, ...linhas.filter((c) => !existentes.has(c.id))]
      })
    }
  }

  return (
    <div>
      <PageHead
        titulo="Etiquetas"
        subtitulo="Identifique cada peça na bancada com número, cliente, prazo e código."
        acoes={
          <>
            <Select
              value={tamanho}
              onChange={(v) => setTamanho(v as TamanhoEtiqueta)}
              aria-label="Tamanho da etiqueta"
              className="w-full sm:w-52"
              options={(Object.keys(TAMANHOS) as TamanhoEtiqueta[]).map((t) => ({
                value: t,
                label: `${TAMANHOS[t].label} · ${TAMANHOS[t].medida}`,
              }))}
            />
            <button
              onClick={() => setPrintOpen(true)}
              className="btn-accent"
              disabled={sel.length === 0 || !podeImprimir}
            >
              <Printer size={15} />
              Imprimir {sel.length > 0 && `(${sel.length})`}
            </button>
          </>
        }
      />

      {!podeImprimir && (
        <p className="mb-4 rounded-field bg-ink-50 px-3.5 py-3 text-[13px] text-ink-500">
          Seu perfil consulta a fila de etiquetas, mas não registra impressão.
        </p>
      )}

      {contagem.carregando && !contagem.dados ? (
        <SkelCards />
      ) : contagem.erro ? (
        <Erro compacto mensagem={contagem.erro} onTentarNovamente={contagem.recarregar} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Aguardando impressão"
            valor={contagem.dados?.pendentes ?? 0}
            hint="Peças sem etiqueta na bancada"
            icon={Tag}
            tom={(contagem.dados?.pendentes ?? 0) > 0 ? 'alerta' : 'neutro'}
            onClick={() => lista.setFiltro({ etiqueta: 'pendentes' })}
          />
          <Kpi
            label="Já impressas"
            valor={contagem.dados?.impressas ?? 0}
            hint="Etiquetas geradas"
            tom="ok"
            onClick={() => lista.setFiltro({ etiqueta: 'impressas' })}
          />
          <Kpi label="Selecionadas" valor={sel.length} hint="Prontas para o lote" />
          <Kpi
            label="Folhas estimadas"
            valor={Math.ceil(Math.max(sel.length, 1) / porFolha)}
            hint={`${porFolha} etiquetas por folha`}
          />
        </div>
      )}

      {/* Filtros */}
      <div className="card mt-6 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="field pl-9"
              placeholder="Buscar comanda, cliente ou serviço…"
              value={lista.busca}
              onChange={(e) => lista.setBusca(e.target.value)}
              aria-label="Buscar comanda"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ['pendentes', 'Pendentes'],
                ['impressas', 'Impressas'],
                ['', 'Todas'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                onClick={() => lista.setFiltro({ etiqueta: v || undefined })}
                className={cx('chip', (filtro.etiqueta ?? '') === v && 'chip-on')}
              >
                {label}
              </button>
            ))}
            <span className="mx-1 h-6 w-px self-center bg-ink-100" />
            <button
              onClick={() => lista.setFiltro({ categoria: undefined })}
              className={cx('chip', !filtro.categoria && 'chip-on')}
            >
              Todas
            </button>
            {dom.CATEGORIA_LIST.slice(0, 3).map((c) => (
              <button
                key={c}
                onClick={() => lista.setFiltro({ categoria: c })}
                className={cx('chip', filtro.categoria === c && 'chip-on')}
              >
                {dom.cat(c).label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={alternarTodas}
            className="btn-ghost text-[13px] px-2 py-1.5"
            disabled={!linhas.length}
          >
            {todasSelecionadas ? <CheckSquare size={15} /> : <Square size={15} />}
            {todasSelecionadas ? 'Desmarcar página' : 'Selecionar página'}
            <span className="num text-ink-400">({linhas.length})</span>
          </button>

          {sel.length > 0 && (
            <button onClick={() => setSel([])} className="btn-ghost text-[13px] px-2 py-1.5 text-danger">
              <RotateCcw size={14} />
              Limpar seleção ({sel.length})
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Lista */}
        <div>
          {lista.inicial && lista.carregando ? (
            <SkelLinhas n={7} />
          ) : lista.erro ? (
            <div className="card">
              <Erro mensagem={lista.erro} onTentarNovamente={lista.recarregar} />
            </div>
          ) : lista.pagina.total === 0 ? (
            <div className="card">
              <Vazio
                icon={Tag}
                titulo="Nenhuma comanda para etiquetar"
                descricao={
                  filtro.etiqueta === 'pendentes'
                    ? 'Todas as peças em andamento já possuem etiqueta impressa.'
                    : 'Ajuste os filtros para ver outras comandas.'
                }
                acao={
                  <button onClick={() => lista.setFiltro({ etiqueta: undefined })} className="btn-outline">
                    Ver todas
                  </button>
                }
              />
            </div>
          ) : (
            <>
              <div className={cx('space-y-2', lista.carregando && 'opacity-60')}>
                {linhas.map((c) => {
                  const on = selIds.has(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => alternar(c)}
                      className={cx(
                        'flex w-full flex-wrap items-center gap-3 rounded-card border px-3.5 py-3 text-left transition',
                        on
                          ? 'border-ink-900 bg-ink-50 shadow-soft'
                          : 'border-ink-100 bg-white hover:border-ink-300 hover:bg-ink-50',
                      )}
                    >
                      <span
                        className={cx(
                          'grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border transition',
                          on ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-300 bg-white',
                        )}
                      >
                        {on && <CheckSquare size={12} strokeWidth={3} />}
                      </span>

                      <span className="num shrink-0 text-[12.5px] font-bold text-ink-500">
                        {comandaCod(c.numero, prefixo)}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink-900">
                          {c.clienteNome}
                        </span>
                        <span className="block truncate text-[12px] text-ink-500">{c.servicoNome}</span>
                      </span>

                      <CategoriaBadge cat={c.categoria} />
                      <PrazoBadge prazo={c.prazoEm} status={c.status} compacto />

                      {c.etiquetaImpressa ? (
                        <span className="badge bg-pine-50 text-pine-700 shrink-0">Impressa</span>
                      ) : (
                        <span className="badge bg-brass-50 text-brass-700 shrink-0">Pendente</span>
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="card mt-3">
                <Paginacao
                  pagina={lista.pagina.pagina}
                  paginas={lista.pagina.paginas}
                  total={lista.pagina.total}
                  tamanho={lista.pagina.tamanho}
                  carregando={lista.carregando}
                  onAnterior={lista.anterior}
                  onProxima={lista.proxima}
                  rotulo="comanda"
                />
              </div>
            </>
          )}
        </div>

        {/* Preview lateral */}
        <aside className="lg:sticky lg:top-[76px] lg:self-start">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14.5px] font-bold text-ink-900">Pré-visualização</h3>
              <span className="num badge bg-ink-100 text-ink-600">{TAMANHOS[tamanho].medida}</span>
            </div>

            {sel.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50 py-10 text-center">
                <Tag size={20} className="mx-auto text-ink-300" />
                <p className="mt-2 text-[12.5px] text-ink-400 px-4 leading-relaxed">
                  Selecione uma ou mais comandas para visualizar as etiquetas.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center gap-2.5 max-h-[420px] overflow-y-auto scroll-x rounded-xl bg-ink-50 p-3">
                  {sel.slice(0, 8).map((c) => (
                    <Etiqueta
                      key={c.id}
                      comanda={c}
                      tamanho={tamanho}
                      mostrarQr={config?.etiquetas.mostrarQr ?? true}
                      mostrarResponsavel={config?.etiquetas.mostrarResponsavel ?? true}
                      prefixo={prefixo}
                      empresa={config?.empresa.nome ?? 'Chaveiro Formiga'}
                    />
                  ))}
                </div>

                {sel.length > 8 && (
                  <p className="num mt-2 text-center text-[12px] text-ink-500">
                    + {sel.length - 8} etiqueta(s) no lote
                  </p>
                )}

                <button
                  onClick={() => setPrintOpen(true)}
                  className="btn-accent mt-3 w-full"
                  disabled={!podeImprimir}
                >
                  <Printer size={15} />
                  Imprimir {sel.length} etiqueta(s)
                </button>
              </>
            )}
          </div>

          <div className="card mt-3 p-4">
            <h4 className="text-[13.5px] font-bold text-ink-900">Impressão em lote</h4>
            <p className="mt-1.5 text-[12.5px] text-ink-500 leading-relaxed">
              As etiquetas selecionadas são distribuídas em folhas de{' '}
              <span className="num font-semibold text-ink-700">{porFolha}</span> unidades, conforme
              configurado.
            </p>
            <div className="mt-3 space-y-1.5">
              <button
                onClick={() => setSel(linhas.filter((c) => !c.etiquetaImpressa))}
                className="btn-outline w-full text-[12.5px] py-2"
                disabled={!linhas.length}
              >
                Selecionar pendentes desta página
              </button>
            </div>
          </div>
        </aside>
      </div>

      <ImprimirEtiqueta
        open={printOpen}
        onClose={() => {
          setPrintOpen(false)
          setSel([])
        }}
        comandas={sel}
        onImpressas={() => {
          lista.recarregar()
          contagem.recarregar()
        }}
      />
    </div>
  )
}
