/**
 * Autenticação e perfil.
 *
 * Substitui `entrar(perfil)` do mock, que era só um `set({autenticado:true})`
 * — qualquer e-mail e senha entravam. Agora é Supabase Auth de verdade, e
 * as permissões vêm de `role_modules` no banco.
 */

import { supabase, exigir, lista, verificar } from '@/lib/supabase'
import { mapConfig, mapIntegracao, mapPerfil } from '@/lib/mappers'
import type { Config, IntegracaoStatus, PapelId, Perfil } from '@/types'

export async function entrar(email: string, senha: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
  if (error) {
    throw new Error(
      error.message.includes('Invalid login credentials')
        ? 'E-mail ou senha incorretos.'
        : error.message,
    )
  }
}

export async function sair(): Promise<void> {
  await supabase.auth.signOut()
}

/**
 * Carrega o perfil do usuário logado com os módulos que ele pode ler e
 * escrever. Retorna null quando não há sessão.
 */
export async function carregarPerfil(): Promise<Perfil | null> {
  const { data: sessao } = await supabase.auth.getSession()
  const uid = sessao.session?.user?.id
  if (!uid) return null

  const perfil = verificar(
    await supabase
      .from('profiles')
      .select('*, roles:role_key(*), staff:staff_id(*)')
      .eq('id', uid)
      .maybeSingle(),
  )

  if (!perfil) {
    // Usuário existe no Auth mas não tem perfil: o trigger
    // handle_new_user deveria ter criado. Sem perfil não há papel, e sem
    // papel a RLS nega tudo — melhor dizer isso do que mostrar um app
    // vazio e sem explicação.
    throw new Error(
      'Seu usuário não tem perfil configurado no sistema. Peça ao responsável para liberar o acesso.',
    )
  }

  if (!perfil.is_active) {
    await sair()
    throw new Error('Seu acesso está desativado. Procure o responsável.')
  }

  const permissoes = lista(
    await supabase.from('role_modules').select('*').eq('role_key', perfil.role_key),
  )

  const papel = (perfil as unknown as { roles: Parameters<typeof mapPerfil>[1] }).roles
  const membro = (perfil as unknown as { staff: Parameters<typeof mapPerfil>[3] }).staff

  return mapPerfil(perfil, papel, permissoes, membro)
}

export async function carregarConfig(): Promise<Config> {
  const data = exigir(await supabase.from('app_settings').select('*').limit(1).single())
  return mapConfig(data)
}

export async function salvarConfig(patch: Record<string, unknown>): Promise<Config> {
  const data = exigir(
    await supabase.from('app_settings').update(patch as never).eq('id', true).select('*').single(),
  )
  return mapConfig(data)
}

/**
 * Status das integrações — só se estão habilitadas, sem config nem
 * segredo (a view `integration_status` não expõe essas colunas).
 * Usado para decidir se o botão "Avisar cliente" fica disponível.
 */
export async function carregarIntegracoes(): Promise<IntegracaoStatus[]> {
  return lista(await supabase.from('integration_status').select('*').order('kind')).map(mapIntegracao)
}

export function trocarSenha(nova: string): Promise<void> {
  return supabase.auth.updateUser({ password: nova }).then(({ error }) => {
    if (error) throw new Error(error.message)
  })
}

/* ------------------------------------------------------------------ *
 * Equipe (usuários do sistema)
 * ------------------------------------------------------------------ */

/**
 * Usuário do sistema.
 *
 * NÃO confundir com `Membro` (tabela `staff`). São duas coisas distintas
 * por design, e a tela de Equipe confundia as duas:
 *
 *   • `staff`    — pessoas da loja que executam serviço. Podem não ter
 *                  login (Marcelo e Rita não têm).
 *   • `profiles` — quem tem login. Ligado a `staff` por `staff_id`, que é
 *                  NULLABLE.
 *
 * A tela listava `staff`, então o usuário `consulta` — semeado sem
 * `staff_name`, logo com `staff_id` NULL — nunca aparecia, embora o login
 * funcionasse. Quem quer gerir ACESSO precisa ler `profiles`.
 */
export interface UsuarioEquipe {
  id: string
  nome: string
  email: string
  papel: PapelId
  papelLabel: string
  ativo: boolean
  /** Cargo vindo do `staff` vinculado; vazio quando não há vínculo. */
  cargo: string
  membroId: string | null
  executa: boolean
  /** Tem escrita em `settings` — usado para não deixar a loja sem admin. */
  administrador: boolean
}

/**
 * Lista todos os usuários. Só o responsável enxerga além de si mesmo — a
 * policy `profiles_select_self` (`id = auth.uid() OR is_owner()`) já faz
 * esse recorte, então não há verificação a repetir aqui.
 *
 * O embed de `staff` é LEFT JOIN: `staff_id` NULL não elimina a linha.
 */
export async function listarEquipe(): Promise<UsuarioEquipe[]> {
  const linhas = lista(
    await supabase
      .from('profiles')
      .select('*, roles:role_key(*), staff:staff_id(*)')
      .order('full_name'),
  )

  const permissoes = lista(
    await supabase.from('role_modules').select('role_key, module_key, can_write'),
  )
  const admins = new Set(
    permissoes.filter((p) => p.module_key === 'settings' && p.can_write).map((p) => p.role_key),
  )

  return linhas.map((r) => {
    const l = r as unknown as {
      id: string
      full_name: string
      email: string | null
      role_key: string
      is_active: boolean
      staff_id: string | null
      roles: { label: string } | null
      staff: { job_title: string; can_execute: boolean } | null
    }
    return {
      id: l.id,
      nome: l.full_name,
      email: l.email ?? '',
      papel: l.role_key as PapelId,
      papelLabel: l.roles?.label ?? l.role_key,
      ativo: l.is_active,
      cargo: l.staff?.job_title ?? '',
      membroId: l.staff_id,
      executa: !!l.staff?.can_execute,
      administrador: admins.has(l.role_key),
    }
  })
}

/** Papéis disponíveis, para o seletor da tela de Equipe. */
export async function listarPapeis(): Promise<{ key: string; label: string }[]> {
  return lista(await supabase.from('roles').select('key, label').order('sort_order')).map((r) => ({
    key: r.key,
    label: r.label,
  }))
}

/**
 * Trocar papel e ativar/desativar vão por RPC, não por UPDATE direto.
 *
 * As guardas (não alterar a si mesmo, não deixar a loja sem
 * administrador) precisam morar no banco: um `if` no React é sugestão,
 * não garantia. Ver 20260730170000_team_management.sql.
 */
export async function trocarPapel(perfilId: string, papel: string): Promise<void> {
  verificar({
    ...(await supabase.rpc('set_profile_role', { p_profile_id: perfilId, p_role_key: papel })),
    data: true,
  })
}

export async function ativarUsuario(perfilId: string, ativo: boolean): Promise<void> {
  verificar({
    ...(await supabase.rpc('set_profile_active', { p_profile_id: perfilId, p_active: ativo })),
    data: true,
  })
}

/** Marca quem executa serviço — dirige o seletor de responsável da Produção. */
export async function definirExecutaServico(membroId: string, executa: boolean): Promise<void> {
  verificar(await supabase.from('staff').update({ can_execute: executa }).eq('id', membroId))
}
