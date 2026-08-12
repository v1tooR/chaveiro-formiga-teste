import {
  Clock,
  Download,
  FileBarChart,
  FileSpreadsheet,
  Printer,
  Share2,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Kpi, PageHead } from '@/components/dominio'
import { Erro, Select, SkelCards, Spinner, Tabs, useToast } from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { useAsync } from '@/lib/hooks'
import { kpisVazios } from '@/lib/mappers'
import { listarComandas } from '@/lib/api/comandas'
import {
  type Periodo,
  obterKpis,
  porCategoria,
  porFormaPagamento,
  porResponsavel,
  porStatus,
  serieAtendimentos,
  serieFaturamento,
  tempoMedioExecucao,
  topServicos,
} from '@/lib/api/relatorios'
import { consultaInicial } from '@/lib/listing'
import { useIntegracaoAtiva } from '@/store/useSessao'
import { addDias, brl, brlCompact, cx, iso, num } from '@/lib/utils'
import { baixarCsv, csvNumero, imprimirParaPdf, paraCsv } from '@/lib/exportar'

const ABAS = [
  { id: 'atendimento', label: 'Atendimento' },
  { id: 'comandas', label: 'Comandas' },
  { id: 'servicos', label: 'Serviços' },
  { id: 'financeiro', label: 'Financeiro' },
]

export default function Relatorios() {
  const { push } = useToast()
  const dom = useDominioMaps()
  // `useIntegracaoAtiva` existia desde o início e nunca havia sido usado;
  // sete arquivos repetiam a mesma consulta inline.
  const compartilharAtivo = useIntegracaoAtiva('report_share')

  const [aba, setAba] = useState('atendimento')
  const [periodo, setPeriodo] = useState('90')
  const [cat, setCat] = useState('')
  const [resp, setResp] = useState('')
  const [exportando, setExportando] = useState<string | null>(null)

  /**
   * O período escolhido, traduzido para uma faixa de datas.
   *
   * Antes isto era `const dias = periodo === '30' ? 30 : ... : 365` e o
   * valor só alimentava a série de atendimentos — 'ano' e 'tudo'
   * colapsavam ambos em 365, e um `Math.min(dias, 60)` travava tudo em 60
   * dias. Na prática '90', 'ano' e 'tudo' produziam gráficos idênticos.
   *
   * `undefined` em `de` significa "sem limite inferior" — é assim que
   * 'tudo' chega às RPCs.
   */
  const recorte = useMemo((): Periodo => {
    const ate = iso(new Date()).slice(0, 10)
    if (periodo === 'tudo') return {}
    if (periodo === 'ano') return { de: `${new Date().getFullYear()}-01-01`, ate }
    const dias = periodo === '30' ? 30 : 90
    return { de: iso(addDias(new Date(), -dias + 1)).slice(0, 10), ate }
  }, [periodo])

  /** Quantos pontos a série diária deve ter para o recorte atual. */
  const diasSerie = useMemo(() => {
    if (!recorte.de) return 90
    const ms = +new Date(`${recorte.ate}T00:00:00`) - +new Date(`${recorte.de}T00:00:00`)
    return Math.max(1, Math.round(ms / 86400000) + 1)
  }, [recorte])

  /**
   * Todas as agregações vêm do banco, e todas recebem o recorte.
   *
   * `recorte` entra nas dependências de cada uma — sem isso o `useAsync`
   * não re-executa e trocar o Select não muda nada na tela, que foi
   * exatamente o defeito relatado.
   */
  const chave = `${recorte.de ?? ''}:${recorte.ate ?? ''}`
  const kpisQ = useAsync(() => obterKpis(), [], { tabelas: ['orders', 'ledger_entries'], canal: 'rel-kpis' })
  const serieQ = useAsync(() => serieAtendimentos(diasSerie, recorte), [chave, diasSerie], {
    canal: 'rel-serie',
  })
  const catsQ = useAsync(() => porCategoria(recorte), [chave], { tabelas: ['orders'], canal: 'rel-cats' })
  const topsQ = useAsync(() => topServicos(10, recorte), [chave], { tabelas: ['orders'], canal: 'rel-tops' })
  const respsQ = useAsync(() => porResponsavel(recorte), [chave], { tabelas: ['orders'], canal: 'rel-resps' })
  const statusQ = useAsync(() => porStatus(recorte), [chave], { tabelas: ['orders'], canal: 'rel-status' })
  const fatQ = useAsync(() => serieFaturamento(12, recorte), [chave], {
    tabelas: ['ledger_entries'],
    canal: 'rel-fat',
  })
  const formasQ = useAsync(() => porFormaPagamento(recorte), [chave], {
    tabelas: ['ledger_entries'],
    canal: 'rel-formas',
  })
  const tmeQ = useAsync(() => tempoMedioExecucao(recorte), [chave], {
    tabelas: ['orders'],
    canal: 'rel-tme',
  })

  /** Serviços atrasados, para a tabela da aba Comandas. */
  const atrasadasQ = useAsync(
    () =>
      listarComandas({ ...consultaInicial({ campo: 'due_date', direcao: 'asc' }), tamanho: 10 }, {
        rapido: 'atrasadas',
        categoria: cat || undefined,
        responsavelId: resp || undefined,
        de: recorte.de,
        ate: recorte.ate,
      }),
    [cat, resp, chave],
    { tabelas: ['orders'], canal: 'rel-atrasadas' },
  )

  /**
   * Total da base, SEM filtro nenhum.
   *
   * Antes o rodapé usava a soma de `porStatus()`, que agora é recortada
   * pelo período — os dois números ficariam sempre iguais e o "no total da
   * base" viraria mentira.
   */
  const baseQ = useAsync(() => listarComandas({ ...consultaInicial(), tamanho: 1 }, {}), [], {
    tabelas: ['orders'],
    canal: 'rel-base',
  })

  /** Recorte filtrado: só a contagem, para o cabeçalho do relatório. */
  const recorteQ = useAsync(
    () =>
      listarComandas({ ...consultaInicial(), tamanho: 1 }, {
        categoria: cat || undefined,
        responsavelId: resp || undefined,
        de: recorte.de,
        ate: recorte.ate,
      }),
    [cat, resp, chave],
    { tabelas: ['orders'], canal: 'rel-recorte' },
  )

  const carregando = kpisQ.carregando && !kpisQ.dados
  const erro =
    kpisQ.erro ?? catsQ.erro ?? topsQ.erro ?? respsQ.erro ?? statusQ.erro ?? fatQ.erro ?? formasQ.erro

  const kpis = kpisQ.dados ?? kpisVazios()

  const serieDias = serieQ.dados ?? []
  const cats = catsQ.dados ?? []
  const tops = topsQ.dados ?? []
  const resps = respsQ.dados ?? []
  const fat = fatQ.dados ?? []
  const formas = formasQ.dados ?? []
  const tme = tmeQ.dados ?? 0
  const totalRecorte = recorteQ.dados?.total ?? 0

  // null = papel sem acesso ao financeiro. "—" diz "não disponível";
  // R$ 0,00 diria "nada entrou". Ver 20260730150000_kpis_finance_leak.sql.
  const dinheiro = (v: number | null) => (v === null ? '—' : brl(v))
  const hintFin = (v: number | null, texto: string) =>
    v === null ? 'Sem acesso ao financeiro' : texto

  const statusMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of statusQ.dados ?? []) m.set(x.status, x.qtd)
    return m
  }, [statusQ.dados])

  const totalBase = baseQ.dados?.total ?? 0
  /** Soma do recorte, para os percentuais por status da aba Comandas. */
  const totalComandas = (statusQ.dados ?? []).reduce((s, x) => s + x.qtd, 0)

  /**
   * Exporta a aba ATIVA em CSV, com o recorte de período aplicado.
   *
   * Não passa por integração: os dados já estão na tela e o navegador
   * gera o arquivo. Ver src/lib/exportar.ts.
   */
  function exportarCsv() {
    setExportando('CSV')
    try {
      const sufixo = recorte.de ? `-${recorte.de}_a_${recorte.ate}` : '-completo'

      if (aba === 'financeiro') {
        baixarCsv(
          `relatorio-financeiro${sufixo}`,
          paraCsv(fat, [
            { titulo: 'Mês', valor: (m) => m.mes },
            { titulo: 'Recebido', valor: (m) => csvNumero(m.recebido) },
            { titulo: 'Pendente', valor: (m) => csvNumero(m.pendente) },
            { titulo: 'Despesa', valor: (m) => csvNumero(m.despesa) },
          ]),
        )
      } else if (aba === 'servicos') {
        baixarCsv(
          `relatorio-servicos${sufixo}`,
          paraCsv(tops, [
            { titulo: 'Serviço', valor: (s) => s.nome },
            { titulo: 'Categoria', valor: (s) => dom.cat(s.cat).label },
            { titulo: 'Quantidade', valor: (s) => s.qtd },
            { titulo: 'Valor', valor: (s) => csvNumero(s.valor) },
          ]),
        )
      } else if (aba === 'comandas') {
        baixarCsv(
          `relatorio-comandas${sufixo}`,
          paraCsv(statusQ.dados ?? [], [
            { titulo: 'Situação', valor: (s) => s.label },
            { titulo: 'Comandas', valor: (s) => s.qtd },
            { titulo: 'Valor', valor: (s) => csvNumero(s.valor) },
          ]),
        )
      } else {
        baixarCsv(
          `relatorio-atendimento${sufixo}`,
          paraCsv(serieDias, [
            { titulo: 'Dia', valor: (d) => d.dia },
            { titulo: 'Atendimentos', valor: (d) => d.atendimentos },
            { titulo: 'Valor', valor: (d) => csvNumero(d.valor) },
          ]),
        )
      }

      push({
        tipo: 'ok',
        titulo: 'Arquivo gerado',
        descricao: `Relatório de ${ABAS.find((a) => a.id === aba)?.label.toLowerCase()}.`,
      })
    } finally {
      setExportando(null)
    }
  }

  /**
   * PDF pela caixa de impressão ("Salvar como PDF").
   *
   * É o mesmo caminho da comanda e da etiqueta, e o CSS de `@media print`
   * já existe. Uma biblioteca de PDF traria um segundo layout para manter
   * em sincronia com o primeiro.
   */
  function exportarPdf() {
    push({
      tipo: 'info',
      titulo: 'Escolha "Salvar como PDF"',
      descricao: 'Na caixa de impressão, selecione PDF como destino.',
    })
    setTimeout(imprimirParaPdf, 300)
  }

  function recarregarTudo() {
    kpisQ.recarregar()
    serieQ.recarregar()
    catsQ.recarregar()
    topsQ.recarregar()
    respsQ.recarregar()
    statusQ.recarregar()
    fatQ.recarregar()
    formasQ.recarregar()
    tmeQ.recarregar()
    recorteQ.recarregar()
    atrasadasQ.recarregar()
    baseQ.recarregar()
  }

  return (
    <div>
      <PageHead
        titulo="Relatórios"
        subtitulo="Indicadores de atendimento, produção, serviços e financeiro."
        acoes={
          <>
            <button onClick={exportarPdf} className="btn-outline" disabled={!!exportando}>
              <Download size={15} />
              PDF
            </button>
            <button onClick={exportarCsv} className="btn-outline" disabled={!!exportando}>
              {exportando === 'CSV' ? <Spinner /> : <FileSpreadsheet size={15} />}
              Excel (CSV)
            </button>
            <button
              onClick={() => {
                push({ tipo: 'ok', titulo: 'Enviado para impressão' })
                window.print()
              }}
              className="btn-outline"
            >
              <Printer size={15} />
              Imprimir
            </button>
            <button onClick={recarregarTudo} className="btn-accent" disabled={carregando}>
              {carregando ? <Spinner /> : <FileBarChart size={15} />}
              {carregando ? 'Atualizando…' : 'Atualizar relatório'}
            </button>
          </>
        }
      />

      {/* Filtros */}
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="label">Período</span>
            <Select
              value={periodo}
              onChange={setPeriodo}
              aria-label="Período"
              options={[
                { value: '30', label: 'Últimos 30 dias' },
                { value: '90', label: 'Últimos 90 dias' },
                { value: 'ano', label: 'Ano atual' },
                { value: 'tudo', label: 'Todo o histórico' },
              ]}
            />
          </div>
          <div>
            <span className="label">Categoria</span>
            <Select
              value={cat}
              onChange={setCat}
              placeholder="Todas"
              aria-label="Categoria"
              options={dom.CATEGORIA_LIST.map((c) => ({ value: c, label: dom.cat(c).label }))}
            />
          </div>
          <div>
            <span className="label">Responsável</span>
            <Select
              value={resp}
              onChange={setResp}
              placeholder="Todos"
              aria-label="Responsável"
              options={dom.EXECUTORES.map((m) => ({ value: m.id, label: m.nome }))}
            />
          </div>
          {/* "Salvar filtro" foi removido. O onClick era só um toast dizendo
              "Disponível na próxima abertura" — sem localStorage, sem API e
              sem tabela no schema. Os filtros são useState locais, perdidos
              a cada montagem: o botão afirmava algo falso. */}
          <div className="flex items-end gap-2">
            {/* Link público de relatório depende MESMO de terceiro (hospedar
                a página e expirar o link), então continua atrás do portão de
                integração — mas agora o botão diz isso antes do clique, em
                vez de aceitar e explicar depois. */}
            <button
              onClick={() => push({ tipo: 'ok', titulo: 'Link do relatório copiado' })}
              disabled={!compartilharAtivo}
              title={
                !compartilharAtivo
                  ? 'Ative "Compartilhar relatório por link" em Configurações → Integrações.'
                  : undefined
              }
              className="btn-outline disabled:opacity-45"
              aria-label="Compartilhar"
            >
              <Share2 size={15} />
            </button>
          </div>
        </div>

        <p className="mt-3 border-t border-ink-100 pt-3 text-[12.5px] text-ink-500">
          <span className="num font-bold text-ink-900">{totalRecorte}</span> comandas no recorte ·{' '}
          <span className="num font-bold text-ink-900">{totalBase}</span> no total da base
        </p>
      </div>

      {/* Abas */}
      <div className="card mt-4 overflow-hidden">
        <div className="px-4 pt-1">
          <Tabs abas={ABAS} ativa={aba} onChange={setAba} />
        </div>

        <div className="p-4 sm:p-5">
          {carregando ? (
            <SkelCards n={4} h="h-64" />
          ) : (
            <>
              {/* ------------------------ Atendimento ------------------------ */}
              {aba === 'atendimento' && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Kpi label="Comandas no recorte" valor={totalRecorte} hint="Filtro aplicado" icon={Users} />
                    <Kpi label="Comandas abertas" valor={kpis.comandasAbertas} hint="Ainda na operação" />
                    <Kpi label="Prontas" valor={kpis.prontos} hint="Aguardando retirada" tom="ok" />
                    <Kpi
                      label="Ticket médio"
                      valor={dinheiro(kpis.ticketMedio)}
                      hint={hintFin(kpis.ticketMedio, 'Base completa')}
                    />
                  </div>

                  <div className="card p-5">
                    <h3 className="text-[15px] font-bold text-ink-900 mb-4">Atendimentos por dia</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={serieDias} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke="#E6E9ED" vertical={false} />
                        <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={38} />
                        <Tooltip content={<Tip />} />
                        <Line
                          type="monotone"
                          dataKey="atendimentos"
                          stroke="#C98E14"
                          strokeWidth={2.6}
                          dot={{ r: 2.5, fill: '#C98E14' }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="card p-5">
                      <h3 className="text-[15px] font-bold text-ink-900 mb-4">Atendimentos por categoria</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={cats} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                          <CartesianGrid stroke="#E6E9ED" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                          <YAxis
                            type="category"
                            dataKey="nome"
                            tick={{ fontSize: 11.5, fill: '#4B525C' }}
                            axisLine={false}
                            tickLine={false}
                            width={78}
                          />
                          <Tooltip content={<Tip />} cursor={{ fill: 'rgba(0,0,0,.035)' }} />
                          <Bar dataKey="qtd" name="Comandas" radius={[0, 5, 5, 0]}>
                            {cats.map((c) => (
                              <Cell key={c.cat} fill={c.cor} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="card p-5">
                      <h3 className="text-[15px] font-bold text-ink-900 mb-4">Atendimentos por responsável</h3>
                      <Tabela
                        colunas={['Responsável', 'Comandas', 'Valor', 'Atrasadas']}
                        linhas={resps.map((r) => [
                          r.nome,
                          num(r.qtd),
                          brl(r.valor),
                          r.atrasadas > 0 ? `${r.atrasadas}` : '—',
                        ])}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* -------------------------- Comandas ------------------------- */}
              {aba === 'comandas' && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Kpi label="Abertas" valor={kpis.comandasAbertas} hint="Ainda na operação" />
                    <Kpi label="Em execução" valor={kpis.emExecucao} hint="Na bancada" />
                    <Kpi label="Prontas" valor={kpis.prontos} hint="Aguardando retirada" tom="ok" />
                    <Kpi
                      label="Atrasadas"
                      valor={kpis.atrasados}
                      hint="Prazo estourado"
                      tom="perigo"
                    />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="card p-5">
                      <h3 className="text-[15px] font-bold text-ink-900 mb-4">Comandas por status</h3>
                      <div className="space-y-2.5">
                        {Array.from(statusMap.entries())
                          .sort((a, b) => b[1] - a[1])
                          .map(([s, qtd]) => {
                            const max = Math.max(...Array.from(statusMap.values()))
                            return (
                              <div key={s}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[12.5px] text-ink-700">{dom.st(s).label}</span>
                                  <span className="num text-[12.5px] font-bold text-ink-900">{qtd}</span>
                                </div>
                                <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-700"
                                    style={{ width: `${(qtd / max) * 100}%`, background: dom.st(s).cor }}
                                  />
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    </div>

                    <div className="card p-5">
                      <h3 className="text-[15px] font-bold text-ink-900">Tempo médio de execução</h3>
                      <p className="text-[12.5px] text-ink-500 mt-0.5 mb-4">
                        Do recebimento até a entrega
                      </p>

                      <div className="rounded-card bg-ink-50 p-5 text-center">
                        <Clock size={22} className="mx-auto text-ink-400" />
                        <p className="num mt-2 text-[34px] font-bold leading-none text-ink-900">
                          {tme.toFixed(1)}
                        </p>
                        <p className="text-[13px] text-ink-500 mt-1">dias em média</p>
                      </div>

                      <div className="mt-4">
                        <Tabela
                          colunas={['Situação', 'Quantidade']}
                          linhas={[
                            ['Entregues', num((statusMap.get('entregue') ?? 0))],
                            ['Canceladas', num((statusMap.get('cancelada') ?? 0))],
                            ['Aguardando material', num((statusMap.get('material') ?? 0))],
                            ['Aguardando aprovação', num((statusMap.get('aprovacao') ?? 0))],
                          ]}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* -------------------------- Serviços ------------------------- */}
              {aba === 'servicos' && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Kpi label="Serviços realizados" valor={totalRecorte} hint="No período" />
                    <Kpi
                      label="Valor total"
                      valor={brl(cats.reduce((acc, x) => acc + x.valor, 0))}
                      hint="Somatório dos serviços"
                      tom="ok"
                    />
                    <Kpi
                      label="Ticket médio"
                      valor={dinheiro(kpis.ticketMedio)}
                      hint={hintFin(kpis.ticketMedio, 'Por serviço')}
                    />
                    <Kpi
                      label="Prazo médio"
                      valor={`${tme.toFixed(1)} dias`}
                      hint="Execução até a entrega"
                    />
                  </div>

                  <div className="card p-5">
                    <h3 className="text-[15px] font-bold text-ink-900 mb-4">Serviços mais realizados</h3>
                    <Tabela
                      colunas={['Serviço', 'Categoria', 'Quantidade', 'Valor total']}
                      linhas={tops.map((t) => [
                        t.nome,
                        dom.cat(t.cat as string).label,
                        num(t.qtd),
                        brl(t.valor),
                      ])}
                    />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="card p-5">
                      <h3 className="text-[15px] font-bold text-ink-900 mb-4">Valor por categoria</h3>
                      <ResponsiveContainer width="100%" height={230}>
                        <PieChart>
                          <Pie data={cats} dataKey="valor" nameKey="nome" innerRadius={54} outerRadius={84} paddingAngle={2}>
                            {cats.map((c) => (
                              <Cell key={c.cat} fill={c.cor} stroke="none" />
                            ))}
                          </Pie>
                          <Tooltip content={<Tip moeda />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="mt-2 space-y-1.5">
                        {cats.map((c) => (
                          <div key={c.cat} className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.cor }} />
                            <span className="flex-1 text-[12.5px] text-ink-700">{c.nome}</span>
                            <span className="num text-[12.5px] font-bold text-ink-900">{brl(c.valor)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="card p-5">
                      <h3 className="text-[15px] font-bold text-ink-900 mb-4">Serviços atrasados</h3>
                      {kpis.atrasados === 0 ? (
                        <p className="rounded-xl bg-pine-50 px-4 py-8 text-center text-[13px] text-pine-700">
                          Nenhum serviço atrasado no período.
                        </p>
                      ) : (
                        <Tabela
                          colunas={['Comanda', 'Cliente', 'Serviço', 'Responsável', 'Valor']}
                          linhas={(atrasadasQ.dados?.linhas ?? []).map((c) => [
                            String(c.numero),
                            c.clienteNome,
                            c.servicoNome,
                            c.responsavel,
                            brl(c.valor),
                          ])}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ------------------------- Financeiro ------------------------ */}
              {aba === 'financeiro' && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {/* null = papel sem acesso ao financeiro. Um "—" diz
                        "não disponível"; R$ 0,00 diria "nada entrou". */}
                    <Kpi
                      label="Recebido no mês"
                      valor={dinheiro(kpis.recebidoMes)}
                      hint={hintFin(kpis.recebidoMes, 'Entradas confirmadas')}
                      tom="ok"
                    />
                    <Kpi
                      label="Pendente"
                      valor={dinheiro(kpis.pendente)}
                      hint={hintFin(kpis.pendente, 'Saldo a receber')}
                      tom="alerta"
                    />
                    <Kpi
                      label="Entregues sem pagar"
                      valor={kpis.entreguesSemPagamento}
                      hint="Requer cobrança"
                      tom={kpis.entreguesSemPagamento ? 'perigo' : 'neutro'}
                    />
                    <Kpi
                      label="Ticket médio"
                      valor={dinheiro(kpis.ticketMedio)}
                      hint={hintFin(kpis.ticketMedio, 'Por comanda')}
                    />
                  </div>

                  <div className="card p-5">
                    <h3 className="text-[15px] font-bold text-ink-900 mb-4">Faturamento por mês</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={fat} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={3}>
                        <CartesianGrid stroke="#E6E9ED" vertical={false} />
                        <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#6B7280' }}
                          axisLine={false}
                          tickLine={false}
                          width={64}
                          tickFormatter={(v) => brlCompact(Number(v))}
                        />
                        <Tooltip content={<Tip moeda />} cursor={{ fill: 'rgba(0,0,0,.035)' }} />
                        <Bar dataKey="recebido" name="Recebido" fill="#2F7D5F" radius={[5, 5, 0, 0]} />
                        <Bar dataKey="pendente" name="Pendente" fill="#DFA92A" radius={[5, 5, 0, 0]} />
                        <Bar dataKey="despesa" name="Despesa" fill="#DC5B57" radius={[5, 5, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="card p-5">
                      <h3 className="text-[15px] font-bold text-ink-900 mb-4">Formas de pagamento</h3>
                      <Tabela
                        colunas={['Forma', 'Valor recebido']}
                        linhas={formas.map((f) => [f.label, brl(f.valor)])}
                      />
                    </div>

                    <div className="card p-5">
                      <h3 className="text-[15px] font-bold text-ink-900 mb-4">Faturamento por categoria</h3>
                      <Tabela
                        colunas={['Categoria', 'Comandas', 'Valor']}
                        linhas={cats.map((c) => [c.nome, num(c.qtd), brl(c.valor)])}
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Tabela({ colunas, linhas }: { colunas: string[]; linhas: string[][] }) {
  if (linhas.length === 0) {
    return <p className="py-8 text-center text-[13px] text-ink-400">Sem dados no período selecionado.</p>
  }
  return (
    <div className="overflow-x-auto scroll-x">
      <table className="w-full">
        <thead>
          <tr className="border-b border-ink-100">
            {colunas.map((c, i) => (
              <th
                key={c}
                className={cx(
                  'whitespace-nowrap px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-500',
                  i === 0 ? 'text-left' : 'text-right',
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-b border-ink-50 last:border-0">
              {l.map((v, j) => (
                <td
                  key={j}
                  className={cx(
                    'px-2 py-2.5 text-[13px]',
                    j === 0
                      ? 'font-semibold text-ink-900 max-w-[220px] truncate'
                      : 'num text-right font-semibold text-ink-700',
                  )}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Tip({
  active,
  payload,
  label,
  moeda,
}: {
  active?: boolean
  payload?: { name?: string; value?: number; color?: string }[]
  label?: string
  moeda?: boolean
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2.5 shadow-lift">
      {label && <p className="text-[11.5px] font-bold text-ink-900 mb-1.5">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-[12px] text-ink-600">
          {p.color && <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />}
          <span>{p.name}</span>
          <span className="num ml-auto font-bold text-ink-900">
            {moeda ? brl(Number(p.value)) : num(Number(p.value))}
          </span>
        </p>
      ))}
    </div>
  )
}
