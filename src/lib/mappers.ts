/**
 * Tradução banco → front.
 *
 * O banco é inglês/snake_case (exigência do projeto); as telas já falam
 * português. Toda a conversão fica concentrada aqui, então nenhuma tela
 * precisa conhecer o nome real das colunas.
 */

import type { Database } from '@/types/database'
import type {
  Alerta,
  CategoriaLancamento,
  CategoriaMeta,
  Cliente,
  ClienteStatusMeta,
  Comanda,
  Config,
  Dominio,
  Foto,
  FormaMeta,
  FotoTipoMeta,
  HistoricoEvento,
  IntegracaoStatus,
  ItemComanda,
  Kpis,
  Lancamento,
  LancamentoStatusMeta,
  Membro,
  Modulo,
  ModuloId,
  Pagamento,
  Perfil,
  PapelId,
  Servico,
  StatusMeta,
} from '@/types'
import { iniciais } from './utils'

type Tables = Database['public']['Tables']
type Views = Database['public']['Views']

/* ------------------------------------------------------------------ *
 * Domínio
 * ------------------------------------------------------------------ */

export const mapCategoria = (r: Tables['service_categories']['Row']): CategoriaMeta => ({
  key: r.key,
  label: r.label,
  icon: r.icon,
  cor: r.color,
  bg: r.bg_color,
  ordem: r.sort_order,
})

export const mapStatus = (r: Tables['order_statuses']['Row']): StatusMeta => ({
  key: r.key,
  label: r.label,
  descricao: r.description,
  cor: r.color,
  bg: r.bg_color,
  borda: r.border_color,
  kanban: r.in_kanban,
  aberto: r.is_open,
  final: r.is_final,
  ordem: r.sort_order,
})

export const mapClienteStatus = (r: Tables['customer_statuses']['Row']): ClienteStatusMeta => ({
  key: r.key,
  label: r.label,
  cor: r.color,
  bg: r.bg_color,
  derivado: r.is_derived,
})

export const mapLancamentoStatus = (
  r: Tables['ledger_statuses']['Row'],
): LancamentoStatusMeta => ({
  key: r.key,
  label: r.label,
  cor: r.color,
  bg: r.bg_color,
  recebido: r.counts_as_received,
  aberto: r.counts_as_open,
})

export const mapForma = (r: Tables['payment_methods']['Row']): FormaMeta => ({
  key: r.key,
  label: r.label,
  icon: r.icon,
  cor: r.color,
})

export const mapCategoriaLancamento = (
  r: Tables['ledger_categories']['Row'],
): CategoriaLancamento => ({
  id: r.id,
  nome: r.name,
  tipo: r.kind === 'income' ? 'entrada' : 'saida',
  sistema: r.is_system,
})

export const mapTipoFoto = (r: Tables['photo_kinds']['Row']): FotoTipoMeta => ({
  key: r.key,
  label: r.label,
  legendaPadrao: r.default_caption,
})

export const mapModulo = (r: Tables['modules']['Row']): Modulo => ({
  key: r.key as ModuloId,
  label: r.label,
  rota: r.route,
  grupo: r.nav_group as Modulo['grupo'],
  ordem: r.sort_order,
})

export const mapMembro = (r: Tables['staff']['Row']): Membro => ({
  id: r.id,
  nome: r.name,
  iniciais: r.initials || iniciais(r.name),
  cargo: r.job_title,
  executa: r.can_execute,
  ativo: r.active,
})

/* ------------------------------------------------------------------ *
 * Perfil e permissões
 * ------------------------------------------------------------------ */

export function mapPerfil(
  p: Tables['profiles']['Row'],
  papel: Tables['roles']['Row'],
  permissoes: Tables['role_modules']['Row'][],
  membro: Tables['staff']['Row'] | null,
): Perfil {
  return {
    id: p.id,
    nome: p.full_name,
    email: p.email ?? '',
    papel: p.role_key as PapelId,
    papelLabel: papel.label,
    cargo: membro?.job_title || papel.label,
    iniciais: membro?.initials || iniciais(p.full_name),
    membroId: p.staff_id,
    ativo: p.is_active,
    modulos: permissoes.filter((x) => x.can_read).map((x) => x.module_key as ModuloId),
    escrita: permissoes.filter((x) => x.can_write).map((x) => x.module_key as ModuloId),
  }
}

/* ------------------------------------------------------------------ *
 * Configuração
 * ------------------------------------------------------------------ */

export const mapConfig = (r: Tables['app_settings']['Row']): Config => ({
  empresa: {
    nome: r.company_name,
    telefone: r.company_phone,
    endereco: r.company_address,
    horario: r.company_hours,
    responsavel: r.company_owner,
  },
  comandas: {
    proximoNumero: r.order_next_number,
    prefixo: r.order_prefix,
    mostrarObservacoes: r.order_show_notes,
    mostrarFoto: r.order_show_photo,
    rodape: r.order_footer_text,
  },
  etiquetas: {
    tamanhoPadrao: r.label_default_size as Config['etiquetas']['tamanhoPadrao'],
    porFolha: r.labels_per_sheet,
    mostrarQr: r.label_show_qr,
    mostrarResponsavel: r.label_show_staff,
  },
  operacao: {
    exigirFotoRecebimento: r.require_photo_on_intake,
    exigirFotoEntrega: r.require_photo_on_delivery,
    diasParaAbandono: r.abandoned_after_days,
  },
})

export const configParaBanco = (c: Partial<Config>): Tables['app_settings']['Update'] => ({
  ...(c.empresa && {
    company_name: c.empresa.nome,
    company_phone: c.empresa.telefone,
    company_address: c.empresa.endereco,
    company_hours: c.empresa.horario,
    company_owner: c.empresa.responsavel,
  }),
  ...(c.comandas && {
    order_next_number: c.comandas.proximoNumero,
    order_prefix: c.comandas.prefixo,
    order_show_notes: c.comandas.mostrarObservacoes,
    order_show_photo: c.comandas.mostrarFoto,
    order_footer_text: c.comandas.rodape,
  }),
  ...(c.etiquetas && {
    label_default_size: c.etiquetas.tamanhoPadrao,
    labels_per_sheet: c.etiquetas.porFolha,
    label_show_qr: c.etiquetas.mostrarQr,
    label_show_staff: c.etiquetas.mostrarResponsavel,
  }),
  ...(c.operacao && {
    require_photo_on_intake: c.operacao.exigirFotoRecebimento,
    require_photo_on_delivery: c.operacao.exigirFotoEntrega,
    abandoned_after_days: c.operacao.diasParaAbandono,
  }),
})

/* ------------------------------------------------------------------ *
 * Cliente
 * ------------------------------------------------------------------ */

export const mapCliente = (r: Tables['customers']['Row']): Cliente => ({
  id: r.id,
  nome: r.name,
  telefone: r.phone,
  whatsapp: r.whatsapp,
  email: r.email,
  cidade: r.city,
  cadastroEm: r.created_at,
  status: r.status_key,
  observacoes: r.notes,
})

export const mapClienteResumo = (r: Views['customer_summary_view']['Row']): Cliente => ({
  id: r.id!,
  nome: r.name!,
  telefone: r.phone!,
  whatsapp: r.whatsapp!,
  email: r.email!,
  cidade: r.city!,
  cadastroEm: r.created_at!,
  status: r.status_key!,
  observacoes: r.notes!,
  qtdComandas: Number(r.order_count ?? 0),
  totalGasto: Number(r.total_spent ?? 0),
  pendente: Number(r.pending_amount ?? 0),
  ultimaComandaEm: r.last_order_at,
  ultimoServico: r.last_service_name,
})

/* ------------------------------------------------------------------ *
 * Serviço
 * ------------------------------------------------------------------ */

export const mapServico = (
  r: Tables['services']['Row'] & { staff?: { name: string } | null },
  equipe?: Membro[],
): Servico => ({
  id: r.id,
  nome: r.name,
  categoria: r.category_key,
  descricao: r.description,
  precoBase: Number(r.base_price),
  prazoDias: r.lead_time_days,
  garantiaDias: r.warranty_days ?? 0,
  responsavelPadraoId: r.default_staff_id,
  responsavelPadrao:
    r.staff?.name ?? equipe?.find((m) => m.id === r.default_staff_id)?.nome ?? '—',
  ativo: r.active,
  observacoes: r.notes,
})

/* ------------------------------------------------------------------ *
 * Comanda
 * ------------------------------------------------------------------ */

export const mapFoto = (r: Tables['order_photos']['Row']): Foto => ({
  id: r.id,
  tipo: r.kind,
  legenda: r.caption,
  seed: r.gradient_seed,
  storagePath: r.storage_path,
  criadoEm: r.created_at,
})

/**
 * Item da comanda. `staff` e `profile` vêm do select embutido — o nome de
 * quem executa e de quem entregou não moram na tabela.
 */
export const mapItem = (
  r: Tables['order_items']['Row'] & {
    staff?: { name: string } | null
    entregador?: { full_name: string } | null
    aprovador?: { full_name: string } | null
    order_photos?: Tables['order_photos']['Row'][] | null
  },
): ItemComanda => ({
  id: r.id,
  comandaId: r.order_id,
  posicao: r.position,
  categoria: r.category_key,
  servicoId: r.service_id,
  servicoNome: r.service_name,
  descricao: r.description ?? '',
  quantidade: r.quantity,
  valor: Number(r.total_amount),
  prazoEm: r.due_date,
  responsavel: r.staff?.name ?? '—',
  responsavelId: r.assigned_staff_id,
  status: r.status_key,

  entregueEm: r.delivered_at,
  entreguePara: r.delivered_to_name ?? '',
  entregueDocumento: r.delivered_to_document ?? '',
  entregaObservacao: r.delivery_note ?? '',
  entreguePorNome: r.entregador?.full_name ?? null,

  aprovadoEm: r.approved_at,
  aprovadoPor: r.approved_by_name ?? '',
  valorAprovado: r.approved_amount === null ? null : Number(r.approved_amount),
  canalAprovacao: r.approval_channel_key,
  aprovacaoPorNome: r.aprovador?.full_name ?? null,

  garantiaDias: r.warranty_days ?? 0,
  itemOrigemId: r.parent_item_id,
  retrabalho: !!r.is_rework,

  etiquetaImpressa: !!r.label_printed,
  fotos: (r.order_photos ?? []).map(mapFoto),
})

export const mapPagamento = (
  r: Tables['order_payments']['Row'] & { staff?: { name: string } | null },
): Pagamento => ({
  id: r.id,
  em: r.paid_at,
  valor: Number(r.amount),
  forma: r.method_key,
  responsavel: r.staff?.name ?? '—',
  observacao: r.note,
})

export const mapEvento = (r: Tables['order_events']['Row']): HistoricoEvento => ({
  id: r.id,
  em: r.created_at,
  autor: r.actor_name,
  titulo: r.title,
  detalhe: r.detail ?? undefined,
})

/** Linha de order_list_view, com as fotos embutidas pelo select. */
type LinhaComanda = Views['order_list_view']['Row'] & {
  order_photos?: Tables['order_photos']['Row'][] | null
}

export function mapComanda(r: LinhaComanda): Comanda {
  const fotos = (r.order_photos ?? []).map(mapFoto)

  return {
    id: r.id!,
    numero: r.number!,
    clienteId: r.customer_id!,
    clienteNome: r.customer_name ?? '—',
    clienteTelefone: r.customer_phone ?? '',
    clienteWhatsapp: r.customer_whatsapp ?? '',
    categoria: r.category_key!,
    servicoId: r.service_id,
    servicoNome: r.service_name!,
    descricao: r.description ?? '',
    quantidade: r.quantity!,
    criadaEm: r.created_at!,
    prazoEm: r.due_date!,
    valor: Number(r.total_amount),
    entrada: Number(r.down_payment),
    formaPagamento: r.down_payment_method_key,
    responsavel: r.assigned_staff_name ?? '—',
    responsavelId: r.assigned_staff_id,
    status: r.status_key!,
    observacoes: r.notes ?? '',

    // Vêm calculados do banco — nunca recalculados no cliente.
    pago: Number(r.amount_paid),
    saldoAberto: Number(r.balance),
    quitada: !!r.is_settled,
    atrasada: !!r.is_overdue,
    diasRestantes: Number(r.days_remaining ?? 0),

    // A view devolve a contagem; as fotos só vêm quando o select as pede.
    fotos: fotos.length ? fotos : primeiraFoto(r),
    fotosQtd: Number(r.photo_count ?? 0),

    // Preenchidos apenas na consulta de detalhe.
    pagamentos: [],
    historico: [],

    // Preenchidos por obterComanda/listarProducao; a listagem não os pede.
    itens: [],

    etiquetaImpressa: !!r.label_printed,
    comandaImpressa: !!r.order_printed,
    entregueEm: r.delivered_at,

    entreguePara: r.delivered_to_name ?? '',
    entregueDocumento: r.delivered_to_document ?? '',
    entregaObservacao: r.delivery_note ?? '',
    entreguePorNome: r.delivered_by_name,

    prontaEm: r.ready_at,
    diasNaPrateleira: r.days_ready,
  }
}

/**
 * A view traz a primeira foto em colunas achatadas — o suficiente para o
 * card do Kanban e a miniatura da lista, sem um segundo round-trip.
 */
function primeiraFoto(r: LinhaComanda): Foto[] {
  if (!r.first_photo_id) return []
  return [
    {
      id: r.first_photo_id,
      tipo: r.first_photo_kind ?? 'antes',
      legenda: r.first_photo_caption ?? '',
      seed: r.first_photo_seed ?? '',
      storagePath: r.first_photo_path,
      criadoEm: r.created_at!,
    },
  ]
}

/* ------------------------------------------------------------------ *
 * Lançamento
 * ------------------------------------------------------------------ */

export const mapLancamento = (r: Views['ledger_list_view']['Row']): Lancamento => ({
  id: r.id!,
  tipo: r.kind === 'income' ? 'entrada' : 'saida',
  descricao: r.description!,
  comandaId: r.order_id,
  comandaNumero: r.order_number,
  clienteId: r.customer_id,
  clienteNome: r.customer_name ?? '',
  categoriaId: r.category_id!,
  categoria: r.category_name!,
  valor: Number(r.amount),
  data: r.entry_date!,
  forma: r.method_key,
  responsavel: r.staff_name ?? '—',
  responsavelId: r.staff_id,
  status: r.status_key!,
  observacao: r.note ?? '',
  automatico: !!r.auto_generated,
})

/* ------------------------------------------------------------------ *
 * Integrações
 * ------------------------------------------------------------------ */

export const mapIntegracao = (r: Views['integration_status']['Row']): IntegracaoStatus => ({
  key: r.key!,
  nome: r.name!,
  tipo: r.kind as IntegracaoStatus['tipo'],
  habilitada: !!r.enabled,
  ultimoStatus: r.last_status,
  verificadaEm: r.last_checked_at,
})

/* ------------------------------------------------------------------ *
 * Métricas
 * ------------------------------------------------------------------ */

interface KpisRpc {
  orders_today: number
  open_orders: number
  in_progress: number
  ready: number
  overdue: number
  received_today: number | null
  received_month: number | null
  pending_amount: number | null
  average_ticket: number | null
  delivered_unpaid: number
  can_read_finance: boolean
}

/** Preserva o null: a tela precisa distinguir "zero" de "sem acesso". */
const dinheiro = (v: number | null) => (v === null ? null : Number(v))

export const mapKpis = (r: KpisRpc): Kpis => ({
  atendimentosHoje: Number(r.orders_today ?? 0),
  comandasAbertas: Number(r.open_orders ?? 0),
  emExecucao: Number(r.in_progress ?? 0),
  prontos: Number(r.ready ?? 0),
  atrasados: Number(r.overdue ?? 0),
  entreguesSemPagamento: Number(r.delivered_unpaid ?? 0),
  // `?? 0` aqui apagaria a correção da 20260730150000: o banco manda NULL
  // para quem não vê o financeiro, e zero seria uma afirmação falsa.
  recebidoHoje: dinheiro(r.received_today),
  recebidoMes: dinheiro(r.received_month),
  pendente: dinheiro(r.pending_amount),
  ticketMedio: dinheiro(r.average_ticket),
  veFinanceiro: !!r.can_read_finance,
})

export const kpisVazios = (): Kpis => ({
  atendimentosHoje: 0,
  comandasAbertas: 0,
  emExecucao: 0,
  prontos: 0,
  atrasados: 0,
  entreguesSemPagamento: 0,
  recebidoHoje: null,
  recebidoMes: null,
  pendente: null,
  ticketMedio: null,
  veFinanceiro: false,
})

interface AmostraComanda {
  id: string
  number: number
  customer_name: string
  service_name: string
}

interface AlertasRpc {
  overdue: { count: number; sample: AmostraComanda[] }
  to_notify: { count: number; sample: AmostraComanda[] }
  without_photo: { count: number; sample: AmostraComanda[] }
  /**
   * Bloco 6. `days` é o prazo configurado e `oldest` a maior espera, os
   * dois em dias. Vem sempre, mas com `count: 0` quando
   * `abandoned_after_days` é 0 — a loja desligou o alerta.
   */
  abandoned: {
    count: number
    days: number
    oldest: number | null
    sample: (AmostraComanda & { days_ready: number })[]
  }
  due_soon: number
  awaiting_payment: { count: number; amount: number }
  ready: number
  missing_label: number
  no_due_date: number
}

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Port de gerarAlertas() — mesma ordem e mesmos textos do mock. */
export function mapAlertas(r: AlertasRpc): Alerta[] {
  const out: Alerta[] = []
  const amostra = (l: AmostraComanda[]) =>
    l.slice(0, 2).map((c) => `${c.customer_name} · ${c.service_name}`).join(' · ')

  if (r.overdue?.count) {
    const n = r.overdue.count
    out.push({
      id: 'atrasadas',
      prioridade: 'alta',
      icone: 'atraso',
      titulo: `${n} ${n === 1 ? 'serviço está atrasado' : 'serviços estão atrasados'}`,
      detalhe: amostra(r.overdue.sample ?? []),
      acaoLabel: 'Ver atrasados',
      to: '/comandas?filtro=atrasadas',
      qtd: n,
    })
  }

  if (r.to_notify?.count) {
    const n = r.to_notify.count
    out.push({
      id: 'avisar',
      prioridade: 'alta',
      icone: 'aviso',
      titulo: `${n} ${n === 1 ? 'cliente precisa' : 'clientes precisam'} ser avisado${n === 1 ? '' : 's'}`,
      detalhe: 'Serviço pronto e o cliente ainda não foi comunicado.',
      acaoLabel: 'Avisar clientes',
      to: '/comandas?filtro=prontas',
      qtd: n,
    })
  }

  if (r.awaiting_payment?.count) {
    out.push({
      id: 'pagamento',
      prioridade: 'alta',
      icone: 'pagamento',
      titulo: `${r.awaiting_payment.count} comandas aguardam pagamento`,
      detalhe: `Total pendente de ${brl(Number(r.awaiting_payment.amount ?? 0))}.`,
      acaoLabel: 'Abrir financeiro',
      to: '/financeiro?filtro=pendente',
      qtd: r.awaiting_payment.count,
    })
  }

  // Antes de "sem foto": uma peça parada há meses é o problema mais caro
  // da lista — ocupa prateleira, segura dinheiro e tem peso legal.
  if (r.abandoned?.count) {
    const n = r.abandoned.count
    const maior = r.abandoned.oldest
    out.push({
      id: 'esquecidas',
      prioridade: 'alta',
      icone: 'aviso',
      titulo: `${n} ${n === 1 ? 'peça pronta não foi retirada' : 'peças prontas não foram retiradas'}`,
      detalhe:
        `Na prateleira há mais de ${r.abandoned.days} dias` +
        (maior ? ` — a mais antiga faz ${maior}.` : '.'),
      acaoLabel: 'Ver esquecidas',
      to: '/comandas?filtro=esquecidas',
      qtd: n,
    })
  }

  if (r.without_photo?.count) {
    const n = r.without_photo.count
    out.push({
      id: 'semfoto',
      prioridade: 'media',
      icone: 'foto',
      titulo: `${n} ${n === 1 ? 'comanda está' : 'comandas estão'} sem foto`,
      detalhe: 'Registre o item recebido para evitar divergência na entrega.',
      acaoLabel: 'Ver comandas',
      to: '/comandas?filtro=semfoto',
      qtd: n,
    })
  }

  if (r.due_soon) {
    out.push({
      id: 'prazo',
      prioridade: 'media',
      icone: 'prazo',
      titulo: `${r.due_soon} ${r.due_soon === 1 ? 'serviço vence' : 'serviços vencem'} até amanhã`,
      detalhe: 'Priorize na produção para não estourar o prazo.',
      acaoLabel: 'Abrir produção',
      to: '/producao',
      qtd: r.due_soon,
    })
  }

  if (r.ready) {
    out.push({
      id: 'prontos',
      prioridade: 'baixa',
      icone: 'pronto',
      titulo: `${r.ready} itens prontos para retirada`,
      detalhe: 'Confira a prateleira de saída e organize por etiqueta.',
      acaoLabel: 'Ver prontos',
      to: '/comandas?filtro=prontas',
      qtd: r.ready,
    })
  }

  if (r.missing_label) {
    out.push({
      id: 'etiqueta',
      prioridade: 'baixa',
      icone: 'etiqueta',
      titulo: `${r.missing_label} etiquetas precisam ser impressas`,
      detalhe: 'Imprima em lote para identificar as peças na bancada.',
      acaoLabel: 'Imprimir etiquetas',
      to: '/etiquetas',
      qtd: r.missing_label,
    })
  }

  if (r.no_due_date) {
    out.push({
      id: 'semprazo',
      prioridade: 'baixa',
      icone: 'prazo',
      titulo: `${r.no_due_date} serviços sem prazo definido`,
      detalhe: 'Defina uma data prevista para acompanhar a entrega.',
      acaoLabel: 'Revisar comandas',
      to: '/comandas',
      qtd: r.no_due_date,
    })
  }

  return out
}

export function dominioVazio(): Dominio {
  return {
    categorias: [],
    status: [],
    clienteStatus: [],
    lancamentoStatus: [],
    formas: [],
    categoriasLancamento: [],
    tiposFoto: [],
    canaisAprovacao: [],
    modulos: [],
    equipe: [],
  }
}
