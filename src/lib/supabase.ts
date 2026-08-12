import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Client único do Supabase.
 *
 * Só variáveis `VITE_*` chegam ao navegador — e tudo que chega ao
 * navegador é público. A chave anônima é pública por design: quem protege
 * os dados é a RLS, não o segredo da chave. A `service_role`, que ignora
 * toda a RLS, NUNCA entra aqui.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Falha alto e cedo: sem isso o app renderiza e só quebra na primeira
  // query, com um erro de rede que não diz nada sobre a causa real.
  throw new Error(
    'Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.\n' +
      'Copie .env.example para .env e preencha os valores.',
  )
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'chaveiro-formiga-auth',
  },
  realtime: {
    // A loja tem poucos usuários simultâneos; 10 eventos/s é folgado e
    // evita rajada quando alguém arrasta vários cards no Kanban.
    params: { eventsPerSecond: 10 },
  },
  global: {
    headers: { 'x-application-name': 'chaveiro-formiga' },
  },
})

/* ------------------------------------------------------------------ *
 * Tratamento de erro
 * ------------------------------------------------------------------ */

/** Códigos que o Postgres/PostgREST devolve e que têm tradução útil. */
const MENSAGENS: Record<string, string> = {
  '42501': 'Você não tem permissão para esta ação.',
  '23505': 'Este registro já existe.',
  '23514': 'Os dados informados não atendem a uma regra do sistema.',
  '23503': 'Existe outro registro dependendo deste.',
  P0002: 'Registro não encontrado.',
  PGRST116: 'Registro não encontrado.',
  PGRST301: 'Sua sessão expirou. Entre novamente.',
}

/**
 * Constraint do banco → frase que diz QUAL campo falhou.
 *
 * Sem isto, toda violação de CHECK vira "Os dados informados não atendem
 * a uma regra do sistema" e toda duplicidade vira "Este registro já
 * existe" — verdadeiro e inútil, porque o operador não sabe onde mexer.
 *
 * O Postgres nomeia a constraint na própria mensagem, então dá para
 * extrair. Só entram aqui as constraints que o operador consegue violar
 * pela interface; as de tabela de domínio (`*_key_format`, `*_hex`) ficam
 * de fora de propósito — quem as viola é migration, não usuário.
 */
const CONSTRAINTS: Record<string, string> = {
  // Clientes
  customers_email_format: 'E-mail inválido. Use o formato nome@dominio.com.',
  customers_phone_unique: 'Este telefone já está cadastrado em outro cliente.',
  customers_phone_digits: 'Telefone deve conter apenas números.',
  customers_whatsapp_digits: 'WhatsApp deve conter apenas números.',
  customers_name_min: 'Informe o nome completo do cliente.',
  // Comandas
  orders_down_lte_total: 'A entrada não pode ser maior que o valor total da comanda.',
  orders_down_method_iff: 'Informe a forma de pagamento da entrada.',
  orders_total_positive: 'O valor da comanda deve ser maior que zero.',
  orders_quantity_min: 'A quantidade deve ser no mínimo 1.',
  orders_paid_min: 'O valor pago não pode ser negativo.',
  orders_down_min: 'A entrada não pode ser negativa.',
  orders_service_name_min: 'Informe o serviço da comanda.',
  order_payments_amount_positive: 'O valor do pagamento deve ser maior que zero.',
  // Serviços
  services_name_unique: 'Já existe um serviço com esse nome.',
  services_price_min: 'O preço do serviço não pode ser negativo.',
  services_lead_min: 'O prazo do serviço não pode ser negativo.',
  services_name_min: 'Informe o nome do serviço.',
  // Financeiro
  ledger_entries_amount_positive: 'O valor do lançamento deve ser maior que zero.',
  ledger_entries_desc_min: 'Informe a descrição do lançamento.',
  // Equipe e configuração
  staff_name_unique_active: 'Já existe alguém com esse nome na equipe.',
  profiles_name_min: 'Informe o nome do usuário.',
  app_settings_prefix_format: 'O prefixo deve ter de 1 a 5 letras maiúsculas.',
  app_settings_per_sheet: 'Etiquetas por folha deve ficar entre 1 e 60.',
  app_settings_next_number: 'O próximo número da comanda deve ser maior que zero.',
  app_settings_company_name: 'Informe o nome da empresa.',
  integrations_enabled_needs_secret:
    'Informe o nome da variável de segredo antes de ativar a integração.',
}

/**
 * Converte o erro do Supabase em uma frase que o operador do balcão
 * entende. As mensagens das RPCs já vêm em português e são preferidas —
 * elas explicam a regra de negócio violada.
 */
export function mensagemErro(erro: unknown): string {
  if (!erro) return 'Erro desconhecido.'

  const e = erro as { code?: string; message?: string; details?: string; hint?: string }

  // Mensagem própria das nossas RPCs (RAISE EXCEPTION em português).
  if (e.message && /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(e.message)) {
    return e.message
  }

  // Constraint nomeada vem antes do código genérico: "telefone já
  // cadastrado" é acionável, "este registro já existe" não é.
  const constraint = `${e.message ?? ''} ${e.details ?? ''}`.match(/constraint "([^"]+)"/)?.[1]
  if (constraint && CONSTRAINTS[constraint]) return CONSTRAINTS[constraint]

  if (e.code && MENSAGENS[e.code]) return MENSAGENS[e.code]

  if (e.message?.includes('Failed to fetch')) {
    return 'Sem conexão com o servidor. Verifique a rede e tente novamente.'
  }
  if (e.message?.includes('Invalid login credentials')) {
    return 'E-mail ou senha incorretos.'
  }
  if (e.message?.includes('JWT expired')) {
    return 'Sua sessão expirou. Entre novamente.'
  }

  return e.message || 'Não foi possível concluir a operação.'
}

/* ------------------------------------------------------------------ *
 * Desembrulho de resposta
 * ------------------------------------------------------------------ */
// Três helpers em vez de um: o supabase-js tipa `data` como possivelmente
// nulo em todos os casos, mas o significado do nulo muda. Um helper único
// obrigaria cada chamada a repetir a mesma checagem.

/** Erro → exceção. `data` pode ser nulo (caso de `maybeSingle`). */
export function verificar<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Error(mensagemErro(res.error))
  return res.data
}

/**
 * Para `.single()`, inserções e RPCs: nulo sem erro é estado impossível.
 * O retorno é `NonNullable<T>` para que quem chama não precise repetir a
 * checagem que já aconteceu aqui.
 */
export function exigir<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw new Error(mensagemErro(res.error))
  if (res.data === null || res.data === undefined) {
    throw new Error('Registro não encontrado.')
  }
  return res.data as NonNullable<T>
}

/** Para listagens: nulo é lista vazia, não erro. */
export function lista<T>(res: { data: T[] | null; error: unknown }): T[] {
  if (res.error) throw new Error(mensagemErro(res.error))
  return res.data ?? []
}
