import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  ChevronDown,
  ClipboardList,
  Cog,
  FileBarChart,
  Hammer,
  Home,
  KeyRound,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  Plus,
  Presentation,
  Receipt,
  Search,
  Tag,
  UserRound,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useSessao } from '@/store/useSessao'
import { useAsync } from '@/lib/hooks'
import { obterAlertas } from '@/lib/api/relatorios'
import { listarComandas } from '@/lib/api/comandas'
import { buscarClientes } from '@/lib/api/clientes'
import { listarServicos } from '@/lib/api/servicos'
import { consultaInicial } from '@/lib/listing'
import { brl, comandaCod, cx, telefoneFmt } from '@/lib/utils'
import { Avatar, SeloPerfil, StatusBadge } from './dominio'
import { Drawer, Spinner, useToast } from './ui'
import type { Cliente, Comanda, ModuloId, Servico } from '@/types'

/** Ícone por módulo — a única parte do NAV que fica no código. */
const ICONES: Record<ModuloId, LucideIcon> = {
  dashboard: Home,
  service_desk: ClipboardList,
  customers: Users,
  orders: Receipt,
  services: Hammer,
  production: LayoutGrid,
  labels: Tag,
  finance: Wallet,
  reports: FileBarChart,
  settings: Cog,
}

const GRUPO_LABEL: Record<string, string> = {
  overview: 'Visão Geral',
  operation: 'Operação',
  management: 'Gestão',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation()
  const nav = useNavigate()
  const { push } = useToast()

  const perfil = useSessao((s) => s.perfil)
  const modulos = useSessao((s) => s.dominio.modulos)
  const sair = useSessao((s) => s.sair)
  const modoApresentacao = useSessao((s) => s.modoApresentacao)
  const setModo = useSessao((s) => s.setModoApresentacao)

  /**
   * Itens do menu: módulos do banco ∩ módulos legíveis do perfil.
   * Mesma tabela (`role_modules`) que a RLS usa — menu e banco não podem
   * divergir.
   */
  const itens = useMemo(
    () =>
      modulos
        .filter((m) => perfil?.modulos.includes(m.key))
        .sort((a, b) => a.ordem - b.ordem),
    [modulos, perfil],
  )

  /**
   * O botão "Criar" só aparece se o perfil escreve em algum módulo que
   * cria algo. O perfil de consulta tem `orders` em leitura — no mock isso
   * bastava para o menu aparecer, e todo item dele dava erro (ambiguidade A2).
   */
  const podeCriar = useMemo(
    () =>
      (['service_desk', 'orders', 'customers', 'services', 'finance'] as ModuloId[]).some((m) =>
        perfil?.escrita.includes(m),
      ),
    [perfil],
  )

  const [buscaAberta, setBuscaAberta] = useState(false)
  const [criarAberto, setCriarAberto] = useState(false)
  const [notifAberta, setNotifAberta] = useState(false)
  const [perfilAberto, setPerfilAberto] = useState(false)
  const [maisAberto, setMaisAberto] = useState(false)
  const [gestaoAberta, setGestaoAberta] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBuscaAberta(true)
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    setCriarAberto(false)
    setNotifAberta(false)
    setPerfilAberto(false)
    setMaisAberto(false)
    setGestaoAberta(false)
  }, [loc.pathname])

  /**
   * Explica o redirecionamento por falta de permissão.
   *
   * O guard de rota manda o usuário para a rota inicial e gravava
   * `state.negado`; sem esta mensagem o redirect era silencioso e parecia
   * um bug de navegação — quem digitava /financeiro simplesmente via o
   * dashboard aparecer.
   */
  const negado = (loc.state as { negado?: ModuloId } | null)?.negado
  useEffect(() => {
    if (!negado) return
    const label = modulos.find((m) => m.key === negado)?.label ?? 'essa área'
    push({
      tipo: 'info',
      titulo: 'Acesso não liberado',
      descricao: `Seu perfil não tem acesso a ${label}. Fale com o responsável.`,
    })
    // Limpa o state para o aviso não repetir ao voltar no histórico.
    nav(loc.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negado])

  const navPrincipal = useMemo(() => itens.filter((i) => i.grupo !== 'management'), [itens])
  const navGestao = useMemo(() => itens.filter((i) => i.grupo === 'management'), [itens])
  const gestaoAtiva = navGestao.some((i) => loc.pathname.startsWith(i.rota))

  /**
   * Contador do sino: vem da RPC `dashboard_alerts` e acompanha Realtime.
   * No mock era `comandas.filter(estaAtrasada).length` sobre o array todo
   * em memória.
   */
  const alertas = useAsync(() => obterAlertas(), [], {
    tabelas: ['orders', 'order_photos'],
    canal: 'layout-alertas',
    ativo: !!perfil,
  })

  /**
   * O badge conta os mesmos itens que a lista mostra.
   *
   * Contava só `atrasadas`, enquanto o painel lista todas as
   * categorias com `qtd > 0` — daí o "3 no sino, 7 na lista" do
   * relatório de QA. São as duas leituras da mesma RPC; agora usam a
   * mesma regra.
   */
  const alertasQtd = (alertas.dados ?? []).filter((a) => a.qtd > 0).length

  const mobilePrincipais = itens.filter((i) =>
    (['dashboard', 'service_desk', 'orders', 'production'] as ModuloId[]).includes(i.key),
  )
  const mobileMais = itens.filter((i) => !mobilePrincipais.some((m) => m.key === i.key))

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      {/* ------------------------------ Topo ------------------------------ */}
      <header className="sticky top-0 z-[90] border-b border-ink-100 bg-white/85 backdrop-blur-xl no-print">
        <div className="mx-auto max-w-[1560px] px-4 sm:px-6">
          <div className="flex h-[58px] items-center gap-3">
            <button
              onClick={() => nav('/dashboard')}
              className="flex shrink-0 items-center gap-2.5 pr-2"
              aria-label="Ir para o dashboard"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-900 text-brass-400">
                <KeyRound size={18} strokeWidth={2.4} />
              </span>
              <span className="hidden sm:block lg:hidden nav:block text-left leading-none">
                <span className="block font-display text-[13.5px] font-extrabold tracking-tight text-ink-900">
                  CHAVEIRO FORMIGA
                </span>
                <span className="block text-[10px] uppercase tracking-[0.14em] text-ink-400 mt-[3px]">
                  Sistema de Atendimento
                </span>
              </span>
            </button>

            {/* A partir de 1600px (breakpoint `nav`) todos os itens ficam
                visíveis; abaixo disso o grupo "Gestão" colapsa — sem isso
                os 10 links passam por cima da busca. */}
            <nav className="hidden lg:flex items-center gap-0.5 ml-2 min-w-0 flex-1" aria-label="Principal">
              {navPrincipal.map((i, idx) => (
                <div key={i.key} className="flex shrink-0 items-center gap-0.5">
                  {idx > 0 && i.grupo !== navPrincipal[idx - 1].grupo && (
                    <span className="mx-1.5 h-5 w-px shrink-0 bg-ink-100" aria-hidden />
                  )}
                  <ItemNavLink rota={i.rota} label={i.label} />
                </div>
              ))}

              {navGestao.length > 0 && (
                <>
                  <span className="mx-1.5 hidden h-5 w-px shrink-0 bg-ink-100 nav:block" aria-hidden />
                  <div className="hidden shrink-0 items-center gap-0.5 nav:flex">
                    {navGestao.map((i) => (
                      <ItemNavLink key={i.key} rota={i.rota} label={i.label} />
                    ))}
                  </div>

                  <div className="relative shrink-0 nav:hidden">
                    <button
                      onClick={() => {
                        setGestaoAberta((v) => !v)
                        setNotifAberta(false)
                        setCriarAberto(false)
                        setPerfilAberto(false)
                      }}
                      aria-expanded={gestaoAberta}
                      aria-haspopup="menu"
                      className={cx(
                        'relative flex items-center gap-1 rounded-lg px-2 py-2 text-[12.5px] font-semibold transition-colors whitespace-nowrap',
                        gestaoAtiva ? 'text-ink-900' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800',
                      )}
                    >
                      {GRUPO_LABEL.management}
                      <ChevronDown size={13} className={cx('transition-transform', gestaoAberta && 'rotate-180')} />
                      {gestaoAtiva && (
                        <span className="absolute inset-x-1.5 -bottom-[9px] h-[2.5px] rounded-full bg-brass-400" />
                      )}
                    </button>

                    <AnimatePresence>
                      {gestaoAberta && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setGestaoAberta(false)} />
                          <motion.div
                            role="menu"
                            initial={{ opacity: 0, y: -6, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.97 }}
                            transition={{ duration: 0.16 }}
                            className="absolute left-0 top-[calc(100%+10px)] z-50 w-56 overflow-hidden rounded-card border border-ink-100 bg-white p-1.5 shadow-lift"
                          >
                            {navGestao.map((i) => {
                              const Ico = ICONES[i.key]
                              return (
                                <button
                                  key={i.key}
                                  role="menuitem"
                                  onClick={() => {
                                    nav(i.rota)
                                    setGestaoAberta(false)
                                  }}
                                  className={cx(
                                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition',
                                    loc.pathname.startsWith(i.rota)
                                      ? 'bg-ink-900 text-white'
                                      : 'text-ink-700 hover:bg-ink-50',
                                  )}
                                >
                                  <Ico size={15} />
                                  {i.label}
                                </button>
                              )
                            })}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </nav>

            <div className="flex-1 lg:hidden" />

            <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
              <button
                onClick={() => setBuscaAberta(true)}
                aria-label="Busca global"
                className="hidden lg:flex shrink-0 items-center gap-2 rounded-field border border-ink-200 bg-ink-50 px-3 py-2
                           text-[12.5px] text-ink-400 transition hover:border-ink-300 hover:bg-white w-[150px] nav:w-[190px]"
              >
                <Search size={14} />
                <span className="flex-1 text-left">Buscar…</span>
                <kbd className="hidden nav:block rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ink-400">
                  Ctrl K
                </kbd>
              </button>

              <button
                onClick={() => setBuscaAberta(true)}
                aria-label="Buscar"
                className="lg:hidden grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
              >
                <Search size={18} />
              </button>

              <div className="relative">
                <button
                  onClick={() => {
                    setNotifAberta((v) => !v)
                    setPerfilAberto(false)
                    setCriarAberto(false)
                  }}
                  aria-label="Notificações"
                  className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 transition"
                >
                  <Bell size={18} />
                  {alertasQtd > 0 && (
                    <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9.5px] font-bold text-white num">
                      {alertasQtd}
                    </span>
                  )}
                </button>
                <AnimatePresence>
                  {notifAberta && <PainelNotificacoes onClose={() => setNotifAberta(false)} />}
                </AnimatePresence>
              </div>

              {podeCriar && (
                <div className="relative">
                  <button
                    onClick={() => {
                      setCriarAberto((v) => !v)
                      setNotifAberta(false)
                      setPerfilAberto(false)
                    }}
                    className="btn-accent h-9 px-3 sm:px-3.5 text-[13px]"
                  >
                    <Plus size={16} strokeWidth={2.6} />
                    <span className="hidden sm:inline">Criar</span>
                  </button>
                  <AnimatePresence>
                    {criarAberto && <MenuCriar onClose={() => setCriarAberto(false)} />}
                  </AnimatePresence>
                </div>
              )}

              <div className="relative">
                <button
                  onClick={() => {
                    setPerfilAberto((v) => !v)
                    setNotifAberta(false)
                    setCriarAberto(false)
                  }}
                  aria-label="Perfil"
                  className="ml-0.5 rounded-full ring-2 ring-transparent transition hover:ring-ink-200"
                >
                  <Avatar nome={perfil?.nome ?? '?'} size={32} />
                </button>
                <AnimatePresence>
                  {perfilAberto && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.16 }}
                      className="absolute right-0 top-[calc(100%+10px)] z-50 w-64 overflow-hidden rounded-card border border-ink-100 bg-white shadow-lift"
                    >
                      <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3.5">
                        <Avatar nome={perfil?.nome ?? '?'} size={38} />
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-bold text-ink-900">{perfil?.nome}</p>
                          <p className="truncate text-[12px] text-ink-500">{perfil?.cargo}</p>
                        </div>
                      </div>

                      <div className="p-1.5">
                        <button
                          onClick={() => {
                            setModo(!modoApresentacao)
                            setPerfilAberto(false)
                            push({
                              tipo: 'ok',
                              titulo: modoApresentacao
                                ? 'Modo apresentação desativado'
                                : 'Modo apresentação ativado',
                              descricao: modoApresentacao
                                ? 'Interface voltou ao padrão.'
                                : 'Indicadores principais em destaque.',
                            })
                          }}
                          className={cx(
                            'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition',
                            modoApresentacao ? 'bg-brass-50 text-brass-700' : 'text-ink-700 hover:bg-ink-50',
                          )}
                        >
                          <Presentation size={15} />
                          Modo apresentação
                          {modoApresentacao && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brass-400" />}
                        </button>

                        {perfil?.modulos.includes('settings') && (
                          <button
                            onClick={() => nav('/configuracoes')}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-ink-700 hover:bg-ink-50 transition"
                          >
                            <Cog size={15} />
                            Configurações
                          </button>
                        )}

                        <button
                          onClick={async () => {
                            await sair()
                            nav('/', { replace: true })
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-danger hover:bg-danger/5 transition"
                        >
                          <LogOut size={15} />
                          Sair
                        </button>
                      </div>

                      <div className="border-t border-ink-100 px-4 py-2.5">
                        <SeloPerfil />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {modoApresentacao && (
          <div className="bg-ink-900 px-4 py-1.5 text-center">
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-brass-300">
              Modo apresentação ativo — Sistema Chaveiro Formiga
            </p>
          </div>
        )}
      </header>

      {/* ----------------------------- Conteúdo ---------------------------- */}
      <main className="mx-auto w-full max-w-[1560px] flex-1 px-4 sm:px-6 py-5 sm:py-7 pb-24 lg:pb-10">
        {/* Sem AnimatePresence `mode="wait"` aqui.
            Ele mantinha a tela ANTERIOR montada até o `exit` terminar
            (220 ms) e só então montava a nova — que só aí começava a
            buscar os dados. Era o "conteúdo da tela anterior permanece
            visível durante a transição" do relatório de QA, e ainda
            atrasava toda navegação em quase um quarto de segundo.
            A entrada da tela nova continua animada. */}
        <motion.div
          key={loc.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          {children}
        </motion.div>
      </main>

      {/* -------------------------- Nav mobile ---------------------------- */}
      <nav
        className="fixed bottom-0 inset-x-0 z-[95] border-t border-ink-100 bg-white/95 backdrop-blur-xl lg:hidden no-print"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Navegação inferior"
      >
        <div className="grid grid-cols-5">
          {mobilePrincipais.map((i) => {
            const Ico = ICONES[i.key]
            return (
              <NavLink
                key={i.key}
                to={i.rota}
                className={({ isActive }) =>
                  cx(
                    'flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-semibold transition-colors',
                    isActive ? 'text-ink-900' : 'text-ink-400',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cx(
                        'grid h-7 w-7 place-items-center rounded-lg transition-colors',
                        isActive && 'bg-brass-100 text-brass-700',
                      )}
                    >
                      <Ico size={17} />
                    </span>
                    {i.key === 'dashboard' ? 'Início' : i.label}
                  </>
                )}
              </NavLink>
            )
          })}

          <button
            onClick={() => setMaisAberto(true)}
            className="flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-semibold text-ink-400"
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg">
              <MoreHorizontal size={17} />
            </span>
            Mais
          </button>
        </div>
      </nav>

      <Drawer
        open={maisAberto}
        onClose={() => setMaisAberto(false)}
        title="Todos os módulos"
        subtitle={`${perfil?.nome ?? ''} · ${perfil?.cargo ?? ''}`}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {mobileMais.map((i) => {
            const Ico = ICONES[i.key]
            return (
              <button
                key={i.key}
                onClick={() => {
                  nav(i.rota)
                  setMaisAberto(false)
                }}
                className="flex flex-col items-start gap-2.5 rounded-card border border-ink-100 bg-white p-4 text-left transition hover:border-ink-300 hover:bg-ink-50"
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-100 text-ink-700">
                  <Ico size={17} />
                </span>
                <span className="text-[13.5px] font-bold text-ink-900">{i.label}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-5 space-y-2">
          <button
            onClick={() => {
              setModo(!modoApresentacao)
              setMaisAberto(false)
              push({
                tipo: 'ok',
                titulo: modoApresentacao ? 'Modo apresentação desativado' : 'Modo apresentação ativado',
              })
            }}
            className="btn-outline w-full"
          >
            <Presentation size={15} />
            {modoApresentacao ? 'Sair do modo apresentação' : 'Modo apresentação'}
          </button>
          <button
            onClick={async () => {
              await sair()
              nav('/', { replace: true })
            }}
            className="btn-ghost w-full text-danger"
          >
            <LogOut size={15} />
            Sair
          </button>
        </div>
      </Drawer>

      <BuscaGlobal open={buscaAberta} onClose={() => setBuscaAberta(false)} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Item da navegação superior
 * ------------------------------------------------------------------ */

function ItemNavLink({ rota, label }: { rota: string; label: string }) {
  return (
    <NavLink
      to={rota}
      className={({ isActive }) =>
        cx(
          'relative shrink-0 rounded-lg px-2 py-2 text-[12.5px] nav:px-2.5 nav:text-[13px]',
          'font-semibold transition-colors whitespace-nowrap',
          isActive ? 'text-ink-900' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800',
        )
      }
    >
      {({ isActive }) => (
        <>
          {label}
          {isActive && (
            <motion.span
              layoutId="nav-ativa"
              className="absolute inset-x-1.5 -bottom-[9px] h-[2.5px] rounded-full bg-brass-400"
              transition={{ duration: 0.24 }}
            />
          )}
        </>
      )}
    </NavLink>
  )
}

/* ------------------------------------------------------------------ *
 * Menu "Criar" — filtrado por permissão de ESCRITA
 * ------------------------------------------------------------------ */

function MenuCriar({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const escrita = useSessao((s) => s.perfil?.escrita ?? [])

  const opcoes = (
    [
      { label: 'Novo atendimento', desc: 'Fluxo completo de balcão', to: '/atendimento?novo=1', icon: ClipboardList, mod: 'service_desk' },
      { label: 'Nova comanda', desc: 'Ordem de serviço direta', to: '/comandas?novo=1', icon: Receipt, mod: 'orders' },
      { label: 'Novo cliente', desc: 'Cadastro rápido', to: '/clientes?novo=1', icon: UserRound, mod: 'customers' },
      { label: 'Novo serviço', desc: 'Catálogo e preços', to: '/servicos?novo=1', icon: Hammer, mod: 'services' },
      { label: 'Novo lançamento', desc: 'Entrada ou saída', to: '/financeiro?novo=1', icon: Wallet, mod: 'finance' },
    ] as const
  ).filter((o) => escrita.includes(o.mod as ModuloId))

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.97 }}
        transition={{ duration: 0.16 }}
        className="absolute right-0 top-[calc(100%+10px)] z-50 w-[290px] overflow-hidden rounded-card border border-ink-100 bg-white p-1.5 shadow-lift"
      >
        {opcoes.map((o) => (
          <button
            key={o.label}
            onClick={() => {
              nav(o.to)
              onClose()
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-ink-50"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-700">
              <o.icon size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-ink-900 leading-tight">{o.label}</span>
              <span className="block text-[11.5px] text-ink-500 mt-0.5">{o.desc}</span>
            </span>
          </button>
        ))}
      </motion.div>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Notificações — alimentadas pela RPC dashboard_alerts
 * ------------------------------------------------------------------ */

function PainelNotificacoes({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()

  const { dados, carregando, erro } = useAsync(() => obterAlertas(), [], {
    tabelas: ['orders'],
    canal: 'notificacoes',
  })

  const itens = (dados ?? []).filter((a) => a.qtd > 0)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.97 }}
        transition={{ duration: 0.16 }}
        className="absolute right-0 top-[calc(100%+10px)] z-50 w-[340px] max-h-[70vh] overflow-hidden rounded-card border border-ink-100 bg-white shadow-lift flex flex-col"
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <p className="text-[13.5px] font-bold text-ink-900">Notificações</p>
          <button onClick={onClose} aria-label="Fechar" className="text-ink-400 hover:text-ink-700">
            <X size={15} />
          </button>
        </div>

        <div className="overflow-y-auto scroll-x flex-1">
          {carregando && (
            <p className="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-ink-400">
              <Spinner />
              Carregando…
            </p>
          )}

          {erro && !carregando && (
            <p className="px-4 py-8 text-center text-[13px] text-danger">{erro}</p>
          )}

          {!carregando && !erro && itens.length === 0 && (
            <p className="px-4 py-8 text-center text-[13px] text-ink-400">Nenhuma pendência no momento.</p>
          )}

          {!carregando &&
            !erro &&
            itens.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  nav(a.to)
                  onClose()
                }}
                className="flex w-full items-start gap-3 border-b border-ink-50 px-4 py-3 text-left transition hover:bg-ink-50"
              >
                <span
                  className={cx(
                    'mt-0.5 h-2 w-2 shrink-0 rounded-full',
                    a.prioridade === 'alta' && 'bg-danger',
                    a.prioridade === 'media' && 'bg-brass-400',
                    a.prioridade === 'baixa' && 'bg-pine-500',
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-bold text-ink-900">{a.titulo}</span>
                  {a.detalhe && (
                    <span className="block truncate text-[12px] text-ink-500 mt-0.5">{a.detalhe}</span>
                  )}
                </span>
              </button>
            ))}
        </div>

        <button
          onClick={() => {
            nav('/dashboard')
            onClose()
          }}
          className="border-t border-ink-100 px-4 py-2.5 text-[12.5px] font-semibold text-ink-600 hover:bg-ink-50 transition"
        >
          Ver tudo no dashboard
        </button>
      </motion.div>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Busca global — agora no servidor
 * ------------------------------------------------------------------ */

function BuscaGlobal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [termo, setTermo] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const perfil = useSessao((s) => s.perfil)
  const modulos = perfil?.modulos ?? []

  useEffect(() => {
    if (open) {
      setQ('')
      setTermo('')
      setTimeout(() => ref.current?.focus(), 60)
    }
  }, [open])

  // Debounce: sem isso cada tecla dispara três consultas.
  useEffect(() => {
    const t = setTimeout(() => setTermo(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const ativo = open && termo.length >= 2

  const { dados, carregando, erro } = useAsync(
    async () => {
      const [comandas, clientes, servicos] = await Promise.all([
        modulos.includes('orders')
          ? listarComandas({ ...consultaInicial(), busca: termo, tamanho: 6 })
          : Promise.resolve(null),
        modulos.includes('customers') ? buscarClientes(termo, 5) : Promise.resolve([]),
        modulos.includes('services') ? listarServicos({ busca: termo }) : Promise.resolve([]),
      ])
      return {
        comandas: comandas?.linhas ?? [],
        clientes,
        servicos: servicos.slice(0, 4),
      }
    },
    [termo, ativo],
    { ativo },
  )

  const resCom: Comanda[] = dados?.comandas ?? []
  const resCli: Cliente[] = dados?.clientes ?? []
  const resSrv: Servico[] = dados?.servicos ?? []
  const vazio = ativo && !carregando && !erro && !resCom.length && !resCli.length && !resSrv.length

  function ir(to: string) {
    nav(to)
    onClose()
  }

  const atalhos = (
    [
      ['Comandas atrasadas', '/comandas?filtro=atrasadas', 'orders'],
      ['Prontas para retirada', '/comandas?filtro=prontas', 'orders'],
      ['Novo atendimento', '/atendimento?novo=1', 'service_desk'],
      ['Produção', '/producao', 'production'],
    ] as const
  ).filter(([, , mod]) => modulos.includes(mod as ModuloId))

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Busca global"
      subtitle="Comandas, clientes e serviços"
      width="max-w-xl"
    >
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          ref={ref}
          className="field pl-9"
          placeholder="Número da comanda, cliente, telefone ou serviço…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {!q && atalhos.length > 0 && (
        <div className="mt-6">
          <p className="label">Atalhos</p>
          <div className="grid grid-cols-2 gap-2">
            {atalhos.map(([l, to]) => (
              <button key={l} onClick={() => ir(to)} className="chip justify-center py-2.5">
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {q.trim().length === 1 && (
        <p className="mt-8 text-center text-[13px] text-ink-400">Digite ao menos 2 caracteres.</p>
      )}

      {carregando && ativo && (
        <p className="mt-8 flex items-center justify-center gap-2 text-[13.5px] text-ink-400">
          <Spinner />
          Buscando…
        </p>
      )}

      {erro && (
        <p className="mt-8 rounded-field border border-danger/25 bg-danger/[0.06] px-3.5 py-3 text-[13px] text-danger">
          {erro}
        </p>
      )}

      {vazio && <p className="mt-8 text-center text-[13.5px] text-ink-400">Nenhum resultado para “{termo}”.</p>}

      {resCom.length > 0 && (
        <section className="mt-6">
          <p className="label">Comandas</p>
          <div className="space-y-1.5">
            {resCom.map((c) => (
              <button
                key={c.id}
                onClick={() => ir(`/comandas/${c.id}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-ink-100 px-3 py-2.5 text-left transition hover:border-ink-300 hover:bg-ink-50"
              >
                <span className="num text-[12.5px] font-bold text-ink-900 shrink-0">
                  {comandaCod(c.numero)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink-800">{c.clienteNome}</span>
                  <span className="block truncate text-[12px] text-ink-500">{c.servicoNome}</span>
                </span>
                <StatusBadge status={c.status} />
              </button>
            ))}
          </div>
        </section>
      )}

      {resCli.length > 0 && (
        <section className="mt-5">
          <p className="label">Clientes</p>
          <div className="space-y-1.5">
            {resCli.map((c) => (
              <button
                key={c.id}
                onClick={() => ir(`/clientes/${c.id}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-ink-100 px-3 py-2.5 text-left transition hover:border-ink-300 hover:bg-ink-50"
              >
                <Avatar nome={c.nome} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink-900">{c.nome}</span>
                  <span className="block truncate text-[12px] text-ink-500 num">
                    {telefoneFmt(c.telefone)} · {c.cidade}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {resSrv.length > 0 && (
        <section className="mt-5">
          <p className="label">Serviços</p>
          <div className="space-y-1.5">
            {resSrv.map((s) => (
              <button
                key={s.id}
                onClick={() => ir('/servicos')}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-100 px-3 py-2.5 text-left transition hover:border-ink-300 hover:bg-ink-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink-900">{s.nome}</span>
                  <span className="block text-[12px] text-ink-500 capitalize">{s.categoria}</span>
                </span>
                <span className="num text-[13px] font-bold text-ink-800">{brl(s.precoBase)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </Drawer>
  )
}
