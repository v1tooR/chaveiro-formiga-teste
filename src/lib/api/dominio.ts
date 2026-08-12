/**
 * Catálogo de domínio: status, categorias, formas de pagamento, módulos,
 * equipe. Substitui os mapas constantes de src/lib/constants.ts.
 *
 * Carregado uma vez por sessão — são tabelas pequenas e estáveis, e
 * praticamente toda tela depende delas para renderizar badge e coluna.
 */

import { supabase, lista } from '@/lib/supabase'
import {
  mapCategoria,
  mapCategoriaLancamento,
  mapClienteStatus,
  mapForma,
  mapLancamentoStatus,
  mapMembro,
  mapModulo,
  mapStatus,
  mapTipoFoto,
} from '@/lib/mappers'
import type { Dominio } from '@/types'

export async function carregarDominio(): Promise<Dominio> {
  const [
    categorias,
    status,
    clienteStatus,
    lancamentoStatus,
    formas,
    categoriasLancamento,
    tiposFoto,
    canaisAprovacao,
    modulos,
    equipe,
  ] = await Promise.all([
    supabase.from('service_categories').select('*').order('sort_order'),
    supabase.from('order_statuses').select('*').order('sort_order'),
    supabase.from('customer_statuses').select('*').order('sort_order'),
    supabase.from('ledger_statuses').select('*').order('sort_order'),
    supabase.from('payment_methods').select('*').eq('active', true).order('sort_order'),
    supabase.from('ledger_categories').select('*').eq('active', true).order('sort_order'),
    supabase.from('photo_kinds').select('*').order('sort_order'),
    supabase.from('approval_channels').select('*').order('sort_order'),
    supabase.from('modules').select('*').order('sort_order'),
    supabase.from('staff').select('*').eq('active', true).order('sort_order'),
  ])

  return {
    categorias: lista(categorias).map(mapCategoria),
    status: lista(status).map(mapStatus),
    clienteStatus: lista(clienteStatus).map(mapClienteStatus),
    lancamentoStatus: lista(lancamentoStatus).map(mapLancamentoStatus),
    formas: lista(formas).map(mapForma),
    categoriasLancamento: lista(categoriasLancamento).map(mapCategoriaLancamento),
    tiposFoto: lista(tiposFoto).map(mapTipoFoto),
    canaisAprovacao: lista(canaisAprovacao).map((c) => ({ key: c.key, label: c.label })),
    modulos: lista(modulos).map(mapModulo),
    equipe: lista(equipe).map(mapMembro),
  }
}
