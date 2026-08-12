import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock,
  PackageCheck,
  Plus,
  Receipt,
  Tag,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
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
import { Contador, Erro, SkelCards, SkelLinhas, Vazio } from '@/components/ui'
import { kpisVazios } from '@/lib/mappers'
import { Kpi, PageHead, PrazoBadge, SeloPerfil, StatusBadge } from '@/components/dominio'
import { useDominioMaps } from '@/lib/dominio'
import { useAsync } from '@/lib/hooks'
import { listarComandas } from '@/lib/api/comandas'
import {
  obterAlertas,
  obterKpis,
  porCategoria,
  porStatus,
  serieAtendimentos,
  serieFaturamento,
  tempoMedioExecucao,
  topServicos,
} from '@/lib/api/relatorios'
import { consultaInicial } from '@/lib/listing'
import { useSessao } from '@/store/useSessao'
import { brl, brlCompact, comandaCod, cx, num, saldo } from '@/lib/utils'
import type { Alerta, ModuloId } from '@/types'

const ICONE_ALERTA = {
  atraso: AlertTriangle,
  aviso: BellRing,
  foto: Camera,
  prazo: CalendarClock,
  pagamento: Wallet,
  pronto: PackageCheck,
  etiqueta: Tag,
}

export default function Dashboard() {
  const nav = useNavigate()
  const dom = useDominioMaps()
  const perfil = useSessao((s) => s.perfil)
  const modo = useSessao((s) => s.modoApresentacao)
  const config = useSessao((s) => s.config)
  const prefixo = config?.comandas.prefixo ?? 'CF'

  const modulos = perfil?.modulos ?? []
  const podeVer = (m: ModuloId) => modulos.includes(m)

  /**
   * Ação rápida é ESCRITA, e escrita se pergunta a `escrita`, não a
   * `modulos`.
   *
   * As ações usavam `podeVer`, então o perfil Consulta — que lê `orders`
   * mas não escreve — via "Criar comanda", percorria as 8 etapas do
   * wizard, enxergava a base de clientes pelo caminho e só descobria que
   * não podia na última tela, quando a RPC recusava. Esta era a única
   * tela do app com esse erro; todas as outras já usam `usePodeEditar`.
   */
  const escrita = perfil?.escrita ?? []
  const podeCriar = (m: ModuloId) => escrita.includes(m)

  /**
   * Cada bloco carrega o seu dado e trata o seu erro.
   * Antes tudo saía de um array em memória; agora são RPCs de agregação,
   * que dão o número certo sobre a base inteira em vez da página.
   */
  const kpisQ = useAsync(() => obterKpis(), [], { tabelas: ['orders', 'ledger_entries'], canal: 'dash-kpis' })
  const alertasQ = useAsync(() => obterAlertas(), [], { tabelas: ['orders', 'order_photos'], canal: 'dash-alertas' })
  const serieQ = useAsync(() => serieAtendimentos(14), [], { tabelas: ['orders'], canal: 'dash-serie' })
  const catsQ = useAsync(() => porCategoria(), [], { tabelas: ['orders'], canal: 'dash-cats' })
  // Só busca o faturamento de quem pode vê-lo: para os demais papéis a RLS
  // devolveria 12 meses de zero, e o gráfico nem é renderizado.
  const fatQ = useAsync(() => serieFaturamento(12), [], {
    tabelas: ['ledger_entries'],
    canal: 'dash-fat',
    ativo: podeVer('finance'),
  })
  const topsQ = useAsync(() => topServicos(6), [], { tabelas: ['orders'], canal: 'dash-tops' })
  const statusQ = useAsync(() => porStatus(), [], { tabelas: ['orders'], canal: 'dash-status' })
  const tmeQ = useAsync(() => tempoMedioExecucao(), [], { tabelas: ['orders'], canal: 'dash-tme' })

  const atrasadasQ = useAsync(
    () =>
      listarComandas({ ...consultaInicial({ campo: 'due_date', direcao: 'asc' }), tamanho: 5 }, {
        rapido: 'atrasadas',
      }),
    [],
    { tabelas: ['orders'], canal: 'dash-atrasadas' },
  )

  const prontosQ = useAsync(
    () =>
      listarComandas({ ...consultaInicial({ campo: 'due_date', direcao: 'asc' }), tamanho: 6 }, {
        rapido: 'prontas',
      }),
    [],
    { tabelas: ['orders'], canal: 'dash-prontos' },
  )

  const carregando = kpisQ.carregando && !kpisQ.dados

  const kpis = kpisQ.dados ?? kpisVazios()

  /** Esconde alertas cuja ação leva a um módulo fora do perfil. */
  const rotaModulo: Record<string, ModuloId> = {
    comandas: 'orders',
    producao: 'production',
    financeiro: 'finance',
    etiquetas: 'labels',
    clientes: 'customers',
    atendimento: 'service_desk',
    relatorios: 'reports',
    configuracoes: 'settings',
    dashboard: 'dashboard',
  }
  const alertas = (alertasQ.dados ?? []).filter((a) => {
    const destino = a.to.split('?')[0].replace('/', '')
    const mod = rotaModulo[destino]
    return !mod || modulos.includes(mod)
  })

  const serieDias = serieQ.dados ?? []
  const cats = catsQ.dados ?? []
  const fat = fatQ.dados ?? []
  const tops = topsQ.dados ?? []
  const tme = tmeQ.dados ?? 0
  const atrasadasLista = atrasadasQ.dados?.linhas ?? []
  const prontosLista = prontosQ.dados?.linhas ?? []

  const statusChart = (statusQ.dados ?? [])
    .filter((x) => x.status !== 'cancelada' && x.qtd > 0)
    .map((x) => ({ nome: x.label, qtd: x.qtd, cor: dom.st(x.status).cor }))
    .sort((a, b) => b.qtd - a.qtd)
    .slice(0, 7)

  return (
    <div className="space-y-6">
      {/* ------------------------------- Hero ------------------------------ */}
      <section
        className="relative overflow-hidden rounded-card text-white"
        style={{
          background:
            'radial-gradient(760px 420px at 12% 6%, rgba(223,169,42,.22), transparent 60%), radial-gradient(620px 420px at 92% 96%, rgba(47,125,95,.20), transparent 58%), linear-gradient(140deg, #0B0C0E, #1D2126 58%, #111317)',
        }}
      >
        <div className="absolute inset-0 grain opacity-50" />

        <div className="relative p-5 sm:p-7 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1
                  className={cx(
                    'font-display font-extrabold tracking-tight leading-tight',
                    modo ? 'text-[27px] sm:text-[34px]' : 'text-[23px] sm:text-[29px]',
                  )}
                >
                  Central de Gestão Chaveiro Formiga
                </h1>
              </div>
              <p className="mt-2 max-w-xl text-[13.5px] sm:text-[14.5px] leading-relaxed text-ink-300">
                Atendimentos, serviços, comandas e financeiro organizados em uma única visão.
              </p>
            </div>
            <SeloPerfil className="!bg-white/10 !border-white/15 !text-ink-300" />
          </div>

          {/* Indicadores */}
          {carregando ? (
            <div className="mt-7 grid gap-3 grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-[74px] rounded-xl bg-white/[0.06]" />
              ))}
            </div>
          ) : (
            <div
              className={cx(
                'mt-7 grid gap-3',
                modo ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-4 xl:grid-cols-8',
              )}
            >
              <HeroStat
                label="Atendimentos hoje"
                valor={<Contador valor={kpis.atendimentosHoje} />}
                destaque={modo}
              />
              <HeroStat label="Comandas abertas" valor={<Contador valor={kpis.comandasAbertas} />} destaque={modo} />
              <HeroStat label="Em execução" valor={<Contador valor={kpis.emExecucao} />} destaque={modo} />
              <HeroStat
                label="Prontos"
                valor={<Contador valor={kpis.prontos} />}
                tom="ok"
                destaque={modo}
              />
              <HeroStat
                label="Atrasados"
                valor={<Contador valor={kpis.atrasados} />}
                tom={kpis.atrasados > 0 ? 'perigo' : undefined}
                destaque={modo}
              />
              {/* Só para quem lê o financeiro. Estes três vêm null quando o
                  papel não tem acesso — mostrar R$ 0,00 seria afirmar que
                  nada entrou, que a loja não deve nada e que o ticket é
                  zero. Ver 20260730150000_kpis_finance_leak.sql. */}
              {kpis.recebidoHoje !== null && (
                <HeroStat
                  label="Recebido hoje"
                  valor={<Contador valor={kpis.recebidoHoje} fmt={brl} />}
                  tom="ok"
                  destaque={modo}
                />
              )}
              {kpis.pendente !== null && (
                <HeroStat
                  label="Pendente"
                  valor={<Contador valor={kpis.pendente} fmt={brl} />}
                  tom="alerta"
                  destaque={modo}
                />
              )}
              {kpis.ticketMedio !== null && (
                <HeroStat
                  label="Ticket médio"
                  valor={<Contador valor={kpis.ticketMedio} fmt={brl} />}
                  destaque={modo}
                />
              )}
            </div>
          )}

          {/* Ações rápidas — só as que o perfil ativo pode acessar */}
          <div className="mt-6 flex flex-wrap gap-2">
            {podeCriar('service_desk') && (
              <button onClick={() => nav('/atendimento?novo=1')} className="btn-accent">
                <Plus size={16} strokeWidth={2.6} />
                Novo atendimento
              </button>
            )}
            {podeCriar('orders') && (
              <button
                onClick={() => nav('/comandas?novo=1')}
                className="btn border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.12]"
              >
                <Receipt size={15} />
                Criar comanda
              </button>
            )}
            {podeCriar('finance') && (
              <button
                onClick={() => nav('/financeiro?pagamento=1')}
                className="btn border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.12]"
              >
                <Wallet size={15} />
                Registrar pagamento
              </button>
            )}
            {podeVer('orders') && (
              <button
                onClick={() => nav('/comandas?filtro=prontas')}
                className="btn border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.12]"
              >
                <PackageCheck size={15} />
                Ver serviços prontos
              </button>
            )}
          </div>

          {kpisQ.erro && (
            <p className="mt-4 text-[12px] text-brass-300">
              Indicadores indisponíveis: {kpisQ.erro}
            </p>
          )}
        </div>
      </section>

      {/* --------------------------- Atenção de hoje ----------------------- */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-bold text-ink-900">Atenção de hoje</h2>
            <p className="text-[13px] text-ink-500 mt-0.5">
              O que precisa de ação imediata na operação.
            </p>
          </div>
          {podeVer('production') && (
            <button onClick={() => nav('/producao')} className="btn-ghost text-[13px] px-2.5 py-1.5">
              Abrir produção
              <ArrowRight size={14} />
            </button>
          )}
        </div>

        {carregando ? (
          <SkelLinhas n={4} />
        ) : alertas.length === 0 ? (
          <div className="card p-8 text-center">
            <CheckCircle2 size={26} className="mx-auto text-pine-500" />
            <p className="mt-2.5 text-[14px] font-semibold text-ink-800">Nenhuma pendência no momento.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {alertas.map((a, i) => (
              <CardAlerta key={a.id} alerta={a} index={i} onIr={() => nav(a.to)} />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------ Gráficos --------------------------- */}
      {carregando ? (
        <SkelCards n={2} h="h-72" />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Atendimentos por dia */}
            <div className="card p-5 lg:col-span-2">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-[15px] font-bold text-ink-900">Atendimentos por dia</h3>
                  <p className="text-[12.5px] text-ink-500 mt-0.5">Últimos 14 dias de balcão</p>
                </div>
                <span className="badge bg-pine-50 text-pine-700">
                  <TrendingUp size={12} />
                  {num(serieDias.reduce((s, d) => s + d.atendimentos, 0))} no período
                </span>
              </div>

              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={serieDias} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gAtend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#DFA92A" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#DFA92A" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#E6E9ED" vertical={false} />
                  <XAxis
                    dataKey="dia"
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={38} />
                  <Tooltip content={<TipChart sufixo=" atendimentos" />} cursor={{ stroke: '#C7CCD3' }} />
                  <Area
                    type="monotone"
                    dataKey="atendimentos"
                    stroke="#C98E14"
                    strokeWidth={2.4}
                    fill="url(#gAtend)"
                    animationDuration={700}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Serviços por categoria */}
            <div className="card p-5">
              <h3 className="text-[15px] font-bold text-ink-900">Serviços por categoria</h3>
              <p className="text-[12.5px] text-ink-500 mt-0.5 mb-3">Distribuição do volume</p>

              <ResponsiveContainer width="100%" height={182}>
                <PieChart>
                  <Pie
                    data={cats}
                    dataKey="qtd"
                    nameKey="nome"
                    innerRadius={50}
                    outerRadius={76}
                    paddingAngle={2}
                    animationDuration={700}
                  >
                    {cats.map((c) => (
                      <Cell key={c.cat} fill={c.cor} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<TipChart sufixo=" comandas" />} />
                </PieChart>
              </ResponsiveContainer>

              <div className="mt-3 space-y-1.5">
                {cats.slice(0, 4).map((c) => (
                  <button
                    key={c.cat}
                    onClick={() => nav(`/comandas?cat=${c.cat}`)}
                    className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-ink-50"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.cor }} />
                    <span className="flex-1 truncate text-[12.5px] text-ink-700">{c.nome}</span>
                    <span className="num text-[12.5px] font-bold text-ink-900">{c.qtd}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={cx('grid gap-4', kpis.veFinanceiro && 'lg:grid-cols-3')}>
            {/* Faturamento — só para quem lê o financeiro.
                A RLS de `ledger_entries` já impede o vazamento: para os
                demais papéis a RPC devolve 0/0/0 em todos os meses. Mas
                renderizar doze barras zeradas afirma "a loja não faturou
                nada no ano", que é pior do que não mostrar o gráfico. */}
            {kpis.veFinanceiro && (
            <div className="card p-5 lg:col-span-2">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-[15px] font-bold text-ink-900">Recebido e pendente</h3>
                  <p className="text-[12.5px] text-ink-500 mt-0.5">Faturamento dos últimos 12 meses</p>
                </div>
                {podeVer('reports') && (
                  <button onClick={() => nav('/relatorios')} className="btn-ghost text-[12.5px] px-2 py-1">
                    Relatórios
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>

              <ResponsiveContainer width="100%" height={228}>
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
                  <Tooltip content={<TipChart moeda />} cursor={{ fill: 'rgba(0,0,0,.035)' }} />
                  <Bar dataKey="recebido" name="Recebido" fill="#2F7D5F" radius={[5, 5, 0, 0]} animationDuration={650} />
                  <Bar dataKey="pendente" name="Pendente" fill="#DFA92A" radius={[5, 5, 0, 0]} animationDuration={650} />
                </BarChart>
              </ResponsiveContainer>

              <div className="mt-3 flex flex-wrap gap-4 text-[12.5px]">
                <span className="flex items-center gap-1.5 text-ink-600">
                  <span className="h-2.5 w-2.5 rounded-sm bg-pine-500" /> Recebido
                </span>
                <span className="flex items-center gap-1.5 text-ink-600">
                  <span className="h-2.5 w-2.5 rounded-sm bg-brass-400" /> Pendente
                </span>
              </div>
            </div>
            )}

            {/* Comandas por status */}
            <div className="card p-5">
              <h3 className="text-[15px] font-bold text-ink-900">Comandas por status</h3>
              <p className="text-[12.5px] text-ink-500 mt-0.5 mb-4">Situação atual da carteira</p>

              <div className="space-y-2.5">
                {statusChart.map((s) => {
                  const max = Math.max(...statusChart.map((x) => x.qtd))
                  return (
                    <div key={s.nome}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12.5px] text-ink-700">{s.nome}</span>
                        <span className="num text-[12.5px] font-bold text-ink-900">{s.qtd}</span>
                      </div>
                      <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${(s.qtd / max) * 100}%` }}
                          transition={{ duration: 0.65, ease: 'easeOut' }}
                          className="h-full rounded-full"
                          style={{ background: s.cor }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="mt-5 rounded-xl bg-ink-50 p-3.5">
                <div className="flex items-center gap-2 text-ink-600">
                  <Clock size={14} />
                  <span className="text-[12px] font-semibold uppercase tracking-wide">
                    Tempo médio de execução
                  </span>
                </div>
                <p className="num mt-1.5 text-[22px] font-bold text-ink-900">
                  {tme.toFixed(1)} <span className="text-[13px] font-semibold text-ink-500">dias</span>
                </p>
              </div>
            </div>
          </div>

          {/* Serviços mais realizados + listas */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card p-5">
              <h3 className="text-[15px] font-bold text-ink-900">Serviços mais realizados</h3>
              <p className="text-[12.5px] text-ink-500 mt-0.5 mb-4">Ranking por volume</p>

              <div className="space-y-2">
                {tops.map((t, i) => (
                  <div key={t.nome} className="flex items-center gap-3">
                    <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-100 text-[11.5px] font-bold text-ink-600">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink-800">{t.nome}</span>
                      <span className="block text-[11.5px]" style={{ color: dom.cat(t.cat).cor }}>
                        {dom.cat(t.cat).label}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[13px] font-bold text-ink-900">{t.qtd}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Atrasados */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[15px] font-bold text-ink-900">Serviços atrasados</h3>
                <span className="badge bg-danger/10 text-danger num">{kpis.atrasados}</span>
              </div>

              {atrasadasLista.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-ink-400">Nada atrasado. Operação em dia.</p>
              ) : (
                <div className="space-y-1.5">
                  {atrasadasLista.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => nav(`/comandas/${c.id}`)}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-ink-50"
                    >
                      <span className="num shrink-0 text-[11.5px] font-bold text-ink-500">
                        {comandaCod(c.numero, prefixo)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink-900">
                          {c.clienteNome}
                        </span>
                        <span className="block truncate text-[11.5px] text-ink-500">{c.servicoNome}</span>
                      </span>
                      <span className="badge shrink-0 bg-danger/10 text-danger num">
                        {Math.abs(Math.round((+new Date(c.prazoEm) - Date.now()) / 86400000))}d
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Prontos */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[15px] font-bold text-ink-900">Prontos para retirada</h3>
                <span className="badge bg-pine-50 text-pine-700 num">{kpis.prontos}</span>
              </div>

              {prontosLista.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-ink-400">Nenhum item aguardando retirada.</p>
              ) : (
                <div className="space-y-1.5">
                  {prontosLista.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => nav(`/comandas/${c.id}`)}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-ink-50"
                    >
                      <span className="num shrink-0 text-[11.5px] font-bold text-ink-500">
                        {comandaCod(c.numero, prefixo)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink-900">
                          {c.clienteNome}
                        </span>
                        <span className="block truncate text-[11.5px] text-ink-500">{c.servicoNome}</span>
                      </span>
                      {saldo(c) > 0 ? (
                        <span className="badge shrink-0 bg-brass-50 text-brass-700 num">{brl(saldo(c))}</span>
                      ) : (
                        <StatusBadge status={c.status} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function HeroStat({
  label,
  valor,
  tom,
  destaque,
}: {
  label: string
  valor: React.ReactNode
  tom?: 'ok' | 'alerta' | 'perigo'
  destaque?: boolean
}) {
  const cor =
    tom === 'ok' ? 'text-pine-300' : tom === 'alerta' ? 'text-brass-300' : tom === 'perigo' ? 'text-danger' : 'text-white'

  return (
    <div
      className={cx(
        'rounded-xl border border-white/[0.08] bg-white/[0.05] backdrop-blur-sm transition-colors hover:bg-white/[0.08]',
        destaque ? 'p-4' : 'p-3.5',
      )}
    >
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 leading-tight">{label}</p>
      <p className={cx('num mt-1.5 font-bold leading-none', cor, destaque ? 'text-[24px]' : 'text-[20px]')}>
        {valor}
      </p>
    </div>
  )
}

function CardAlerta({ alerta, index, onIr }: { alerta: Alerta; index: number; onIr: () => void }) {
  const Icone = ICONE_ALERTA[alerta.icone]
  const tons = {
    alta: { cor: '#B4413D', bg: '#FDEEED', label: 'Alta' },
    media: { cor: '#A5710E', bg: '#FDF7E9', label: 'Média' },
    baixa: { cor: '#4B525C', bg: '#F5F6F8', label: 'Baixa' },
  }[alerta.prioridade]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: index * 0.04 }}
      className="card card-hover p-4 flex flex-col"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
          style={{ background: tons.bg, color: tons.cor }}
        >
          <Icone size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-[13.5px] font-bold text-ink-900 leading-snug">{alerta.titulo}</h4>
            <span
              className="badge shrink-0 text-[10px]"
              style={{ background: tons.bg, color: tons.cor }}
            >
              {tons.label}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-500 leading-snug line-clamp-2">{alerta.detalhe}</p>
        </div>
      </div>

      <button
        onClick={onIr}
        className="mt-3.5 flex items-center gap-1.5 self-start text-[12.5px] font-bold text-ink-900 hover:text-brass-600 transition"
      >
        {alerta.acaoLabel}
        <ArrowRight size={13} />
      </button>
    </motion.div>
  )
}

function TipChart({
  active,
  payload,
  label,
  moeda,
  sufixo,
}: {
  active?: boolean
  payload?: { name?: string; value?: number; color?: string; payload?: Record<string, unknown> }[]
  label?: string
  moeda?: boolean
  sufixo?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2.5 shadow-lift">
      {label && <p className="text-[11.5px] font-bold text-ink-900 mb-1.5">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-[12px] text-ink-600">
          {p.color && <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />}
          <span>{p.name}</span>
          <span className="num font-bold text-ink-900 ml-auto">
            {moeda ? brl(Number(p.value)) : `${num(Number(p.value))}${sufixo ?? ''}`}
          </span>
        </p>
      ))}
    </div>
  )
}
