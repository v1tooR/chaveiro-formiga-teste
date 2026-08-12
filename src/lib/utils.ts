import type { Comanda, ComandaStatus } from '@/types'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })

/**
 * R$ 3,8 mil — para eixos de gráfico.
 *
 * `toFixed` produzia "R$ 6.0k" com ponto decimal, que em pt-BR lê como
 * milhar. E o rótulo era largo demais para o eixo (`width={52}` com
 * `margin.left={-12}` deixava 40 px), então o "R" saía cortado — o
 * "$ 6.0k" e "!$ 1.5k" que o QA viu era recorte de layout, não formato.
 */
export const brlCompact = (v: number) => {
  if (Math.abs(v) < 1000) return `R$ ${v.toFixed(0)}`
  const mil = v / 1000
  const casas = Math.abs(v) >= 10000 ? 0 : 1
  return `R$ ${mil.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })} mil`
}

export const num = (v: number) => v.toLocaleString('pt-BR')

export const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

export const iso = (d: Date) => d.toISOString()

export const hoje = () => new Date()

/** Meia-noite local — para comparar dias sem ruído de horário. */
export function dia(d: Date | string) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDias(d: Date | string, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function mesmoDia(a: Date | string, b: Date | string) {
  return dia(a).getTime() === dia(b).getTime()
}

export function fmtData(d: Date | string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtDataCurta(d: Date | string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function fmtHora(d: Date | string) {
  return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function fmtDataHora(d: Date | string) {
  return `${fmtData(d)} · ${fmtHora(d)}`
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const mesLabel = (d: Date | string) => MESES[new Date(d).getMonth()]

/** Dias entre hoje e o prazo. Negativo = atrasado. */
export function diasRestantes(prazo: Date | string) {
  return Math.round((dia(prazo).getTime() - dia(hoje()).getTime()) / 86400000)
}

export function prazoTexto(prazo: Date | string) {
  const d = diasRestantes(prazo)
  if (d < -1) return `${Math.abs(d)} dias em atraso`
  if (d === -1) return 'Atrasado 1 dia'
  if (d === 0) return 'Vence hoje'
  if (d === 1) return 'Vence amanhã'
  return `Faltam ${d} dias`
}

/** Urgência do prazo — dirige a cor do badge. */
export function prazoTom(prazo: Date | string, status: ComandaStatus, finalizado?: boolean) {
  if (finalizado || status === 'entregue' || status === 'cancelada') return 'neutro' as const
  const d = diasRestantes(prazo)
  if (d < 0) return 'atraso' as const
  if (d <= 1) return 'proximo' as const
  return 'ok' as const
}

/**
 * Uma comanda só está atrasada se ainda não saiu da operação.
 * O banco já resolve isso em `order_list_view.is_overdue` (comparando por
 * dia no fuso da loja); aqui é só a leitura desse campo.
 */
export function estaAtrasada(c: Comanda) {
  return c.atrasada
}

/**
 * Total pago e saldo vêm CALCULADOS do banco
 * (`orders.amount_paid` / `balance`, colunas GENERATED).
 *
 * Recalcular no cliente daria número errado nas listas: elas não carregam
 * o array de pagamentos de cada comanda (seriam N consultas por página),
 * então `entrada + soma(pagamentos)` veria pagamentos = [] e mostraria a
 * comanda como não paga.
 */
export function totalPago(c: Comanda) {
  return c.pago
}

export function saldo(c: Comanda) {
  return c.saldoAberto
}

export function estaQuitada(c: Comanda) {
  return c.quitada
}

/**
 * Prazo máximo aceito em dias.
 *
 * Não é número inventado: `dashboard_alerts` já classifica comanda com
 * mais de 60 dias de prazo como "sem prazo definido"
 * (20260729121300_views_and_reports.sql). Sem teto, o wizard aceitava
 * 9999 dias e gerava previsão para 2053.
 */
export const PRAZO_MAX_DIAS = 60

/**
 * Lê um `<input type="number">` devolvendo número já limitado.
 *
 * Existe por causa de um detalhe do ReactDOM: em input numérico ele
 * compara `node.value != value` com igualdade FROUXA, então `"05" == 5`
 * e o nó NUNCA é reescrito. Digitar "-" deixa `e.target.value === ''`
 * (valor inválido para o browser), `Number('')` vira 0, e a partir daí
 * o zero fica preso à esquerda: "-5" virava "05" e "-100" virava "0100".
 *
 * A correção é escrever o valor canônico de volta no nó quando ele
 * diverge do que o state vai guardar.
 */
export function numeroDeInput(
  e: { target: HTMLInputElement },
  { min, max }: { min?: number; max?: number } = {},
): number {
  const bruto = e.target.value
  let n = Number(bruto)
  if (!Number.isFinite(n)) n = min ?? 0
  if (min !== undefined) n = Math.max(min, n)
  if (max !== undefined) n = Math.min(max, n)

  const canonico = String(n)
  if (bruto !== canonico) e.target.value = canonico
  return n
}

export function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}

export function telefoneFmt(t: string) {
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

/** Só os dígitos — é assim que o telefone é gravado (regra `digits_only` no banco). */
export const telefoneDigitos = (t: string) => t.replace(/\D/g, '').slice(0, 11)

/**
 * Máscara progressiva, para o campo enquanto se digita.
 *
 * `telefoneFmt` só formata número completo (10 ou 11 dígitos) e devolve a
 * entrada intacta no meio do caminho — serve para exibir, não para digitar.
 */
export function telefoneMask(t: string) {
  const d = telefoneDigitos(t)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function comandaCod(numero: number, prefixo = 'CF') {
  return `${prefixo}-${String(numero).padStart(4, '0')}`
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

/** PRNG determinístico — mantém o mock idêntico entre reloads. */
export function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function pick<T>(arr: readonly T[], r: number): T {
  return arr[Math.floor(r * arr.length) % arr.length]
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms = 220) {
  let t: ReturnType<typeof setTimeout>
  return (...a: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

/** Busca acento-insensível. */
export function normaliza(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function matchBusca(q: string, ...campos: (string | number | undefined)[]) {
  const n = normaliza(q)
  if (!n) return true
  return campos.some((c) => normaliza(String(c ?? '')).includes(n))
}
