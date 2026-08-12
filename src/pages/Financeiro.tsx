import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import RegistrarPagamento from '@/components/RegistrarPagamento'
import { IconeForma, Kpi, LancStatusBadge, PageHead } from '@/components/dominio'
import {
  Confirm,
  Erro,
  Modal,
  Paginacao,
  Select,
  SkelCards,
  SkelLinhas,
  Spinner,
  Vazio,
  useToast,
} from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { baixarCsv, csvData, csvNumero, paraCsv } from '@/lib/exportar'
import { mensagemErro } from '@/lib/supabase'
import { useAcao, useAsync, useLista } from '@/lib/hooks'
import {
  atualizarLancamento,
  criarLancamento,
  listarLancamentos,
  removerLancamento,
  totaisLancamentos,
  type FiltroFinanceiro,
  type NovoLancamento,
} from '@/lib/api/financeiro'
import { listarComandas } from '@/lib/api/comandas'
import { obterKpis, porFormaPagamento, serieFaturamento } from '@/lib/api/relatorios'
import { consultaInicial } from '@/lib/listing'
import { usePodeEditar, useSessao } from '@/store/useSessao'
import { brl, brlCompact, comandaCod, cx, fmtData, iso, numeroDeInput } from '@/lib/utils'
import type { Lancamento } from '@/types'

export default function Financeiro() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const { push } = useToast()
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)
  const prefixo = config?.comandas.prefixo ?? 'CF'
  const podeEditar = usePodeEditar('finance')

  const [novoAberto, setNovoAberto] = useState(false)
  const [pagOpen, setPagOpen] = useState(false)
  const [excluir, setExcluir] = useState<Lancamento | null>(null)
  const [editar, setEditar] = useState<Lancamento | null>(null)

  const lista = useLista<Lancamento, FiltroFinanceiro>(listarLancamentos, { periodo: 'mes' }, {
    ordem: { campo: 'entry_date', direcao: 'desc' },
    tabelas: ['ledger_entries', 'order_payments'],
    canal: 'financeiro-lista',
  })

  /**
   * Totais do recorte filtrado, agregados no banco.
   * Somar só a página exibida daria um rodapé mentiroso.
   */
  const totais = useAsync(() => totaisLancamentos(lista.filtro), [JSON.stringify(lista.filtro)], {
    tabelas: ['ledger_entries'],
    canal: 'financeiro-totais',
  })

  const kpis = useAsync(() => obterKpis(), [], {
    tabelas: ['orders', 'ledger_entries'],
    canal: 'financeiro-kpis',
  })

  const serie = useAsync(() => serieFaturamento(12), [], {
    tabelas: ['ledger_entries'],
    canal: 'financeiro-serie',
  })

  const formas = useAsync(() => porFormaPagamento(), [], {
    tabelas: ['ledger_entries'],
    canal: 'financeiro-formas',
  })

  /** Entregues sem pagamento — o alerta vermelho da tela. */
  const semPagamento = useAsync(
    () =>
      listarComandas({ ...consultaInicial({ campo: 'due_date', direcao: 'asc' }), tamanho: 8 }, {
        status: 'entregue',
        pagamento: 'pendente',
      }),
    [],
    { tabelas: ['orders', 'order_payments'], canal: 'financeiro-sem-pgto' },
  )

  const criar = useAcao(criarLancamento)
  const [exportando, setExportando] = useState(false)

  /** Exporta o recorte filtrado inteiro, não a página visível. */
  async function exportar() {
    setExportando(true)
    try {
      const pagina = await listarLancamentos(
        { ...lista.consulta, pagina: 1, tamanho: 10000 },
        lista.filtro,
      )
      baixarCsv(
        'financeiro',
        paraCsv(pagina.linhas, [
          { titulo: 'Data', valor: (l) => csvData(l.data) },
          { titulo: 'Tipo', valor: (l) => (l.tipo === 'entrada' ? 'Entrada' : 'Saída') },
          { titulo: 'Descrição', valor: (l) => l.descricao },
          { titulo: 'Categoria', valor: (l) => l.categoria },
          { titulo: 'Comanda', valor: (l) => (l.comandaNumero ? comandaCod(l.comandaNumero, prefixo) : '') },
          { titulo: 'Cliente', valor: (l) => l.clienteNome },
          { titulo: 'Forma', valor: (l) => dom.forma(l.forma)?.label ?? '' },
          { titulo: 'Situação', valor: (l) => dom.lancSt(l.status).label },
          { titulo: 'Responsável', valor: (l) => l.responsavel },
          { titulo: 'Valor', valor: (l) => csvNumero(l.valor) },
          { titulo: 'Origem', valor: (l) => (l.automatico ? 'Comanda' : 'Manual') },
        ]),
      )
      push({ tipo: 'ok', titulo: 'Arquivo gerado', descricao: `${pagina.linhas.length} lançamentos.` })
    } catch (e) {
      push({ tipo: 'erro', titulo: 'Falha ao exportar', descricao: mensagemErro(e) })
    } finally {
      setExportando(false)
    }
  }

  const apagar = useAcao(removerLancamento)
  const editarAcao = useAcao(atualizarLancamento)

  useEffect(() => {
    let mudou = false
    if (params.get('novo') === '1') {
      setNovoAberto(true)
      params.delete('novo')
      mudou = true
    }
    if (params.get('pagamento') === '1') {
      setPagOpen(true)
      params.delete('pagamento')
      mudou = true
    }
    if (params.get('filtro') === 'pendente') {
      lista.setFiltro({ status: 'pendente', periodo: 'tudo' })
      params.delete('filtro')
      mudou = true
    }
    if (mudou) setParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams])

  const f = lista.filtro
  const t = totais.dados
  const semPgto = semPagamento.dados?.linhas ?? []

  const dadosFormas = (formas.dados ?? []).map((x) => ({ nome: x.label, valor: x.valor, cor: x.cor }))

  return (
    <div>
      <PageHead
        titulo="Financeiro"
        subtitulo="Recebimentos, pendências e despesas da operação."
        acoes={
          <>
            <button onClick={exportar} className="btn-outline" disabled={exportando}>
              {exportando ? <Spinner /> : <Download size={15} />}
              Exportar
            </button>
            {podeEditar && (
              <>
                <button onClick={() => setNovoAberto(true)} className="btn-outline">
                  <Plus size={15} />
                  Lançamento
                </button>
                <button onClick={() => setPagOpen(true)} className="btn-accent">
                  <Wallet size={15} />
                  Registrar pagamento
                </button>
              </>
            )}
          </>
        }
      />

      {kpis.carregando && !kpis.dados ? (
        <SkelCards />
      ) : kpis.erro ? (
        <Erro compacto mensagem={kpis.erro} onTentarNovamente={kpis.recarregar} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Quem chega nesta tela tem o módulo financeiro, então os
              valores vêm preenchidos. O fallback existe só para o
              instante entre a montagem e a resposta da RPC. */}
          <Kpi
            label="Recebido hoje"
            valor={kpis.dados?.recebidoHoje === null ? '—' : brl(kpis.dados?.recebidoHoje ?? 0)}
            hint="Entradas confirmadas"
            icon={TrendingUp}
            tom="ok"
          />
          <Kpi
            label="Recebido no mês"
            valor={kpis.dados?.recebidoMes === null ? '—' : brl(kpis.dados?.recebidoMes ?? 0)}
            hint="Acumulado do mês atual"
            tom="ok"
          />
          <Kpi
            label="Valores pendentes"
            valor={kpis.dados?.pendente == null ? '—' : brl(kpis.dados.pendente)}
            hint="Saldo a receber das comandas"
            tom="alerta"
            onClick={() => lista.setFiltro({ status: 'pendente', periodo: 'tudo' })}
          />
          <Kpi
            label="Entregues sem pagar"
            valor={kpis.dados?.entreguesSemPagamento ?? 0}
            hint="Serviços entregues com saldo"
            tom={(kpis.dados?.entreguesSemPagamento ?? 0) > 0 ? 'perigo' : 'neutro'}
          />
        </div>
      )}

      {/* Gráficos */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-[15px] font-bold text-ink-900">Entradas e despesas</h3>
          <p className="text-[12.5px] text-ink-500 mt-0.5 mb-4">Últimos 12 meses</p>

          {serie.carregando && !serie.dados ? (
            <div className="skel h-[230px] rounded-xl" />
          ) : serie.erro ? (
            <Erro compacto mensagem={serie.erro} onTentarNovamente={serie.recarregar} />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={serie.dados ?? []} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={3}>
                  <CartesianGrid stroke="#E6E9ED" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                    tickFormatter={(v) => brlCompact(Number(v))}
                  />
                  <Tooltip content={<TipMoeda />} cursor={{ fill: 'rgba(0,0,0,.035)' }} />
                  <Bar dataKey="recebido" name="Recebido" fill="#2F7D5F" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="pendente" name="Pendente" fill="#DFA92A" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="despesa" name="Despesa" fill="#DC5B57" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              <div className="mt-3 flex flex-wrap gap-4 text-[12.5px]">
                {[
                  ['Recebido', '#2F7D5F'],
                  ['Pendente', '#DFA92A'],
                  ['Despesa', '#DC5B57'],
                ].map(([l, c]) => (
                  <span key={l} className="flex items-center gap-1.5 text-ink-600">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} /> {l}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-[15px] font-bold text-ink-900">Formas de pagamento</h3>
          <p className="text-[12.5px] text-ink-500 mt-0.5 mb-2">Valores efetivamente recebidos</p>

          {formas.carregando && !formas.dados ? (
            <div className="skel h-[168px] rounded-xl" />
          ) : formas.erro ? (
            <Erro compacto mensagem={formas.erro} onTentarNovamente={formas.recarregar} />
          ) : dadosFormas.length === 0 ? (
            <p className="py-12 text-center text-[13px] text-ink-400">Nenhum recebimento registrado.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={168}>
                <PieChart>
                  <Pie
                    data={dadosFormas}
                    dataKey="valor"
                    nameKey="nome"
                    innerRadius={46}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {dadosFormas.map((d) => (
                      <Cell key={d.nome} fill={d.cor} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<TipMoeda />} />
                </PieChart>
              </ResponsiveContainer>

              <div className="mt-3 space-y-1.5">
                {dadosFormas.map((d) => (
                  <div key={d.nome} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.cor }} />
                    <span className="flex-1 text-[12.5px] text-ink-700">{d.nome}</span>
                    <span className="num text-[12.5px] font-bold text-ink-900">{brl(d.valor)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Entregues sem pagamento */}
      {semPgto.length > 0 && (
        <div className="card mt-4 border-danger/25 bg-danger/[0.03] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[14.5px] font-bold text-ink-900">Serviços entregues sem pagamento</h3>
              <p className="text-[12.5px] text-ink-500 mt-0.5">
                <span className="num font-semibold">{semPagamento.dados?.total ?? 0}</span> comandas ·{' '}
                <span className="num font-semibold text-danger">
                  {brl(semPgto.reduce((s, c) => s + c.saldoAberto, 0))}
                </span>{' '}
                em aberto nesta amostra
              </p>
            </div>
            {podeEditar && (
              <button onClick={() => setPagOpen(true)} className="btn-primary">
                <Wallet size={15} />
                Registrar recebimento
              </button>
            )}
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto scroll-x pb-1">
            {semPgto.map((c) => (
              <button
                key={c.id}
                onClick={() => nav(`/comandas/${c.id}`)}
                className="shrink-0 rounded-xl border border-ink-100 bg-white px-3 py-2 text-left transition hover:border-ink-300"
              >
                <p className="num text-[11.5px] font-bold text-ink-400">{comandaCod(c.numero, prefixo)}</p>
                <p className="mt-0.5 max-w-[150px] truncate text-[12.5px] font-semibold text-ink-900">
                  {c.clienteNome}
                </p>
                <p className="num text-[12.5px] font-bold text-danger">{brl(c.saldoAberto)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="card mt-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="field pl-9"
              placeholder="Buscar lançamento, cliente ou categoria…"
              value={lista.busca}
              onChange={(e) => lista.setBusca(e.target.value)}
              aria-label="Buscar lançamento"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select
              value={f.periodo ?? 'mes'}
              onChange={(v) => lista.setFiltro({ periodo: v })}
              aria-label="Período"
              className="w-full sm:w-40"
              options={[
                { value: 'mes', label: 'Mês atual' },
                { value: '90', label: 'Últimos 90 dias' },
                { value: 'ano', label: 'Ano atual' },
                { value: 'tudo', label: 'Todo o período' },
              ]}
            />
            <Select
              value={f.tipo ?? ''}
              onChange={(v) => lista.setFiltro({ tipo: v || undefined })}
              placeholder="Entradas e saídas"
              aria-label="Tipo"
              className="w-full sm:w-40"
              options={[
                { value: 'entrada', label: 'Somente entradas' },
                { value: 'saida', label: 'Somente saídas' },
              ]}
            />
            <Select
              value={f.status ?? ''}
              onChange={(v) => lista.setFiltro({ status: v || undefined })}
              placeholder="Todos os status"
              aria-label="Status"
              className="w-full sm:w-40"
              options={Object.values(dom.LANCAMENTO_STATUS).map((m) => ({ value: m.key, label: m.label }))}
            />
            <Select
              value={f.categoriaId ?? ''}
              onChange={(v) => lista.setFiltro({ categoriaId: v || undefined })}
              placeholder="Todas as categorias"
              aria-label="Categoria"
              className="w-full sm:w-48"
              options={[...dom.CAT_ENTRADA, ...dom.CAT_SAIDA].map((c) => ({ value: c.id, label: c.nome }))}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-ink-100 pt-3 text-[12.5px]">
          {totais.carregando && !t ? (
            <span className="flex items-center gap-2 text-ink-400">
              <Spinner />
              Somando…
            </span>
          ) : totais.erro ? (
            <span className="text-danger">Não foi possível somar o período.</span>
          ) : (
            <>
              <span className="text-ink-500">
                <span className="num font-bold text-ink-900">{lista.pagina.total}</span> lançamento(s)
              </span>
              <span className="flex items-center gap-1.5 text-pine-600">
                <ArrowUpRight size={13} />
                <span className="num font-bold">{brl(t?.recebido ?? 0)}</span> recebido
              </span>
              <span className="flex items-center gap-1.5 text-brass-600">
                <span className="num font-bold">{brl(t?.pendente ?? 0)}</span> pendente
              </span>
              <span className="flex items-center gap-1.5 text-danger">
                <ArrowDownLeft size={13} />
                <span className="num font-bold">{brl(t?.despesa ?? 0)}</span> em despesas
              </span>
            </>
          )}

          {(lista.consulta.busca || f.tipo || f.status || f.categoriaId) && (
            <button
              onClick={() => {
                lista.setBusca('')
                lista.trocarFiltro({ periodo: f.periodo })
              }}
              className="ml-auto font-bold text-brass-600 hover:underline"
            >
              limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Lançamentos */}
      <div className="mt-4">
        {lista.inicial && lista.carregando ? (
          <SkelLinhas n={8} />
        ) : lista.erro ? (
          <div className="card">
            <Erro mensagem={lista.erro} onTentarNovamente={lista.recarregar} />
          </div>
        ) : lista.pagina.total === 0 ? (
          <div className="card">
            <Vazio
              icon={Wallet}
              titulo="Nenhum lançamento encontrado"
              descricao="Ajuste os filtros ou registre um novo lançamento."
              acao={
                podeEditar && (
                  <button onClick={() => setNovoAberto(true)} className="btn-primary">
                    <Plus size={15} />
                    Novo lançamento
                  </button>
                )
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className={cx('card hidden lg:block overflow-hidden', lista.carregando && 'opacity-60')}>
              <div className="overflow-x-auto scroll-x">
                <table className="w-full min-w-[940px]">
                  <thead>
                    <tr className="border-b border-ink-100 bg-ink-50/60">
                      {['Data', 'Descrição', 'Comanda', 'Categoria', 'Forma', 'Resp.', 'Status', 'Valor', ''].map(
                        (h) => (
                          <th
                            key={h}
                            className="whitespace-nowrap px-3.5 py-3 text-left text-[11.5px] font-bold uppercase tracking-wider text-ink-500"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {lista.pagina.linhas.map((l) => (
                      <tr key={l.id} className="border-b border-ink-50 transition hover:bg-ink-50 last:border-0">
                        <td className="num whitespace-nowrap px-3.5 py-3 text-[12.5px] text-ink-600">
                          {fmtData(l.data)}
                        </td>
                        <td className="px-3.5 py-3">
                          <span className="flex items-center gap-2">
                            <span
                              className={cx(
                                'grid h-6 w-6 shrink-0 place-items-center rounded-md',
                                l.tipo === 'entrada' ? 'bg-pine-50 text-pine-600' : 'bg-danger/10 text-danger',
                              )}
                            >
                              {l.tipo === 'entrada' ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                            </span>
                            <span className="min-w-0">
                              <span className="block max-w-[230px] truncate text-[13px] font-semibold text-ink-900">
                                {l.descricao}
                              </span>
                              {l.clienteNome && (
                                <span className="block truncate text-[11.5px] text-ink-500">
                                  {l.clienteNome}
                                </span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="px-3.5 py-3">
                          {l.comandaId && l.comandaNumero ? (
                            <button
                              onClick={() => nav(`/comandas/${l.comandaId}`)}
                              className="num text-[12.5px] font-bold text-brass-600 hover:underline"
                            >
                              {comandaCod(l.comandaNumero, prefixo)}
                            </button>
                          ) : (
                            <span className="text-ink-300">—</span>
                          )}
                        </td>
                        <td className="px-3.5 py-3 text-[12.5px] text-ink-600">{l.categoria}</td>
                        <td className="px-3.5 py-3">
                          {l.forma ? (
                            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-600">
                              <IconeForma forma={l.forma} size={13} />
                              {dom.forma(l.forma)?.label}
                            </span>
                          ) : (
                            <span className="text-ink-300">—</span>
                          )}
                        </td>
                        <td className="px-3.5 py-3 text-[12.5px] text-ink-600">{l.responsavel}</td>
                        <td className="px-3.5 py-3">
                          <LancStatusBadge status={l.status} />
                        </td>
                        <td
                          className={cx(
                            'num whitespace-nowrap px-3.5 py-3 text-right text-[13.5px] font-bold',
                            l.tipo === 'entrada' ? 'text-pine-600' : 'text-danger',
                          )}
                        >
                          {l.tipo === 'entrada' ? '+' : '−'} {brl(l.valor)}
                        </td>
                        <td className="px-2 py-3">
                          {/* Lançamento automático da comanda não é excluível:
                              quem zera o valor é o cancelamento da comanda.
                              Mostrar a lixeira aqui só produziria erro de RLS. */}
                          {podeEditar && !l.automatico ? (
                            <span className="flex items-center gap-0.5">
                              <button
                                onClick={() => setEditar(l)}
                                aria-label="Editar lançamento"
                                className="grid h-7 w-7 place-items-center rounded-md text-ink-300 transition hover:bg-ink-100 hover:text-ink-700"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => setExcluir(l)}
                                aria-label="Excluir lançamento"
                                className="grid h-7 w-7 place-items-center rounded-md text-ink-300 transition hover:bg-danger/10 hover:text-danger"
                              >
                                <Trash2 size={13} />
                              </button>
                            </span>
                          ) : l.automatico ? (
                            <span
                              className="grid h-7 w-7 place-items-center rounded-md text-ink-200"
                              title="Gerado pela comanda — não pode ser excluído"
                            >
                              <Lock size={12} />
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Paginacao
                pagina={lista.pagina.pagina}
                paginas={lista.pagina.paginas}
                total={lista.pagina.total}
                tamanho={lista.pagina.tamanho}
                carregando={lista.carregando}
                onAnterior={lista.anterior}
                onProxima={lista.proxima}
                rotulo="lançamento"
              />
            </div>

            {/* Mobile */}
            <div className="space-y-2 lg:hidden">
              {lista.pagina.linhas.map((l) => (
                <div key={l.id} className="card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className={cx(
                          'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                          l.tipo === 'entrada' ? 'bg-pine-50 text-pine-600' : 'bg-danger/10 text-danger',
                        )}
                      >
                        {l.tipo === 'entrada' ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-bold text-ink-900">{l.descricao}</p>
                        <p className="num text-[12px] text-ink-500">
                          {fmtData(l.data)}
                          {l.forma && ` · ${dom.forma(l.forma)?.label}`}
                        </p>
                      </div>
                    </div>
                    <span
                      className={cx(
                        'num shrink-0 text-[14px] font-bold',
                        l.tipo === 'entrada' ? 'text-pine-600' : 'text-danger',
                      )}
                    >
                      {l.tipo === 'entrada' ? '+' : '−'} {brl(l.valor)}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-ink-50 pt-2.5">
                    <LancStatusBadge status={l.status} />
                    {l.comandaId && l.comandaNumero && (
                      <button
                        onClick={() => nav(`/comandas/${l.comandaId}`)}
                        className="num text-[12px] font-bold text-brass-600"
                      >
                        {comandaCod(l.comandaNumero, prefixo)}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="card">
                <Paginacao
                  pagina={lista.pagina.pagina}
                  paginas={lista.pagina.paginas}
                  total={lista.pagina.total}
                  tamanho={lista.pagina.tamanho}
                  carregando={lista.carregando}
                  onAnterior={lista.anterior}
                  onProxima={lista.proxima}
                  rotulo="lançamento"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modais */}
      <RegistrarPagamento
        open={pagOpen}
        onClose={() => setPagOpen(false)}
        onRegistrado={() => {
          lista.recarregar()
          totais.recarregar()
          kpis.recarregar()
          semPagamento.recarregar()
        }}
      />

      <ModalLancamento
        open={novoAberto}
        onClose={() => setNovoAberto(false)}
        enviando={criar.enviando}
        erro={criar.erro}
        onSalvar={async (l) => {
          const r = await criar.executar(l)
          if (!r) return
          setNovoAberto(false)
          push({
            tipo: 'ok',
            titulo: 'Lançamento registrado',
            descricao: `${l.tipo === 'entrada' ? 'Entrada' : 'Saída'} de ${brl(l.valor)}`,
          })
          lista.recarregar()
          totais.recarregar()
        }}
      />

      <ModalLancamento
        open={!!editar}
        inicial={editar}
        onClose={() => setEditar(null)}
        enviando={editarAcao.enviando}
        erro={editarAcao.erro}
        onSalvar={async (l) => {
          if (!editar) return
          const r = await editarAcao.executar(editar.id, l)
          if (r === null) return // o erro aparece no próprio formulário
          setEditar(null)
          push({ tipo: 'ok', titulo: 'Lançamento atualizado', descricao: l.descricao })
          lista.recarregar()
          totais.recarregar()
        }}
      />

      <Confirm
        open={!!excluir}
        onClose={() => setExcluir(null)}
        title="Excluir lançamento"
        message={`"${excluir?.descricao}" sai das listas e dos relatórios. O registro é preservado no banco para conciliação.`}
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          if (!excluir) return
          const r = await apagar.executar(excluir.id)
          if (r === null) {
            push({
              tipo: 'erro',
              titulo: 'Falha ao excluir',
              descricao: apagar.erro ?? 'Não foi possível excluir o lançamento.',
            })
            return
          }
          push({ tipo: 'ok', titulo: 'Lançamento excluído' })
          lista.recarregar()
          totais.recarregar()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function TipMoeda({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name?: string; value?: number; color?: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2.5 shadow-lift">
      {label && <p className="text-[11.5px] font-bold text-ink-900 mb-1.5">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-[12px] text-ink-600">
          {p.color && <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />}
          <span>{p.name}</span>
          <span className="num ml-auto font-bold text-ink-900">{brl(Number(p.value))}</span>
        </p>
      ))}
    </div>
  )
}

function ModalLancamento({
  open,
  onClose,
  onSalvar,
  enviando,
  erro,
  inicial,
}: {
  open: boolean
  onClose: () => void
  onSalvar: (l: NovoLancamento) => void | Promise<void>
  enviando: boolean
  erro: string | null
  /** Preenchido = edição; ausente = novo lançamento. */
  inicial?: Lancamento | null
}) {
  const dom = useDominioMaps()

  const vazio = (): NovoLancamento => ({
    tipo: 'saida',
    descricao: '',
    categoriaId: dom.CAT_SAIDA[0]?.id ?? '',
    valor: 0,
    data: iso(new Date()),
    forma: dom.FORMA_LIST[0] ?? null,
    status: 'pago',
    responsavelId: null,
    observacao: '',
  })

  const de = (l: Lancamento): NovoLancamento => ({
    tipo: l.tipo,
    descricao: l.descricao,
    categoriaId: l.categoriaId,
    valor: l.valor,
    data: l.data,
    forma: l.forma,
    status: l.status,
    responsavelId: l.responsavelId,
    observacao: l.observacao ?? '',
  })

  const [f, setF] = useState<NovoLancamento>(vazio)

  useEffect(() => {
    if (open) setF(inicial ? de(inicial) : vazio())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inicial])

  // Regra 29: a categoria tem que ser do mesmo tipo do lançamento — o
  // banco valida por trigger, e trocar a lista aqui evita o erro.
  const cats = f.tipo === 'entrada' ? dom.CAT_ENTRADA : dom.CAT_SAIDA
  const valido = f.descricao.trim().length > 2 && f.valor > 0 && !!f.categoriaId

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={inicial ? 'Editar lançamento' : 'Novo lançamento'}
      subtitle="Entradas e saídas avulsas da operação."
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={!valido || enviando} onClick={() => void onSalvar(f)}>
            {enviando ? <Spinner /> : null}
            Salvar lançamento
          </button>
        </>
      }
    >
      {erro && (
        <div className="mb-4">
          <Erro compacto mensagem={erro} />
        </div>
      )}

      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-2">
          {(['entrada', 'saida'] as const).map((tp) => (
            <button
              key={tp}
              onClick={() =>
                setF({
                  ...f,
                  tipo: tp,
                  categoriaId:
                    (tp === 'entrada' ? dom.CAT_ENTRADA[0]?.id : dom.CAT_SAIDA[0]?.id) ?? '',
                  status: tp === 'entrada' ? 'recebido' : 'pago',
                })
              }
              className={cx(
                'flex items-center justify-center gap-2 rounded-field border px-3 py-3 text-[13.5px] font-bold transition',
                f.tipo === tp
                  ? tp === 'entrada'
                    ? 'border-pine-500 bg-pine-50 text-pine-700'
                    : 'border-danger bg-danger/5 text-danger'
                  : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50',
              )}
            >
              {tp === 'entrada' ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}
              {tp === 'entrada' ? 'Entrada' : 'Saída'}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="l-desc">
            Descrição *
          </label>
          <input
            id="l-desc"
            autoFocus
            className="field"
            value={f.descricao}
            onChange={(e) => setF({ ...f, descricao: e.target.value })}
            placeholder={f.tipo === 'entrada' ? 'Ex.: Recebimento avulso' : 'Ex.: Compra de chaves virgens'}
          />
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="l-valor">
              Valor *
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-ink-400">
                R$
              </span>
              <input
                id="l-valor"
                type="number"
                min={0}
                step="0.01"
                className="field num pl-10"
                value={f.valor}
                onChange={(e) => setF({ ...f, valor: numeroDeInput(e, { min: 0 }) })}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="l-data">
              Data
            </label>
            <input
              id="l-data"
              type="date"
              className="field num"
              value={new Date(f.data).toISOString().slice(0, 10)}
              onChange={(e) => setF({ ...f, data: iso(new Date(`${e.target.value}T12:00:00`)) })}
            />
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <span className="label">Categoria</span>
            <Select
              value={f.categoriaId}
              onChange={(v) => setF({ ...f, categoriaId: v })}
              options={cats.map((c) => ({ value: c.id, label: c.nome }))}
              aria-label="Categoria"
            />
          </div>
          <div>
            <span className="label">Status</span>
            <Select
              value={f.status}
              onChange={(v) => setF({ ...f, status: v })}
              options={Object.values(dom.LANCAMENTO_STATUS).map((m) => ({
                value: m.key,
                label: m.label,
              }))}
              aria-label="Status"
            />
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <span className="label">Forma de pagamento</span>
            <Select
              value={f.forma ?? ''}
              onChange={(v) => setF({ ...f, forma: v || null })}
              placeholder="Não informada"
              options={dom.FORMA_LIST.map((x) => ({ value: x, label: dom.forma(x)?.label ?? x }))}
              aria-label="Forma"
            />
          </div>
          <div>
            <span className="label">Responsável</span>
            <Select
              value={f.responsavelId ?? ''}
              onChange={(v) => setF({ ...f, responsavelId: v || null })}
              placeholder="Usuário logado"
              options={dom.EQUIPE.map((m) => ({ value: m.id, label: m.nome }))}
              aria-label="Responsável"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="l-obs">
            Observação
          </label>
          <input
            id="l-obs"
            className="field"
            value={f.observacao}
            onChange={(e) => setF({ ...f, observacao: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  )
}
