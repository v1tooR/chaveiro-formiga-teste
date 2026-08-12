import {
  ArrowLeftRight,
  Banknote,
  Camera,
  CreditCard,
  Footprints,
  ImageOff,
  KeyRound,
  Package,
  QrCode,
  Ruler,
  Scissors,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useDominioMaps } from '@/lib/dominio'
import { useSessao } from '@/store/useSessao'
import type {
  Categoria,
  Cliente,
  ClienteStatus,
  Comanda,
  ComandaStatus,
  Foto,
  FormaPagamento,
  LancamentoStatus,
} from '@/types'
import {
  cx,
  diasRestantes,
  fmtData,
  fmtDataCurta,
  iniciais,
  prazoTexto,
  prazoTom,
} from '@/lib/utils'
import { Badge } from './ui'

/* ------------------------------------------------------------------ *
 * Ícones
 * ------------------------------------------------------------------ */

const ICONES: Record<string, LucideIcon> = {
  KeyRound,
  Footprints,
  Scissors,
  Ruler,
  Wrench,
  Package,
  QrCode,
  Banknote,
  CreditCard,
  ArrowLeftRight,
}

export function IconeCategoria({ cat, size = 15 }: { cat: Categoria; size?: number }) {
  const { cat: meta } = useDominioMaps()
  const Ico = ICONES[meta(cat).icon] ?? Package
  return <Ico size={size} />
}

export function IconeForma({ forma, size = 14 }: { forma: FormaPagamento; size?: number }) {
  const { forma: meta } = useDominioMaps()
  const Ico = ICONES[meta(forma)?.icon ?? ''] ?? Banknote
  return <Ico size={size} />
}

/* ------------------------------------------------------------------ *
 * Badges
 * ------------------------------------------------------------------ */

export function StatusBadge({ status, className }: { status: ComandaStatus; className?: string }) {
  const m = useDominioMaps().st(status)
  return (
    <Badge cor={m.cor} bg={m.bg} className={className} dot>
      {m.label}
    </Badge>
  )
}

export function CategoriaBadge({ cat, className }: { cat: Categoria; className?: string }) {
  const m = useDominioMaps().cat(cat)
  return (
    <Badge cor={m.cor} bg={m.bg} className={className}>
      <IconeCategoria cat={cat} size={12} />
      {m.label}
    </Badge>
  )
}

export function ClienteStatusBadge({ status }: { status: ClienteStatus }) {
  const m = useDominioMaps().cliSt(status)
  return (
    <Badge cor={m.cor} bg={m.bg} dot>
      {m.label}
    </Badge>
  )
}

export function LancStatusBadge({ status }: { status: LancamentoStatus }) {
  const m = useDominioMaps().lancSt(status)
  return (
    <Badge cor={m.cor} bg={m.bg} dot>
      {m.label}
    </Badge>
  )
}

export function PrazoBadge({
  prazo,
  status,
  compacto,
}: {
  prazo: string
  status: ComandaStatus
  compacto?: boolean
}) {
  // `is_final` vem da tabela de status, então um status novo cadastrado
  // pelo responsavel ja entra na regra sem mexer no codigo.
  const finalizado = useDominioMaps().st(status).final
  const tom = prazoTom(prazo, status, finalizado)
  const d = diasRestantes(prazo)
  const cores = {
    atraso: { cor: '#B4413D', bg: '#FDEEED' },
    proximo: { cor: '#A5710E', bg: '#FDF7E9' },
    ok: { cor: '#4B525C', bg: '#F5F6F8' },
    neutro: { cor: '#6B7280', bg: '#F5F6F8' },
  }[tom]

  // Comanda finalizada não tem contagem regressiva: o prazo virou fato, não
  // previsão. "Faltam 2 dias" numa entregue e "-117d" numa cancelada afirmam
  // algo que deixou de valer — a data em si continua verdadeira.
  //
  // `tom` já sabe disso (prazoTom devolve 'neutro' para status final), mas o
  // texto era calculado por caminho independente e ignorava o resultado.
  let texto: string
  if (tom === 'neutro') {
    texto = compacto ? fmtDataCurta(prazo) : fmtData(prazo)
  } else if (!compacto) {
    texto = prazoTexto(prazo)
  } else if (tom === 'atraso') {
    texto = `${Math.abs(d)}d atraso`
  } else {
    texto = d === 0 ? 'Hoje' : `${d}d`
  }

  return (
    <Badge cor={cores.cor} bg={cores.bg} className="num">
      {texto}
    </Badge>
  )
}

/* ------------------------------------------------------------------ *
 * Foto: imagem do Storage quando há arquivo, gradiente quando não há
 * ------------------------------------------------------------------ */

const PALETAS: Record<string, [string, string, string]> = {
  chaveiro: ['#8A6B2F', '#C9A24B', '#4A3A18'],
  sapataria: ['#5A4230', '#997048', '#2E2118'],
  costura: ['#43407A', '#7B77BE', '#26243F'],
  ajuste: ['#2B4C7E', '#5A86BE', '#182B47'],
  reparo: ['#7A4A28', '#B87B45', '#3D2415'],
  outro: ['#4A4F57', '#7C838D', '#2A2D32'],
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return Math.abs(h)
}

/**
 * Renderiza a foto da comanda.
 *
 * `dataUrl` é a URL assinada do bucket privado (resolvida em
 * src/lib/api/fotos.ts). Sem arquivo — caso dos registros do seed de
 * demonstração, que não têm binário — desenha um gradiente estável a
 * partir do seed, para a grade não ficar com buracos.
 */
export function FotoBox({
  foto,
  className,
  mostrarTipo = true,
  onClick,
}: {
  foto: Foto
  className?: string
  mostrarTipo?: boolean
  onClick?: () => void
}) {
  const cat = foto.seed.split('-')[0] || 'outro'
  const pal = PALETAS[cat] ?? PALETAS.outro
  const h = hash(foto.seed)
  const ang = h % 360
  const px = h % 100
  const py = (h >> 3) % 100

  const El = onClick ? 'button' : 'div'

  return (
    <El
      onClick={onClick}
      className={cx(
        'relative overflow-hidden rounded-xl bg-ink-200 group/foto text-left w-full',
        onClick && 'cursor-zoom-in',
        className,
      )}
      style={
        foto.dataUrl
          ? undefined
          : {
              backgroundImage: `radial-gradient(circle at ${px}% ${py}%, ${pal[1]}, transparent 62%), linear-gradient(${ang}deg, ${pal[0]}, ${pal[2]})`,
            }
      }
      aria-label={foto.legenda}
    >
      {foto.dataUrl && (
        <img
          src={foto.dataUrl}
          alt={foto.legenda}
          className="h-full w-full object-cover"
          // Sem isto, imagem que não carrega vira um quadrado cinza com o
          // texto alternativo por cima — indistinguível de foto que nunca
          // foi anexada. O operador conclui que o upload não salvou,
          // quando o arquivo está no bucket e o problema é a exibição.
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            e.currentTarget.dataset.falhou = '1'
            console.error(
              `[foto] a imagem não carregou: ${foto.legenda} · ${foto.storagePath ?? '(sem arquivo)'}\n` +
                `URL tentada: ${foto.dataUrl}`,
            )
          }}
        />
      )}

      {!foto.dataUrl && (
        <span className="absolute inset-0 grid place-items-center gap-1 text-white/30">
          {/*
            `storagePath` sem `dataUrl` NÃO é o mesmo que "não tem foto":
            existe arquivo no bucket e a URL assinada é que não veio. Essa
            distinção é a diferença entre "esqueceram de fotografar" e
            "tem algo quebrado", e antes as duas apareciam iguais.
          */}
          {foto.storagePath ? (
            <span className="flex flex-col items-center gap-1 text-center">
              <ImageOff size={20} strokeWidth={1.5} />
              <span className="px-1 text-[9px] font-semibold leading-tight text-white/70">
                imagem não carregou
              </span>
            </span>
          ) : (
            <Camera size={22} strokeWidth={1.5} />
          )}
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/85 to-transparent px-2 pb-1.5 pt-5">
        <span className="block truncate text-[10.5px] font-semibold text-white/95">{foto.legenda}</span>
      </span>

      {mostrarTipo && (
        <span
          className={cx(
            'absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide',
            foto.tipo === 'antes' && 'bg-info/90 text-white',
            foto.tipo === 'detalhe' && 'bg-brass-400/95 text-ink-950',
            foto.tipo === 'depois' && 'bg-pine-500/95 text-white',
          )}
        >
          {foto.tipo}
        </span>
      )}
    </El>
  )
}

export function SemFoto({ className, texto = 'Sem foto' }: { className?: string; texto?: string }) {
  return (
    <div
      className={cx(
        'grid place-items-center rounded-xl border border-dashed border-ink-200 bg-ink-50 text-ink-300',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-1">
        <ImageOff size={18} strokeWidth={1.6} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wide">{texto}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Avatar
 * ------------------------------------------------------------------ */

const AV_CORES = ['#1B4A37', '#A5710E', '#5B4CB8', '#1D4ED8', '#B4413D', '#2F7D5F', '#7D550C']

export function Avatar({
  nome,
  size = 34,
  className,
}: {
  nome: string
  size?: number
  className?: string
}) {
  const cor = AV_CORES[hash(nome) % AV_CORES.length]
  return (
    <span
      className={cx('grid shrink-0 place-items-center rounded-full font-bold text-white', className)}
      style={{ width: size, height: size, background: cor, fontSize: size * 0.36 }}
      aria-hidden
    >
      {iniciais(nome)}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Código visual / QR demonstrativo
 * ------------------------------------------------------------------ */

/*
 * `QrFake` e `BarrasFake` foram removidos.
 *
 * Os dois desenhavam padrões a partir de um hash — nada codificado, nada
 * legível. O QR saía impresso na via do cliente sob "CÓDIGO DA COMANDA" e
 * o próprio `aria-label` dele dizia "Código demonstrativo"; o de barras
 * era `aria-hidden` com o comentário "decorativo". Impressos, prometiam
 * uma leitura por câmera ou leitor que não existia — quem tentasse
 * concluiria que o equipamento está com defeito, não o código.
 *
 * O QR de verdade está em `Qr.tsx`, e ele se recusa a desenhar quando o
 * tamanho não permite leitura. Código de barras não foi refeito: só vale
 * se a loja tiver leitor, e aí o formato é decisão de operação.
 */

/* ------------------------------------------------------------------ *
 * Linha "cliente" reutilizável
 * ------------------------------------------------------------------ */

export function ClienteInline({ cliente, sub }: { cliente?: Cliente; sub?: string }) {
  if (!cliente) return <span className="text-ink-400">—</span>
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar nome={cliente.nome} size={32} />
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-semibold text-ink-900 leading-tight">{cliente.nome}</p>
        <p className="truncate text-[12px] text-ink-500 num">{sub ?? cliente.cidade}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * KPI Card
 * ------------------------------------------------------------------ */

export function Kpi({
  label,
  valor,
  hint,
  icon: Icon,
  tom = 'neutro',
  onClick,
}: {
  label: string
  valor: React.ReactNode
  hint?: string
  icon?: LucideIcon
  tom?: 'neutro' | 'ok' | 'alerta' | 'perigo' | 'info'
  onClick?: () => void
}) {
  const tons = {
    neutro: { cor: '#111317', bg: '#F5F6F8' },
    ok: { cor: '#1B4A37', bg: '#EDF5F1' },
    alerta: { cor: '#A5710E', bg: '#FDF7E9' },
    perigo: { cor: '#B4413D', bg: '#FDEEED' },
    info: { cor: '#1D4ED8', bg: '#EFF6FF' },
  }[tom]

  const El = onClick ? 'button' : 'div'

  return (
    <El
      onClick={onClick}
      className={cx(
        'card p-4 sm:p-[18px] text-left w-full',
        onClick && 'card-hover cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-500">{label}</p>
        {Icon && (
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
            style={{ background: tons.bg, color: tons.cor }}
          >
            <Icon size={15} />
          </span>
        )}
      </div>
      <p className="mt-2.5 text-[26px] font-bold leading-none text-ink-900 num">{valor}</p>
      {hint && <p className="mt-2 text-[12.5px] text-ink-500 leading-snug">{hint}</p>}
    </El>
  )
}

/* ------------------------------------------------------------------ *
 * Cabeçalho de página
 * ------------------------------------------------------------------ */

export function PageHead({
  titulo,
  subtitulo,
  acoes,
}: {
  titulo: string
  subtitulo?: string
  acoes?: React.ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] sm:text-[26px] font-bold text-ink-900 leading-tight">{titulo}</h1>
        {subtitulo && <p className="text-[13.5px] text-ink-500 mt-1 leading-snug">{subtitulo}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2 shrink-0">{acoes}</div>}
    </header>
  )
}

/* ------------------------------------------------------------------ *
 * Selo de demonstração
 * ------------------------------------------------------------------ */

/**
 * Selo do papel do usuário logado.
 *
 * Era um selo fixo "Demonstração". Com dados reais, o que ajuda o
 * operador é saber com qual perfil está logado — é o que explica por que
 * um menu aparece para um colega e não para ele.
 */
export function SeloPerfil({ className }: { className?: string }) {
  const papel = useSessao((s) => s.perfil?.papelLabel)
  if (!papel) return null
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/70 px-2.5 py-1',
        'text-[10.5px] font-semibold uppercase tracking-wider text-ink-500',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-brass-400" />
      {papel}
    </span>
  )
}

/** Card de comanda usado em listas e no Kanban. */
export function comandaResumo(c: Comanda) {
  return `${c.servicoNome}${c.quantidade > 1 ? ` · ${c.quantidade}x` : ''}`
}
