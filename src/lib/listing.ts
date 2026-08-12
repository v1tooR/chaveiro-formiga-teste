/**
 * Padrão único de listagem — paginação, filtros e ordenação.
 *
 * Toda lista do sistema (comandas, clientes, serviços, lançamentos,
 * etiquetas) usa este mesmo contrato. Antes, cada tela filtrava o array
 * completo em memória e cortava com `.slice(0, 60)` — o que dava número
 * errado nos totais e não escalava. Aqui o filtro, a ordenação e a
 * contagem acontecem no banco.
 */

export const TAMANHO_PAGINA = 30

export type Direcao = 'asc' | 'desc'

export interface Ordenacao {
  campo: string
  direcao: Direcao
  /** Ordena NULLs por último — prazo vazio não deve encabeçar a fila. */
  nullsLast?: boolean
}

export interface Consulta {
  pagina: number
  tamanho: number
  busca?: string
  ordem?: Ordenacao
}

export interface Pagina<T> {
  linhas: T[]
  total: number
  pagina: number
  tamanho: number
  paginas: number
  temMais: boolean
}

export const consultaInicial = (ordem?: Ordenacao): Consulta => ({
  pagina: 1,
  tamanho: TAMANHO_PAGINA,
  busca: '',
  ordem,
})

export function paginaVazia<T>(tamanho = TAMANHO_PAGINA): Pagina<T> {
  return { linhas: [], total: 0, pagina: 1, tamanho, paginas: 0, temMais: false }
}

/** Converte página 1-based no range 0-based do PostgREST. */
export function faixa(pagina: number, tamanho: number): [number, number] {
  const inicio = Math.max(0, (pagina - 1) * tamanho)
  return [inicio, inicio + tamanho - 1]
}

export function montarPagina<T>(
  linhas: T[] | null,
  total: number | null,
  consulta: Consulta,
): Pagina<T> {
  const t = total ?? 0
  const tamanho = consulta.tamanho
  const paginas = Math.max(1, Math.ceil(t / tamanho))
  return {
    linhas: linhas ?? [],
    total: t,
    pagina: consulta.pagina,
    tamanho,
    paginas,
    temMais: consulta.pagina < paginas,
  }
}

/**
 * Aplica ordenação e paginação. Sempre desempata por uma coluna única
 * (`id`) — sem isso, dois registros com o mesmo valor de ordenação podem
 * trocar de lugar entre páginas e o usuário vê a mesma linha duas vezes.
 */
// O builder do PostgREST tem 6 parâmetros genéricos que mudam entre
// versões; tipá-los aqui só acopla este arquivo à versão do SDK. O tipo do
// RESULTADO continua garantido: quem chama passa por montarPagina<T>.
interface QueryOrdenavel {
  order: (campo: string, opts: { ascending: boolean; nullsFirst?: boolean }) => QueryOrdenavel
  range: (de: number, ate: number) => unknown
}

export function aplicar<Q>(query: Q, consulta: Consulta, desempate = 'id'): Q {
  let q = query as unknown as QueryOrdenavel

  if (consulta.ordem) {
    q = q.order(consulta.ordem.campo, {
      ascending: consulta.ordem.direcao === 'asc',
      ...(consulta.ordem.nullsLast ? { nullsFirst: false } : {}),
    })
  }

  // Desempate por coluna única: sem isso, duas linhas com o mesmo valor de
  // ordenação podem trocar de página e a mesma aparece duas vezes.
  q = q.order(desempate, { ascending: false })

  const [de, ate] = faixa(consulta.pagina, consulta.tamanho)
  return q.range(de, ate) as Q
}

/**
 * Termo de busca preparado para `ilike`. Escapa `%` e `_`, que no LIKE são
 * curingas: um cliente chamado "50%" viraria "qualquer coisa".
 */
export function termoBusca(busca?: string): string | null {
  const t = (busca ?? '').trim()
  if (t.length < 2) return null
  return `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
}
