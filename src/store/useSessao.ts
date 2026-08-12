import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import * as api from '@/lib/api/sessao'
import { carregarDominio } from '@/lib/api/dominio'
import { dominioVazio } from '@/lib/mappers'
import type { Config, Dominio, IntegracaoStatus, ModuloId, Perfil } from '@/types'

/**
 * Sessão, permissões, domínio e configuração.
 *
 * Separado do store de dados de negócio porque tem ciclo de vida
 * diferente: carrega uma vez no login e só muda em logout ou troca de
 * configuração.
 */

interface SessaoState {
  /** null = ainda verificando a sessão; evita piscar a tela de login. */
  perfil: Perfil | null
  carregando: boolean
  erro: string | null

  dominio: Dominio
  config: Config | null
  integracoes: IntegracaoStatus[]

  /** Preferência de UI, local ao navegador — não é dado de negócio. */
  modoApresentacao: boolean

  iniciar: () => Promise<void>
  entrar: (email: string, senha: string) => Promise<void>
  sair: () => Promise<void>
  recarregarConfig: () => Promise<void>
  recarregarIntegracoes: () => Promise<void>
  salvarConfig: (patch: Record<string, unknown>) => Promise<void>
  setModoApresentacao: (v: boolean) => void
  limparErro: () => void
}

const CHAVE_APRESENTACAO = 'chaveiro-formiga:modo-apresentacao'

export const useSessao = create<SessaoState>()((set, get) => ({
  perfil: null,
  carregando: true,
  erro: null,
  dominio: dominioVazio(),
  config: null,
  integracoes: [],
  modoApresentacao: localStorage.getItem(CHAVE_APRESENTACAO) === '1',

  /** Chamado no boot e após cada login. */
  iniciar: async () => {
    set({ carregando: true, erro: null })
    try {
      const perfil = await api.carregarPerfil()

      if (!perfil) {
        set({ perfil: null, carregando: false })
        return
      }

      // Domínio, configuração e integrações em paralelo — todos são
      // pequenos e a primeira tela depende dos três.
      const [dominio, config, integracoes] = await Promise.all([
        carregarDominio(),
        api.carregarConfig(),
        api.carregarIntegracoes(),
      ])

      set({ perfil, dominio, config, integracoes, carregando: false, erro: null })
    } catch (e) {
      set({
        perfil: null,
        carregando: false,
        erro: e instanceof Error ? e.message : 'Falha ao carregar a sessão.',
      })
    }
  },

  entrar: async (email, senha) => {
    set({ erro: null })
    await api.entrar(email, senha)
    await get().iniciar()
  },

  sair: async () => {
    await api.sair()
    set({ perfil: null, config: null, dominio: dominioVazio(), integracoes: [], erro: null })
  },

  recarregarConfig: async () => {
    set({ config: await api.carregarConfig() })
  },

  /**
   * Recarrega SÓ as integrações.
   *
   * A tela de Configurações chamava `iniciar()` depois de salvar uma
   * integração, só para que os botões "Avisar cliente" das outras telas
   * enxergassem o novo status. Mas `iniciar()` faz `carregando: true`, e
   * o guard de rota em App.tsx troca a árvore inteira por <Carregando/> —
   * Layout e página desmontavam e remontavam, refazendo todas as queries.
   * Um clique num botão de integração custava um recarregamento completo.
   */
  recarregarIntegracoes: async () => {
    set({ integracoes: await api.carregarIntegracoes() })
  },

  salvarConfig: async (patch) => {
    set({ config: await api.salvarConfig(patch) })
  },

  setModoApresentacao: (v) => {
    localStorage.setItem(CHAVE_APRESENTACAO, v ? '1' : '0')
    set({ modoApresentacao: v })
  },

  limparErro: () => set({ erro: null }),
}))

/* ------------------------------------------------------------------ *
 * Permissões
 * ------------------------------------------------------------------ */

/** Pode VER o módulo? Dirige o menu e o guard de rota. */
export function usePodeVer(modulo: ModuloId): boolean {
  return useSessao((s) => !!s.perfil?.modulos.includes(modulo))
}

/**
 * Pode ESCREVER no módulo? Dirige a exibição dos botões de ação.
 *
 * Esconder o botão não é a segurança — a RLS é. Mas mostrar um botão que
 * sempre falha é pior que não mostrar: o front lê a mesma matriz
 * (`role_modules`) que a RLS usa, então os dois nunca divergem.
 */
export function usePodeEditar(modulo: ModuloId): boolean {
  return useSessao((s) => !!s.perfil?.escrita.includes(modulo))
}

/** Versão imperativa, para handlers e funções fora de render. */
export function podeEditar(modulo: ModuloId): boolean {
  return !!useSessao.getState().perfil?.escrita.includes(modulo)
}

/** Alguma integração de mensagem está ativa? Gate do "Avisar cliente". */
export function useIntegracaoAtiva(key: string): boolean {
  return useSessao((s) => !!s.integracoes.find((i) => i.key === key)?.habilitada)
}

/* ------------------------------------------------------------------ *
 * Atalhos de domínio (substituem os mapas de constants.ts)
 * ------------------------------------------------------------------ */

export function useCategorias() {
  return useSessao((s) => s.dominio.categorias)
}

export function useStatusList() {
  return useSessao((s) => s.dominio.status)
}

/** Responsáveis que executam serviço (antigo RESPONSAVEIS). */
export function useExecutores() {
  return useSessao((s) => s.dominio.equipe.filter((m) => m.executa && m.ativo))
}

/* ------------------------------------------------------------------ *
 * Reação a mudança de sessão
 * ------------------------------------------------------------------ */

// Token expirado ou logout em outra aba: o app volta para o login em vez
// de ficar disparando queries que a RLS vai negar.
supabase.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT') {
    useSessao.setState({ perfil: null, config: null, integracoes: [] })
  }
})
