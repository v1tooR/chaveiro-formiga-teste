/**
 * Assinaturas de Realtime.
 *
 * Critério: toda tela que duas pessoas olham ao mesmo tempo. O Kanban da
 * Produção é o caso mais crítico — Diego arrasta um card e Camila precisa
 * ver, senão os dois mexem na mesma peça.
 *
 * O Supabase aplica a RLS de SELECT a cada mensagem: um `viewer` não
 * recebe evento de tabela que não pode ler. Não há filtro extra a fazer
 * aqui, mas isso depende das policies de SELECT — que por isso nunca são
 * `USING (true)` em tabela de negócio.
 */

import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type TabelaRealtime =
  | 'orders'
  // Desde a migration 20260807100000 quem muda de status é o item; sem
  // esta entrada o Kanban da Produção para de se mover sozinho.
  | 'order_items'
  | 'order_photos'
  | 'order_payments'
  | 'order_events'
  | 'ledger_entries'
  | 'customers'
  | 'services'
  | 'app_settings'

/**
 * Assina mudanças e chama `onChange` quando qualquer uma das tabelas
 * mexer. Devolve a função de cancelamento — chame no cleanup do efeito,
 * senão cada navegação deixa um canal aberto.
 */
export function assinar(
  nome: string,
  tabelas: TabelaRealtime[],
  onChange: (info: { tabela: TabelaRealtime; evento: string; novo: unknown; antigo: unknown }) => void,
): () => void {
  let canal: RealtimeChannel = supabase.channel(nome)

  for (const tabela of tabelas) {
    canal = canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: tabela },
      (payload) => {
        onChange({
          tabela,
          evento: payload.eventType,
          novo: payload.new,
          antigo: payload.old,
        })
      },
    )
  }

  canal.subscribe()

  return () => {
    void supabase.removeChannel(canal)
  }
}

/**
 * Agrupa rajadas de eventos em uma única atualização.
 *
 * Sem isso, marcar 30 etiquetas em lote dispara 30 recargas da lista.
 * O atraso de 250ms é imperceptível para quem opera e transforma a rajada
 * num único refetch.
 */
export function agrupar(fn: () => void, ms = 250): () => void {
  let t: ReturnType<typeof setTimeout> | undefined
  return () => {
    if (t) clearTimeout(t)
    t = setTimeout(fn, ms)
  }
}
