import { motion } from 'framer-motion'
import {
  BellRing,
  Camera,
  CheckCircle2,
  GripVertical,
  LayoutGrid,
  MessageSquarePlus,
  Search,
  User,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GradeFotos } from '@/components/Fotos'
import { CategoriaBadge, Kpi, PageHead, PrazoBadge } from '@/components/dominio'
import { Drawer, Erro, Modal, Select, SkelCards, Spinner, Vazio, useToast } from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { useAcao, useAsync } from '@/lib/hooks'
import { alterarStatus, alterarStatusItem, atualizarComanda, listarItensProducao, obterComanda } from '@/lib/api/comandas'
import type { ItemProducao } from '@/lib/api/comandas'
import { enviarFoto } from '@/lib/api/fotos'
import { useIntegracaoAtiva, useSessao, usePodeEditar } from '@/store/useSessao'
import { brl, comandaCod, cx, fmtData, iso, prazoTom } from '@/lib/utils'
import type { Comanda } from '@/types'

export default function Producao() {
  const nav = useNavigate()
  const { push } = useToast()
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)
  const prefixo = config?.comandas.prefixo ?? 'CF'
  const podeEditar = usePodeEditar('production') || usePodeEditar('orders')
  const whatsappAtivo = useIntegracaoAtiva('whatsapp_notify')

  const [busca, setBusca] = useState('')
  const [resp, setResp] = useState('')
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [detalheId, setDetalheId] = useState<string | null>(null)
  const [obsModal, setObsModal] = useState<Comanda | null>(null)
  const [obsTexto, setObsTexto] = useState('')

  /**
   * Kanban inteiro em uma consulta, com Realtime.
   *
   * Esta é a tela em que o Realtime importa mais: Diego arrasta um card e
   * Camila precisa ver na hora, senão os dois trabalham na mesma peça.
   *
   * O quadro move ITENS, não comandas (migration 20260807100000). Com uma
   * chave pronta e um sapato em execução, a mesma comanda aparece em duas
   * colunas — que é o que o quadro por comanda não conseguia mostrar.
   */
  const quadro = useAsync(
    () => listarItensProducao({ responsavelId: resp || undefined }),
    [resp],
    { tabelas: ['order_items', 'orders', 'order_photos'], canal: 'producao-kanban' },
  )

  const detalhe = useAsync(
    () => (detalheId ? obterComanda(detalheId) : Promise.resolve(null)),
    [detalheId],
    { ativo: !!detalheId, tabelas: ['orders', 'order_photos'], canal: 'producao-detalhe' },
  )

  /** Arrasto do Kanban: move UM item. */
  const mover = useAcao(alterarStatusItem)
  /** Ações do drawer: agem sobre a comanda inteira (fan-out nos itens abertos). */
  const moverComanda = useAcao(alterarStatus)
  const editar = useAcao(atualizarComanda)
  const upload = useAcao(enviarFoto)

  const todas = quadro.dados ?? []

  // A busca é local: o quadro já está em memória e filtrar no cliente
  // evita recarregar as 8 colunas a cada tecla.
  const ativas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return todas
    return todas.filter(
      (c) =>
        c.clienteNome.toLowerCase().includes(t) ||
        c.servicoNome.toLowerCase().includes(t) ||
        comandaCod(c.numero, prefixo).toLowerCase().includes(t) ||
        String(c.numero).includes(t),
    )
  }, [todas, busca, prefixo])

  const colunasKanban = dom.KANBAN_COLS

  const colunas = useMemo(() => {
    const m = new Map<string, ItemProducao[]>()
    for (const s of colunasKanban) m.set(s, [])
    for (const c of ativas) if (m.has(c.status)) m.get(c.status)!.push(c)
    // Dentro da coluna, o mais urgente primeiro.
    for (const [, l] of m) l.sort((a, b) => +new Date(a.prazoEm) - +new Date(b.prazoEm))
    return m
  }, [ativas, colunasKanban])

  async function soltar(status: string) {
    if (!arrastando) return
    const c = todas.find((x) => x.id === arrastando)
    setArrastando(null)
    setSobre(null)
    if (!c || c.status === status) return

    if (!podeEditar) {
      push({ tipo: 'erro', titulo: 'Sem permissão', descricao: 'Seu perfil não altera o status da comanda.' })
      return
    }

    // `entregue` não sai daqui: a entrega exige quem retirou e a foto do
    // "Depois", e a RPC recusaria um arrasto seco. O caminho é a ficha.
    if (status === 'entregue') {
      setDetalheId(c.comandaId)
      push({
        tipo: 'info',
        titulo: 'Entrega é na ficha da comanda',
        descricao: 'É preciso registrar quem está retirando.',
      })
      return
    }

    const r = await mover.executar(c.id, status)
    if (r === null && mover.erro) {
      push({ tipo: 'erro', titulo: 'Não foi possível mover', descricao: mover.erro })
      return
    }

    push({
      tipo: 'ok',
      titulo: `${comandaCod(c.numero, prefixo)}/${c.posicao} → ${dom.st(status).label}`,
      descricao: `${c.clienteNome} · ${c.servicoNome}`,
    })
    quadro.recarregar()
  }

  const emExecucao = ativas.filter((c) => c.status === 'execucao').length
  const atrasadas = ativas.filter((c) => c.atrasada).length
  const prontas = ativas.filter((c) => c.status === 'pronta' || c.status === 'avisado').length
  const venceHoje = ativas.filter((c) => !dom.st(c.status).final && c.diasRestantes === 0).length

  const d = detalhe.dados

  return (
    <div>
      <PageHead
        titulo="Produção"
        subtitulo={
          podeEditar
            ? 'Arraste os cards para mover o serviço entre as etapas de execução.'
            : 'Acompanhamento das etapas de execução (somente leitura).'
        }
        acoes={
          <>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                className="field pl-9 w-full sm:w-56"
                placeholder="Buscar na produção…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Buscar na produção"
              />
            </div>
            <Select
              value={resp}
              onChange={setResp}
              placeholder="Todos responsáveis"
              aria-label="Filtrar responsável"
              className="w-full sm:w-48"
              options={dom.EXECUTORES.map((m) => ({ value: m.id, label: m.nome }))}
            />
          </>
        }
      />

      {quadro.carregando && !quadro.dados ? (
        <SkelCards />
      ) : quadro.erro ? (
        <div className="card">
          <Erro mensagem={quadro.erro} onTentarNovamente={quadro.recarregar} />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Em execução" valor={emExecucao} hint="Serviços na bancada" icon={LayoutGrid} />
            <Kpi label="Vencem hoje" valor={venceHoje} hint="Prioridade máxima" tom="alerta" />
            <Kpi label="Atrasados" valor={atrasadas} hint="Prazo estourado" tom={atrasadas ? 'perigo' : 'neutro'} />
            <Kpi label="Prontos" valor={prontas} hint="Aguardando retirada" tom="ok" />
          </div>

          {/* Kanban */}
          <div className={cx('mt-6 flex gap-3 overflow-x-auto scroll-x pb-4', quadro.carregando && 'opacity-70')}>
            {colunasKanban.map((status) => {
              const l = colunas.get(status) ?? []
              const meta = dom.st(status)
              const alvo = sobre === status

              return (
                <section
                  key={status}
                  onDragOver={(e) => {
                    if (!podeEditar) return
                    e.preventDefault()
                    setSobre(status)
                  }}
                  onDragLeave={() => setSobre((s) => (s === status ? null : s))}
                  onDrop={() => void soltar(status)}
                  className={cx(
                    'flex w-[286px] shrink-0 flex-col rounded-card border transition-colors',
                    alvo ? 'border-brass-400 bg-brass-50/60' : 'border-ink-100 bg-ink-50/60',
                  )}
                >
                  <header className="flex items-center justify-between gap-2 px-3.5 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.cor }} />
                      <h3 className="truncate text-[13px] font-bold text-ink-800">{meta.label}</h3>
                    </div>
                    <span className="num shrink-0 rounded-full bg-white px-2 py-0.5 text-[11.5px] font-bold text-ink-600 shadow-soft">
                      {l.length}
                    </span>
                  </header>

                  <div className="flex-1 space-y-2 px-2.5 pb-3 min-h-[120px] max-h-[calc(100vh-380px)] overflow-y-auto scroll-x">
                    {l.map((c) => (
                      <CardKanban
                        key={c.id}
                        comanda={c}
                        prefixo={prefixo}
                        finalizado={dom.st(c.status).final}
                        arrastavel={podeEditar}
                        arrastando={arrastando === c.id}
                        onDragStart={() => setArrastando(c.id)}
                        onDragEnd={() => {
                          setArrastando(null)
                          setSobre(null)
                        }}
                        onClick={() => setDetalheId(c.id)}
                      />
                    ))}

                    {l.length === 0 && (
                      <div className="grid place-items-center rounded-xl border border-dashed border-ink-200 py-8 text-center">
                        <p className="text-[12px] text-ink-400 px-3">
                          {alvo ? 'Solte aqui' : 'Nenhum serviço nesta etapa'}
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              )
            })}
          </div>

          {ativas.length === 0 && (
            <div className="card mt-4">
              <Vazio
                icon={LayoutGrid}
                titulo={busca || resp ? 'Nenhum serviço encontrado' : 'Nenhum serviço na produção'}
                descricao={
                  busca || resp
                    ? 'Ajuste a busca ou o filtro de responsável.'
                    : 'Os serviços aparecem aqui assim que uma comanda for aberta no balcão.'
                }
                acao={
                  (busca || resp) && (
                    <button
                      onClick={() => {
                        setBusca('')
                        setResp('')
                      }}
                      className="btn-outline"
                    >
                      Limpar filtros
                    </button>
                  )
                }
              />
            </div>
          )}
        </>
      )}

      {/* Drawer de detalhe rápido */}
      <Drawer
        open={!!detalheId}
        onClose={() => setDetalheId(null)}
        title={d ? comandaCod(d.numero, prefixo) : 'Carregando…'}
        subtitle={d ? `${d.clienteNome} · ${d.servicoNome}` : ''}
        footer={
          d && (
            <>
              <button className="btn-ghost" onClick={() => setDetalheId(null)}>
                Fechar
              </button>
              <button className="btn-primary" onClick={() => nav(`/comandas/${d.id}`)}>
                Abrir comanda
              </button>
            </>
          )
        }
      >
        {detalhe.carregando && !d && (
          <p className="flex items-center justify-center gap-2 py-10 text-[13.5px] text-ink-400">
            <Spinner />
            Carregando comanda…
          </p>
        )}

        {detalhe.erro && <Erro mensagem={detalhe.erro} onTentarNovamente={detalhe.recarregar} />}

        {d && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <CategoriaBadge cat={d.categoria} />
              <PrazoBadge prazo={d.prazoEm} status={d.status} />
              <span className="badge bg-ink-100 text-ink-600 num">{brl(d.valor)}</span>
              {d.saldoAberto > 0.01 && (
                <span className="badge bg-danger/10 text-danger num">Saldo {brl(d.saldoAberto)}</span>
              )}
            </div>

            {!podeEditar && (
              <p className="rounded-xl bg-ink-50 px-3.5 py-2.5 text-[12.5px] text-ink-500">
                Seu perfil acompanha a produção, mas não altera comandas.
              </p>
            )}

            {podeEditar && (
              <>
                <div>
                  <span className="label">Mover para</span>
                  <div className="flex flex-wrap gap-2">
                    {colunasKanban.map((s) => (
                      <button
                        key={s}
                        disabled={moverComanda.enviando || dom.st(d.status).final}
                        onClick={async () => {
                          // Comanda inteira: aplica a todos os itens abertos.
                          const r = await moverComanda.executar(d.id, s)
                          if (r === null && moverComanda.erro) {
                            push({ tipo: 'erro', titulo: 'Não foi possível mover', descricao: moverComanda.erro })
                            return
                          }
                          push({ tipo: 'ok', titulo: 'Status atualizado', descricao: dom.st(s).label })
                          detalhe.recarregar()
                          quadro.recarregar()
                        }}
                        className={cx('chip disabled:opacity-50', d.status === s && 'chip-on')}
                      >
                        {dom.st(s).label}
                      </button>
                    ))}
                  </div>
                  {dom.st(d.status).final && (
                    <p className="mt-2 text-[12px] text-ink-400">
                      Comanda finalizada — o status não muda mais.
                    </p>
                  )}
                </div>

                <div>
                  <span className="label">Responsável</span>
                  <Select
                    value={d.responsavelId ?? ''}
                    onChange={async (v) => {
                      const nome = dom.membro(v)?.nome ?? '—'
                      const r = await editar.executar(
                        d.id,
                        { responsavelId: v || null },
                        `Responsável alterado para ${nome}`,
                      )
                      if (r === null && editar.erro) {
                        push({ tipo: 'erro', titulo: 'Falha ao salvar', descricao: editar.erro })
                        return
                      }
                      push({ tipo: 'ok', titulo: 'Responsável atualizado', descricao: nome })
                      detalhe.recarregar()
                      quadro.recarregar()
                    }}
                    placeholder="Sem responsável"
                    options={dom.EXECUTORES.map((m) => ({ value: m.id, label: m.nome }))}
                    aria-label="Responsável"
                  />
                </div>

                <div>
                  <span className="label">Prazo</span>
                  <input
                    type="date"
                    className="field num"
                    value={new Date(d.prazoEm).toISOString().slice(0, 10)}
                    onChange={async (e) => {
                      const nova = new Date(`${e.target.value}T12:00:00`)
                      const r = await editar.executar(
                        d.id,
                        { prazoEm: iso(nova) },
                        `Prazo alterado para ${fmtData(nova)}`,
                      )
                      if (r === null && editar.erro) {
                        push({ tipo: 'erro', titulo: 'Falha ao salvar', descricao: editar.erro })
                        return
                      }
                      push({ tipo: 'ok', titulo: 'Prazo atualizado', descricao: fmtData(nova) })
                      detalhe.recarregar()
                      quadro.recarregar()
                    }}
                    aria-label="Prazo"
                  />
                </div>
              </>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="label !mb-0">Fotos</span>
                <span className="num text-[12px] text-ink-400">{d.fotos.length}</span>
              </div>
              <GradeFotos
                fotos={d.fotos}
                categoria={d.categoria}
                editavel={podeEditar && !dom.st(d.status).final}
                onArquivo={async (file, tipo, legenda) => {
                  const r = await upload.executar(d.id, file, tipo, legenda)
                  if (r === null && upload.erro) throw new Error(upload.erro)
                  detalhe.recarregar()
                  quadro.recarregar()
                }}
                colunas="grid-cols-3"
                altura="h-24"
              />
            </div>

            {podeEditar && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setObsModal(d)
                    setObsTexto('')
                  }}
                  className="btn-outline"
                >
                  <MessageSquarePlus size={14} />
                  Observação
                </button>
                <button
                  onClick={() =>
                    push(
                      whatsappAtivo
                        ? { tipo: 'ok', titulo: 'Cliente avisado', descricao: d.clienteNome }
                        : {
                            tipo: 'info',
                            titulo: 'WhatsApp não configurado',
                            descricao: 'Ative a integração em Configurações → Integrações.',
                          },
                    )
                  }
                  disabled={!whatsappAtivo}
                  title={
                    !whatsappAtivo
                      ? 'Ative "WhatsApp — avisar cliente" em Configurações → Integrações.'
                      : undefined
                  }
                  className="btn-outline disabled:opacity-45"
                >
                  <BellRing size={14} />
                  Avisar cliente
                </button>
                {/* Age na comanda inteira: marca pronto TODOS os itens ainda
                    abertos. Para uma peça só, use o card no Kanban. */}
                <button
                  disabled={moverComanda.enviando || dom.st(d.status).final}
                  onClick={async () => {
                    const r = await moverComanda.executar(d.id, 'pronta')
                    if (r === null && moverComanda.erro) {
                      push({ tipo: 'erro', titulo: 'Falha', descricao: moverComanda.erro })
                      return
                    }
                    push({
                      tipo: 'ok',
                      titulo: 'Marcado como pronto',
                      descricao: d.itens.length > 1 ? `${d.itens.length} itens` : undefined,
                    })
                    detalhe.recarregar()
                    quadro.recarregar()
                  }}
                  className="btn-outline disabled:opacity-50"
                >
                  <CheckCircle2 size={14} />
                  Marcar pronto
                </button>
                {/* A entrega mora na ficha: exige quem retirou e a foto do
                    "Depois", e com vários itens é uma decisão por peça. */}
                <button
                  disabled={dom.st(d.status).final}
                  onClick={() => nav(`/comandas/${d.id}`)}
                  className="btn-primary disabled:opacity-50"
                >
                  Entregar na ficha
                </button>
              </div>
            )}

            {d.observacoes && (
              <div className="rounded-xl bg-ink-50 p-3.5">
                <p className="label !mb-1">Observações</p>
                <p className="whitespace-pre-line text-[13px] text-ink-700 leading-relaxed">{d.observacoes}</p>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Observação */}
      <Modal
        open={!!obsModal}
        onClose={() => setObsModal(null)}
        title="Adicionar observação"
        subtitle={obsModal ? comandaCod(obsModal.numero, prefixo) : ''}
        size="sm"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setObsModal(null)}>
              Cancelar
            </button>
            <button
              className="btn-primary"
              disabled={!obsTexto.trim() || editar.enviando}
              onClick={async () => {
                if (!obsModal) return
                const nova = obsModal.observacoes
                  ? `${obsModal.observacoes}\n• ${obsTexto.trim()}`
                  : obsTexto.trim()
                const r = await editar.executar(obsModal.id, { observacoes: nova }, 'Observação adicionada')
                if (r === null && editar.erro) {
                  push({ tipo: 'erro', titulo: 'Falha ao salvar', descricao: editar.erro })
                  return
                }
                setObsModal(null)
                setObsTexto('')
                push({ tipo: 'ok', titulo: 'Observação registrada' })
                detalhe.recarregar()
                quadro.recarregar()
              }}
            >
              {editar.enviando ? <Spinner /> : null}
              Salvar
            </button>
          </>
        }
      >
        <label className="label" htmlFor="p-obs">
          Anotação da produção
        </label>
        <textarea
          id="p-obs"
          autoFocus
          rows={4}
          className="field resize-none"
          value={obsTexto}
          onChange={(e) => setObsTexto(e.target.value)}
          placeholder="Ex.: Aguardando salto na cor exata, previsto para quinta."
        />
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CardKanban({
  comanda: c,
  prefixo,
  finalizado,
  arrastavel,
  arrastando,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  /** Um ITEM da comanda desde a migration 20260807100000. */
  comanda: ItemProducao
  prefixo: string
  finalizado: boolean
  arrastavel: boolean
  arrastando: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onClick: () => void
}) {
  const tom = prazoTom(c.prazoEm, c.status, finalizado)
  const foto = c.fotos[0]

  return (
    <motion.article
      layout
      draggable={arrastavel}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cx(
        'group cursor-pointer rounded-xl border bg-white p-3 shadow-soft transition',
        'hover:border-ink-300 hover:shadow-lift',
        arrastavel && 'active:cursor-grabbing',
        arrastando ? 'opacity-40 border-brass-400' : 'border-ink-100',
        tom === 'atraso' && 'border-l-[3px] border-l-danger',
        tom === 'proximo' && 'border-l-[3px] border-l-brass-400',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* O sufixo /N identifica a PEÇA na bancada — é o mesmo da etiqueta. */}
        <span className="num text-[11px] font-bold text-ink-400">
          {comandaCod(c.numero, prefixo)}
          <span className="text-ink-300">/{c.posicao}</span>
        </span>
        {arrastavel && (
          <GripVertical size={13} className="text-ink-300 opacity-0 transition group-hover:opacity-100" />
        )}
      </div>

      <p className="mt-1 truncate text-[13.5px] font-bold text-ink-900">{c.clienteNome}</p>
      <p className="truncate text-[12px] text-ink-500">{c.servicoNome}</p>

      <div className="mt-2.5 flex items-center gap-2">
        {foto ? (
          <GradeFotos
            fotos={[foto]}
            categoria={c.categoria}
            editavel={false}
            colunas="grid-cols-1"
            altura="h-11 w-11"
          />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-dashed border-ink-200 text-ink-300">
            <Camera size={13} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <CategoriaBadge cat={c.categoria} />
          <p className="num mt-1 text-[12px] font-bold text-ink-900">{brl(c.valor)}</p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-ink-50 pt-2">
        <span className="flex items-center gap-1 text-[11.5px] text-ink-500">
          <User size={11} />
          {c.responsavel}
        </span>
        <PrazoBadge prazo={c.prazoEm} status={c.status} compacto />
      </div>
    </motion.article>
  )
}
