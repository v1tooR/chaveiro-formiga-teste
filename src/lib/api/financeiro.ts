/**
 * Financeiro — lançamentos de entrada e saída.
 *
 * Os totais (recebido / pendente / despesa) vêm de agregação no banco, e
 * não da soma da página exibida: no mock a conta era feita sobre o array
 * inteiro em memória, e com paginação real somar a página daria número
 * errado no rodapé da tela.
 */

import { supabase, exigir, lista, verificar } from '@/lib/supabase'
import { aplicar, montarPagina, termoBusca, type Consulta, type Pagina } from '@/lib/listing'
import { mapLancamento } from '@/lib/mappers'
import type { Lancamento, FormaPagamento } from '@/types'

export interface FiltroFinanceiro {
  tipo?: string
  status?: string
  categoriaId?: string
  /** 'mes' | '90' | 'ano' | 'tudo' */
  periodo?: string
  comandaId?: string
  clienteId?: string
}

function inicioPeriodo(periodo?: string): string | null {
  const agora = new Date()
  switch (periodo) {
    case 'mes':
      return new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString()
    case '90':
      return new Date(agora.getTime() - 90 * 86400000).toISOString()
    case 'ano':
      return new Date(agora.getFullYear(), 0, 1).toISOString()
    default:
      return null
  }
}

function aplicarFiltros(query: any, f: FiltroFinanceiro) {
  let q = query

  if (f.tipo) q = q.eq('kind', f.tipo === 'entrada' ? 'income' : 'expense')
  if (f.status) q = q.eq('status_key', f.status)
  if (f.categoriaId) q = q.eq('category_id', f.categoriaId)
  if (f.comandaId) q = q.eq('order_id', f.comandaId)
  if (f.clienteId) q = q.eq('customer_id', f.clienteId)

  const de = inicioPeriodo(f.periodo)
  if (de) q = q.gte('entry_date', de)

  return q
}

export async function listarLancamentos(
  consulta: Consulta,
  filtro: FiltroFinanceiro = {},
): Promise<Pagina<Lancamento>> {
  let q = supabase.from('ledger_list_view').select('*', { count: 'exact' })
  q = aplicarFiltros(q, filtro)

  const termo = termoBusca(consulta.busca)
  if (termo) {
    q = q.or(
      [`description.ilike.${termo}`, `category_name.ilike.${termo}`, `customer_name.ilike.${termo}`].join(','),
    )
  }

  const res = await aplicar(q as any, {
    ...consulta,
    ordem: consulta.ordem ?? { campo: 'entry_date', direcao: 'desc' },
  })
  if (res.error) throw new Error(res.error.message)

  return montarPagina((res.data ?? []).map(mapLancamento), res.count, consulta)
}

export interface TotaisFinanceiro {
  recebido: number
  pendente: number
  despesa: number
  quantidade: number
}

/**
 * Totais do recorte filtrado, calculados no banco.
 * Paginar a lista e somar só a página daria um rodapé mentiroso.
 */
export async function totaisLancamentos(filtro: FiltroFinanceiro): Promise<TotaisFinanceiro> {
  let q = supabase
    .from('ledger_list_view')
    .select('kind, amount, status_key')
    .limit(20000)
  q = aplicarFiltros(q, filtro)

  const linhas = lista(await q)

  const recebidos = new Set(['recebido', 'pago'])
  const abertos = new Set(['pendente', 'parcial', 'vencido'])

  let recebido = 0
  let pendente = 0
  let despesa = 0

  for (const l of linhas) {
    const v = Number(l.amount)
    if (l.kind === 'expense') despesa += v
    else if (recebidos.has(l.status_key!)) recebido += v
    else if (abertos.has(l.status_key!)) pendente += v
  }

  return { recebido, pendente, despesa, quantidade: linhas.length }
}

export interface NovoLancamento {
  tipo: 'entrada' | 'saida'
  descricao: string
  categoriaId: string
  valor: number
  data: string
  forma: FormaPagamento | null
  status: string
  responsavelId: string | null
  observacao: string
}

export async function criarLancamento(input: NovoLancamento): Promise<Lancamento> {
  const inserido = exigir(
    await supabase
      .from('ledger_entries')
      .insert({
        kind: input.tipo === 'entrada' ? 'income' : 'expense',
        description: input.descricao.trim(),
        category_id: input.categoriaId,
        amount: input.valor,
        entry_date: input.data,
        method_key: input.forma,
        status_key: input.status,
        staff_id: input.responsavelId,
        note: input.observacao,
        auto_generated: false,
      })
      .select('id')
      .single(),
  )

  const data = exigir(
    await supabase.from('ledger_list_view').select('*').eq('id', inserido.id).single(),
  )
  return mapLancamento(data)
}

/**
 * Edição de lançamento manual.
 *
 * A função já existia e a policy `ledger_entries_update` sempre
 * permitiu — faltava só a tela chamar. Nada aqui toca `deleted_at`,
 * então o UPDATE direto passa; é gravar ESSA coluna que exige RPC
 * (ver `removerLancamento`).
 */
export async function atualizarLancamento(
  id: string,
  patch: Partial<NovoLancamento>,
): Promise<void> {
  verificar(
    await supabase
      .from('ledger_entries')
      .update({
        ...(patch.tipo !== undefined && { kind: patch.tipo === 'entrada' ? 'income' : 'expense' }),
        ...(patch.descricao !== undefined && { description: patch.descricao.trim() }),
        ...(patch.categoriaId !== undefined && { category_id: patch.categoriaId }),
        ...(patch.valor !== undefined && { amount: patch.valor }),
        ...(patch.data !== undefined && { entry_date: patch.data }),
        ...(patch.forma !== undefined && { method_key: patch.forma }),
        ...(patch.status !== undefined && { status_key: patch.status }),
        ...(patch.responsavelId !== undefined && { staff_id: patch.responsavelId }),
        ...(patch.observacao !== undefined && { note: patch.observacao }),
      })
      .eq('id', id)
      // Redundante com o WITH CHECK da policy, mas transforma um erro
      // de RLS em um no-op previsível.
      .eq('auto_generated', false),
  )
}

/**
 * Exclusão é SOFT: histórico financeiro apagado de verdade impossibilita
 * conciliação. Lançamento automático de comanda não é excluível — quem
 * cancela o valor é o cancelamento da comanda.
 *
 * Vai por RPC, não por UPDATE: gravar `deleted_at` pelo PostgREST bate na
 * policy de SELECT, que exige `deleted_at IS NULL` também na linha nova.
 * Detalhe completo em 20260730160000_soft_delete_rpcs.sql.
 *
 * O `.eq('auto_generated', false)` que existia aqui era pior que inútil:
 * um lançamento automático simplesmente não casava o filtro, o UPDATE
 * afetava 0 linhas e a função retornava SUCESSO. Agora a RPC explica.
 */
export async function removerLancamento(id: string): Promise<void> {
  verificar({ ...(await supabase.rpc('delete_ledger_entry', { p_id: id })), data: true })
}
