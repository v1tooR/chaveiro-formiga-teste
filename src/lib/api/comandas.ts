/**
 * Comandas — o módulo mais quente do sistema.
 *
 * Leituras vão pela `order_list_view` (cliente, responsável, atraso e
 * primeira foto já resolvidos). Escritas passam por RPC, porque cada uma
 * envolve mais de uma tabela e precisa ser atômica.
 */

import { supabase, exigir, lista, verificar } from '@/lib/supabase'
import { aplicar, montarPagina, termoBusca, type Consulta, type Pagina } from '@/lib/listing'
import { mapComanda, mapEvento, mapItem, mapPagamento } from '@/lib/mappers'
import { diasRestantes } from '@/lib/utils'
import type { Comanda, Foto, FormaPagamento, ItemComanda, Pagamento } from '@/types'

/**
 * Colunas da view + fotos embutidas.
 *
 * O embed custa ~25 ms e ~50% de payload a mais (medido: 51 ms vs 22 ms
 * numa página de 30). Vale a pena onde a tela mostra VÁRIAS fotos por
 * comanda — o card de "Últimos atendimentos" exibe 4, e a ficha do
 * cliente exibe a grade com aviso de "+N foto(s)".
 */
const SELECT_LISTA = '*, order_photos(*)'

/**
 * Kanban: só a primeira foto, que a própria view já achata em
 * `first_photo_*`. O card renderiza `c.fotos[0]` e nada mais, então
 * embutir todas as fotos de 400 comandas era payload jogado fora.
 */
const SELECT_KANBAN = '*'

export interface FiltroComandas {
  status?: string
  categoria?: string
  responsavelId?: string
  clienteId?: string
  /** 'com' | 'sem' */
  foto?: string
  /** 'pago' | 'pendente' */
  pagamento?: string
  /** Atalhos do dashboard: 'atrasadas' | 'abertas' | 'semfoto' | 'prontas' */
  rapido?: string
  /**
   * Prazo de abandono, em dias, vindo de `app_settings`. Só o filtro
   * `esquecidas` usa; sem ele (ou com 0) o filtro não aplica nada, que é
   * o certo — a loja desligou a regra.
   */
  diasParaAbandono?: number
  /** Etiquetas: 'pendentes' | 'impressas' */
  etiqueta?: string
  /** Só comandas ainda na operação (fila de etiquetas, Kanban). */
  apenasAtivas?: boolean
  criadaHoje?: boolean
  /**
   * Faixa de datas de abertura, inclusiva. Formato `YYYY-MM-DD`.
   *
   * Não existia: o único predicado de data era `criadaHoje`, e por isso o
   * seletor de Período em /relatorios não tinha para onde ir — ele não
   * chegava nem à API, quanto mais ao banco.
   */
  de?: string
  ate?: string
}

function aplicarFiltros(query: any, f: FiltroComandas) {
  let q = query

  if (f.status) q = q.eq('status_key', f.status)
  if (f.categoria) q = q.eq('category_key', f.categoria)
  if (f.responsavelId) q = q.eq('assigned_staff_id', f.responsavelId)
  if (f.clienteId) q = q.eq('customer_id', f.clienteId)

  if (f.foto === 'com') q = q.gt('photo_count', 0)
  if (f.foto === 'sem') q = q.eq('photo_count', 0)

  if (f.pagamento === 'pago') q = q.eq('is_settled', true)
  if (f.pagamento === 'pendente') q = q.eq('is_settled', false)

  if (f.rapido === 'atrasadas') q = q.eq('is_overdue', true)
  if (f.rapido === 'prontas') q = q.in('status_key', ['pronta', 'avisado'])
  if (f.rapido === 'abertas') q = q.not('status_key', 'in', '("entregue","cancelada")')
  if (f.rapido === 'semfoto') {
    q = q.eq('photo_count', 0).not('status_key', 'in', '("entregue","cancelada")')
  }
  // Peça pronta esquecida na prateleira. O prazo é da loja e chega em
  // `diasParaAbandono` — a view devolve os DIAS, não o veredito, para não
  // amarrar `order_list_view` a `app_settings`.
  if (f.rapido === 'esquecidas' && (f.diasParaAbandono ?? 0) > 0) {
    q = q.gte('days_ready', f.diasParaAbandono!)
  }

  if (f.etiqueta === 'pendentes') q = q.eq('label_printed', false)
  if (f.etiqueta === 'impressas') q = q.eq('label_printed', true)

  if (f.apenasAtivas) q = q.not('status_key', 'in', '("entregue","cancelada")')

  if (f.criadaHoje) {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    q = q.gte('created_at', hoje.toISOString())
  }

  // Inclusivo nas duas pontas: `ate` vira "< dia seguinte", senão o
  // último dia do recorte ficaria de fora.
  if (f.de) q = q.gte('created_at', `${f.de}T00:00:00`)
  if (f.ate) {
    const seguinte = new Date(`${f.ate}T00:00:00`)
    seguinte.setDate(seguinte.getDate() + 1)
    q = q.lt('created_at', seguinte.toISOString())
  }

  return q
}

export async function listarComandas(
  consulta: Consulta,
  filtro: FiltroComandas = {},
): Promise<Pagina<Comanda>> {
  // `count: 'exact'` fica. Medido em EXPLAIN ANALYZE: 1 ms. Trocar por
  // 'planned' daria número aproximado nas contagens ("121 comandas") e na
  // paginação, para economizar 1 ms — errado nas duas pontas.
  let q = supabase.from('order_list_view').select(SELECT_LISTA, { count: 'exact' })

  q = aplicarFiltros(q, filtro)

  const termo = termoBusca(consulta.busca)
  if (termo) {
    // Número da comanda, nome/telefone do cliente ou nome do serviço —
    // as mesmas quatro chaves que matchBusca() cobria no mock.
    const numero = (consulta.busca ?? '').replace(/\D/g, '')
    const partes = [
      `customer_name.ilike.${termo}`,
      `customer_phone.ilike.${termo}`,
      `service_name.ilike.${termo}`,
    ]
    if (numero) partes.push(`number.eq.${numero}`)
    q = q.or(partes.join(','))
  }

  const res = await aplicar(q as any, consulta, 'number')
  if (res.error) throw new Error(res.error.message)

  return montarPagina((res.data ?? []).map(mapComanda), res.count, consulta)
}

/** Kanban: carrega as colunas de uma vez, sem paginação por coluna. */
/**
 * Card do Kanban desde a migration 20260807100000: um por ITEM.
 *
 * Os nomes de campo repetem os de `Comanda` de propósito (`numero`,
 * `clienteNome`, `status`, `prazoEm`…). A Produção passou a arrastar item
 * em vez de comanda, e manter o mesmo vocabulário evitou reescrever a
 * tela inteira por causa de renomeação.
 */
export interface ItemProducao extends ItemComanda {
  numero: number
  clienteNome: string
  clienteTelefone: string
  observacoes: string
  atrasada: boolean
  diasRestantes: number
}

const SELECT_ITEM_KANBAN =
  '*, staff:assigned_staff_id(name), entregador:delivered_by(full_name),' +
  ' aprovador:approval_taken_by(full_name), order_photos(*),' +
  ' comanda:orders!inner(number, notes, deleted_at, customer:customers(name, phone))'

/**
 * Itens em produção. Substitui `listarProducao` no Kanban.
 *
 * Com uma chave pronta e um sapato em execução, esta consulta devolve
 * DOIS cards da mesma comanda, em colunas diferentes — que é exatamente o
 * que o quadro por comanda não conseguia mostrar.
 */
export async function listarItensProducao(filtro: FiltroComandas = {}): Promise<ItemProducao[]> {
  let q = supabase
    .from('order_items')
    .select(SELECT_ITEM_KANBAN)
    .is('comanda.deleted_at', null)
    // O Kanban mostra até `entregue`; só `cancelada` fica fora.
    .neq('status_key', 'cancelada')

  if (filtro.responsavelId) q = q.eq('assigned_staff_id', filtro.responsavelId)
  if (filtro.categoria) q = q.eq('category_key', filtro.categoria)
  if (filtro.clienteId) q = q.eq('comanda.customer_id', filtro.clienteId)

  const linhas = lista(await q.order('due_date', { ascending: true }).limit(600))

  return linhas.map((l) => {
    const r = l as never as Parameters<typeof mapItem>[0] & {
      comanda?: { number: number; notes: string; customer?: { name: string; phone: string } | null }
    }
    const base = mapItem(r)
    const dias = diasRestantes(base.prazoEm)
    return {
      ...base,
      numero: r.comanda?.number ?? 0,
      clienteNome: r.comanda?.customer?.name ?? '—',
      clienteTelefone: r.comanda?.customer?.phone ?? '',
      observacoes: r.comanda?.notes ?? '',
      // `is_overdue` da view é por comanda; aqui o prazo é do item.
      atrasada: dias < 0 && base.status !== 'entregue',
      diasRestantes: dias,
    }
  })
}

/**
 * Itens de várias comandas de uma vez. É o que a impressão de etiquetas
 * precisa: uma etiqueta por PEÇA, e a listagem de comandas não carrega os
 * itens (seriam N consultas por página).
 */
export async function listarItensDeComandas(ids: string[]): Promise<ItemComanda[]> {
  if (ids.length === 0) return []
  const r = await supabase
    .from('order_items')
    .select(SELECT_ITENS)
    .in('order_id', ids)
    .order('position')
  return lista(r).map((i) => mapItem(i as never))
}

export async function listarProducao(filtro: FiltroComandas = {}): Promise<Comanda[]> {
  let q = supabase.from('order_list_view').select(SELECT_KANBAN)
  q = aplicarFiltros(q, { ...filtro, apenasAtivas: false })
  // O Kanban mostra até `entregue`; só `cancelada` fica fora.
  q = q.neq('status_key', 'cancelada').order('due_date', { ascending: true }).limit(400)

  return lista(await q).map(mapComanda)
}

/**
 * Pagamentos de um cliente, um por linha.
 *
 * A ficha do cliente derivava isto de `orders.amount_paid` — uma linha
 * por comanda, com a data de CRIAÇÃO da comanda. Duas parcelas de R$ 320
 * apareciam como um pagamento de R$ 640 na data errada. O total batia
 * (vem de `customer_summary_view`), o detalhamento não.
 */
export async function listarPagamentosDoCliente(clienteId: string): Promise<
  (Pagamento & { comandaId: string; comandaNumero: number })[]
> {
  const linhas = lista(
    await supabase
      .from('order_payments')
      .select('*, staff:received_by_staff_id(name), orders!inner(id, number, customer_id)')
      .eq('orders.customer_id', clienteId)
      .order('paid_at', { ascending: false })
      .limit(500),
  )

  return linhas.map((r) => {
    const l = r as unknown as { orders: { id: string; number: number } }
    return {
      ...mapPagamento(r as never),
      comandaId: l.orders.id,
      comandaNumero: l.orders.number,
    }
  })
}

/** Detalhe completo: comanda + fotos + pagamentos + histórico. */
/** O select dos itens, com nome do executor, de quem entregou e as fotos. */
const SELECT_ITENS =
  '*, staff:assigned_staff_id(name), entregador:delivered_by(full_name),' +
  ' aprovador:approval_taken_by(full_name), order_photos(*)'

export async function obterComanda(id: string): Promise<Comanda | null> {
  const [base, itens, fotos, pagamentos, eventos] = await Promise.all([
    supabase.from('order_list_view').select('*').eq('id', id).maybeSingle(),
    supabase.from('order_items').select(SELECT_ITENS).eq('order_id', id).order('position'),
    supabase.from('order_photos').select('*').eq('order_id', id).order('created_at'),
    supabase
      .from('order_payments')
      .select('*, staff:received_by_staff_id(name)')
      .eq('order_id', id)
      .order('paid_at'),
    supabase.from('order_events').select('*').eq('order_id', id).order('created_at'),
  ])

  const linha = verificar(base)
  if (!linha) return null

  const comanda = mapComanda(linha)
  comanda.itens = lista(itens).map((i) => mapItem(i as never))
  comanda.fotos = lista(fotos).map((f) => ({
    id: f.id,
    tipo: f.kind,
    legenda: f.caption,
    seed: f.gradient_seed,
    storagePath: f.storage_path,
    criadoEm: f.created_at,
  }))
  comanda.fotosQtd = comanda.fotos.length
  comanda.pagamentos = lista(pagamentos).map((p) => mapPagamento(p as never))
  comanda.historico = lista(eventos).map(mapEvento)

  return comanda
}

/* ------------------------------------------------------------------ *
 * Escritas — todas por RPC
 * ------------------------------------------------------------------ */

/** Uma linha do atendimento: um serviço, uma peça, uma etiqueta. */
export interface NovoItem {
  servicoId: string
  categoria?: string
  quantidade: number
  valor: number
  responsavelId: string | null
  prazoEm?: string
  descricao?: string
}

export interface NovaComanda {
  clienteId: string
  /** Ao menos um. A RPC recusa lista vazia. */
  itens: NovoItem[]
  entrada: number
  forma: FormaPagamento | null
  prazoEm: string
  descricao: string
  observacoes: string
  fotos: Foto[]
}

export async function criarComanda(input: NovaComanda): Promise<Comanda> {
  const data = exigir(
    await supabase.rpc('create_order', {
      p_payload: {
        customer_id: input.clienteId,
        down_payment: input.entrada,
        down_payment_method_key: input.entrada > 0 ? input.forma : null,
        due_date: input.prazoEm,
        description: input.descricao,
        notes: input.observacoes,
        items: input.itens.map((i) => ({
          service_id: i.servicoId,
          category_key: i.categoria ?? null,
          quantity: i.quantidade,
          total_amount: i.valor,
          assigned_staff_id: i.responsavelId,
          due_date: i.prazoEm ?? null,
          description: i.descricao ?? '',
        })),
        photos: input.fotos.map((f) => ({
          kind: f.tipo,
          caption: f.legenda,
          storage_path: f.storagePath ?? null,
          gradient_seed: f.seed,
        })),
      } as never,
    }),
  )

  // A RPC devolve a linha de `orders`; recarregamos pela view para ter
  // nome do cliente, responsável e flag de atraso já resolvidos.
  const criada = await obterComanda((data as { id: string }).id)
  if (!criada) throw new Error('Comanda criada, mas não foi possível recarregá-la.')
  return criada
}

/**
 * Lastro da aprovação do orçamento. A RPC só exige ao SAIR de `aprovacao`
 * para um status de trabalho — sair para `cancelada` é o cliente
 * recusando e não pede nada.
 */
export interface DadosAprovacao {
  /** Quem aprovou — o CLIENTE, não o funcionário. */
  nome: string
  /** Chave de `approval_channels`: presencial, telefone, whatsapp, email. */
  canal: string
  /** Omitido = o valor atual do item. */
  valor?: number
}

/** Dados do ato da entrega. Só `entregue` os usa; os outros status ignoram. */
export interface DadosEntrega {
  /** Quem retirou. A RPC recusa a transição sem isto. */
  nome: string
  documento?: string
  observacao?: string
}

/**
 * Move UM item. É o caminho normal desde a migration 20260807100000: o
 * status da comanda passou a ser derivado do item menos adiantado, então
 * quem anda é o item.
 *
 * `alterarStatus` (abaixo) continua existindo para ação de comanda
 * inteira — cancelar, pausar, ou o caso de um item só.
 */
export async function alterarStatusItem(
  itemId: string,
  status: string,
  entrega?: DadosEntrega,
  aprovacao?: DadosAprovacao,
): Promise<void> {
  verificar(
    await supabase.rpc('change_order_item_status', {
      p_item_id: itemId,
      p_status_key: status,
      ...(entrega && {
        p_delivery: {
          delivered_to_name: entrega.nome,
          delivered_to_document: entrega.documento ?? '',
          delivery_note: entrega.observacao ?? '',
        },
      }),
      ...(aprovacao && {
        p_approval: {
          approved_by_name: aprovacao.nome,
          approval_channel_key: aprovacao.canal,
          ...(aprovacao.valor !== undefined && { approved_amount: aprovacao.valor }),
        },
      }),
    }),
  )
}

/**
 * Abre a comanda de retrabalho de um item já entregue.
 *
 * Não passa por `criarComanda`: retrabalho não tem entrada, não escolhe
 * serviço (é o mesmo) e por padrão não tem valor. Devolve a comanda nova,
 * já vinculada ao item de origem.
 */
export async function abrirRetrabalho(
  itemId: string,
  motivo: string,
  valor = 0,
): Promise<Comanda> {
  const data = exigir(
    await supabase.rpc('create_rework', {
      p_item_id: itemId,
      p_payload: { reason: motivo, total_amount: valor } as never,
    }),
  )
  const nova = await obterComanda((data as { id: string }).id)
  if (!nova) throw new Error('Retrabalho criado, mas não foi possível recarregá-lo.')
  return nova
}

/** Aplica o status a TODOS os itens ainda abertos da comanda. */
export async function alterarStatus(
  id: string,
  status: string,
  entrega?: DadosEntrega,
  aprovacao?: DadosAprovacao,
): Promise<void> {
  verificar(
    await supabase.rpc('change_order_status', {
      p_order_id: id,
      p_status_key: status,
      // Sem entrega o argumento nem vai — o DEFAULT NULL da RPC cobre.
      ...(entrega && {
        p_delivery: {
          delivered_to_name: entrega.nome,
          delivered_to_document: entrega.documento ?? '',
          delivery_note: entrega.observacao ?? '',
        },
      }),
      ...(aprovacao && {
        p_approval: {
          approved_by_name: aprovacao.nome,
          approval_channel_key: aprovacao.canal,
          ...(aprovacao.valor !== undefined && { approved_amount: aprovacao.valor }),
        },
      }),
    }),
  )
}

export async function atualizarComanda(
  id: string,
  patch: {
    descricao?: string
    observacoes?: string
    quantidade?: number
    valor?: number
    prazoEm?: string
    responsavelId?: string | null
    /** Reescreve `service_name` e `category_key` a partir do catálogo. */
    servicoId?: string | null
    clienteId?: string
    categoria?: string
  },
  evento?: string,
): Promise<void> {
  verificar(
    await supabase.rpc('update_order', {
      p_order_id: id,
      p_patch: {
        ...(patch.descricao !== undefined && { description: patch.descricao }),
        ...(patch.observacoes !== undefined && { notes: patch.observacoes }),
        ...(patch.quantidade !== undefined && { quantity: patch.quantidade }),
        ...(patch.valor !== undefined && { total_amount: patch.valor }),
        ...(patch.prazoEm !== undefined && { due_date: patch.prazoEm }),
        ...(patch.responsavelId !== undefined && { assigned_staff_id: patch.responsavelId }),
        ...(patch.servicoId !== undefined && { service_id: patch.servicoId }),
        ...(patch.clienteId !== undefined && { customer_id: patch.clienteId }),
        ...(patch.categoria !== undefined && { category_key: patch.categoria }),
      } as never,
      p_event_title: evento ?? undefined,
    }),
  )
}

export interface Recibo {
  payment_id: string
  applied_amount: number
  order_id: string
  order_number: number
  amount_paid: number
  balance: number
  is_settled: boolean
  paid_at: string
}

export async function registrarPagamento(
  comandaId: string,
  valor: number,
  forma: FormaPagamento,
  observacao = '',
): Promise<Recibo> {
  const data = exigir(
    await supabase.rpc('register_order_payment', {
      p_order_id: comandaId,
      p_amount: valor,
      p_method_key: forma,
      p_note: observacao,
    }),
  )
  return data as unknown as Recibo
}

export async function marcarComandaImpressa(id: string): Promise<void> {
  verificar(await supabase.rpc('mark_order_printed', { p_order_id: id }))
}

/** Retorna quantas etiquetas foram efetivamente marcadas (regra 24). */
export async function marcarEtiquetasImpressas(ids: string[]): Promise<number> {
  const data = verificar(await supabase.rpc('mark_labels_printed', { p_order_ids: ids }))
  return Number(data ?? 0)
}
