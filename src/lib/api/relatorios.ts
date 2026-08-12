/**
 * Relatórios e KPIs — ports de src/lib/metricas.ts para RPCs.
 *
 * Precisam rodar no banco: com paginação, um cálculo no cliente veria só
 * a página atual e mostraria "recebido no mês" errado.
 */

import { supabase, exigir, lista, verificar } from '@/lib/supabase'
import { mapAlertas, mapKpis } from '@/lib/mappers'
import type { Alerta, Kpis } from '@/types'

/**
 * Recorte de período dos relatórios.
 *
 * Inclusivo nas duas pontas; `undefined` = sem limite. As RPCs aplicam o
 * fuso da loja — ver 20260730180000_reports_period.sql.
 */
export interface Periodo {
  de?: string
  ate?: string
}

/** As RPCs esperam `p_from`/`p_to`; omitir quando não há recorte. */
const args = (p: Periodo = {}) => ({
  ...(p.de && { p_from: p.de }),
  ...(p.ate && { p_to: p.ate }),
})

export async function obterKpis(): Promise<Kpis> {
  const data = exigir(await supabase.rpc('dashboard_kpis'))
  return mapKpis(data as never)
}

export async function obterAlertas(): Promise<Alerta[]> {
  const data = exigir(await supabase.rpc('dashboard_alerts'))
  return mapAlertas(data as never)
}

export interface SerieDia {
  dia: string
  atendimentos: number
  valor: number
}

export async function serieAtendimentos(dias = 14, periodo?: Periodo): Promise<SerieDia[]> {
  const data = lista(
    await supabase.rpc('report_daily_intake', { p_days: dias, ...args(periodo) }),
  )
  return data.map((r) => ({
    dia: new Date(`${r.day}T12:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    }),
    atendimentos: Number(r.orders),
    valor: Number(r.amount),
  }))
}

export interface SerieMes {
  mes: string
  recebido: number
  despesa: number
  pendente: number
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export async function serieFaturamento(meses = 12, periodo?: Periodo): Promise<SerieMes[]> {
  const data = lista(
    await supabase.rpc('report_monthly_finance', { p_months: meses, ...args(periodo) }),
  )
  return data.map((r) => ({
    mes: MESES[new Date(`${r.month}T12:00:00`).getMonth()],
    recebido: Number(r.received),
    despesa: Number(r.expense),
    pendente: Number(r.pending),
  }))
}

export interface PorCategoria {
  cat: string
  nome: string
  cor: string
  qtd: number
  valor: number
}

export async function porCategoria(periodo?: Periodo): Promise<PorCategoria[]> {
  const data = lista(await supabase.rpc('report_by_category', args(periodo)))
  return data.map((r) => ({
    cat: r.category_key,
    nome: r.label,
    cor: r.color,
    qtd: Number(r.orders),
    valor: Number(r.amount),
  }))
}

export interface TopServico {
  nome: string
  cat: string
  qtd: number
  valor: number
}

export async function topServicos(limite = 8, periodo?: Periodo): Promise<TopServico[]> {
  const data = lista(
    await supabase.rpc('report_top_services', { p_limit: limite, ...args(periodo) }),
  )
  return data.map((r) => ({
    nome: r.service_name,
    cat: r.category_key,
    qtd: Number(r.quantity),
    valor: Number(r.amount),
  }))
}

export interface PorResponsavel {
  nome: string
  qtd: number
  valor: number
  atrasadas: number
}

export async function porResponsavel(periodo?: Periodo): Promise<PorResponsavel[]> {
  const data = lista(await supabase.rpc('report_by_staff', args(periodo)))
  return data.map((r) => ({
    nome: r.staff_name,
    qtd: Number(r.orders),
    valor: Number(r.amount),
    atrasadas: Number(r.overdue),
  }))
}

export interface PorForma {
  forma: string
  label: string
  cor: string
  valor: number
}

export async function porFormaPagamento(periodo?: Periodo): Promise<PorForma[]> {
  const data = lista(await supabase.rpc('report_payment_methods', args(periodo)))
  return data
    .map((r) => ({
      forma: r.method_key,
      label: r.label,
      cor: r.color,
      valor: Number(r.amount),
    }))
    .filter((f) => f.valor > 0)
}

export interface PorStatus {
  status: string
  label: string
  qtd: number
  valor: number
}

export async function porStatus(periodo?: Periodo): Promise<PorStatus[]> {
  const data = lista(await supabase.rpc('report_by_status', args(periodo)))
  return data.map((r) => ({
    status: r.status_key,
    label: r.label,
    qtd: Number(r.orders),
    valor: Number(r.amount),
  }))
}

export async function tempoMedioExecucao(periodo?: Periodo): Promise<number> {
  const data = verificar(await supabase.rpc('report_avg_lead_time', args(periodo)))
  return Number(data ?? 0)
}
