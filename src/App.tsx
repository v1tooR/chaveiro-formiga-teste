import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import Layout from '@/components/Layout'
import { ToastProvider } from '@/components/ui'
import { useSessao } from '@/store/useSessao'
import type { ModuloId, Modulo, Perfil } from '@/types'

import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Atendimento from '@/pages/Atendimento'
import Clientes from '@/pages/Clientes'
import ClienteDetalhe from '@/pages/ClienteDetalhe'
import Comandas from '@/pages/Comandas'
import ComandaDetalhe from '@/pages/ComandaDetalhe'
import AbrirPorNumero from '@/pages/AbrirPorNumero'
import Servicos from '@/pages/Servicos'
import Producao from '@/pages/Producao'
import Etiquetas from '@/pages/Etiquetas'
import Financeiro from '@/pages/Financeiro'
import Relatorios from '@/pages/Relatorios'
import Configuracoes from '@/pages/Configuracoes'

/**
 * Primeira rota que o perfil consegue abrir.
 *
 * Existe para não haver `/dashboard` cravado em três lugares: o guard de
 * rota, a rota `/` e o Login. Um perfil sem o módulo `dashboard` cairia
 * em loop de redirect.
 */
function rotaInicial(perfil: Perfil | null, modulos: Modulo[]): string {
  if (!perfil) return '/'
  // A rota vem de `modules.route` no banco, na ordem `sort_order` — não há
  // lista de rotas duplicada no código.
  const primeiro = modulos
    .filter((m) => perfil.modulos.includes(m.key))
    .sort((a, b) => a.ordem - b.ordem)[0]
  return primeiro?.rota ?? '/dashboard'
}

/**
 * Bloqueia rotas fora do escopo do perfil.
 *
 * A permissão vem de `role_modules` no banco — a mesma tabela que a RLS
 * consulta. Este guard é conveniência de navegação, não segurança: quem
 * protege os dados é a RLS. Mas ler da mesma fonte garante que o menu, o
 * redirecionamento e o banco nunca discordem.
 */
function Protegida({ modulo, children }: { modulo: ModuloId; children: React.ReactNode }) {
  const perfil = useSessao((s) => s.perfil)
  const carregando = useSessao((s) => s.carregando)
  const modulos = useSessao((s) => s.dominio.modulos)
  const loc = useLocation()

  if (carregando) return <Carregando />
  if (!perfil) return <Navigate to="/" replace state={{ from: loc.pathname }} />
  // Destino calculado, não `/dashboard` fixo: um perfil sem o módulo
  // `dashboard` entraria em loop de redirect (hoje mascarado porque todos
  // os papéis do seed têm dashboard).
  if (!perfil.modulos.includes(modulo)) {
    return <Navigate to={rotaInicial(perfil, modulos)} replace state={{ negado: modulo }} />
  }

  return <Layout>{children}</Layout>
}

/** Splash do boot — evita piscar a tela de login antes de checar a sessão. */
function Carregando() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-50">
      <div className="flex flex-col items-center gap-4">
        <span className="grid h-12 w-12 animate-pulse place-items-center rounded-xl bg-ink-900 text-brass-400">
          <KeyRound size={22} strokeWidth={2.4} />
        </span>
        <p className="text-[13px] text-ink-500">Carregando o sistema…</p>
      </div>
    </div>
  )
}

export default function App() {
  const perfil = useSessao((s) => s.perfil)
  const carregando = useSessao((s) => s.carregando)
  const iniciar = useSessao((s) => s.iniciar)
  const modulos = useSessao((s) => s.dominio.modulos)

  // Restaura a sessão persistida antes de decidir o que renderizar.
  useEffect(() => {
    void iniciar()
  }, [iniciar])

  const inicial = rotaInicial(perfil, modulos)

  return (
    <ToastProvider>
      <Routes>
        <Route
          path="/"
          element={
            carregando ? <Carregando /> : perfil ? <Navigate to={inicial} replace /> : <Login />
          }
        />

        <Route path="/dashboard" element={<Protegida modulo="dashboard"><Dashboard /></Protegida>} />
        <Route path="/atendimento" element={<Protegida modulo="service_desk"><Atendimento /></Protegida>} />
        <Route path="/clientes" element={<Protegida modulo="customers"><Clientes /></Protegida>} />
        <Route path="/clientes/:id" element={<Protegida modulo="customers"><ClienteDetalhe /></Protegida>} />
        <Route path="/comandas" element={<Protegida modulo="orders"><Comandas /></Protegida>} />
        <Route path="/comandas/:id" element={<Protegida modulo="orders"><ComandaDetalhe /></Protegida>} />
        {/* Destino do QR das etiquetas — encurta o endereço para o código
            caber fisicamente na etiqueta. Ver AbrirPorNumero.tsx. */}
        <Route path="/c/:numero" element={<Protegida modulo="orders"><AbrirPorNumero /></Protegida>} />
        <Route path="/servicos" element={<Protegida modulo="services"><Servicos /></Protegida>} />
        <Route path="/producao" element={<Protegida modulo="production"><Producao /></Protegida>} />
        <Route path="/etiquetas" element={<Protegida modulo="labels"><Etiquetas /></Protegida>} />
        <Route path="/financeiro" element={<Protegida modulo="finance"><Financeiro /></Protegida>} />
        <Route path="/relatorios" element={<Protegida modulo="reports"><Relatorios /></Protegida>} />
        <Route path="/configuracoes" element={<Protegida modulo="settings"><Configuracoes /></Protegida>} />

        <Route path="*" element={<Navigate to={perfil ? inicial : '/'} replace />} />
      </Routes>
    </ToastProvider>
  )
}
