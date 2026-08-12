import {
  ArrowLeft,
  Camera,
  MessageSquarePlus,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Trash2,
  UserCheck,
  UserX,
  Wallet,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import NovoAtendimento from '@/components/NovoAtendimento'
import RegistrarPagamento from '@/components/RegistrarPagamento'
import { GradeFotos } from '@/components/Fotos'
import { ModalCliente } from './Clientes'
import {
  Avatar,
  CategoriaBadge,
  ClienteStatusBadge,
  Kpi,
  PageHead,
  PrazoBadge,
  StatusBadge,
} from '@/components/dominio'
import { Confirm, Erro, Modal, SkelCards, SkelLinhas, Spinner, Tabs, Vazio, useToast } from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { useAcao, useAsync } from '@/lib/hooks'
import { atualizarCliente, bloquearCliente, obterCliente, removerCliente } from '@/lib/api/clientes'
import { listarComandas, listarPagamentosDoCliente } from '@/lib/api/comandas'
import { consultaInicial } from '@/lib/listing'
import { useIntegracaoAtiva, usePodeEditar } from '@/store/useSessao'
import { brl, comandaCod, fmtData, fmtDataHora, telefoneFmt } from '@/lib/utils'

export default function ClienteDetalhe() {
  const { id } = useParams()
  const nav = useNavigate()
  const { push } = useToast()
  const dom = useDominioMaps()
  const podeEditar = usePodeEditar('customers')
  const podeCriarComanda = usePodeEditar('service_desk') || usePodeEditar('orders')
  const podeReceber = usePodeEditar('finance') || usePodeEditar('service_desk')
  const whatsappAtivo = useIntegracaoAtiva('whatsapp_notify')

  const [aba, setAba] = useState('geral')
  const [editar, setEditar] = useState(false)
  const [bloquear, setBloquear] = useState(false)
  const [excluir, setExcluir] = useState(false)
  const [novoAtend, setNovoAtend] = useState(false)
  const [pagamento, setPagamento] = useState(false)
  const [contato, setContato] = useState(false)
  const [notaContato, setNotaContato] = useState('')

  const cliente = useAsync(() => (id ? obterCliente(id) : Promise.resolve(null)), [id], {
    tabelas: ['customers', 'orders'],
    canal: `cliente-${id}`,
  })

  /**
   * Comandas do cliente: até 100. Uma loja de bairro raramente passa
   * disso por cliente, e a ficha precisa do histórico completo para
   * montar as abas de fotos e pagamentos.
   */
  const comandas = useAsync(
    () =>
      id
        ? listarComandas({ ...consultaInicial({ campo: 'number', direcao: 'desc' }), tamanho: 100 }, { clienteId: id })
        : Promise.resolve(null),
    [id],
    { tabelas: ['orders', 'order_payments', 'order_photos'], canal: `cliente-comandas-${id}` },
  )

  /** Pagamentos posteriores: a listagem de comandas não traz o array. */
  const pagamentosQ = useAsync(
    () => (id ? listarPagamentosDoCliente(id) : Promise.resolve([])),
    [id],
    { tabelas: ['order_payments'], canal: `cliente-pagamentos-${id}` },
  )

  const salvar = useAcao(atualizarCliente)
  const alternarBloqueio = useAcao(bloquearCliente)
  const apagar = useAcao(removerCliente)

  if (cliente.carregando && !cliente.dados) {
    return (
      <div>
        <div className="skel h-[140px] rounded-card" />
        <div className="mt-4">
          <SkelCards />
        </div>
      </div>
    )
  }

  if (cliente.erro) {
    return (
      <div className="card">
        <Erro mensagem={cliente.erro} onTentarNovamente={cliente.recarregar} />
      </div>
    )
  }

  const c = cliente.dados
  if (!c) {
    return (
      <div className="card">
        <Vazio
          icon={Receipt}
          titulo="Cliente não encontrado"
          descricao="O registro pode ter sido removido ou você não tem acesso a ele."
          acao={
            <button onClick={() => nav('/clientes')} className="btn-primary">
              Voltar para clientes
            </button>
          }
        />
      </div>
    )
  }

  const minhas = comandas.dados?.linhas ?? []
  const abertas = minhas.filter((o) => !dom.st(o.status).final)
  const comFoto = minhas.filter((o) => o.fotosQtd > 0)
  const totalFotos = minhas.reduce((s, o) => s + o.fotosQtd, 0)

  /**
   * Entrada da comanda + cada pagamento posterior, um por linha.
   *
   * Antes isto era derivado de `orders.amount_paid` — UMA linha por
   * comanda, com a data de criação dela. Duas parcelas de R$ 320 viravam
   * "R$ 640" na data errada; o total batia, o detalhamento não.
   */
  const posteriores = pagamentosQ.dados ?? []
  const pagamentos = useMemo(() => {
    const entradas = minhas
      .filter((o) => o.entrada > 0)
      .map((o) => ({
        id: `entrada-${o.id}`,
        em: o.criadaEm,
        valor: o.entrada,
        rotulo: 'Entrada',
        comandaId: o.id,
        comandaNumero: o.numero,
        servico: o.servicoNome,
      }))

    const porComanda = new Map(minhas.map((o) => [o.id, o]))
    const demais = posteriores.map((p) => ({
      id: p.id,
      em: p.em,
      valor: p.valor,
      rotulo: 'Pagamento',
      comandaId: p.comandaId,
      comandaNumero: p.comandaNumero,
      servico: porComanda.get(p.comandaId)?.servicoNome ?? '—',
    }))

    return [...entradas, ...demais].sort((a, b) => +new Date(b.em) - +new Date(a.em))
  }, [minhas, posteriores])

  const pendente = c.pendente ?? 0

  return (
    <div>
      <button onClick={() => nav('/clientes')} className="btn-ghost mb-3 -ml-2 text-[13px]">
        <ArrowLeft size={15} />
        Clientes
      </button>

      {salvar.erro && (
        <div className="mb-3">
          <Erro compacto mensagem={salvar.erro} onTentarNovamente={salvar.limparErro} />
        </div>
      )}

      {/* Cabeçalho */}
      <div className="card p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <Avatar nome={c.nome} size={56} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-[21px] font-bold text-ink-900 leading-tight">{c.nome}</h1>
                <ClienteStatusBadge status={c.status} />
              </div>
              <p className="num mt-1 text-[13.5px] text-ink-500">
                {telefoneFmt(c.telefone)} · {c.cidade}
              </p>
              {c.email && <p className="text-[13px] text-ink-500">{c.email}</p>}
              <p className="num mt-1 text-[12.5px] text-ink-400">
                Cliente desde {fmtData(c.cadastroEm)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            {podeEditar && (
              <>
                <button onClick={() => setEditar(true)} className="btn-outline">
                  <Pencil size={14} />
                  Editar
                </button>
                <button onClick={() => setContato(true)} className="btn-outline">
                  <MessageSquarePlus size={14} />
                  Registrar contato
                </button>
                {/* Dois verbos diferentes, de propósito.
                    BLOQUEAR tira do atendimento e preserva o histórico — é
                    o caminho de quem já teve comanda.
                    EXCLUIR só existe para cadastro errado ou duplicado; a
                    RPC recusa quem tem comanda, porque `order_list_view`
                    faz INNER JOIN em customers e as comandas dele sumiriam
                    das listagens. */}
                {c.status === 'bloqueado' ? (
                  <button onClick={() => setBloquear(true)} className="btn-outline">
                    <UserCheck size={14} />
                    Desbloquear
                  </button>
                ) : (
                  <button onClick={() => setBloquear(true)} className="btn-outline">
                    <UserX size={14} />
                    Bloquear
                  </button>
                )}
                <button
                  onClick={() => setExcluir(true)}
                  className="btn-outline text-danger hover:border-danger"
                >
                  <Trash2 size={14} />
                  Excluir
                </button>
              </>
            )}
            {pendente > 0.01 && podeReceber && (
              <button onClick={() => setPagamento(true)} className="btn-outline">
                <Wallet size={14} />
                Registrar pagamento
              </button>
            )}
            {podeCriarComanda && (
              <button onClick={() => setNovoAtend(true)} className="btn-accent">
                <Plus size={15} strokeWidth={2.6} />
                Criar comanda
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Serviços realizados" valor={c.qtdComandas ?? 0} hint="Total de comandas" icon={Receipt} />
        <Kpi label="Total pago" valor={brl(c.totalGasto ?? 0)} hint="Valores efetivamente pagos" tom="ok" />
        <Kpi
          label="Valor pendente"
          valor={brl(pendente)}
          hint={pendente > 0.01 ? 'Saldo em aberto' : 'Nenhuma pendência'}
          tom={pendente > 0.01 ? 'perigo' : 'neutro'}
        />
        <Kpi
          label="Último serviço"
          valor={c.ultimaComandaEm ? fmtData(c.ultimaComandaEm) : '—'}
          hint={c.ultimoServico ?? 'Sem histórico'}
        />
      </div>

      {/* Abas */}
      <div className="card mt-4 overflow-hidden">
        <div className="px-4 pt-1">
          <Tabs
            abas={[
              { id: 'geral', label: 'Visão geral' },
              { id: 'comandas', label: 'Comandas', badge: minhas.length },
              { id: 'fotos', label: 'Fotos', badge: totalFotos },
              { id: 'pagamentos', label: 'Pagamentos', badge: pagamentos.length },
            ]}
            ativa={aba}
            onChange={setAba}
          />
        </div>

        <div className="p-4 sm:p-5">
          {comandas.carregando && !comandas.dados && <SkelLinhas n={4} />}

          {comandas.erro && <Erro mensagem={comandas.erro} onTentarNovamente={comandas.recarregar} />}

          {comandas.dados && (
            <>
              {/* Visão geral */}
              {aba === 'geral' && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h3 className="text-[14.5px] font-bold text-ink-900 mb-3">Serviços em andamento</h3>
                    {abertas.length === 0 ? (
                      <p className="rounded-xl bg-ink-50 px-4 py-6 text-center text-[13px] text-ink-400">
                        Nenhum serviço em andamento.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {abertas.map((o) => (
                          <button
                            key={o.id}
                            onClick={() => nav(`/comandas/${o.id}`)}
                            className="flex w-full items-center gap-3 rounded-xl border border-ink-100 px-3 py-2.5 text-left transition hover:border-ink-300 hover:bg-ink-50"
                          >
                            <span className="num shrink-0 text-[12px] font-bold text-ink-400">
                              {comandaCod(o.numero)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-ink-900">
                                {o.servicoNome}
                              </span>
                              <span className="mt-1 flex items-center gap-1.5">
                                <StatusBadge status={o.status} />
                                <PrazoBadge prazo={o.prazoEm} status={o.status} compacto />
                              </span>
                            </span>
                            <span className="num shrink-0 text-[13px] font-bold text-ink-900">
                              {brl(o.valor)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-[14.5px] font-bold text-ink-900 mb-3">Observações</h3>
                    <div className="rounded-xl border border-ink-100 p-4">
                      {c.observacoes ? (
                        <p className="whitespace-pre-line text-[13.5px] text-ink-700 leading-relaxed">
                          {c.observacoes}
                        </p>
                      ) : (
                        <p className="text-[13px] text-ink-400">Nenhuma observação registrada.</p>
                      )}
                      {podeEditar && (
                        <button onClick={() => setContato(true)} className="btn-outline mt-3 w-full">
                          <MessageSquarePlus size={14} />
                          Adicionar observação
                        </button>
                      )}
                    </div>

                    <h3 className="text-[14.5px] font-bold text-ink-900 mt-5 mb-3">Próxima ação</h3>
                    <div className="rounded-xl bg-brass-50 p-4">
                      <p className="text-[13px] font-semibold text-brass-700 leading-relaxed">
                        {pendente > 0.01
                          ? `Cobrar saldo de ${brl(pendente)} em aberto.`
                          : abertas.some((o) => o.status === 'pronta')
                            ? 'Avisar o cliente — há serviço pronto para retirada.'
                            : abertas.length > 0
                              ? 'Acompanhar a execução dos serviços em andamento.'
                              : 'Nenhuma ação pendente para este cliente.'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            push(
                              whatsappAtivo
                                ? {
                                    tipo: 'ok',
                                    titulo: 'Cliente avisado',
                                    descricao: `Mensagem enviada para ${telefoneFmt(c.whatsapp)}.`,
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
                          className="btn-outline text-[12.5px] py-2 disabled:opacity-45"
                        >
                          <Phone size={13} />
                          Avisar cliente
                        </button>
                        {pendente > 0.01 && podeReceber && (
                          <button onClick={() => setPagamento(true)} className="btn-primary text-[12.5px] py-2">
                            <Wallet size={13} />
                            Registrar pagamento
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Comandas */}
              {aba === 'comandas' &&
                (minhas.length === 0 ? (
                  <Vazio
                    icon={Receipt}
                    titulo="Nenhuma comanda"
                    descricao="Este cliente ainda não possui serviços registrados."
                    acao={
                      podeCriarComanda && (
                        <button onClick={() => setNovoAtend(true)} className="btn-primary">
                          <Plus size={15} />
                          Criar comanda
                        </button>
                      )
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    {minhas.map((o) => (
                      <button
                        key={o.id}
                        onClick={() => nav(`/comandas/${o.id}`)}
                        className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-ink-100 px-3.5 py-3 text-left transition hover:border-ink-300 hover:bg-ink-50"
                      >
                        <span className="num shrink-0 text-[12.5px] font-bold text-ink-500">
                          {comandaCod(o.numero)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-ink-900">
                            {o.servicoNome}
                          </span>
                          <span className="num block text-[12px] text-ink-500">{fmtData(o.criadaEm)}</span>
                        </span>
                        <CategoriaBadge cat={o.categoria} />
                        <StatusBadge status={o.status} />
                        <span className="num shrink-0 text-[13.5px] font-bold text-ink-900">
                          {brl(o.valor)}
                        </span>
                        {o.saldoAberto > 0.01 && (
                          <span className="badge bg-danger/10 text-danger num shrink-0">
                            Saldo {brl(o.saldoAberto)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}

              {/* Fotos */}
              {aba === 'fotos' &&
                (totalFotos === 0 ? (
                  <Vazio
                    icon={Camera}
                    titulo="Nenhuma foto"
                    descricao="As fotos anexadas às comandas deste cliente aparecem aqui."
                  />
                ) : (
                  <div className="space-y-5">
                    {comFoto.map((o) => (
                      <div key={o.id}>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="num text-[12px] font-bold text-ink-500">
                            {comandaCod(o.numero)}
                          </span>
                          <span className="text-[13px] font-semibold text-ink-700">{o.servicoNome}</span>
                          <span className="num text-[12px] text-ink-400">· {fmtData(o.criadaEm)}</span>
                        </div>
                        <GradeFotos
                          fotos={o.fotos}
                          categoria={o.categoria}
                          editavel={false}
                          colunas="grid-cols-3 sm:grid-cols-5 lg:grid-cols-6"
                          altura="h-24"
                        />
                        {o.fotosQtd > o.fotos.length && (
                          <button
                            onClick={() => nav(`/comandas/${o.id}`)}
                            className="mt-1.5 text-[12px] font-semibold text-brass-600 hover:underline"
                          >
                            + {o.fotosQtd - o.fotos.length} foto(s) — abrir comanda
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}

              {/* Pagamentos */}
              {aba === 'pagamentos' &&
                (pagamentos.length === 0 ? (
                  <Vazio
                    icon={Wallet}
                    titulo="Nenhum pagamento registrado"
                    descricao="Entradas e pagamentos deste cliente aparecem aqui."
                  />
                ) : (
                  <div className="space-y-2">
                    {pagamentos.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 px-3.5 py-3"
                      >
                        <span className="num shrink-0 text-[12px] font-bold text-ink-400">
                          {comandaCod(p.comandaNumero)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-ink-900">
                            {p.servico}
                          </span>
                          <span className="num block text-[12px] text-ink-500">
                            {p.rotulo} · {fmtDataHora(p.em)}
                          </span>
                        </span>
                        <span className="num shrink-0 text-[14px] font-bold text-pine-600">
                          {brl(p.valor)}
                        </span>
                      </div>
                    ))}

                    <div className="flex items-center justify-between rounded-xl bg-ink-50 px-3.5 py-3 mt-3">
                      <span className="text-[13.5px] font-bold text-ink-700">Total pago</span>
                      <span className="num text-[15px] font-bold text-ink-900">
                        {brl(c.totalGasto ?? 0)}
                      </span>
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>

      {/* Modais */}
      <ModalCliente
        open={editar}
        onClose={() => setEditar(false)}
        titulo="Editar cliente"
        inicial={c}
        enviando={salvar.enviando}
        erro={salvar.erro}
        onSalvar={async (d) => {
          const r = await salvar.executar(c.id, d)
          if (r === null && salvar.erro) return
          setEditar(false)
          push({ tipo: 'ok', titulo: 'Cliente atualizado' })
          cliente.recarregar()
        }}
      />

      <Confirm
        open={bloquear}
        onClose={() => setBloquear(false)}
        title={c.status === 'bloqueado' ? 'Desbloquear cliente' : 'Bloquear cliente'}
        message={
          c.status === 'bloqueado'
            ? `${c.nome} volta a aparecer no atendimento.`
            : `${c.nome} deixa de aparecer no atendimento. As comandas e o histórico são preservados, e você pode desbloquear a qualquer momento.`
        }
        confirmLabel={c.status === 'bloqueado' ? 'Desbloquear' : 'Bloquear'}
        onConfirm={async () => {
          const r = await alternarBloqueio.executar(c.id, c.status !== 'bloqueado')
          if (r === null) {
            push({
              tipo: 'erro',
              titulo: 'Não foi possível concluir',
              descricao: alternarBloqueio.erro ?? '',
            })
            return
          }
          push({
            tipo: 'ok',
            titulo: c.status === 'bloqueado' ? 'Cliente desbloqueado' : 'Cliente bloqueado',
          })
          cliente.recarregar()
        }}
      />

      <Confirm
        open={excluir}
        onClose={() => setExcluir(false)}
        title="Excluir cliente"
        message={
          minhas.length > 0
            ? `${c.nome} tem ${minhas.length} comanda(s) e não pode ser excluído — as comandas sumiriam das listagens junto com ele. Use "Bloquear" para tirá-lo do atendimento sem perder o histórico.`
            : `${c.nome} sai da base. O registro é preservado no banco e o telefone fica livre para novo cadastro.`
        }
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          const r = await apagar.executar(c.id)
          if (r === null) {
            push({ tipo: 'erro', titulo: 'Não foi possível excluir', descricao: apagar.erro ?? '' })
            return
          }
          push({ tipo: 'ok', titulo: 'Cliente excluído', descricao: c.nome })
          nav('/clientes')
        }}
      />

      <NovoAtendimento
        open={novoAtend}
        onClose={() => setNovoAtend(false)}
        clientePre={c.id}
        onCriada={() => {
          cliente.recarregar()
          comandas.recarregar()
        }}
      />

      <RegistrarPagamento
        open={pagamento}
        onClose={() => setPagamento(false)}
        onRegistrado={() => {
          cliente.recarregar()
          comandas.recarregar()
        }}
      />

      <Modal
        open={contato}
        onClose={() => setContato(false)}
        title="Registrar contato"
        subtitle="A anotação é adicionada às observações do cliente."
        size="sm"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setContato(false)}>
              Cancelar
            </button>
            <button
              className="btn-primary"
              disabled={!notaContato.trim() || salvar.enviando}
              onClick={async () => {
                const nova = c.observacoes
                  ? `${c.observacoes}\n• ${fmtData(new Date())}: ${notaContato.trim()}`
                  : `• ${fmtData(new Date())}: ${notaContato.trim()}`
                const r = await salvar.executar(c.id, { observacoes: nova })
                if (r === null && salvar.erro) return
                setNotaContato('')
                setContato(false)
                push({ tipo: 'ok', titulo: 'Contato registrado' })
                cliente.recarregar()
              }}
            >
              {salvar.enviando ? <Spinner /> : null}
              Salvar
            </button>
          </>
        }
      >
        <label className="label" htmlFor="nota">
          Anotação
        </label>
        <textarea
          id="nota"
          autoFocus
          rows={4}
          className="field resize-none"
          value={notaContato}
          onChange={(e) => setNotaContato(e.target.value)}
          placeholder="Ex.: Cliente avisado por WhatsApp, retira amanhã."
        />
      </Modal>
    </div>
  )
}
