/**
 * Clientes — CRUD direto pelo client do Supabase.
 *
 * Não precisa de RPC: são operações de uma tabela só, e as regras (nome
 * mínimo, telefone só dígitos, whatsapp herdado, status derivado) já
 * estão em constraints e triggers.
 */

import { supabase, exigir, lista, verificar } from '@/lib/supabase'
import { aplicar, montarPagina, termoBusca, type Consulta, type Pagina } from '@/lib/listing'
import { mapCliente, mapClienteResumo } from '@/lib/mappers'
import type { Cliente } from '@/types'

/** Regra do card "Recorrentes": 3 ou mais serviços. */
export const MIN_SERVICOS_RECORRENTE = 3

export interface FiltroClientes {
  status?: string
  /**
   * Cliente com 3+ comandas, medido por `order_count`.
   *
   * NÃO é `status_key = 'recorrente'`. O trigger `recalc_customer_status`
   * avalia 'pendencia' antes de 'recorrente', então só seria recorrente
   * quem tem 3+ comandas E zero dívida — no banco de demonstração, 13
   * clientes têm 3+ comandas e NENHUM deles se qualifica. O KPI marcava
   * 0 e o filtro não retornava nada.
   *
   * Frequência e dívida são eixos ortogonais espremidos numa coluna só, e
   * pendência é o que a operação precisa ver primeiro no badge. Então a
   * recorrência passa a ser medida direto de `order_count`, que é o que o
   * próprio card sempre anunciou ("3 ou mais serviços").
   *
   * Por isso também não combina com `status`: um cliente com 5 comandas e
   * saldo aberto é `pendencia` E recorrente.
   */
  recorrente?: boolean
  /** 'recentes' | 'nome' | 'gasto' | 'pendente' | 'servicos' */
  ordem?: string
}

const ORDENACOES: Record<string, { campo: string; direcao: 'asc' | 'desc' }> = {
  recentes: { campo: 'created_at', direcao: 'desc' },
  nome: { campo: 'name', direcao: 'asc' },
  gasto: { campo: 'total_spent', direcao: 'desc' },
  pendente: { campo: 'pending_amount', direcao: 'desc' },
  servicos: { campo: 'order_count', direcao: 'desc' },
}

export async function listarClientes(
  consulta: Consulta,
  filtro: FiltroClientes = {},
): Promise<Pagina<Cliente>> {
  let q = supabase.from('customer_summary_view').select('*', { count: 'exact' })

  if (filtro.status) q = q.eq('status_key', filtro.status)
  if (filtro.recorrente) q = q.gte('order_count', MIN_SERVICOS_RECORRENTE)

  const termo = termoBusca(consulta.busca)
  if (termo) {
    q = q.or(
      [
        `name.ilike.${termo}`,
        `phone.ilike.${termo}`,
        `email.ilike.${termo}`,
        `city.ilike.${termo}`,
      ].join(','),
    )
  }

  const ordem = ORDENACOES[filtro.ordem ?? 'recentes'] ?? ORDENACOES.recentes
  const res = await aplicar(q as any, { ...consulta, ordem }, 'name')
  if (res.error) throw new Error(res.error.message)

  return montarPagina((res.data ?? []).map(mapClienteResumo), res.count, consulta)
}

/** Busca rápida do balcão (etapa 1 do atendimento). */
export async function buscarClientes(termo: string, limite = 8): Promise<Cliente[]> {
  const t = termoBusca(termo)

  let q = supabase.from('customers').select('*').order('created_at', { ascending: false })
  if (t) {
    q = q.or([`name.ilike.${t}`, `phone.ilike.${t}`, `whatsapp.ilike.${t}`, `email.ilike.${t}`].join(','))
  }

  return lista(await q.limit(limite)).map(mapCliente)
}

export async function obterCliente(id: string): Promise<Cliente | null> {
  const data = verificar(
    await supabase.from('customer_summary_view').select('*').eq('id', id).maybeSingle(),
  )
  return data ? mapClienteResumo(data) : null
}

export interface NovoCliente {
  nome: string
  telefone: string
  whatsapp?: string
  email?: string
  cidade?: string
  observacoes?: string
}

export async function criarCliente(input: NovoCliente): Promise<Cliente> {
  const data = exigir(
    await supabase
      .from('customers')
      .insert({
        name: input.nome.trim(),
        // A trigger normaliza, mas mandar já limpo evita erro de constraint
        // antes de chegar lá (a mensagem do CHECK é bem menos amigável).
        phone: input.telefone.replace(/\D/g, ''),
        whatsapp: (input.whatsapp || input.telefone).replace(/\D/g, ''),
        email: (input.email ?? '').trim(),
        city: input.cidade?.trim() || 'Formiga',
        notes: input.observacoes ?? '',
      })
      .select('*')
      .single(),
  )
  return mapCliente(data)
}

export async function atualizarCliente(
  id: string,
  patch: Partial<NovoCliente> & { status?: string },
): Promise<void> {
  verificar(
    await supabase
      .from('customers')
      .update({
        ...(patch.nome !== undefined && { name: patch.nome.trim() }),
        ...(patch.telefone !== undefined && { phone: patch.telefone.replace(/\D/g, '') }),
        ...(patch.whatsapp !== undefined && { whatsapp: patch.whatsapp.replace(/\D/g, '') }),
        ...(patch.email !== undefined && { email: patch.email.trim() }),
        ...(patch.cidade !== undefined && { city: patch.cidade.trim() || 'Formiga' }),
        ...(patch.observacoes !== undefined && { notes: patch.observacoes }),
        ...(patch.status !== undefined && { status_key: patch.status }),
      })
      .eq('id', id),
  )
}

/**
 * Tira o cliente do atendimento SEM perder o histórico.
 *
 * É o caminho normal para cliente com comandas. `bloqueado` já existe em
 * `customer_statuses` com `is_derived = false`, então o trigger
 * `recalc_customer_status` não sobrescreve na próxima comanda.
 */
export async function bloquearCliente(id: string, bloquear: boolean): Promise<void> {
  verificar(
    await supabase
      .from('customers')
      // 'ativo' é derivado: o trigger recalcula na primeira movimentação.
      .update({ status_key: bloquear ? 'bloqueado' : 'ativo' })
      .eq('id', id),
  )
}

/**
 * Exclusão de cadastro errado ou duplicado. SOFT, e só para cliente SEM
 * histórico — a RPC recusa quem tem comanda, porque `order_list_view` faz
 * INNER JOIN em `customers` e as comandas dele sumiriam das listagens.
 *
 * Para cliente com histórico, use `bloquearCliente`.
 */
export async function removerCliente(id: string): Promise<void> {
  verificar({ ...(await supabase.rpc('delete_customer', { p_id: id })), data: true })
}
