import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  RotateCcw,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/lib/utils'

/* ------------------------------------------------------------------ *
 * Toast
 * ------------------------------------------------------------------ */

type ToastTipo = 'ok' | 'erro' | 'info'
interface Toast {
  id: string
  tipo: ToastTipo
  titulo: string
  descricao?: string
}

const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => {} })

export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([])

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setLista((l) => [...l, { ...t, id }])
    setTimeout(() => setLista((l) => l.filter((x) => x.id !== id)), 3600)
  }, [])

  const ctx = useMemo(() => ({ push }), [push])

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      {createPortal(
        <div
          className="fixed z-[200] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-stretch sm:items-end pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <AnimatePresence>
            {lista.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.22 }}
                className="pointer-events-auto flex items-start gap-3 rounded-card bg-ink-900 text-white
                           px-4 py-3 shadow-dark max-w-[380px] w-full sm:w-auto"
              >
                <span
                  className={cx(
                    'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full',
                    t.tipo === 'ok' && 'bg-pine-500',
                    t.tipo === 'erro' && 'bg-danger',
                    t.tipo === 'info' && 'bg-info',
                  )}
                >
                  {t.tipo === 'ok' ? (
                    <Check size={12} strokeWidth={3} />
                  ) : t.tipo === 'erro' ? (
                    <AlertTriangle size={12} strokeWidth={3} />
                  ) : (
                    <Info size={12} strokeWidth={3} />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold leading-snug">{t.titulo}</p>
                  {t.descricao && <p className="text-[12.5px] text-ink-300 mt-0.5">{t.descricao}</p>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', h)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size]

  return createPortal(
    <AnimatePresence>
      {open && (
        // `modal-shell` / `modal-card` / `modal-body` existem para a
        // impressão: em @media print elas deixam de ser janela flutuante e
        // viram documento. Sem isso a folha sai cortada — ver index.css.
        <div className="modal-shell fixed inset-0 z-[150] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-ink-950/55 backdrop-blur-[2px] no-print"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 24, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.985 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cx(
              'modal-card relative w-full bg-white shadow-dark rounded-t-2xl sm:rounded-card',
              'max-h-[92vh] sm:max-h-[88vh] flex flex-col',
              w,
            )}
          >
            <header className="no-print flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-ink-100 shrink-0">
              <div className="min-w-0">
                <h2 className="text-[17px] font-bold text-ink-900 leading-tight">{title}</h2>
                {subtitle && <p className="text-[13px] text-ink-500 mt-0.5">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Fechar"
                className="shrink-0 grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition"
              >
                <X size={17} />
              </button>
            </header>

            <div className="modal-body overflow-y-auto px-5 sm:px-6 py-5 scroll-x">{children}</div>

            {footer && (
              <footer className="no-print flex items-center justify-end gap-2.5 px-5 sm:px-6 py-4 border-t border-ink-100 bg-ink-50/60 rounded-b-2xl sm:rounded-b-card shrink-0">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ------------------------------------------------------------------ *
 * Drawer lateral
 * ------------------------------------------------------------------ */

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  side = 'right',
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  side?: 'right' | 'left'
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', h)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[150]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-ink-950/55 backdrop-blur-[2px] no-print"
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className={cx(
              'absolute top-0 bottom-0 w-full bg-white shadow-dark flex flex-col',
              width,
              side === 'right' ? 'right-0' : 'left-0',
            )}
          >
            <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-ink-100 shrink-0">
              <div className="min-w-0">
                <h2 className="text-[16.5px] font-bold text-ink-900 leading-tight">{title}</h2>
                {subtitle && <p className="text-[12.5px] text-ink-500 mt-0.5">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Fechar"
                className="shrink-0 grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition"
              >
                <X size={17} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-5 scroll-x">{children}</div>
            {footer && (
              <footer className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-ink-100 bg-ink-50/60 shrink-0">
                {footer}
              </footer>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ------------------------------------------------------------------ *
 * Confirmação
 * ------------------------------------------------------------------ */

export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  danger,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-[14px] text-ink-600 leading-relaxed">{message}</p>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Badge / Pill
 * ------------------------------------------------------------------ */

export function Badge({
  children,
  cor,
  bg,
  className,
  dot,
}: {
  children: ReactNode
  cor?: string
  bg?: string
  className?: string
  dot?: boolean
}) {
  return (
    <span className={cx('badge', className)} style={{ color: cor, background: bg }}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: cor }} />}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Estado vazio
 * ------------------------------------------------------------------ */

export function Vazio({
  icon: Icon,
  titulo,
  descricao,
  acao,
}: {
  icon: LucideIcon
  titulo: string
  descricao: string
  acao?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-ink-400 mb-4">
        <Icon size={24} strokeWidth={1.8} />
      </div>
      <h3 className="text-[15.5px] font-bold text-ink-800">{titulo}</h3>
      <p className="text-[13.5px] text-ink-500 mt-1.5 max-w-sm leading-relaxed">{descricao}</p>
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Skeleton
 * ------------------------------------------------------------------ */

export function Skel({ className }: { className?: string }) {
  return <div className={cx('skel', className)} />
}

export function SkelCards({ n = 4, h = 'h-28' }: { n?: number; h?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <Skel key={i} className={cx(h, 'rounded-card')} />
      ))}
    </div>
  )
}

export function SkelLinhas({ n = 6 }: { n?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: n }).map((_, i) => (
        <Skel key={i} className="h-14 rounded-xl" />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Estado de erro
 * ------------------------------------------------------------------ */

/**
 * Erro de carregamento com opção de tentar de novo.
 *
 * Com mock nenhuma tela falhava. Contra o banco real, falha — e o
 * operador do balcão precisa ver o motivo ("Você não tem permissão",
 * "Sem conexão com o servidor") em vez de uma tela vazia que parece
 * "não tem nada cadastrado".
 */
export function Erro({
  mensagem,
  onTentarNovamente,
  titulo = 'Não foi possível carregar',
  compacto,
}: {
  mensagem: string
  onTentarNovamente?: () => void
  titulo?: string
  compacto?: boolean
}) {
  if (compacto) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-field border border-danger/25 bg-danger/[0.06] px-3.5 py-3"
      >
        <AlertTriangle size={15} className="shrink-0 text-danger" />
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-danger">{mensagem}</p>
        {onTentarNovamente && (
          <button onClick={onTentarNovamente} className="btn-outline text-[12.5px] py-1.5 px-2.5">
            <RotateCcw size={13} />
            Tentar novamente
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-danger/10 text-danger">
        <AlertTriangle size={24} strokeWidth={1.8} />
      </div>
      <h3 className="text-[15.5px] font-bold text-ink-800">{titulo}</h3>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-500">{mensagem}</p>
      {onTentarNovamente && (
        <button onClick={onTentarNovamente} className="btn-primary mt-5">
          <RotateCcw size={15} />
          Tentar novamente
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Paginação
 * ------------------------------------------------------------------ */

/**
 * Controles de página do padrão único de listagem (src/lib/listing.ts).
 *
 * Mostra o total real vindo do banco. Antes as listas cortavam com
 * `.slice(0, 60)` e escreviam "Exibindo 60 de N" — mas o N era o tamanho
 * do array em memória, não o do banco.
 */
export function Paginacao({
  pagina,
  paginas,
  total,
  tamanho,
  carregando,
  onAnterior,
  onProxima,
  rotulo = 'registro',
}: {
  pagina: number
  paginas: number
  total: number
  tamanho: number
  carregando?: boolean
  onAnterior: () => void
  onProxima: () => void
  rotulo?: string
}) {
  if (total === 0) return null

  const de = (pagina - 1) * tamanho + 1
  const ate = Math.min(pagina * tamanho, total)

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-4 py-3"
      aria-label="Paginação"
    >
      <p className="text-[12.5px] text-ink-500">
        <span className="num font-semibold text-ink-800">
          {de}–{ate}
        </span>{' '}
        de <span className="num font-semibold text-ink-800">{total}</span> {rotulo}
        {total === 1 ? '' : 's'}
      </p>

      <div className="flex items-center gap-1.5">
        <button
          onClick={onAnterior}
          disabled={pagina <= 1 || carregando}
          className="btn-outline px-2.5 py-1.5 text-[12.5px] disabled:opacity-40"
          aria-label="Página anterior"
        >
          <ChevronLeft size={14} />
          Anterior
        </button>
        <span className="num px-2 text-[12.5px] font-semibold text-ink-600">
          {pagina} / {paginas}
        </span>
        <button
          onClick={onProxima}
          disabled={pagina >= paginas || carregando}
          className="btn-outline px-2.5 py-1.5 text-[12.5px] disabled:opacity-40"
          aria-label="Próxima página"
        >
          Próxima
          <ChevronRight size={14} />
        </button>
      </div>
    </nav>
  )
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

export function Tabs({
  abas,
  ativa,
  onChange,
}: {
  abas: { id: string; label: string; badge?: number }[]
  ativa: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex gap-1 overflow-x-auto hide-scroll border-b border-ink-100" role="tablist">
      {abas.map((a) => {
        const on = a.id === ativa
        return (
          <button
            key={a.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(a.id)}
            className={cx(
              'relative shrink-0 px-4 py-2.5 text-[13.5px] font-semibold transition-colors',
              on ? 'text-ink-900' : 'text-ink-500 hover:text-ink-700',
            )}
          >
            <span className="flex items-center gap-2">
              {a.label}
              {a.badge !== undefined && a.badge > 0 && (
                <span
                  className={cx(
                    'num rounded-full px-1.5 py-0.5 text-[10.5px] font-bold',
                    on ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-500',
                  )}
                >
                  {a.badge}
                </span>
              )}
            </span>
            {on && (
              <motion.span
                layoutId="tab-underline"
                className="absolute left-2 right-2 -bottom-px h-[2.5px] rounded-full bg-brass-400"
                transition={{ duration: 0.22 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Select
 * ------------------------------------------------------------------ */

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled,
  title,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Tooltip — use para dizer POR QUE está desabilitado. */
  title?: string
  'aria-label'?: string
}) {
  return (
    <div className={cx('relative', className)}>
      <select
        aria-label={ariaLabel}
        title={title}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          'field appearance-none pr-9',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Loading inline
 * ------------------------------------------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={16} className={cx('animate-spin', className)} />
}

/* ------------------------------------------------------------------ *
 * Contador animado
 * ------------------------------------------------------------------ */

export function Contador({
  valor,
  fmt = (n: number) => String(Math.round(n)),
  duracao = 700,
  className,
}: {
  valor: number
  fmt?: (n: number) => string
  duracao?: number
  className?: string
}) {
  const [n, setN] = useState(0)
  const raf = useRef<number>()

  useEffect(() => {
    const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduz) {
      setN(valor)
      return
    }
    const ini = performance.now()
    const de = 0
    const passo = (t: number) => {
      const p = Math.min(1, (t - ini) / duracao)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(de + (valor - de) * eased)
      if (p < 1) raf.current = requestAnimationFrame(passo)
    }
    raf.current = requestAnimationFrame(passo)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [valor, duracao])

  return <span className={cx('num', className)}>{fmt(n)}</span>
}

/* ------------------------------------------------------------------ *
 * Tooltip simples
 * ------------------------------------------------------------------ */

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 z-50 whitespace-nowrap
                   rounded-lg bg-ink-900 px-2.5 py-1.5 text-[11.5px] font-medium text-white opacity-0
                   shadow-dark transition-opacity duration-150 group-hover/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}
