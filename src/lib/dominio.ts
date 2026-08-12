/**
 * Mapas de domínio prontos para consumo nas telas.
 *
 * As telas indexavam objetos constantes (`CATEGORIAS[cat].label`,
 * `STATUS[s].cor`). Agora esses dados vêm do banco, mas o formato de
 * acesso continua o mesmo — `useDominioMaps()` monta os mapas a partir
 * dos arrays carregados uma vez por sessão.
 *
 * Todo acesso passa por um fallback neutro: se uma chave de status ou
 * categoria não estiver no mapa (domínio ainda carregando, ou registro
 * removido), a tela renderiza em cinza em vez de estourar em
 * `undefined.label`.
 */

import { useMemo } from 'react'
import { useSessao } from '@/store/useSessao'
import { COR_NEUTRA, KANBAN_FALLBACK } from './constants'
import type {
  CategoriaMeta,
  ClienteStatusMeta,
  FormaMeta,
  LancamentoStatusMeta,
  StatusMeta,
} from '@/types'

const categoriaNeutra = (key: string): CategoriaMeta => ({
  key,
  label: key || '—',
  icon: 'Package',
  cor: COR_NEUTRA.cor,
  bg: COR_NEUTRA.bg,
  ordem: 999,
})

const statusNeutro = (key: string): StatusMeta => ({
  key,
  label: key || '—',
  descricao: '',
  cor: COR_NEUTRA.cor,
  bg: COR_NEUTRA.bg,
  borda: COR_NEUTRA.borda,
  kanban: false,
  aberto: true,
  final: false,
  ordem: 999,
})

const clienteStatusNeutro = (key: string): ClienteStatusMeta => ({
  key,
  label: key || '—',
  cor: COR_NEUTRA.cor,
  bg: COR_NEUTRA.bg,
  derivado: true,
})

const lancStatusNeutro = (key: string): LancamentoStatusMeta => ({
  key,
  label: key || '—',
  cor: COR_NEUTRA.cor,
  bg: COR_NEUTRA.bg,
  recebido: false,
  aberto: false,
})

const formaNeutra = (key: string): FormaMeta => ({
  key,
  label: key || '—',
  icon: 'Wallet',
  cor: COR_NEUTRA.cor,
})

export function useDominioMaps() {
  const d = useSessao((s) => s.dominio)

  return useMemo(() => {
    const porKey = <T extends { key: string }>(itens: T[]) =>
      Object.fromEntries(itens.map((i) => [i.key, i])) as Record<string, T>

    const CATEGORIAS = porKey(d.categorias)
    const STATUS = porKey(d.status)
    const CLIENTE_STATUS = porKey(d.clienteStatus)
    const LANCAMENTO_STATUS = porKey(d.lancamentoStatus)
    const FORMAS = porKey(d.formas)

    return {
      CATEGORIAS,
      STATUS,
      CLIENTE_STATUS,
      LANCAMENTO_STATUS,
      FORMAS,

      CATEGORIA_LIST: d.categorias.map((c) => c.key),
      STATUS_LIST: d.status.map((s) => s.key),
      FORMA_LIST: d.formas.map((f) => f.key),

      /** Colunas do Kanban na ordem do banco. */
      KANBAN_COLS: d.status.filter((s) => s.kanban).map((s) => s.key),
      /** Status que ainda ocupam a operação. */
      STATUS_ABERTOS: d.status.filter((s) => s.aberto).map((s) => s.key),

      CAT_ENTRADA: d.categoriasLancamento.filter((c) => c.tipo === 'entrada'),
      CAT_SAIDA: d.categoriasLancamento.filter((c) => c.tipo === 'saida'),
      TIPOS_FOTO: d.tiposFoto,
      /** Por onde o cliente aprovou o orçamento (`approval_channels`). */
      CANAIS_APROVACAO: d.canaisAprovacao,
      EQUIPE: d.equipe,
      /** Antigo RESPONSAVEIS: quem realmente executa serviço. */
      EXECUTORES: d.equipe.filter((m) => m.executa && m.ativo),
      MODULOS: d.modulos,

      /* Acessadores seguros — nunca retornam undefined. */
      cat: (key: string) => CATEGORIAS[key] ?? categoriaNeutra(key),
      st: (key: string) => STATUS[key] ?? statusNeutro(key),
      cliSt: (key: string) => CLIENTE_STATUS[key] ?? clienteStatusNeutro(key),
      lancSt: (key: string) => LANCAMENTO_STATUS[key] ?? lancStatusNeutro(key),
      forma: (key: string | null) => (key ? FORMAS[key] ?? formaNeutra(key) : null),
      membro: (id: string | null) => (id ? d.equipe.find((m) => m.id === id) ?? null : null),

      /** Domínio ainda não carregou (usuário sem sessão, ou boot). */
      vazio: d.status.length === 0,
    }
  }, [d])
}

export type DominioMaps = ReturnType<typeof useDominioMaps>

/** Fallback usado antes de o domínio carregar (ex.: tela de impressão). */
export const KANBAN_COLS_FALLBACK: readonly string[] = KANBAN_FALLBACK
