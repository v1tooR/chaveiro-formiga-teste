import { Archive, ArchiveRestore, Copy, Hammer, Pencil, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CategoriaBadge, IconeCategoria, Kpi, PageHead } from '@/components/dominio'
import {
  Confirm,
  Erro,
  Modal,
  Select,
  SkelCards,
  SkelLinhas,
  Spinner,
  Vazio,
  useToast,
} from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { useAcao, useAsync } from '@/lib/hooks'
import {
  type ArquivoServicos,
  alternarArquivamento,
  atualizarServico,
  contarUsoServicos,
  criarServico,
  duplicarServico,
  listarServicos,
  type NovoServico,
} from '@/lib/api/servicos'
import { usePodeEditar } from '@/store/useSessao'
import { PRAZO_MAX_DIAS, brl, cx, numeroDeInput } from '@/lib/utils'
import type { Servico } from '@/types'

export default function Servicos() {
  const [params, setParams] = useSearchParams()
  const { push } = useToast()
  const dom = useDominioMaps()
  const podeEditar = usePodeEditar('services')

  const [busca, setBusca] = useState('')
  const [termo, setTermo] = useState('')
  const [cat, setCat] = useState('')
  // Tri-estado: o chip "Arquivados" agora mostra SÓ os arquivados, que é
  // o que o rótulo sempre prometeu.
  const [arquivo, setArquivo] = useState<ArquivoServicos>('ativos')
  const [editando, setEditando] = useState<Servico | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  const [confirmar, setConfirmar] = useState<Servico | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 320)
    return () => clearTimeout(t)
  }, [busca])

  useEffect(() => {
    if (params.get('novo') === '1') {
      setNovoAberto(true)
      params.delete('novo')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  /**
   * O catálogo é pequeno (dezenas de itens) e serve de lookup para o
   * atendimento inteiro, então carrega completo em vez de paginado.
   */
  const servicos = useAsync(
    () =>
      listarServicos({
        categoria: cat || undefined,
        arquivo,
        busca: termo || undefined,
      }),
    [cat, arquivo, termo],
    { tabelas: ['services'], canal: 'servicos-lista' },
  )

  /** Volume de uso por serviço — ranking da lista. */
  const uso = useAsync(() => contarUsoServicos(), [], {
    tabelas: ['orders'],
    canal: 'servicos-uso',
  })

  /** Catálogo ativo completo, para os KPIs não dependerem dos filtros. */
  const todos = useAsync(() => listarServicos({ arquivo: 'todos' }), [], {
    tabelas: ['services'],
    canal: 'servicos-todos',
  })

  const criar = useAcao(criarServico)
  const salvar = useAcao(atualizarServico)
  const duplicar = useAcao(duplicarServico)
  const arquivar = useAcao(alternarArquivamento)

  const mapaUso = uso.dados ?? new Map<string, number>()

  const lista = useMemo(
    () => (servicos.dados ?? []).slice().sort((a, b) => (mapaUso.get(b.id) ?? 0) - (mapaUso.get(a.id) ?? 0)),
    [servicos.dados, mapaUso],
  )

  const catalogo = todos.dados ?? []
  const ativos = catalogo.filter((s) => s.ativo)
  const precoMedio = ativos.length ? ativos.reduce((a, s) => a + s.precoBase, 0) / ativos.length : 0
  const prazoMedio = ativos.length ? ativos.reduce((a, s) => a + s.prazoDias, 0) / ativos.length : 0

  const porCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of ativos) m.set(s.categoria, (m.get(s.categoria) ?? 0) + 1)
    return m
  }, [ativos])

  const erroAcao = criar.erro ?? salvar.erro ?? duplicar.erro ?? arquivar.erro

  return (
    <div>
      <PageHead
        titulo="Serviços"
        subtitulo="Catálogo de serviços com preço base, prazo padrão e responsável."
        acoes={
          podeEditar && (
            <button onClick={() => setNovoAberto(true)} className="btn-accent">
              <Plus size={16} strokeWidth={2.6} />
              Novo serviço
            </button>
          )
        }
      />

      {erroAcao && (
        <div className="mb-4">
          <Erro
            compacto
            mensagem={erroAcao}
            onTentarNovamente={() => {
              criar.limparErro()
              salvar.limparErro()
              duplicar.limparErro()
              arquivar.limparErro()
            }}
          />
        </div>
      )}

      {todos.carregando && !todos.dados ? (
        <SkelCards />
      ) : todos.erro ? (
        <Erro compacto mensagem={todos.erro} onTentarNovamente={todos.recarregar} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Serviços ativos" valor={ativos.length} hint="Disponíveis no atendimento" icon={Hammer} />
          <Kpi label="Preço médio" valor={brl(precoMedio)} hint="Média do catálogo ativo" tom="ok" />
          <Kpi label="Prazo médio" valor={`${prazoMedio.toFixed(1)} dias`} hint="Tempo padrão de execução" />
          <Kpi
            label="Arquivados"
            valor={catalogo.length - ativos.length}
            hint="Fora do atendimento"
            onClick={() => setArquivo('arquivados')}
          />
        </div>
      )}

      {/* Categorias */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {dom.CATEGORIA_LIST.slice(0, 3).map((c) => (
          <button
            key={c}
            onClick={() => setCat(cat === c ? '' : c)}
            className={cx('card card-hover p-4 text-left', cat === c && 'ring-2 ring-ink-900 ring-offset-1')}
          >
            <div className="flex items-center gap-3">
              <span
                className="grid h-10 w-10 place-items-center rounded-xl"
                style={{ background: dom.cat(c).bg, color: dom.cat(c).cor }}
              >
                <IconeCategoria cat={c} size={18} />
              </span>
              <div>
                <p className="text-[14.5px] font-bold text-ink-900">{dom.cat(c).label}</p>
                <p className="num text-[12.5px] text-ink-500">{porCat.get(c) ?? 0} serviços ativos</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="card mt-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="field pl-9"
              placeholder="Buscar serviço…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar serviço"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setCat('')} className={cx('chip', !cat && 'chip-on')}>
              Todas
            </button>
            {dom.CATEGORIA_LIST.map((c) => (
              <button key={c} onClick={() => setCat(c)} className={cx('chip', cat === c && 'chip-on')}>
                {dom.cat(c).label}
              </button>
            ))}
            <button
              onClick={() => setArquivo((v) => (v === 'arquivados' ? 'ativos' : 'arquivados'))}
              className={cx('chip', arquivo === 'arquivados' && 'chip-on')}
            >
              <Archive size={12} />
              Arquivados
            </button>
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="mt-4">
        {servicos.carregando && !servicos.dados ? (
          <SkelLinhas n={8} />
        ) : servicos.erro ? (
          <div className="card">
            <Erro mensagem={servicos.erro} onTentarNovamente={servicos.recarregar} />
          </div>
        ) : lista.length === 0 ? (
          <div className="card">
            <Vazio
              icon={Hammer}
              titulo={termo || cat ? 'Nenhum serviço encontrado' : 'Catálogo vazio'}
              descricao={
                termo || cat
                  ? 'Ajuste os filtros ou a busca.'
                  : 'Cadastre os serviços da loja para que o atendimento possa abrir comandas.'
              }
              acao={
                podeEditar && (
                  <button onClick={() => setNovoAberto(true)} className="btn-primary">
                    <Plus size={15} />
                    Novo serviço
                  </button>
                )
              }
            />
          </div>
        ) : (
          <div className={cx('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', servicos.carregando && 'opacity-60')}>
            {lista.map((s) => (
              <div key={s.id} className={cx('card p-4', !s.ativo && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[14.5px] font-bold text-ink-900 leading-snug">{s.nome}</h3>
                    <div className="mt-1.5">
                      <CategoriaBadge cat={s.categoria} />
                    </div>
                  </div>
                  <span className="num shrink-0 text-[16px] font-bold text-ink-900">{brl(s.precoBase)}</span>
                </div>

                <p className="mt-2.5 text-[12.5px] text-ink-500 leading-relaxed line-clamp-2">
                  {s.descricao || 'Sem descrição.'}
                </p>

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3">
                  <div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">Prazo</p>
                    <p className="num text-[13px] font-bold text-ink-900">
                      {s.prazoDias === 0 ? 'No ato' : `${s.prazoDias}d`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">Resp.</p>
                    <p className="truncate text-[13px] font-bold text-ink-900">{s.responsavelPadrao}</p>
                  </div>
                  <div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
                      Realizados
                    </p>
                    <p className="num text-[13px] font-bold text-ink-900">{mapaUso.get(s.id) ?? 0}</p>
                  </div>
                </div>

                {podeEditar && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button onClick={() => setEditando(s)} className="btn-outline text-[12px] py-1.5 px-2.5">
                      <Pencil size={12} />
                      Editar
                    </button>
                    <button
                      disabled={duplicar.enviando}
                      onClick={async () => {
                        const r = await duplicar.executar(s.id, dom.EQUIPE)
                        if (!r) return
                        push({ tipo: 'ok', titulo: 'Serviço duplicado', descricao: r.nome })
                        servicos.recarregar()
                        todos.recarregar()
                      }}
                      className="btn-outline text-[12px] py-1.5 px-2.5"
                    >
                      <Copy size={12} />
                      Duplicar
                    </button>
                    <button onClick={() => setConfirmar(s)} className="btn-ghost text-[12px] py-1.5 px-2.5">
                      {s.ativo ? <Archive size={12} /> : <ArchiveRestore size={12} />}
                      {s.ativo ? 'Arquivar' : 'Reativar'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modais */}
      <ModalServico
        open={novoAberto || !!editando}
        onClose={() => {
          setNovoAberto(false)
          setEditando(null)
        }}
        servico={editando}
        enviando={criar.enviando || salvar.enviando}
        erro={criar.erro ?? salvar.erro}
        onSalvar={async (d) => {
          if (editando) {
            const r = await salvar.executar(editando.id, d)
            if (r === null && salvar.erro) return
            push({ tipo: 'ok', titulo: 'Serviço atualizado', descricao: d.nome })
          } else {
            const r = await criar.executar(d, dom.EQUIPE)
            if (!r) return
            push({ tipo: 'ok', titulo: 'Serviço criado', descricao: r.nome })
          }
          setNovoAberto(false)
          setEditando(null)
          servicos.recarregar()
          todos.recarregar()
        }}
      />

      <Confirm
        open={!!confirmar}
        onClose={() => setConfirmar(null)}
        title={confirmar?.ativo ? 'Arquivar serviço' : 'Reativar serviço'}
        message={
          confirmar?.ativo
            ? `"${confirmar?.nome}" deixará de aparecer no atendimento. As comandas existentes não são afetadas.`
            : `"${confirmar?.nome}" voltará a ficar disponível no atendimento.`
        }
        confirmLabel={confirmar?.ativo ? 'Arquivar' : 'Reativar'}
        onConfirm={async () => {
          if (!confirmar) return
          const r = await arquivar.executar(confirmar.id, !confirmar.ativo)
          if (r === null && arquivar.erro) return
          push({
            tipo: 'ok',
            titulo: confirmar.ativo ? 'Serviço arquivado' : 'Serviço reativado',
            descricao: confirmar.nome,
          })
          servicos.recarregar()
          todos.recarregar()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ModalServico({
  open,
  onClose,
  servico,
  onSalvar,
  enviando,
  erro,
}: {
  open: boolean
  onClose: () => void
  servico: Servico | null
  onSalvar: (d: NovoServico) => void | Promise<void>
  enviando: boolean
  erro: string | null
}) {
  const dom = useDominioMaps()
  const catInicial = dom.CATEGORIA_LIST[0] ?? 'chaveiro'

  const vazio = (): NovoServico => ({
    nome: '',
    categoria: catInicial,
    descricao: '',
    precoBase: 0,
    prazoDias: 1,
    garantiaDias: 0,
    responsavelPadraoId: dom.EXECUTORES[0]?.id ?? null,
    ativo: true,
    observacoes: '',
  })

  const [f, setF] = useState<NovoServico>(vazio)

  useEffect(() => {
    if (!open) return
    setF(
      servico
        ? {
            nome: servico.nome,
            categoria: servico.categoria,
            descricao: servico.descricao,
            precoBase: servico.precoBase,
            prazoDias: servico.prazoDias,
            garantiaDias: servico.garantiaDias,
            responsavelPadraoId: servico.responsavelPadraoId,
            ativo: servico.ativo,
            observacoes: servico.observacoes,
          }
        : vazio(),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, servico, catInicial])

  // Regras 5, 6 e 7 — as mesmas que o banco valida por CHECK.
  const valido = f.nome.trim().length > 2 && f.precoBase >= 0 && f.prazoDias >= 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={servico ? 'Editar serviço' : 'Novo serviço'}
      subtitle="Define o preço e o prazo sugeridos no atendimento."
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={!valido || enviando} onClick={() => void onSalvar(f)}>
            {enviando ? <Spinner /> : null}
            Salvar serviço
          </button>
        </>
      }
    >
      {erro && (
        <div className="mb-4">
          <Erro compacto mensagem={erro} />
        </div>
      )}

      <div className="space-y-3.5">
        <div>
          <label className="label" htmlFor="s-nome">
            Nome do serviço *
          </label>
          <input
            id="s-nome"
            autoFocus
            className="field"
            value={f.nome}
            onChange={(e) => setF({ ...f, nome: e.target.value })}
            placeholder="Ex.: Troca de salto"
          />
        </div>

        <div>
          <span className="label">Categoria</span>
          <div className="flex flex-wrap gap-2">
            {dom.CATEGORIA_LIST.map((c) => (
              <button
                key={c}
                onClick={() => setF({ ...f, categoria: c })}
                className={cx('chip', f.categoria === c && 'chip-on')}
              >
                <IconeCategoria cat={c} size={12} />
                {dom.cat(c).label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="s-desc">
            Descrição
          </label>
          <textarea
            id="s-desc"
            rows={3}
            className="field resize-none"
            value={f.descricao}
            onChange={(e) => setF({ ...f, descricao: e.target.value })}
            placeholder="O que está incluso neste serviço."
          />
        </div>

        <div className="grid gap-3.5 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="s-preco">
              Preço base
            </label>
            <input
              id="s-preco"
              type="number"
              min={0}
              step="0.01"
              className="field num"
              value={f.precoBase}
              onChange={(e) => setF({ ...f, precoBase: numeroDeInput(e, { min: 0 }) })}
            />
          </div>
          <div>
            <label className="label" htmlFor="s-prazo">
              Prazo (dias)
            </label>
            <input
              id="s-prazo"
              type="number"
              min={0}
              max={PRAZO_MAX_DIAS}
              className="field num"
              value={f.prazoDias}
              onChange={(e) => setF({ ...f, prazoDias: numeroDeInput(e, { min: 0, max: PRAZO_MAX_DIAS }) })}
            />
          </div>
          <div>
            <label className="label" htmlFor="s-garantia">
              Garantia (dias)
            </label>
            <input
              id="s-garantia"
              type="number"
              min={0}
              max={PRAZO_MAX_DIAS}
              className="field num"
              value={f.garantiaDias}
              onChange={(e) =>
                setF({ ...f, garantiaDias: numeroDeInput(e, { min: 0, max: PRAZO_MAX_DIAS }) })
              }
            />
            <p className="mt-1 text-[12px] text-ink-500">
              0 = sem garantia. Fica gravado na peça na hora da venda — mudar aqui depois não
              altera o que já foi combinado.
            </p>
          </div>
          <div>
            <span className="label">Responsável</span>
            <Select
              value={f.responsavelPadraoId ?? ''}
              onChange={(v) => setF({ ...f, responsavelPadraoId: v || null })}
              placeholder="Sem responsável"
              options={dom.EXECUTORES.map((m) => ({ value: m.id, label: m.nome }))}
              aria-label="Responsável padrão"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="s-obs">
            Observações
          </label>
          <input
            id="s-obs"
            className="field"
            value={f.observacoes}
            onChange={(e) => setF({ ...f, observacoes: e.target.value })}
            placeholder="Informações internas sobre o serviço"
          />
        </div>

        <label className="flex items-center gap-2.5 rounded-xl border border-ink-100 px-3.5 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={f.ativo}
            onChange={(e) => setF({ ...f, ativo: e.target.checked })}
            className="h-4 w-4 accent-ink-900"
          />
          <span className="text-[13.5px] font-semibold text-ink-800">Disponível no atendimento</span>
        </label>
      </div>
    </Modal>
  )
}
