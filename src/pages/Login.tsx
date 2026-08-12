import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSessao } from '@/store/useSessao'
import { Spinner } from '@/components/ui'

/**
 * Autenticação real via Supabase Auth.
 *
 * Antes, qualquer e-mail e senha entravam e o usuário ESCOLHIA o próprio
 * papel numa grade de botões. Agora o papel vem do perfil no banco: quem
 * define quem é o quê é o responsável, em Configurações.
 */
export default function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const entrar = useSessao((s) => s.entrar)

  /**
   * Rota que o usuário tentou abrir antes de ser mandado para o login.
   *
   * O guard em App.tsx já gravava isto em `state.from`; o Login ignorava
   * e ia para /dashboard. Quem clicava num link de comanda e precisava
   * entrar perdia o destino.
   *
   * Vazio significa "sem destino": a rota `/` decide pelo perfil assim que
   * a sessão entra no store. `/` NÃO serve de fallback — é a própria rota
   * do login, e navegar para ela devolveria o usuário para cá.
   */
  const bruto = (loc.state as { from?: string } | null)?.from ?? ''
  const destino = bruto && bruto !== '/' ? bruto : ''

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function acessar(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !senha) {
      setErro('Informe e-mail e senha.')
      return
    }

    setEnviando(true)
    setErro(null)
    try {
      await entrar(email.trim(), senha)
      // O guard de rota grava o destino em `state.from` ao barrar quem não
      // tem sessão; ir para /dashboard fixo jogava fora essa informação.
      // Sem destino salvo não se navega: a rota `/` já redireciona pelo
      // primeiro módulo do perfil.
      if (destino) nav(destino, { replace: true })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível entrar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-ink-950">
      {/* Painel da marca */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 text-white">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(900px 520px at 18% 8%, rgba(223,169,42,.20), transparent 62%), radial-gradient(700px 500px at 88% 92%, rgba(47,125,95,.20), transparent 60%), linear-gradient(150deg, #0B0C0E, #171A1F 55%, #0B0C0E)',
          }}
        />
        <div className="absolute inset-0 grain opacity-60" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brass-400 text-ink-950">
              <KeyRound size={21} strokeWidth={2.4} />
            </span>
            <div>
              <p className="font-display text-[17px] font-extrabold tracking-tight leading-none">
                CHAVEIRO FORMIGA
              </p>
              <p className="text-[11.5px] uppercase tracking-[0.18em] text-brass-300 mt-1">
                Atendimento e Serviços
              </p>
            </div>
          </div>
        </div>

        <div className="relative max-w-lg">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="font-display text-[42px] leading-[1.08] font-extrabold tracking-tight"
          >
            Cada serviço organizado.
            <br />
            Cada cliente acompanhado.
            <br />
            <span className="text-brass-300">Nada perdido no caminho.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-5 text-[15px] leading-relaxed text-ink-300"
          >
            Atendimentos, comandas, fotos, etiquetas e financeiro reunidos em um único sistema —
            do balcão até a entrega.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18 }}
            className="mt-9 grid grid-cols-3 gap-3"
          >
            {[
              ['Comandas', 'com foto e prazo'],
              ['Produção', 'do recebido à entrega'],
              ['Financeiro', 'recebido e pendente'],
            ].map(([t, s]) => (
              <div key={t} className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-sm">
                <p className="text-[13px] font-bold">{t}</p>
                <p className="text-[11.5px] text-ink-400 mt-0.5 leading-snug">{s}</p>
              </div>
            ))}
          </motion.div>
        </div>

        <div className="relative flex items-center gap-2 text-[12px] text-ink-400">
          <ShieldCheck size={14} />
          Acesso restrito à equipe da loja.
        </div>
      </div>

      {/* Formulário */}
      <div className="flex items-center justify-center bg-ink-50 p-6 sm:p-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-[400px]"
        >
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-900 text-brass-400">
              <KeyRound size={19} strokeWidth={2.4} />
            </span>
            <div>
              <p className="font-display text-[15px] font-extrabold text-ink-900 leading-none">
                CHAVEIRO FORMIGA
              </p>
              <p className="text-[11px] uppercase tracking-wider text-ink-500 mt-1">
                Atendimento e Serviços
              </p>
            </div>
          </div>

          <h2 className="text-[24px] font-bold text-ink-900 leading-tight">Entrar no sistema</h2>
          <p className="text-[13.5px] text-ink-500 mt-1.5">
            Use o e-mail cadastrado pelo responsável da loja.
          </p>

          <form onSubmit={acessar} className="mt-7 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  className="field pl-9"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setErro(null)
                  }}
                  placeholder="seu@email.com"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="senha">
                Senha
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  id="senha"
                  type="password"
                  autoComplete="current-password"
                  className="field pl-9"
                  value={senha}
                  onChange={(e) => {
                    setSenha(e.target.value)
                    setErro(null)
                  }}
                  placeholder="••••••••"
                />
              </div>
            </div>

            {erro && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-field border border-danger/25 bg-danger/[0.06] px-3.5 py-3"
              >
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" />
                <p className="text-[13px] leading-snug text-danger">{erro}</p>
              </div>
            )}

            <button type="submit" className="btn-primary w-full mt-1" disabled={enviando}>
              {enviando ? <Spinner /> : null}
              {enviando ? 'Entrando…' : 'Entrar'}
              {!enviando && <ArrowRight size={15} />}
            </button>
          </form>

          <p className="mt-6 text-center text-[12px] text-ink-400 leading-relaxed">
            Esqueceu a senha? Procure o responsável da loja.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
