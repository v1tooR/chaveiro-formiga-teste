/**
 * Constantes que continuam estáticas.
 *
 * Os mapas de domínio (CATEGORIAS, STATUS, CLIENTE_STATUS,
 * LANCAMENTO_STATUS, FORMAS, CAT_ENTRADA, CAT_SAIDA, PERFIS,
 * RESPONSAVEIS) saíram daqui: agora vêm das tabelas de domínio, via
 * `useDominioMaps()` em src/lib/dominio.ts. Assim o responsável muda uma
 * cor ou adiciona uma categoria sem novo deploy.
 *
 * O que sobrou é o que é mesmo do código: layout de impressão e as
 * colunas do Kanban como ordem de fallback.
 */

/** Tamanhos físicos de etiqueta — dependem do rolo de papel, não do banco. */
export const TAMANHOS_ETIQUETA = {
  pequena: { label: 'Pequena', medida: '40 × 25 mm', classe: 'w-[150px] h-[95px] p-2' },
  media: { label: 'Média', medida: '60 × 40 mm', classe: 'w-[205px] h-[135px] p-2.5' },
  grande: { label: 'Grande', medida: '80 × 50 mm', classe: 'w-[265px] h-[170px] p-3.5' },
} as const

export type TamanhoEtiqueta = keyof typeof TAMANHOS_ETIQUETA

/**
 * Ordem das colunas do Kanban usada só como fallback.
 * A ordem real vem de `order_statuses.sort_order` + `in_kanban`.
 */
export const KANBAN_FALLBACK = [
  'recebida',
  'analise',
  'aprovacao',
  'execucao',
  'material',
  'pronta',
  'avisado',
  'entregue',
] as const

/** Prazos sugeridos no atendimento (chips da etapa "Prazo"). */
export const PRAZOS_SUGERIDOS = [0, 1, 2, 3, 5, 7, 10] as const

/** Ajustes rápidos de valor (chips da etapa "Valor"). */
export const AJUSTES_VALOR = [-10, -5, 5, 10, 20] as const

/** Cor neutra para chave de domínio desconhecida (nunca deixa a UI sem cor). */
export const COR_NEUTRA = { cor: '#4B525C', bg: '#F5F6F8', borda: '#E6E9ED' }
