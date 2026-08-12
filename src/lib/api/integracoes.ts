/**
 * Administração de integrações — a ÚLTIMA etapa da implementação.
 *
 * Chega por último de propósito: só depois de todos os módulos prontos
 * dá para saber quais APIs externas o sistema realmente precisa. A lista
 * (docs/01-analise-frontend.md §8) veio dos pontos "(simulado)" do front,
 * não de suposição.
 *
 * ARQUITETURA DE SEGREDO
 *   • `config`     → JSON NÃO sensível (template, formato). Uma trigger no
 *                    banco rejeita chaves com cara de segredo.
 *   • `secret_ref` → apenas o NOME da variável (ex.: WHATSAPP_API_TOKEN).
 *                    O valor vive nos secrets da Edge Function / Vault e
 *                    nunca passa por aqui.
 *
 * Cada integração é um adapter isolado atrás de uma interface comum
 * (`chamarIntegracao`): trocar de provedor de WhatsApp não toca em
 * nenhuma tela.
 */

import { supabase, exigir, lista, verificar } from '@/lib/supabase'
import type { Json } from '@/types/database'

export interface Integracao {
  id: string
  key: string
  nome: string
  tipo: 'messaging' | 'document' | 'export'
  provedor: string
  descricao: string
  config: Record<string, unknown>
  habilitada: boolean
  /** NOME da variável de ambiente. Nunca o valor. */
  segredoRef: string | null
  ultimoStatus: 'ok' | 'error' | 'unconfigured' | null
  ultimoErro: string | null
  verificadaEm: string | null
}

function mapear(r: {
  id: string
  key: string
  name: string
  kind: string
  provider: string
  description: string
  config: Json
  enabled: boolean
  secret_ref: string | null
  last_status: string | null
  last_error: string | null
  last_checked_at: string | null
}): Integracao {
  return {
    id: r.id,
    key: r.key,
    nome: r.name,
    tipo: r.kind as Integracao['tipo'],
    provedor: r.provider,
    descricao: r.description,
    config: (r.config ?? {}) as Record<string, unknown>,
    habilitada: r.enabled,
    segredoRef: r.secret_ref,
    ultimoStatus: r.last_status as Integracao['ultimoStatus'],
    ultimoErro: r.last_error,
    verificadaEm: r.last_checked_at,
  }
}

/** Só quem tem escrita em `settings` consegue ler — RLS garante. */
export async function listarIntegracoes(): Promise<Integracao[]> {
  return lista(await supabase.from('integrations').select('*').order('kind').order('name')).map(mapear)
}

export async function salvarIntegracao(
  id: string,
  patch: {
    provedor?: string
    config?: Record<string, unknown>
    habilitada?: boolean
    segredoRef?: string | null
  },
): Promise<Integracao> {
  const data = exigir(
    await supabase
      .from('integrations')
      .update({
        ...(patch.provedor !== undefined && { provider: patch.provedor }),
        ...(patch.config !== undefined && { config: patch.config as Json }),
        ...(patch.habilitada !== undefined && { enabled: patch.habilitada }),
        ...(patch.segredoRef !== undefined && {
          secret_ref: patch.segredoRef?.trim() ? patch.segredoRef.trim().toUpperCase() : null,
        }),
      })
      .eq('id', id)
      .select('*')
      .single(),
  )
  return mapear(data)
}

/* ------------------------------------------------------------------ *
 * Adapters
 * ------------------------------------------------------------------ */

/**
 * Interface comum de todas as integrações.
 *
 * A chamada real acontece numa Edge Function, que é o único lugar com
 * acesso ao segredo. O front nunca fala com a API externa direto — se
 * falasse, o token teria que estar no bundle.
 *
 * A função `integracao-<key>` só existe depois de o provedor ser
 * escolhido; até lá, `chamarIntegracao` devolve `nao_configurada` e a UI
 * explica o que falta em vez de fingir que enviou.
 */
export type ResultadoIntegracao =
  | { ok: true; dados?: unknown }
  | { ok: false; motivo: 'nao_configurada' | 'desabilitada' | 'erro'; mensagem: string }

export async function chamarIntegracao(
  key: string,
  payload: Record<string, unknown>,
): Promise<ResultadoIntegracao> {
  const status = verificar(
    await supabase.from('integration_status').select('enabled').eq('key', key).maybeSingle(),
  )

  if (!status) {
    return { ok: false, motivo: 'nao_configurada', mensagem: 'Integração não registrada.' }
  }
  if (!status.enabled) {
    return {
      ok: false,
      motivo: 'desabilitada',
      mensagem: 'Integração desativada em Configurações → Integrações.',
    }
  }

  const { data, error } = await supabase.functions.invoke(`integracao-${key}`, { body: payload })

  if (error) {
    return { ok: false, motivo: 'erro', mensagem: error.message }
  }
  return { ok: true, dados: data }
}
