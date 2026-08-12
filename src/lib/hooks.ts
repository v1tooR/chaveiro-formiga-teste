/**
 * Hooks de dados.
 *
 * Com mock, nenhuma tela falhava — `useCarregando(420)` era um
 * `setTimeout` fingindo latência. Contra o banco real toda leitura pode
 * falhar (rede caiu, RLS negou, sessão expirou), e o operador precisa ver
 * o motivo em vez de uma tela em branco.
 *
 * Todo hook aqui devolve o mesmo trio: `carregando`, `erro`, `recarregar`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { mensagemErro } from '@/lib/supabase'
import { agrupar, assinar, type TabelaRealtime } from '@/lib/realtime'
import { consultaInicial, paginaVazia, type Consulta, type Ordenacao, type Pagina } from '@/lib/listing'

export interface EstadoAsync<T> {
  dados: T | null
  carregando: boolean
  erro: string | null
  recarregar: () => void
}

/**
 * Executa uma busca assíncrona, reexecutando quando `deps` muda.
 *
 * `tabelas` liga a assinatura de Realtime: qualquer escrita naquelas
 * tabelas dispara um refetch agrupado. É o que faz o Kanban de um usuário
 * refletir o arrasto do outro sem recarregar a página.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
  opcoes: { tabelas?: TabelaRealtime[]; canal?: string; ativo?: boolean } = {},
): EstadoAsync<T> {
  const { tabelas, canal, ativo = true } = opcoes

  const [dados, setDados] = useState<T | null>(null)
  const [carregando, setCarregando] = useState(ativo)
  const [erro, setErro] = useState<string | null>(null)

  // `fn` normalmente é uma arrow inline (nova identidade a cada render).
  // Guardar em ref evita loop infinito de efeito.
  const fnRef = useRef(fn)
  fnRef.current = fn

  // Descarta resposta de uma busca antiga que chegou depois de uma nova.
  const geracao = useRef(0)

  const buscar = useCallback(async () => {
    if (!ativo) {
      setCarregando(false)
      return
    }
    const minha = ++geracao.current
    setCarregando(true)
    setErro(null)
    try {
      const r = await fnRef.current()
      if (minha === geracao.current) {
        setDados(r)
        setErro(null)
      }
    } catch (e) {
      if (minha === geracao.current) setErro(mensagemErro(e))
    } finally {
      if (minha === geracao.current) setCarregando(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo])

  useEffect(() => {
    void buscar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscar, ...deps])

  useEffect(() => {
    if (!tabelas?.length || !ativo) return
    const refetch = agrupar(() => void buscar())
    return assinar(canal ?? `rt-${tabelas.join('-')}`, tabelas, refetch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, ativo, buscar, tabelas?.join('-')])

  return { dados, carregando, erro, recarregar: () => void buscar() }
}

/* ------------------------------------------------------------------ *
 * Listagem paginada
 * ------------------------------------------------------------------ */

export interface EstadoLista<T, F> {
  pagina: Pagina<T>
  consulta: Consulta
  filtro: F
  carregando: boolean
  erro: string | null
  /** true na primeira carga; distingue "vazio" de "ainda carregando". */
  inicial: boolean
  /** Texto digitado, antes do debounce — para o input ser controlado. */
  busca: string
  setBusca: (v: string) => void
  setFiltro: (patch: Partial<F>) => void
  trocarFiltro: (f: F) => void
  /** Zera filtro, busca e página numa só atualização. */
  limpar: (filtroVazio: F) => void
  irPara: (pagina: number) => void
  proxima: () => void
  anterior: () => void
  ordenar: (ordem: Ordenacao) => void
  recarregar: () => void
}

/**
 * Lista paginada com busca, filtros e Realtime.
 *
 * A busca é debounced: sem isso, cada tecla no campo de busca vira uma
 * query — o campo de comandas dispararia 20 requisições ao digitar o nome
 * de um cliente.
 */
export function useLista<T, F extends object>(
  buscar: (consulta: Consulta, filtro: F) => Promise<Pagina<T>>,
  filtroInicial: F,
  opcoes: {
    ordem?: Ordenacao
    tabelas?: TabelaRealtime[]
    canal?: string
    debounceMs?: number
  } = {},
): EstadoLista<T, F> {
  const { ordem, tabelas, canal, debounceMs = 320 } = opcoes

  const [consulta, setConsulta] = useState<Consulta>(consultaInicial(ordem))
  const [buscaImediata, setBuscaImediata] = useState('')
  const [filtro, setFiltroState] = useState<F>(filtroInicial)
  const [pagina, setPagina] = useState<Pagina<T>>(paginaVazia<T>())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [inicial, setInicial] = useState(true)

  const buscarRef = useRef(buscar)
  buscarRef.current = buscar
  const geracao = useRef(0)

  // Debounce do texto digitado.
  useEffect(() => {
    const t = setTimeout(() => {
      setConsulta((c) =>
        c.busca === buscaImediata ? c : { ...c, busca: buscaImediata, pagina: 1 },
      )
    }, debounceMs)
    return () => clearTimeout(t)
  }, [buscaImediata, debounceMs])

  const executar = useCallback(async (c: Consulta, f: F) => {
    const minha = ++geracao.current
    setCarregando(true)
    setErro(null)
    try {
      const r = await buscarRef.current(c, f)
      if (minha === geracao.current) {
        setPagina(r)
        setErro(null)
      }
    } catch (e) {
      if (minha === geracao.current) setErro(mensagemErro(e))
    } finally {
      if (minha === geracao.current) {
        setCarregando(false)
        setInicial(false)
      }
    }
  }, [])

  useEffect(() => {
    void executar(consulta, filtro)
  }, [executar, consulta, filtro])

  // O refetch do Realtime precisa da consulta ATUAL, mas a assinatura não
  // pode depender dela.
  //
  // Com `consulta` e `filtro` nas dependências do efeito abaixo, cada
  // troca de página, cada filtro e cada debounce de busca derrubava o
  // canal e abria outro — um round-trip de WebSocket com renegociação de
  // RLS a cada tecla digitada, em /comandas, /clientes, /financeiro,
  // /servicos e /etiquetas.
  //
  // O ref dá o valor fresco no momento do refetch sem entrar nas deps.
  const atualRef = useRef({ consulta, filtro })
  atualRef.current = { consulta, filtro }

  useEffect(() => {
    if (!tabelas?.length) return
    const refetch = agrupar(() => {
      const { consulta: c, filtro: f } = atualRef.current
      void executar(c, f)
    })
    return assinar(canal ?? `rt-lista-${tabelas.join('-')}`, tabelas, refetch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, tabelas?.join('-'), executar])

  return {
    pagina,
    consulta,
    filtro,
    carregando,
    erro,
    inicial,
    busca: buscaImediata,
    setBusca: setBuscaImediata,

    /**
     * "Limpar tudo" precisa zerar a busca de forma SÍNCRONA.
     *
     * Chamar `trocarFiltro({})` + `setBusca('')` não funcionava:
     * `trocarFiltro` dispara o refetch na hora, mas `setBusca` só mexe no
     * state do debounce, e `consulta.busca` só é atualizado 320 ms
     * depois. O primeiro refetch saía COM O TERMO ANTIGO, e a resposta do
     * segundo só chegava mais tarde — o contador ficava travado no valor
     * pré-clique (o "7 em vez de 121" do relatório de QA).
     *
     * Aqui os três states mudam na mesma rodada, então sai um refetch só,
     * já limpo. O efeito de debounce roda depois e não faz nada, porque
     * `c.busca === buscaImediata === ''`.
     */
    limpar: (filtroVazio: F) => {
      setBuscaImediata('')
      setFiltroState(filtroVazio)
      setConsulta((c) => ({ ...c, busca: '', pagina: 1 }))
    },
    // Trocar filtro sempre volta para a página 1: manter a página 5 com
    // um filtro novo normalmente cai num resultado vazio.
    setFiltro: (patch) => {
      setFiltroState((f) => ({ ...f, ...patch }))
      setConsulta((c) => ({ ...c, pagina: 1 }))
    },
    trocarFiltro: (f) => {
      setFiltroState(f)
      setConsulta((c) => ({ ...c, pagina: 1 }))
    },
    irPara: (p) => setConsulta((c) => ({ ...c, pagina: Math.max(1, p) })),
    proxima: () => setConsulta((c) => ({ ...c, pagina: c.pagina + 1 })),
    anterior: () => setConsulta((c) => ({ ...c, pagina: Math.max(1, c.pagina - 1) })),
    ordenar: (o) => setConsulta((c) => ({ ...c, ordem: o, pagina: 1 })),
    recarregar: () => void executar(consulta, filtro),
  }
}

/* ------------------------------------------------------------------ *
 * Ação com estado de envio
 * ------------------------------------------------------------------ */

/**
 * Envolve uma escrita, expondo `enviando` e `erro`.
 * O botão fica desabilitado durante o envio — sem isso, dois cliques
 * rápidos em "Confirmar pagamento" criam dois pagamentos.
 *
 * `erro` é um GETTER sobre um ref, não um valor fixo. O motivo:
 *
 *   const r = await apagar.executar(id)
 *   if (r === null && apagar.erro) { ... }   // ← lê o render ANTERIOR
 *
 * Este é o idiom usado em ~20 lugares do app. Com `erro` sendo state
 * puro, o handler enxerga o valor capturado no closure do render que o
 * criou — sempre `null` na primeira falha. O resultado é erro engolido
 * e, onde havia toast de sucesso depois do `if`, uma mentira: o
 * Financeiro dizia "Lançamento excluído" para um DELETE recusado pela
 * RLS.
 *
 * O ref é escrito antes do `setErro`, então a leitura logo após o
 * `await` já enxerga a falha. O `setErro` continua existindo porque é
 * ele que dispara o re-render de quem exibe `<Erro>` na tela.
 */
export function useAcao<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [enviando, setEnviando] = useState(false)
  const [, setErro] = useState<string | null>(null)
  const erroRef = useRef<string | null>(null)

  const executar = useCallback(
    async (...args: A): Promise<R | null> => {
      setEnviando(true)
      erroRef.current = null
      setErro(null)
      try {
        return await fn(...args)
      } catch (e) {
        erroRef.current = mensagemErro(e)
        setErro(erroRef.current)
        return null
      } finally {
        setEnviando(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return {
    executar,
    enviando,
    get erro() {
      return erroRef.current
    },
    limparErro: () => {
      erroRef.current = null
      setErro(null)
    },
  }
}
