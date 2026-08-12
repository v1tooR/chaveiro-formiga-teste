/**
 * Catálogo de serviços — CRUD direto + RPC só para duplicar (que precisa
 * resolver colisão de nome no servidor).
 */

import { supabase, exigir, lista, verificar } from '@/lib/supabase'
import { mapServico } from '@/lib/mappers'
import type { Membro, Servico } from '@/types'

const SELECT = '*, staff:default_staff_id(name)'

/**
 * Recorte do catálogo por situação de arquivamento.
 *
 * Substitui o antigo `incluirArquivados: boolean`, que só sabia
 * INCLUIR — nunca havia um `eq('active', false)`. Com o flag ligado
 * nenhum predicado era aplicado e o chip "Arquivados" listava o catálogo
 * inteiro (35 ativos + 2 arquivados = 37, exatamente o que o QA viu).
 * O rótulo prometia recorte exclusivo; o código fazia união.
 */
export type ArquivoServicos = 'ativos' | 'arquivados' | 'todos'

export interface FiltroServicos {
  categoria?: string
  /** Padrão: 'ativos'. */
  arquivo?: ArquivoServicos
  busca?: string
}

/**
 * O catálogo é pequeno (dezenas de itens) e o atendimento precisa dele
 * inteiro para montar a grade de escolha, então não é paginado.
 */
export async function listarServicos(filtro: FiltroServicos = {}): Promise<Servico[]> {
  let q = supabase.from('services').select(SELECT)

  const arquivo = filtro.arquivo ?? 'ativos'
  if (arquivo === 'ativos') q = q.eq('active', true)
  else if (arquivo === 'arquivados') q = q.eq('active', false)

  if (filtro.categoria) q = q.eq('category_key', filtro.categoria)

  const busca = (filtro.busca ?? '').trim()
  if (busca.length >= 2) {
    const t = `%${busca.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    q = q.or([`name.ilike.${t}`, `description.ilike.${t}`].join(','))
  }

  return lista(await q.order('name').limit(500)).map((r) => mapServico(r as never))
}

/** Volume de uso por serviço — alimenta o ranking da tela Serviços. */
export async function contarUsoServicos(): Promise<Map<string, number>> {
  const data = lista(
    await supabase
      .from('orders')
      .select('service_id')
      .neq('status_key', 'cancelada')
      .not('service_id', 'is', null)
      .limit(10000),
  )

  const mapa = new Map<string, number>()
  for (const r of data) {
    if (r.service_id) mapa.set(r.service_id, (mapa.get(r.service_id) ?? 0) + 1)
  }
  return mapa
}

export interface NovoServico {
  nome: string
  categoria: string
  descricao: string
  precoBase: number
  prazoDias: number
  responsavelPadraoId: string | null
  ativo: boolean
  observacoes: string
  /** Dias de garantia; 0 = sem garantia. Vira instantâneo no item vendido. */
  garantiaDias: number
}

export async function criarServico(input: NovoServico, equipe: Membro[]): Promise<Servico> {
  const data = exigir(
    await supabase
      .from('services')
      .insert({
        name: input.nome.trim(),
        category_key: input.categoria,
        description: input.descricao,
        base_price: input.precoBase,
        lead_time_days: input.prazoDias,
        warranty_days: input.garantiaDias,
        default_staff_id: input.responsavelPadraoId,
        active: input.ativo,
        notes: input.observacoes,
      })
      .select(SELECT)
      .single(),
  )
  return mapServico(data as never, equipe)
}

export async function atualizarServico(
  id: string,
  patch: Partial<NovoServico>,
): Promise<void> {
  verificar(
    await supabase
      .from('services')
      .update({
        ...(patch.nome !== undefined && { name: patch.nome.trim() }),
        ...(patch.categoria !== undefined && { category_key: patch.categoria }),
        ...(patch.descricao !== undefined && { description: patch.descricao }),
        ...(patch.precoBase !== undefined && { base_price: patch.precoBase }),
        ...(patch.prazoDias !== undefined && { lead_time_days: patch.prazoDias }),
        ...(patch.garantiaDias !== undefined && { warranty_days: patch.garantiaDias }),
        ...(patch.responsavelPadraoId !== undefined && {
          default_staff_id: patch.responsavelPadraoId,
        }),
        ...(patch.ativo !== undefined && { active: patch.ativo }),
        ...(patch.observacoes !== undefined && { notes: patch.observacoes }),
      })
      .eq('id', id),
  )
}

export async function duplicarServico(id: string, equipe: Membro[]): Promise<Servico> {
  const data = exigir(await supabase.rpc('duplicate_service', { p_service_id: id }))
  return mapServico(data as never, equipe)
}

/** Arquivar / reativar — o front nunca exclui serviço (comandas o referenciam). */
export async function alternarArquivamento(id: string, ativo: boolean): Promise<void> {
  verificar(await supabase.from('services').update({ active: ativo }).eq('id', id))
}
