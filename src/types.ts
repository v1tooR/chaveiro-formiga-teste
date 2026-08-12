/**
 * Tipos de domínio do front.
 *
 * Antes eram os tipos do mock. Agora são a projeção das tabelas do
 * Supabase para o vocabulário que as telas já usam (português), montada
 * em src/lib/mappers.ts. Os tipos gerados do banco vivem em
 * src/types/database.ts e não devem ser usados direto nas telas.
 */

export type Categoria = string
export type ComandaStatus = string
export type ClienteStatus = string
export type FormaPagamento = string
export type LancamentoStatus = string
export type FotoTipo = string

/** Chave de módulo do banco (`modules.key`). */
export type ModuloId =
  | 'dashboard'
  | 'service_desk'
  | 'customers'
  | 'orders'
  | 'services'
  | 'production'
  | 'labels'
  | 'finance'
  | 'reports'
  | 'settings'

export type PapelId = 'owner' | 'attendant' | 'production' | 'finance' | 'viewer'

/* ------------------------------------------------------------------ *
 * Domínio (tabelas de referência)
 * ------------------------------------------------------------------ */

export interface CategoriaMeta {
  key: Categoria
  label: string
  icon: string
  cor: string
  bg: string
  ordem: number
}

export interface StatusMeta {
  key: ComandaStatus
  label: string
  descricao: string
  cor: string
  bg: string
  borda: string
  kanban: boolean
  aberto: boolean
  final: boolean
  ordem: number
}

export interface ClienteStatusMeta {
  key: ClienteStatus
  label: string
  cor: string
  bg: string
  derivado: boolean
}

export interface LancamentoStatusMeta {
  key: LancamentoStatus
  label: string
  cor: string
  bg: string
  recebido: boolean
  aberto: boolean
}

export interface FormaMeta {
  key: FormaPagamento
  label: string
  icon: string
  cor: string
}

export interface CategoriaLancamento {
  id: string
  nome: string
  tipo: 'entrada' | 'saida'
  sistema: boolean
}

export interface FotoTipoMeta {
  key: FotoTipo
  label: string
  legendaPadrao: string
}

export interface Modulo {
  key: ModuloId
  label: string
  rota: string
  grupo: 'overview' | 'operation' | 'management'
  ordem: number
}

/** Pessoa da equipe (`staff`). */
export interface Membro {
  id: string
  nome: string
  iniciais: string
  cargo: string
  executa: boolean
  ativo: boolean
}

/** Catálogo de domínio carregado uma vez por sessão. */
export interface Dominio {
  categorias: CategoriaMeta[]
  status: StatusMeta[]
  clienteStatus: ClienteStatusMeta[]
  lancamentoStatus: LancamentoStatusMeta[]
  formas: FormaMeta[]
  categoriasLancamento: CategoriaLancamento[]
  tiposFoto: FotoTipoMeta[]
  /** Por onde o cliente aprovou o orçamento (`approval_channels`). */
  canaisAprovacao: { key: string; label: string }[]
  modulos: Modulo[]
  equipe: Membro[]
}

/* ------------------------------------------------------------------ *
 * Sessão e permissões
 * ------------------------------------------------------------------ */

export interface Perfil {
  id: string
  nome: string
  email: string
  papel: PapelId
  papelLabel: string
  cargo: string
  iniciais: string
  membroId: string | null
  ativo: boolean
  /** Módulos legíveis — dirige o menu e os guards de rota. */
  modulos: ModuloId[]
  /** Módulos com escrita — dirige a exibição de botões de ação. */
  escrita: ModuloId[]
}

/* ------------------------------------------------------------------ *
 * Entidades
 * ------------------------------------------------------------------ */

export interface Foto {
  id: string
  tipo: FotoTipo
  legenda: string
  /** Gradiente determinístico: fallback quando não há arquivo. */
  seed: string
  /** Caminho no bucket privado `order-photos`. */
  storagePath?: string | null
  /** URL assinada resolvida em runtime (ou dataURL durante o upload). */
  dataUrl?: string
  /**
   * Arquivo ainda não enviado. Só existe no fluxo de criação, quando a
   * comanda não tem id e o upload só pode acontecer depois do
   * `create_order`.
   */
  arquivo?: File
  criadoEm: string
}

export interface Cliente {
  id: string
  nome: string
  telefone: string
  whatsapp: string
  email: string
  cidade: string
  cadastroEm: string
  status: ClienteStatus
  observacoes: string
  /** Agregados de customer_summary_view. */
  qtdComandas?: number
  totalGasto?: number
  pendente?: number
  ultimaComandaEm?: string | null
  ultimoServico?: string | null
}

export interface Servico {
  id: string
  nome: string
  categoria: Categoria
  descricao: string
  precoBase: number
  prazoDias: number
  /** Dias de garantia. 0 = sem garantia. Copiado para o item na venda. */
  garantiaDias: number
  responsavelPadrao: string
  responsavelPadraoId: string | null
  ativo: boolean
  observacoes: string
  /** Quantas comandas usaram este serviço (ranking da tela Serviços). */
  realizados?: number
}

export interface HistoricoEvento {
  id: string
  em: string
  autor: string
  titulo: string
  detalhe?: string
}

export interface Pagamento {
  id: string
  em: string
  valor: number
  forma: FormaPagamento
  responsavel: string
  observacao?: string
}

/**
 * Item da comanda. Uma peça física, uma etiqueta, um status, uma entrega.
 *
 * O cliente que chega com duas chaves e um sapato gera UMA comanda com
 * três itens: um número, um saldo, três etiquetas. Cada item anda sozinho
 * na produção e pode ser retirado no seu próprio momento.
 */
export interface ItemComanda {
  id: string
  comandaId: string
  /** 1, 2, 3… dentro da comanda. Vira o sufixo da etiqueta: CF-0042/2. */
  posicao: number
  categoria: Categoria
  servicoId: string | null
  servicoNome: string
  descricao: string
  quantidade: number
  valor: number
  prazoEm: string
  responsavel: string
  responsavelId: string | null
  status: ComandaStatus

  entregueEm: string | null
  entreguePara: string
  entregueDocumento: string
  entregaObservacao: string
  entreguePorNome: string | null

  /**
   * Lastro da aprovação do orçamento. Exigido ao SAIR de `aprovacao` para
   * um status de trabalho — sair para `cancelada` é o cliente recusando e
   * não pede nada.
   *
   * `aprovadoPor` é o CLIENTE. Quem no balcão registrou é `aprovacaoPorNome`.
   */
  aprovadoEm: string | null
  aprovadoPor: string
  valorAprovado: number | null
  canalAprovacao: string | null
  aprovacaoPorNome: string | null

  /**
   * Garantia desta peça. `garantiaDias` é instantâneo da venda — mexer no
   * catálogo depois não reescreve o combinado com o cliente. A contagem
   * começa na entrega DESTE item.
   */
  garantiaDias: number
  /** Item original que este retrabalho refaz. */
  itemOrigemId: string | null
  retrabalho: boolean

  etiquetaImpressa: boolean
  /** Fotos amarradas a ESTE item. A do tipo `depois` libera a entrega dele. */
  fotos: Foto[]
}

export interface Comanda {
  id: string
  numero: number
  clienteId: string
  /** Vem da view — dispensa ter a base de clientes toda em memória. */
  clienteNome: string
  clienteTelefone: string
  clienteWhatsapp: string
  categoria: Categoria
  servicoId: string | null
  servicoNome: string
  descricao: string
  quantidade: number
  criadaEm: string
  prazoEm: string
  valor: number
  entrada: number
  formaPagamento: FormaPagamento | null
  responsavel: string
  responsavelId: string | null
  status: ComandaStatus
  observacoes: string

  /** Calculados no banco (orders.amount_paid / balance / is_settled). */
  pago: number
  saldoAberto: number
  quitada: boolean
  atrasada: boolean
  diasRestantes: number

  fotos: Foto[]
  fotosQtd: number
  pagamentos: Pagamento[]
  historico: HistoricoEvento[]

  /**
   * Itens da comanda — a fonte da verdade de serviço, valor, status e
   * entrega desde a migration 20260807100000.
   *
   * `servicoNome`, `valor`, `quantidade` e `status` acima continuam
   * existindo, mas são ESPELHO derivado destes itens (o nome vira
   * "Cópia de chave +2", o status é o do item menos adiantado). Servem
   * para listagem, busca e relatórios; para agir, use o item.
   *
   * Só vem preenchido na consulta de detalhe e na Produção.
   */
  itens: ItemComanda[]

  etiquetaImpressa: boolean
  comandaImpressa: boolean
  entregueEm?: string | null

  /**
   * Registro da entrega. Vazio nas comandas anteriores à migration
   * 20260806200000 — a partir dela, `change_order_status` exige o nome
   * para aceitar a transição para `entregue`.
   */
  entreguePara: string
  entregueDocumento: string
  entregaObservacao: string
  entreguePorNome: string | null

  /**
   * Quando a comanda INTEIRA ficou pronta — o começo da espera na
   * prateleira. Nulo enquanto alguma peça viva ainda está na bancada, e
   * volta a nulo na entrega.
   *
   * `diasNaPrateleira` vem calculado da view; comparar com
   * `config.operacao.diasParaAbandono` é o que define "não retirada".
   * Não existe status `abandonada`: abandono é tempo, não etapa de
   * trabalho — ver a migration 20260811100000.
   */
  prontaEm?: string | null
  diasNaPrateleira?: number | null
}

export interface Lancamento {
  id: string
  tipo: 'entrada' | 'saida'
  descricao: string
  comandaId: string | null
  comandaNumero: number | null
  clienteId: string | null
  clienteNome: string
  categoriaId: string
  categoria: string
  valor: number
  data: string
  forma: FormaPagamento | null
  responsavel: string
  /** Id do membro — o nome sozinho não serve para reabrir o formulário. */
  responsavelId: string | null
  status: LancamentoStatus
  observacao: string
  /** Gerado pela automação da comanda: não é editável à mão. */
  automatico: boolean
}

export interface Config {
  empresa: {
    nome: string
    telefone: string
    endereco: string
    horario: string
    responsavel: string
  }
  comandas: {
    proximoNumero: number
    prefixo: string
    mostrarObservacoes: boolean
    mostrarFoto: boolean
    rodape: string
  }
  etiquetas: {
    tamanhoPadrao: 'pequena' | 'media' | 'grande'
    porFolha: number
    mostrarQr: boolean
    mostrarResponsavel: boolean
  }
  /**
   * Regras de operação do balcão. Quem manda é o banco: desligar aqui
   * afrouxa `create_order` e `change_order_status`, não só a tela.
   */
  operacao: {
    exigirFotoRecebimento: boolean
    exigirFotoEntrega: boolean
    /** Dias na prateleira até a peça contar como não retirada. 0 desliga. */
    diasParaAbandono: number
  }
}

/* ------------------------------------------------------------------ *
 * Integrações
 * ------------------------------------------------------------------ */

export interface IntegracaoStatus {
  key: string
  nome: string
  tipo: 'messaging' | 'document' | 'export'
  habilitada: boolean
  ultimoStatus: string | null
  verificadaEm: string | null
}

/* ------------------------------------------------------------------ *
 * Métricas (retorno das RPCs)
 * ------------------------------------------------------------------ */

export interface Kpis {
  atendimentosHoje: number
  comandasAbertas: number
  emExecucao: number
  prontos: number
  atrasados: number
  /**
   * Contagem de comandas entregues a cobrar — não é valor, então é
   * visível a todos: o balcão precisa saber quantos clientes chamar.
   */
  entreguesSemPagamento: number
  /**
   * null = o papel não tem acesso ao módulo financeiro.
   *
   * Anulável de propósito: `0` afirmaria "não entrou nada hoje", que é
   * diferente de "você não pode ver isso". A tela esconde o indicador
   * quando é null em vez de mostrar zero.
   */
  recebidoHoje: number | null
  recebidoMes: number | null
  pendente: number | null
  ticketMedio: number | null
  /** Espelha `can_read_finance` da RPC — decide entre esconder e mostrar. */
  veFinanceiro: boolean
}

export type Prioridade = 'alta' | 'media' | 'baixa'

export interface Alerta {
  id: string
  prioridade: Prioridade
  icone: 'atraso' | 'aviso' | 'foto' | 'prazo' | 'pagamento' | 'pronto' | 'etiqueta'
  titulo: string
  detalhe: string
  acaoLabel: string
  to: string
  qtd: number
}
