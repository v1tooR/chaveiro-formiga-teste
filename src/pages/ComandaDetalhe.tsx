import {
  ArrowLeft,
  BellRing,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  History,
  PackageCheck,
  Pencil,
  Printer,
  Receipt,
  RotateCcw,
  Tag,
  Wallet,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { GradeFotos } from '@/components/Fotos'
import ImprimirComanda from '@/components/ImprimirComanda'
import ImprimirEtiqueta from '@/components/ImprimirEtiqueta'
import ReciboEntrega from '@/components/ReciboEntrega'
import RegistrarPagamento from '@/components/RegistrarPagamento'
import { Avatar, CategoriaBadge, PrazoBadge, StatusBadge } from '@/components/dominio'
import { Erro, Modal, Select, SkelLinhas, Spinner, Tabs, Tip, Vazio, useToast } from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { useAcao, useAsync } from '@/lib/hooks'
import {
  abrirRetrabalho,
  alterarStatus,
  alterarStatusItem,
  atualizarComanda,
  obterComanda,
} from '@/lib/api/comandas'
import type { DadosAprovacao, DadosEntrega } from '@/lib/api/comandas'
import { enviarFoto, marcarTipoFoto, removerFoto } from '@/lib/api/fotos'
import { listarServicos } from '@/lib/api/servicos'
import { useIntegracaoAtiva, useSessao, usePodeEditar, usePodeVer } from '@/store/useSessao'
import {
  addDias,
  brl,
  comandaCod,
  cx,
  fmtData,
  fmtDataHora,
  iso,
  numeroDeInput,
  prazoTexto,
  telefoneFmt,
} from '@/lib/utils'
import type { Comanda, ItemComanda } from '@/types'

export default function ComandaDetalhe() {
  const { id } = useParams()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const { push } = useToast()
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)
  const whatsappAtivo = useIntegracaoAtiva('whatsapp_notify')

  const podeVerCliente = usePodeVer('customers')
  const podeOperar = usePodeEditar('orders') || usePodeEditar('production')
  const podeReceber = usePodeEditar('finance') || usePodeEditar('service_desk') || usePodeEditar('orders')
  const podeEtiqueta = usePodeEditar('labels')

  const [aba, setAba] = useState('geral')
  const [printOpen, setPrintOpen] = useState(false)
  const [etiquetaOpen, setEtiquetaOpen] = useState(false)
  const [pagOpen, setPagOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [entregaOpen, setEntregaOpen] = useState(false)
  const [reciboOpen, setReciboOpen] = useState(false)
  const [reciboPendente, setReciboPendente] = useState(false)
  const [entrega, setEntrega] = useState({ nome: '', documento: '', observacao: '' })
  /** Item sendo entregue. `null` = entrega da comanda inteira. */
  const [itemEntrega, setItemEntrega] = useState<ItemComanda | null>(null)
  /** Item saindo de "Aguardando aprovação", com o status de destino. */
  const [aprovacao, setAprovacao] = useState<{ item: ItemComanda; destino: string } | null>(null)
  const [formAprov, setFormAprov] = useState({ nome: '', canal: '', valor: '' })
  /** Item entregue que o cliente trouxe de volta. */
  const [retrabalho, setRetrabalho] = useState<ItemComanda | null>(null)
  const [formRetrab, setFormRetrab] = useState({ motivo: '', valor: '0' })

  const detalhe = useAsync(() => (id ? obterComanda(id) : Promise.resolve(null)), [id], {
    // Realtime: se a produção mover a comanda enquanto o balcão a olha, a
    // ficha acompanha.
    tabelas: ['orders', 'order_photos', 'order_payments', 'order_events'],
    canal: `comanda-${id}`,
  })

  const mover = useAcao(alterarStatus)
  const moverItem = useAcao(alterarStatusItem)
  const criarRetrabalho = useAcao(abrirRetrabalho)
  const editar = useAcao(atualizarComanda)
  const upload = useAcao(enviarFoto)
  const apagarFoto = useAcao(removerFoto)
  const marcarFoto = useAcao(marcarTipoFoto)

  // Abre o preview logo após criar a comanda (?print=1).
  useEffect(() => {
    if (params.get('print') === '1') {
      setPrintOpen(true)
      params.delete('print')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  /**
   * Abre o recibo assim que a entrega aparece nos dados recarregados.
   *
   * `recarregar()` não devolve promise, então abrir o modal na mesma volta
   * do clique mostraria a comanda ANTERIOR — sem quem retirou, sem data.
   * O cliente está no balcão esperando para assinar; o papel tem que sair
   * preenchido.
   */
  useEffect(() => {
    if (reciboPendente && detalhe.dados?.status === 'entregue' && detalhe.dados.entreguePara) {
      setReciboPendente(false)
      setReciboOpen(true)
    }
  }, [reciboPendente, detalhe.dados])

  const comanda = detalhe.dados

  if (detalhe.carregando && !comanda) {
    return (
      <div>
        <div className="skel h-[188px] rounded-card" />
        <div className="mt-4">
          <SkelLinhas n={5} />
        </div>
      </div>
    )
  }

  if (detalhe.erro) {
    return (
      <div className="card">
        <Erro mensagem={detalhe.erro} onTentarNovamente={detalhe.recarregar} />
      </div>
    )
  }

  if (!comanda) {
    return (
      <div className="card">
        <Vazio
          icon={Receipt}
          titulo="Comanda não encontrada"
          descricao="O registro pode ter sido removido ou você não tem acesso a ele."
          acao={
            <button onClick={() => nav('/comandas')} className="btn-primary">
              Voltar para comandas
            </button>
          }
        />
      </div>
    )
  }

  const cod = comandaCod(comanda.numero, config?.comandas.prefixo ?? 'CF')
  const emAberto = comanda.saldoAberto
  const finalizada = dom.st(comanda.status).final

  // Mesma conta que `dashboard_alerts()` faz no servidor. Fica aqui e não
  // na view porque o prazo mora em `app_settings`, e a view não deve
  // depender de uma tabela com RLS própria — ver a migration 20260811100000.
  const diasAbandono = config?.operacao.diasParaAbandono ?? 0
  const esquecida =
    diasAbandono > 0 &&
    comanda.diasNaPrateleira != null &&
    comanda.diasNaPrateleira >= diasAbandono

  // Quem recusa de verdade é `change_order_status`; aqui é só para o botão
  // não convidar a uma ação que o banco vai negar.
  const faltaFotoDepois =
    !!config?.operacao.exigirFotoEntrega && !comanda.fotos.some((f) => f.tipo === 'depois')

  const pagamentos = [
    ...(comanda.entrada > 0
      ? [
          {
            id: 'entrada',
            em: comanda.criadaEm,
            valor: comanda.entrada,
            forma: comanda.formaPagamento,
            rotulo: 'Entrada',
          },
        ]
      : []),
    ...comanda.pagamentos.map((p) => ({ ...p, rotulo: 'Pagamento' })),
  ].sort((a, b) => +new Date(a.em) - +new Date(b.em))

  /**
   * Move UM item. É o caminho normal desde a migration de itens: o status
   * da comanda é derivado, então empurrar a comanda inteira só faz sentido
   * para cancelar/pausar tudo.
   */
  async function mudarStatusItem(
    it: ItemComanda,
    s: string,
    dadosEntrega?: DadosEntrega,
    dadosAprovacao?: DadosAprovacao,
  ) {
    // Sair de "Aguardando aprovação" para trabalho exige o lastro. Pedir
    // aqui evita o erro na cara — a RPC recusaria de qualquer forma.
    // Ir para `cancelada` é o cliente recusando: não se pede nada.
    if (
      it.status === 'aprovacao' &&
      !it.aprovadoEm &&
      s !== 'cancelada' &&
      s !== 'aprovacao' &&
      !dadosAprovacao
    ) {
      setAprovacao({ item: it, destino: s })
      setFormAprov({ nome: comanda!.clienteNome, canal: '', valor: String(it.valor) })
      return
    }

    const r = await moverItem.executar(it.id, s, dadosEntrega, dadosAprovacao)
    if (r === null && moverItem.erro) {
      push({ tipo: 'erro', titulo: 'Não foi possível alterar', descricao: moverItem.erro })
      return
    }
    setEntregaOpen(false)
    setItemEntrega(null)
    setAprovacao(null)
    setEntrega({ nome: '', documento: '', observacao: '' })
    if (s === 'entregue') setReciboPendente(true)
    push({
      tipo: 'ok',
      titulo: s === 'entregue' ? 'Item entregue' : 'Status do item atualizado',
      descricao: `${it.servicoNome} · ${dom.st(s).label}`,
    })
    detalhe.recarregar()
  }

  /** Abre o formulário de entrega apontando para um item específico. */
  function abrirEntregaItem(it: ItemComanda) {
    setItemEntrega(it)
    setEntrega({ nome: '', documento: '', observacao: '' })
    setEntregaOpen(true)
  }

  async function mudarStatus(s: string, dadosEntrega?: DadosEntrega) {
    const r = await mover.executar(comanda!.id, s, dadosEntrega)
    setStatusOpen(false)
    if (r === null && mover.erro) {
      push({ tipo: 'erro', titulo: 'Não foi possível alterar', descricao: mover.erro })
      return
    }
    setEntregaOpen(false)
    setEntrega({ nome: '', documento: '', observacao: '' })
    if (s === 'entregue') setReciboPendente(true)
    push({ tipo: 'ok', titulo: 'Status atualizado', descricao: dom.st(s).label })
    detalhe.recarregar()
  }

  return (
    <div>
      <button onClick={() => nav('/comandas')} className="btn-ghost mb-3 -ml-2 text-[13px]">
        <ArrowLeft size={15} />
        Comandas
      </button>

      {(mover.erro || editar.erro) && (
        <div className="mb-3">
          <Erro
            compacto
            mensagem={mover.erro ?? editar.erro ?? ''}
            onTentarNovamente={() => {
              mover.limparErro()
              editar.limparErro()
            }}
          />
        </div>
      )}

      {/* ----------------------------- Cabeçalho ---------------------------- */}
      <div className="card overflow-hidden">
        <div
          className="px-5 py-5 sm:px-6 text-white"
          style={{
            background:
              'radial-gradient(520px 300px at 8% 0%, rgba(223,169,42,.18), transparent 60%), linear-gradient(135deg, #111317, #1D2126)',
          }}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="num font-display text-[26px] font-extrabold leading-none tracking-tight">
                  {cod}
                </h1>
                <StatusBadge status={comanda.status} />
                <PrazoBadge prazo={comanda.prazoEm} status={comanda.status} />
              </div>

              <button
                onClick={() => podeVerCliente && nav(`/clientes/${comanda.clienteId}`)}
                disabled={!podeVerCliente}
                className={cx(
                  'mt-3.5 flex items-center gap-2.5 text-left transition',
                  podeVerCliente ? 'hover:opacity-80' : 'cursor-default',
                )}
              >
                <Avatar nome={comanda.clienteNome} size={36} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-bold">{comanda.clienteNome}</span>
                  <span className="num block text-[12.5px] text-ink-400">
                    {telefoneFmt(comanda.clienteTelefone)}
                  </span>
                </span>
                {podeVerCliente && <ChevronRight size={15} className="text-ink-500" />}
              </button>

              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                <CategoriaBadge cat={comanda.categoria} />
                <span className="badge bg-white/10 text-ink-200">{comanda.servicoNome}</span>
                <span className="badge bg-white/10 text-ink-200">Resp. {comanda.responsavel}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 shrink-0 lg:min-w-[330px]">
              <BoxValor label="Valor" valor={brl(comanda.valor)} />
              <BoxValor label="Pago" valor={brl(comanda.pago)} tom="ok" />
              <BoxValor label="Saldo" valor={brl(emAberto)} tom={emAberto > 0.01 ? 'alerta' : 'ok'} />
            </div>
          </div>
        </div>

        {/* Ações — cada botão só aparece se o perfil pode executá-lo.
            Mostrar um botão que a RLS vai negar é pior que esconder. */}
        <div className="flex flex-wrap gap-2 border-t border-ink-100 p-4">
          {podeOperar && (
            <button onClick={() => setStatusOpen(true)} className="btn-outline" disabled={finalizada}>
              <Clock size={14} />
              Alterar status
            </button>
          )}

          {podeOperar && !finalizada && (
            <button onClick={() => setAba('fotos')} className="btn-outline">
              <Camera size={14} />
              Anexar foto
            </button>
          )}

          {emAberto > 0.01 && podeReceber && (
            <button onClick={() => setPagOpen(true)} className="btn-outline">
              <Wallet size={14} />
              Registrar pagamento
            </button>
          )}

          <button onClick={() => setPrintOpen(true)} className="btn-outline">
            <Printer size={14} />
            Imprimir comanda
          </button>

          {podeEtiqueta && (
            <button onClick={() => setEtiquetaOpen(true)} className="btn-outline">
              <Tag size={14} />
              Imprimir etiqueta
            </button>
          )}

          {podeOperar && (
            <button onClick={() => setEditOpen(true)} className="btn-outline" disabled={finalizada}>
              <Pencil size={14} />
              Editar
            </button>
          )}

          <div className="flex-1" />

          {podeOperar && comanda.status !== 'pronta' && !finalizada && (
            <button onClick={() => void mudarStatus('pronta')} className="btn-primary" disabled={mover.enviando}>
              <PackageCheck size={15} />
              Marcar como pronto
            </button>
          )}

          {podeOperar && comanda.status === 'pronta' && (
            <button onClick={() => void mudarStatus('avisado')} className="btn-primary" disabled={mover.enviando}>
              <BellRing size={15} />
              Marcar cliente avisado
            </button>
          )}

          {podeOperar && (comanda.status === 'avisado' || comanda.status === 'pronta') && (
            <Tip
              label={
                faltaFotoDepois
                  ? 'Anexe uma foto do tipo "Depois" na aba Fotos para liberar a entrega.'
                  : 'Registra quem retirou e fecha a comanda.'
              }
            >
              <button
                onClick={() => setEntregaOpen(true)}
                className="btn-accent"
                disabled={faltaFotoDepois}
              >
                <CheckCircle2 size={15} />
                Finalizar entrega
              </button>
            </Tip>
          )}
        </div>
      </div>

      {/* ------------------------------- Abas ------------------------------- */}
      <div className="card mt-4 overflow-hidden">
        <div className="px-4 pt-1">
          <Tabs
            abas={[
              { id: 'geral', label: 'Visão geral' },
              { id: 'itens', label: 'Itens', badge: comanda.itens.length },
              { id: 'fotos', label: 'Fotos', badge: comanda.fotos.length },
              { id: 'execucao', label: 'Execução' },
              { id: 'financeiro', label: 'Financeiro' },
              { id: 'historico', label: 'Histórico', badge: comanda.historico.length },
              { id: 'impressao', label: 'Impressão' },
            ]}
            ativa={aba}
            onChange={setAba}
          />
        </div>

        <div className="p-4 sm:p-5">
          {/* Visão geral */}
          {aba === 'geral' && (
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <Info label="Serviço" valor={comanda.servicoNome} />
                <Info label="Quantidade" valor={String(comanda.quantidade)} num />
                <Info label="Criada em" valor={fmtDataHora(comanda.criadaEm)} num />
                <Info
                  label="Prazo previsto"
                  valor={
                    // Sem contagem regressiva depois de finalizada — ver PrazoBadge.
                    finalizada
                      ? fmtData(comanda.prazoEm)
                      : `${fmtData(comanda.prazoEm)} · ${prazoTexto(comanda.prazoEm)}`
                  }
                  num
                />
                <Info label="Responsável" valor={comanda.responsavel} />
                {/*
                  Só enquanto a peça está na loja: depois de entregue,
                  `prontaEm` volta a nulo e "esperando há X dias" viraria
                  mentira sobre algo que já saiu.
                */}
                {comanda.prontaEm && comanda.diasNaPrateleira != null && (
                  <Info
                    label="Na prateleira desde"
                    valor={
                      <span className={cx(esquecida && 'font-semibold text-danger')}>
                        {fmtData(comanda.prontaEm)}
                        {comanda.diasNaPrateleira > 0 && ` · ${comanda.diasNaPrateleira} dias`}
                        {esquecida && ' · não retirada'}
                      </span>
                    }
                  />
                )}
                {comanda.entregueEm && (
                  <Info label="Entregue em" valor={fmtDataHora(comanda.entregueEm)} num />
                )}
                {/* Vazio nas comandas anteriores à migration 20260806200000. */}
                {comanda.entreguePara && (
                  <>
                    <Info
                      label="Retirado por"
                      valor={
                        comanda.entregueDocumento
                          ? `${comanda.entreguePara} · ${comanda.entregueDocumento}`
                          : comanda.entreguePara
                      }
                    />
                    {comanda.entreguePorNome && (
                      <Info label="Entregue por" valor={comanda.entreguePorNome} />
                    )}
                    {comanda.entregaObservacao && (
                      <Info label="Observação da entrega" valor={comanda.entregaObservacao} />
                    )}
                  </>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <p className="label">Descrição</p>
                  <div className="rounded-xl border border-ink-100 p-3.5">
                    <p className="text-[13.5px] leading-relaxed text-ink-700">
                      {comanda.descricao || 'Nenhuma descrição registrada.'}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="label">Observações</p>
                  <div className="rounded-xl border border-ink-100 p-3.5">
                    <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-700">
                      {comanda.observacoes || 'Nenhuma observação registrada.'}
                    </p>
                  </div>
                </div>

                {comanda.fotos.length > 0 && (
                  <div>
                    <p className="label">Fotos do item</p>
                    <GradeFotos
                      fotos={comanda.fotos}
                      categoria={comanda.categoria}
                      editavel={false}
                      colunas="grid-cols-4"
                      altura="h-20"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Itens — cada peça anda e é entregue por conta própria */}
          {aba === 'itens' && (
            <div>
              <p className="mb-4 text-[13.5px] text-ink-600 leading-relaxed">
                Cada item tem seu status, sua etiqueta e sua entrega. O status da comanda acima é o
                do item menos adiantado — ela só fica pronta quando a última peça fica.
              </p>

              <div className="space-y-3">
                {comanda.itens.map((it) => (
                  <ItemLinha
                    key={it.id}
                    item={it}
                    cod={cod}
                    podeOperar={podeOperar}
                    exigeFoto={!!config?.operacao.exigirFotoEntrega}
                    enviando={moverItem.enviando}
                    onStatus={(s) => void mudarStatusItem(it, s)}
                    onEntregar={() => abrirEntregaItem(it)}
                    onRetrabalho={() => {
                      setRetrabalho(it)
                      setFormRetrab({ motivo: '', valor: '0' })
                    }}
                    onFoto={async (file, tipo, legenda) => {
                      // Amarrada ao ITEM: é ela que libera a entrega desta peça.
                      const r = await upload.executar(comanda.id, file, tipo, legenda, it.id)
                      if (r === null && upload.erro) throw new Error(upload.erro)
                      detalhe.recarregar()
                    }}
                  />
                ))}

                {comanda.itens.length === 0 && (
                  <p className="py-8 text-center text-[13px] text-ink-400">
                    Esta comanda não tem itens registrados.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Fotos */}
          {aba === 'fotos' && (
            <div>
              <p className="mb-4 text-[13.5px] text-ink-600 leading-relaxed">
                Registre o item no recebimento, os detalhes durante a execução e o resultado final. As
                fotos aparecem na comanda impressa e no histórico do cliente.
              </p>

              {(upload.erro || apagarFoto.erro) && (
                <div className="mb-4">
                  <Erro
                    compacto
                    mensagem={upload.erro ?? apagarFoto.erro ?? ''}
                    onTentarNovamente={() => {
                      upload.limparErro()
                      apagarFoto.limparErro()
                    }}
                  />
                </div>
              )}

              <GradeFotos
                fotos={comanda.fotos}
                categoria={comanda.categoria}
                editavel={podeOperar && !finalizada}
                onArquivo={async (file, tipo, legenda) => {
                  const r = await upload.executar(comanda.id, file, tipo, legenda)
                  if (r === null && upload.erro) throw new Error(upload.erro)
                  detalhe.recarregar()
                }}
                onRemove={async (fid) => {
                  const r = await apagarFoto.executar(fid)
                  if (r === null && apagarFoto.erro) {
                    push({ tipo: 'erro', titulo: 'Falha ao remover', descricao: apagarFoto.erro })
                    return
                  }
                  push({ tipo: 'ok', titulo: 'Foto removida' })
                  detalhe.recarregar()
                }}
                onTipo={async (fid, t) => {
                  await marcarFoto.executar(fid, t)
                  detalhe.recarregar()
                }}
                colunas="grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"
                altura="h-28"
              />

              {finalizada && (
                <p className="mt-4 rounded-xl bg-ink-50 px-3.5 py-2.5 text-[12.5px] text-ink-500">
                  Comanda finalizada — as fotos ficam apenas para consulta.
                </p>
              )}
            </div>
          )}

          {/* Execução */}
          {aba === 'execucao' && (
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div>
                <p className="label">Andamento do serviço</p>
                <ol className="mt-2 space-y-1">
                  {dom.KANBAN_COLS.map((s, i, arr) => {
                    const idx = arr.indexOf(comanda.status)
                    const feito = idx >= 0 && i <= idx
                    const atual = comanda.status === s
                    return (
                      <li key={s} className="flex items-center gap-3">
                        <span className="flex flex-col items-center">
                          <span
                            className={cx(
                              'grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold transition',
                              atual
                                ? 'bg-ink-900 text-white'
                                : feito
                                  ? 'bg-pine-100 text-pine-700'
                                  : 'bg-ink-100 text-ink-400',
                            )}
                          >
                            {feito && !atual ? <CheckCircle2 size={13} /> : i + 1}
                          </span>
                          {i < arr.length - 1 && (
                            <span className={cx('h-5 w-px', feito ? 'bg-pine-200' : 'bg-ink-100')} />
                          )}
                        </span>
                        <button
                          onClick={() => podeOperar && !finalizada && void mudarStatus(s)}
                          disabled={!podeOperar || finalizada || mover.enviando}
                          className={cx(
                            'flex-1 rounded-lg px-3 py-1.5 text-left text-[13px] font-semibold transition',
                            atual ? 'text-ink-900' : feito ? 'text-pine-700' : 'text-ink-400',
                            podeOperar && !finalizada && 'hover:bg-ink-50',
                          )}
                        >
                          {dom.st(s).label}
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </div>

              <div className="space-y-3">
                {/* `finalizada` também aqui: comanda entregue trava
                    "Alterar status", "Anexar foto" e "Editar" no topo, mas
                    responsável e prazo seguiam editáveis nesta aba. Os
                    passos do andamento logo acima já respeitavam a regra. */}
                {podeOperar && !finalizada ? (
                  <div className="rounded-card border border-ink-100 p-4">
                    <p className="label">Responsável</p>
                    <Select
                      value={comanda.responsavelId ?? ''}
                      onChange={async (v) => {
                        const nome = dom.membro(v)?.nome ?? '—'
                        const r = await editar.executar(
                          comanda.id,
                          { responsavelId: v || null },
                          `Responsável alterado para ${nome}`,
                        )
                        if (r === null && editar.erro) return
                        push({ tipo: 'ok', titulo: 'Responsável atualizado', descricao: nome })
                        detalhe.recarregar()
                      }}
                      placeholder="Sem responsável"
                      options={dom.EXECUTORES.map((m) => ({ value: m.id, label: m.nome }))}
                      aria-label="Responsável"
                    />

                    <p className="label mt-4">Prazo</p>
                    <input
                      type="date"
                      className="field num"
                      value={new Date(comanda.prazoEm).toISOString().slice(0, 10)}
                      onChange={async (e) => {
                        const d = new Date(`${e.target.value}T12:00:00`)
                        const r = await editar.executar(
                          comanda.id,
                          { prazoEm: iso(d) },
                          `Prazo alterado para ${fmtData(d)}`,
                        )
                        if (r === null && editar.erro) return
                        push({ tipo: 'ok', titulo: 'Prazo atualizado', descricao: fmtData(d) })
                        detalhe.recarregar()
                      }}
                      aria-label="Prazo de entrega"
                    />

                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {[1, 2, 3, 7].map((d) => (
                        <button
                          key={d}
                          onClick={async () => {
                            const novo = addDias(new Date(), d)
                            const r = await editar.executar(
                              comanda.id,
                              { prazoEm: iso(novo) },
                              `Prazo estendido em ${d} dia(s)`,
                            )
                            if (r === null && editar.erro) return
                            push({ tipo: 'ok', titulo: `Prazo definido para ${fmtData(novo)}` })
                            detalhe.recarregar()
                          }}
                          className="chip num"
                        >
                          +{d}d
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-card border border-ink-100 p-4">
                    <p className="label">Responsável</p>
                    <p className="text-[13.5px] font-semibold text-ink-900">{comanda.responsavel}</p>
                    <p className="label mt-4">Prazo</p>
                    <p className="num text-[13.5px] font-semibold text-ink-900">
                      {fmtData(comanda.prazoEm)}
                    </p>
                  </div>
                )}

                {podeOperar && (
                  <button
                    onClick={() =>
                      push(
                        whatsappAtivo
                          ? {
                              tipo: 'ok',
                              titulo: 'Cliente avisado',
                              descricao: `Mensagem enviada para ${comanda.clienteWhatsapp}.`,
                            }
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
                    className="btn-outline w-full disabled:opacity-45"
                  >
                    <BellRing size={14} />
                    Avisar cliente
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Financeiro */}
          {aba === 'financeiro' && (
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="rounded-card bg-ink-50 p-4">
                  <LinhaFin label="Valor do serviço" valor={brl(comanda.valor)} />
                  <LinhaFin label="Entrada" valor={brl(comanda.entrada)} />
                  <LinhaFin
                    label="Pagamentos posteriores"
                    valor={brl(comanda.pagamentos.reduce((s, p) => s + p.valor, 0))}
                  />
                  <div className="mt-2 border-t border-ink-200 pt-2">
                    <LinhaFin label="Total pago" valor={brl(comanda.pago)} forte />
                    <LinhaFin
                      label="Saldo em aberto"
                      valor={brl(emAberto)}
                      forte
                      tom={emAberto > 0.01 ? 'perigo' : 'ok'}
                    />
                  </div>
                </div>

                {emAberto > 0.01 && podeReceber && (
                  <button onClick={() => setPagOpen(true)} className="btn-accent mt-3 w-full">
                    <Wallet size={15} />
                    Registrar pagamento
                  </button>
                )}
              </div>

              <div>
                <p className="label">Pagamentos</p>
                {pagamentos.length === 0 ? (
                  <p className="rounded-xl bg-ink-50 px-4 py-6 text-center text-[13px] text-ink-400">
                    Nenhum pagamento registrado.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {pagamentos.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 rounded-xl border border-ink-100 px-3.5 py-2.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-ink-900">{p.rotulo}</span>
                          <span className="num block text-[11.5px] text-ink-500">
                            {fmtDataHora(p.em)}
                            {p.forma && ` · ${dom.forma(p.forma)?.label}`}
                          </span>
                        </span>
                        <span className="num shrink-0 text-[14px] font-bold text-pine-600">
                          {brl(p.valor)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Histórico */}
          {aba === 'historico' && (
            <ol className="space-y-0">
              {comanda.historico
                .slice()
                .reverse()
                .map((h, i, arr) => (
                  <li key={h.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brass-400 ring-4 ring-brass-50" />
                      {i < arr.length - 1 && <span className="w-px flex-1 bg-ink-100" />}
                    </div>
                    <div className="pb-5 min-w-0">
                      <p className="text-[13.5px] font-bold text-ink-900">{h.titulo}</p>
                      {h.detalhe && <p className="text-[12.5px] text-ink-600 mt-0.5">{h.detalhe}</p>}
                      <p className="num mt-1 text-[11.5px] text-ink-400">
                        {fmtDataHora(h.em)} · {h.autor}
                      </p>
                    </div>
                  </li>
                ))}

              {comanda.historico.length === 0 && (
                <Vazio icon={History} titulo="Sem histórico" descricao="As movimentações aparecerão aqui." />
              )}
            </ol>
          )}

          {/* Impressão */}
          {aba === 'impressao' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-100 text-ink-700">
                    <Printer size={18} />
                  </span>
                  <div>
                    <h3 className="text-[14.5px] font-bold text-ink-900">Comanda</h3>
                    <p className="text-[12.5px] text-ink-500">
                      {comanda.comandaImpressa ? 'Já impressa' : 'Ainda não impressa'}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[13px] text-ink-600 leading-relaxed">
                  Via completa com cliente, serviço, prazo, valores, foto e código.
                </p>
                <button onClick={() => setPrintOpen(true)} className="btn-primary mt-4 w-full">
                  <Printer size={15} />
                  Abrir preview
                </button>
              </div>

              <div className="card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-100 text-ink-700">
                    <Tag size={18} />
                  </span>
                  <div>
                    <h3 className="text-[14.5px] font-bold text-ink-900">Etiqueta</h3>
                    <p className="text-[12.5px] text-ink-500">
                      {comanda.etiquetaImpressa ? 'Já impressa' : 'Ainda não impressa'}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[13px] text-ink-600 leading-relaxed">
                  Identificação da peça na bancada, com número, cliente, prazo e código.
                </p>
                <button
                  onClick={() => setEtiquetaOpen(true)}
                  className="btn-primary mt-4 w-full"
                  disabled={!podeEtiqueta || finalizada}
                >
                  <Tag size={15} />
                  {finalizada ? 'Comanda finalizada' : 'Abrir preview'}
                </button>
              </div>

              {/* Só depois de entregue: antes disso o documento não tem o
                  que atestar. */}
              {comanda.status === 'entregue' && (
                <div className="card p-5">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-pine-100 text-pine-700">
                      <CheckCircle2 size={18} />
                    </span>
                    <div>
                      <h3 className="text-[14.5px] font-bold text-ink-900">Recibo de entrega</h3>
                      <p className="text-[12.5px] text-ink-500">
                        {comanda.entreguePara
                          ? `Retirado por ${comanda.entreguePara}`
                          : 'Sem registro de quem retirou'}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[13px] text-ink-600 leading-relaxed">
                    Comprovante de retirada com as fotos de antes e depois, quem retirou e a linha
                    de assinatura.
                  </p>
                  <button onClick={() => setReciboOpen(true)} className="btn-primary mt-4 w-full">
                    <Printer size={15} />
                    Abrir preview
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------ Modais ------------------------------ */}
      <ImprimirComanda
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        comanda={comanda}
        onImpressa={detalhe.recarregar}
      />
      <ReciboEntrega open={reciboOpen} onClose={() => setReciboOpen(false)} comanda={comanda} />

      {/* Retrabalho: abre comanda nova vinculada à peça original. Dentro da
          garantia sai por R$ 0,00; fora dela o balcão arbitra o valor. */}
      <Modal
        open={!!retrabalho}
        onClose={() => setRetrabalho(null)}
        title="Abrir retrabalho"
        subtitle={retrabalho ? `${cod}/${retrabalho.posicao} · ${retrabalho.servicoNome}` : ''}
        size="sm"
        footer={
          <>
            <button onClick={() => setRetrabalho(null)} className="btn-ghost">
              Cancelar
            </button>
            <button
              className="btn-accent"
              disabled={formRetrab.motivo.trim().length < 5 || criarRetrabalho.enviando}
              onClick={async () => {
                if (!retrabalho) return
                const nova = await criarRetrabalho.executar(
                  retrabalho.id,
                  formRetrab.motivo.trim(),
                  Number(formRetrab.valor) || 0,
                )
                if (nova === null) {
                  push({
                    tipo: 'erro',
                    titulo: 'Não foi possível abrir',
                    descricao: criarRetrabalho.erro ?? '',
                  })
                  return
                }
                setRetrabalho(null)
                push({
                  tipo: 'ok',
                  titulo: `Retrabalho aberto · ${comandaCod(nova.numero, config?.comandas.prefixo ?? 'CF')}`,
                  descricao: 'A peça voltou para a produção.',
                })
                nav(`/comandas/${nova.id}`)
              }}
            >
              {criarRetrabalho.enviando ? <Spinner /> : <RotateCcw size={15} />}
              Abrir retrabalho
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="rounded-card bg-ink-50 p-3">
            <p className="text-[13px] text-ink-700 leading-relaxed">
              Abre uma <strong>comanda nova</strong> vinculada a esta peça. As duas ficam ligadas —
              a comanda original registra que o item voltou, e o relatório de retrabalho passa a
              contar.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="rt-motivo">
              O que o cliente relatou *
            </label>
            <textarea
              id="rt-motivo"
              rows={3}
              autoFocus
              className="field"
              value={formRetrab.motivo}
              onChange={(e) => setFormRetrab({ ...formRetrab, motivo: e.target.value })}
              placeholder="Ex.: a sola descolou de novo na mesma ponta, duas semanas depois."
            />
          </div>

          <div>
            <label className="label" htmlFor="rt-valor">
              Valor a cobrar
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-ink-400">
                R$
              </span>
              <input
                id="rt-valor"
                type="number"
                min={0}
                step="0.01"
                className="field num pl-10 font-bold"
                value={formRetrab.valor}
                onChange={(e) => setFormRetrab({ ...formRetrab, valor: e.target.value })}
              />
            </div>
            <p className="mt-1 text-[12px] text-ink-500">
              Deixe em zero para retrabalho em garantia — nesse caso nada é lançado no financeiro.
            </p>
          </div>
        </div>
      </Modal>

      {/* Aprovação do orçamento: quem aprovou, por onde e por qual valor.
          Sem isso o status dizia "aprovado" e nada dizia por quem. */}
      <Modal
        open={!!aprovacao}
        onClose={() => setAprovacao(null)}
        title="Registrar aprovação do orçamento"
        subtitle={
          aprovacao ? `${cod}/${aprovacao.item.posicao} · ${aprovacao.item.servicoNome}` : ''
        }
        size="sm"
        footer={
          <>
            <button onClick={() => setAprovacao(null)} className="btn-ghost">
              Cancelar
            </button>
            <button
              className="btn-accent"
              disabled={
                formAprov.nome.trim().length < 3 || !formAprov.canal || moverItem.enviando
              }
              onClick={() => {
                if (!aprovacao) return
                void mudarStatusItem(aprovacao.item, aprovacao.destino, undefined, {
                  nome: formAprov.nome.trim(),
                  canal: formAprov.canal,
                  valor: Number(formAprov.valor) || aprovacao.item.valor,
                })
              }}
            >
              {moverItem.enviando ? <Spinner /> : <CheckCircle2 size={15} />}
              Registrar e liberar
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div>
            <label className="label" htmlFor="ap-nome">
              Quem aprovou *
            </label>
            <input
              id="ap-nome"
              autoFocus
              className="field"
              value={formAprov.nome}
              onChange={(e) => setFormAprov({ ...formAprov, nome: e.target.value })}
              placeholder={comanda.clienteNome}
            />
            <p className="mt-1 text-[12px] text-ink-500">
              O cliente, ou quem ele autorizou a decidir. Não é você.
            </p>
          </div>

          <div>
            <span className="label">Por onde aprovou *</span>
            <div className="flex flex-wrap gap-2">
              {dom.CANAIS_APROVACAO.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setFormAprov({ ...formAprov, canal: c.key })}
                  className={cx('chip', formAprov.canal === c.key && 'chip-on')}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="ap-valor">
              Valor aprovado
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-ink-400">
                R$
              </span>
              <input
                id="ap-valor"
                type="number"
                min={0}
                step="0.01"
                className="field num pl-10 font-bold"
                value={formAprov.valor}
                onChange={(e) => setFormAprov({ ...formAprov, valor: e.target.value })}
              />
            </div>
            <p className="mt-1 text-[12px] text-ink-500">
              Fica guardado como estava no aceite. Se o serviço crescer depois, a ficha mostra a
              diferença.
            </p>
          </div>
        </div>
      </Modal>
      <ImprimirEtiqueta
        open={etiquetaOpen}
        onClose={() => setEtiquetaOpen(false)}
        comandas={[comanda]}
        onImpressas={detalhe.recarregar}
      />
      <RegistrarPagamento
        open={pagOpen}
        onClose={() => setPagOpen(false)}
        comandaId={comanda.id}
        onRegistrado={detalhe.recarregar}
      />

      <Modal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Alterar status"
        subtitle={`Comanda ${cod}`}
        size="sm"
      >
        <div className="space-y-1.5">
          {dom.STATUS_LIST.map((s) => (
            <button
              key={s}
              onClick={() => void mudarStatus(s)}
              disabled={mover.enviando}
              className={cx(
                'flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition',
                comanda.status === s
                  ? 'border-ink-900 bg-ink-50'
                  : 'border-ink-100 hover:border-ink-300 hover:bg-ink-50',
              )}
            >
              <StatusBadge status={s} />
              {comanda.status === s && <CheckCircle2 size={16} className="text-pine-500" />}
            </button>
          ))}
        </div>
      </Modal>

      <ModalEditar
        open={editOpen}
        onClose={() => setEditOpen(false)}
        comanda={comanda}
        enviando={editar.enviando}
        erro={editar.erro}
        onSalvar={async (patch) => {
          const r = await editar.executar(
            comanda.id,
            {
              ...patch,
              servicoId: patch.servicoId || null,
              responsavelId: patch.responsavelId || null,
              prazoEm: patch.prazoEm ? `${patch.prazoEm}T12:00:00` : undefined,
            },
            'Comanda editada',
          )
          if (r === null) {
            push({ tipo: 'erro', titulo: 'Não foi possível salvar', descricao: editar.erro ?? '' })
            return
          }
          setEditOpen(false)
          push({ tipo: 'ok', titulo: 'Comanda atualizada' })
          detalhe.recarregar()
        }}
      />

      {/* Entrega: formulário, não confirmação.
          O nome de quem retira é o registro que faltava — sem ele a RPC
          recusa a transição, então pedir aqui evita o erro na cara. */}
      <Modal
        open={entregaOpen}
        onClose={() => setEntregaOpen(false)}
        title={itemEntrega ? 'Entregar item' : 'Finalizar entrega'}
        subtitle={
          itemEntrega
            ? `${cod}/${itemEntrega.posicao} · ${itemEntrega.servicoNome}`
            : `${cod} · ${comanda.clienteNome}`
        }
        size="sm"
        footer={
          <>
            <button onClick={() => setEntregaOpen(false)} className="btn-ghost">
              Cancelar
            </button>
            <button
              className="btn-accent"
              disabled={entrega.nome.trim().length < 3 || mover.enviando || moverItem.enviando}
              onClick={() => {
                const dados = {
                  nome: entrega.nome.trim(),
                  documento: entrega.documento.trim(),
                  observacao: entrega.observacao.trim(),
                }
                if (itemEntrega) void mudarStatusItem(itemEntrega, 'entregue', dados)
                else void mudarStatus('entregue', dados)
              }}
            >
              {mover.enviando || moverItem.enviando ? <Spinner /> : <CheckCircle2 size={15} />}
              {itemEntrega ? 'Confirmar entrega do item' : 'Confirmar entrega'}
            </button>
          </>
        }
      >
        {/* Entregar um item de uma comanda com vários não fecha a conta:
            o saldo continua sendo da comanda inteira. */}
        {itemEntrega && comanda.itens.length > 1 && (
          <div className="mb-4 rounded-card border border-ink-200 bg-ink-50 p-3">
            <p className="text-[13px] text-ink-700 leading-relaxed">
              Os outros {comanda.itens.length - 1} item(ns) desta comanda continuam na loja. A
              comanda só é finalizada quando o último sair.
            </p>
          </div>
        )}

        {emAberto > 0.01 && (
          <div className="mb-4 rounded-card border border-brass-200 bg-brass-50 p-3">
            <p className="text-[13px] font-semibold text-brass-800 leading-relaxed">
              Saldo em aberto de {brl(emAberto)}. Ao entregar, o valor passa a constar como vencido
              no financeiro.
            </p>
          </div>
        )}

        <div className="space-y-3.5">
          <div>
            <label className="label" htmlFor="e-nome">
              Quem está retirando *
            </label>
            <input
              id="e-nome"
              autoFocus
              className="field"
              value={entrega.nome}
              onChange={(e) => setEntrega({ ...entrega, nome: e.target.value })}
              placeholder={comanda.clienteNome}
            />
            <p className="mt-1 text-[12px] text-ink-500">
              Se não for o próprio cliente, escreva o nome de quem está levando.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="e-doc">
              Documento
            </label>
            <input
              id="e-doc"
              className="field"
              value={entrega.documento}
              onChange={(e) => setEntrega({ ...entrega, documento: e.target.value })}
              placeholder="opcional — RG ou CPF de quem retira"
            />
          </div>

          <div>
            <label className="label" htmlFor="e-obs">
              Observação da entrega
            </label>
            <textarea
              id="e-obs"
              rows={2}
              className="field"
              value={entrega.observacao}
              onChange={(e) => setEntrega({ ...entrega, observacao: e.target.value })}
              placeholder="Ex.: conferido com o cliente no balcão."
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Uma peça da comanda: status próprio, entrega própria, etiqueta própria.
 *
 * O botão de entregar fica travado sem a foto "Depois" DESTE item —
 * `change_order_item_status` recusaria, e descobrir pelo erro depois de
 * chamar o cliente ao balcão é o pior momento possível.
 */
function ItemLinha({
  item,
  cod,
  podeOperar,
  exigeFoto,
  enviando,
  onStatus,
  onEntregar,
  onRetrabalho,
  onFoto,
}: {
  item: ItemComanda
  cod: string
  podeOperar: boolean
  exigeFoto: boolean
  enviando: boolean
  onStatus: (s: string) => void
  onEntregar: () => void
  onRetrabalho: () => void
  onFoto: (file: File, tipo: string, legenda: string) => Promise<void>
}) {
  const dom = useDominioMaps()
  const final = dom.st(item.status).final
  const faltaFoto = exigeFoto && !item.fotos.some((f) => f.tipo === 'depois')

  const canalAprovacao = dom.CANAIS_APROVACAO.find((c) => c.key === item.canalAprovacao)?.label
  /** 0 quando não houve aprovação ou quando o valor não mudou desde o aceite. */
  const divergencia =
    item.aprovadoEm && item.valorAprovado !== null ? item.valor - item.valorAprovado : 0

  // A garantia conta a partir da entrega DESTA peça.
  const garantiaAte =
    item.entregueEm && item.garantiaDias > 0
      ? addDias(new Date(item.entregueEm), item.garantiaDias)
      : null
  const naGarantia = !!garantiaAte && garantiaAte >= new Date()

  return (
    <div className="rounded-card border border-ink-100 p-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-[12.5px] font-bold text-ink-600">
          {item.posicao}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-bold text-ink-900">{item.servicoNome}</p>
            <StatusBadge status={item.status} />
            <CategoriaBadge cat={item.categoria} />
          </div>
          <p className="num mt-0.5 text-[12px] text-ink-500">
            {cod}/{item.posicao} · {item.quantidade}x · {brl(item.valor)} · {item.responsavel}
          </p>
          {item.aprovadoEm && (
            <p className="mt-1 text-[12.5px] text-ink-600">
              Orçamento aprovado por <strong>{item.aprovadoPor}</strong>
              {canalAprovacao && ` via ${canalAprovacao}`} · {fmtDataHora(item.aprovadoEm)}
              {item.valorAprovado !== null && ` · ${brl(item.valorAprovado)}`}
            </p>
          )}

          {/* O serviço cresceu depois do aceite. Não é erro — mas tem que
              aparecer antes da cobrança, não na discussão com o cliente. */}
          {divergencia !== 0 && (
            <p className="mt-1 rounded-lg bg-brass-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-brass-800">
              Valor {divergencia > 0 ? 'acima' : 'abaixo'} do aprovado em{' '}
              {brl(Math.abs(divergencia))} — aprovado {brl(item.valorAprovado!)}, hoje{' '}
              {brl(item.valor)}.
            </p>
          )}

          {item.entreguePara && (
            <p className="mt-1 text-[12.5px] text-pine-700">
              Retirado por <strong>{item.entreguePara}</strong>
              {item.entregueDocumento && ` · ${item.entregueDocumento}`}
              {item.entregueEm && ` · ${fmtDataHora(item.entregueEm)}`}
            </p>
          )}

          {garantiaAte && (
            <p
              className={cx(
                'mt-1 text-[12.5px]',
                naGarantia ? 'text-pine-700' : 'text-ink-500',
              )}
            >
              {naGarantia ? 'Em garantia até' : 'Garantia venceu em'} {fmtData(garantiaAte)}
              <span className="text-ink-400"> · {item.garantiaDias} dias</span>
            </p>
          )}
        </div>

        <div className="shrink-0">
          <PrazoBadge prazo={item.prazoEm} status={item.status} />
        </div>
      </div>

      {/* Fotos DESTA peça. A aba Fotos da ficha grava na comanda; para
          liberar a entrega de um item entre vários, a foto tem que estar
          amarrada a ele — e é aqui que isso acontece. */}
      {podeOperar && !final && (
        <div className="mt-3 border-t border-ink-100 pt-3">
          <p className="label !mb-1.5">
            Fotos desta peça {faltaFoto && <span className="text-brass-700">— falta a do "Depois"</span>}
          </p>
          <GradeFotos
            fotos={item.fotos}
            categoria={item.categoria}
            editavel
            colunas="grid-cols-4"
            altura="h-16"
            onArquivo={onFoto}
          />
        </div>
      )}

      {/* Peça entregue que voltou. O botão existe mesmo fora da garantia —
          o retrabalho acontece do mesmo jeito, só que cobrando. */}
      {podeOperar && item.entregueEm && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
          <span className="text-[12.5px] text-ink-500">
            {item.retrabalho ? 'Este item já é um retrabalho.' : 'O cliente trouxe a peça de volta?'}
          </span>
          <span className="flex-1" />
          <button onClick={onRetrabalho} disabled={enviando} className="btn-outline !py-1.5 !text-[12.5px]">
            <RotateCcw size={14} />
            Abrir retrabalho
          </button>
        </div>
      )}

      {podeOperar && !final && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-3">
          {dom.STATUS_LIST.filter((s) => !dom.st(s).final && s !== item.status).map((s) => (
            <button
              key={s}
              disabled={enviando}
              onClick={() => onStatus(s)}
              className="chip disabled:opacity-50"
            >
              {dom.st(s).label}
            </button>
          ))}

          <span className="flex-1" />

          <Tip
            label={
              faltaFoto
                ? 'Anexe uma foto "Depois" deste item na aba Fotos para liberar a entrega.'
                : 'Registra quem retirou esta peça.'
            }
          >
            <button
              onClick={onEntregar}
              disabled={enviando || faltaFoto}
              className="btn-accent !py-1.5 !text-[12.5px]"
            >
              <CheckCircle2 size={14} />
              Entregar item
            </button>
          </Tip>
        </div>
      )}
    </div>
  )
}

function BoxValor({ label, valor, tom }: { label: string; valor: string; tom?: 'ok' | 'alerta' }) {
  const cor = tom === 'ok' ? 'text-pine-300' : tom === 'alerta' ? 'text-brass-300' : 'text-white'
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <p className={cx('num mt-1 text-[16px] font-bold leading-none', cor)}>{valor}</p>
    </div>
  )
}

// `valor` aceita ReactNode e não só string: a linha da prateleira precisa
// destacar em vermelho quando a peça passou do prazo.
function Info({ label, valor, num }: { label: string; valor: ReactNode; num?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-50 pb-2.5">
      <span className="text-[12.5px] font-semibold text-ink-500">{label}</span>
      <span className={cx('text-[13.5px] font-semibold text-ink-900 text-right', num && 'num')}>
        {valor}
      </span>
    </div>
  )
}

function LinhaFin({
  label,
  valor,
  forte,
  tom,
}: {
  label: string
  valor: string
  forte?: boolean
  tom?: 'ok' | 'perigo'
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className={cx('text-[13px]', forte ? 'font-bold text-ink-800' : 'text-ink-600')}>{label}</span>
      <span
        className={cx(
          'num text-[13.5px] font-bold',
          tom === 'ok' ? 'text-pine-600' : tom === 'perigo' ? 'text-danger' : 'text-ink-900',
        )}
      >
        {valor}
      </span>
    </div>
  )
}

function ModalEditar({
  open,
  onClose,
  comanda,
  enviando,
  erro,
  onSalvar,
}: {
  open: boolean
  onClose: () => void
  comanda: Comanda
  enviando: boolean
  erro: string | null
  onSalvar: (patch: {
    descricao: string
    observacoes: string
    valor: number
    quantidade: number
    servicoId?: string | null
    prazoEm?: string
    responsavelId?: string | null
  }) => void
}) {
  const dom = useDominioMaps()

  const inicial = () => ({
    descricao: comanda.descricao,
    observacoes: comanda.observacoes,
    valor: comanda.valor,
    quantidade: comanda.quantidade,
    servicoId: comanda.servicoId ?? '',
    prazoEm: comanda.prazoEm.slice(0, 10),
    responsavelId: comanda.responsavelId ?? '',
  })

  const [f, setF] = useState(inicial)

  useEffect(() => {
    if (open) setF(inicial())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comanda])

  /**
   * Catálogo para a troca de serviço.
   *
   * Trocar o serviço era impossível: errar na abertura obrigava a cancelar
   * a comanda e refazer, perdendo número, histórico e fotos. A RPC
   * `update_order` passou a aceitar `service_id` e reescreve o nome e a
   * categoria a partir do catálogo (20260730200000).
   */
  const servicos = useAsync(() => listarServicos({ arquivo: 'ativos' }), [], { ativo: open })

  // Regra 10: o valor não pode ficar abaixo do que já foi pago — o banco
  // rejeitaria, e avisar aqui é mais direto que mostrar o erro depois.
  const valorInvalido = f.valor < comanda.pago

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar comanda"
      subtitle={comandaCod(comanda.numero)}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn-primary"
            disabled={enviando || valorInvalido}
            onClick={() => onSalvar(f)}
          >
            Salvar alterações
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
          <label className="label" htmlFor="e-servico">
            Serviço
          </label>
          <Select
            value={f.servicoId}
            onChange={(v) => {
              const s = (servicos.dados ?? []).find((x) => x.id === v)
              // Traz o preço de tabela junto, como no wizard — mas nunca
              // abaixo do que já foi pago, que o banco recusaria.
              setF({
                ...f,
                servicoId: v,
                valor: s ? Math.max(comanda.pago, s.precoBase * f.quantidade) : f.valor,
              })
            }}
            aria-label="Serviço"
            placeholder={servicos.carregando ? 'Carregando…' : 'Manter o atual'}
            options={(servicos.dados ?? []).map((s) => ({
              value: s.id,
              label: `${dom.cat(s.categoria).label} · ${s.nome}`,
            }))}
          />
          <p className="mt-1 text-[11.5px] text-ink-400">
            Trocar o serviço atualiza também a categoria da comanda.
          </p>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="e-prazo">
              Prazo
            </label>
            <input
              id="e-prazo"
              type="date"
              className="field num"
              value={f.prazoEm}
              onChange={(e) => setF({ ...f, prazoEm: e.target.value })}
            />
          </div>
          <div>
            <span className="label">Responsável</span>
            <Select
              value={f.responsavelId}
              onChange={(v) => setF({ ...f, responsavelId: v })}
              aria-label="Responsável"
              placeholder="Sem responsável"
              options={dom.EXECUTORES.map((m) => ({ value: m.id, label: m.nome }))}
            />
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="e-valor">
              Valor total
            </label>
            <input
              id="e-valor"
              type="number"
              min={0}
              step="0.01"
              className="field num"
              value={f.valor}
              onChange={(e) => setF({ ...f, valor: numeroDeInput(e, { min: 0 }) })}
            />
            {valorInvalido && (
              <p className="mt-1.5 text-[12px] text-danger">
                O valor não pode ser menor que o já pago ({brl(comanda.pago)}).
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="e-qtd">
              Quantidade
            </label>
            <input
              id="e-qtd"
              type="number"
              min={1}
              className="field num"
              value={f.quantidade}
              onChange={(e) => setF({ ...f, quantidade: numeroDeInput(e, { min: 1 }) })}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="e-desc">
            Descrição
          </label>
          <textarea
            id="e-desc"
            rows={3}
            className="field resize-none"
            value={f.descricao}
            onChange={(e) => setF({ ...f, descricao: e.target.value })}
          />
        </div>

        <div>
          <label className="label" htmlFor="e-obs">
            Observações
          </label>
          <textarea
            id="e-obs"
            rows={3}
            className="field resize-none"
            value={f.observacoes}
            onChange={(e) => setF({ ...f, observacoes: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  )
}
