import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, CircleCheck, Search, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Cliente, Foto, FormaPagamento, Servico } from '@/types'
import { AJUSTES_VALOR, PRAZOS_SUGERIDOS } from '@/lib/constants'
import { useDominioMaps } from '@/lib/dominio'
import { useAcao, useAsync } from '@/lib/hooks'
import { buscarClientes, criarCliente } from '@/lib/api/clientes'
import { listarServicos } from '@/lib/api/servicos'
import { criarComanda } from '@/lib/api/comandas'
import { anexarArquivo } from '@/lib/api/fotos'
import { useSessao, usePodeEditar } from '@/store/useSessao'
import {
  PRAZO_MAX_DIAS,
  addDias,
  brl,
  comandaCod,
  cx,
  fmtData,
  iso,
  numeroDeInput,
  telefoneDigitos,
  telefoneFmt,
  telefoneMask,
} from '@/lib/utils'
import { Erro, Modal, Spinner, useToast } from './ui'
import { Avatar, CategoriaBadge, IconeCategoria, IconeForma } from './dominio'
import { GradeFotos } from './Fotos'

/**
 * Linha do atendimento, só enquanto o wizard está aberto.
 *
 * Não é `ItemComanda`: aquele tem id do banco, status e entrega, que só
 * existem depois do `create_order`. Aqui é o rascunho.
 */
interface LinhaItem {
  /** Chave de render — some no envio. */
  uid: string
  servicoId: string
  servicoNome: string
  categoria: string
  quantidade: number
  /** O que vai ser cobrado. Pode divergir do preço de tabela. */
  valor: number
  /** Preço de tabela na hora em que o item entrou, para o botão "restaurar". */
  precoBase: number
}

const ETAPAS = [
  'Cliente',
  'Serviços',
  'Fotos',
  'Descrição',
  'Prazo',
  'Valor',
  'Pagamento',
  'Revisão',
] as const

/**
 * Fluxo de balcão em 8 etapas.
 *
 * A comanda é criada pela RPC `create_order`, que numera, gera os
 * lançamentos e o histórico numa só transação. As fotos escolhidas antes
 * da criação ficam em memória (a comanda ainda não tem id) e sobem para o
 * Storage logo depois.
 */
export default function NovoAtendimento({
  open,
  onClose,
  clientePre,
  onCriada,
}: {
  open: boolean
  onClose: () => void
  clientePre?: string
  onCriada?: () => void
}) {
  const nav = useNavigate()
  const { push } = useToast()
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)

  /** Regra da loja (app_settings), aplicada de verdade por `create_order`. */
  const exigeFoto = !!config?.operacao.exigirFotoRecebimento

  /**
   * Guarda de permissão do wizard.
   *
   * O componente não tinha nenhuma: quem abrisse o modal percorria as 8
   * etapas, via a base de clientes pelo caminho e só era barrado pela RPC
   * na confirmação. A RLS sempre esteve certa — o erro era expor o fluxo.
   *
   * `podeCadastrarCliente` é separado porque o balcão pode criar comanda
   * para cliente existente sem ter escrita em `customers`.
   */
  const podeCriarComanda = usePodeEditar('service_desk') || usePodeEditar('orders')
  const podeCadastrarCliente = usePodeEditar('customers')

  const [etapa, setEtapa] = useState(0)

  // 1. cliente
  const [busca, setBusca] = useState('')
  const [termo, setTermo] = useState('')
  const [clienteId, setClienteId] = useState(clientePre ?? '')
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null)
  const [novoCli, setNovoCli] = useState({ nome: '', telefone: '', cidade: 'Formiga', email: '' })
  const [modoNovoCli, setModoNovoCli] = useState(false)

  // 2. serviço
  const [categoria, setCategoria] = useState('')
  const [servicoId, setServicoId] = useState('')
  /**
   * Itens da comanda. Desde a migration 20260807100000 o atendimento não
   * é mais "um serviço": o cliente chega com duas chaves e um sapato e
   * sai com UMA comanda de três itens.
   *
   * `uid` é chave de render, não vai para o banco — o id real só existe
   * depois do `create_order`.
   */
  const [itens, setItens] = useState<LinhaItem[]>([])

  // 3. fotos (em memória até a comanda existir)
  const [fotos, setFotos] = useState<Foto[]>([])

  // 4. descrição
  const [descricao, setDescricao] = useState('')
  const [observacoes, setObservacoes] = useState('')

  // 5. prazo
  const [prazoDias, setPrazoDias] = useState(2)
  const [responsavelId, setResponsavelId] = useState<string>('')

  // 6/7. valores — o total é a soma dos itens, nunca um campo próprio.
  const [entrada, setEntrada] = useState(0)
  const [forma, setForma] = useState<FormaPagamento>('pix')

  const criarCli = useAcao(criarCliente)
  const criar = useAcao(criarComanda)

  const catInicial = dom.CATEGORIA_LIST[0] ?? ''

  useEffect(() => {
    if (!open) return
    setEtapa(0)
    setBusca('')
    setTermo('')
    setClienteId(clientePre ?? '')
    setClienteSel(null)
    setModoNovoCli(false)
    setNovoCli({ nome: '', telefone: '', cidade: 'Formiga', email: '' })
    setCategoria(catInicial)
    setServicoId('')
    setItens([])
    setFotos([])
    setDescricao('')
    setObservacoes('')
    setPrazoDias(2)
    setResponsavelId('')
    setEntrada(0)
    setForma(dom.FORMA_LIST[0] ?? 'pix')
    criar.limparErro()
    criarCli.limparErro()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientePre, catInicial])

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 300)
    return () => clearTimeout(t)
  }, [busca])

  /** Busca de cliente no servidor — não depende de ter a base em memória. */
  const clientes = useAsync(() => buscarClientes(termo, 8), [termo], {
    ativo: open && etapa === 0 && !modoNovoCli,
  })

  /** Catálogo ativo da categoria escolhida. */
  const servicos = useAsync(
    () => listarServicos({ categoria: categoria || undefined }),
    [categoria],
    { ativo: open && etapa >= 1 },
  )

  const servicosCat = servicos.dados ?? []
  const servico = servicosCat.find((s) => s.id === servicoId) ?? null

  // O cliente escolhido pode não estar na página atual da busca.
  useEffect(() => {
    if (!clienteId) {
      setClienteSel(null)
      return
    }
    const naLista = clientes.dados?.find((c) => c.id === clienteId)
    if (naLista) setClienteSel(naLista)
  }, [clienteId, clientes.dados])

  /** Clicar num serviço ACRESCENTA um item — não troca a seleção. */
  function adicionarServico(s: Servico) {
    setItens((l) => [
      ...l,
      {
        uid: `${s.id}-${l.length}-${s.nome.length}`,
        servicoId: s.id,
        servicoNome: s.nome,
        categoria,
        quantidade: 1,
        valor: s.precoBase,
        precoBase: s.precoBase,
      },
    ])
    setServicoId(s.id)
    // O prazo da comanda acompanha o item mais demorado.
    setPrazoDias((p) => Math.max(p, s.prazoDias))
    if (!responsavelId && s.responsavelPadraoId) setResponsavelId(s.responsavelPadraoId)
  }

  function alterarItem(uid: string, patch: Partial<LinhaItem>) {
    setItens((l) =>
      l.map((i) => {
        if (i.uid !== uid) return i
        const novo = { ...i, ...patch }
        // Mexer na quantidade recalcula o valor pelo preço de tabela; se o
        // operador já negociou o valor, ele o reescreve na etapa Valor.
        if (patch.quantidade !== undefined) novo.valor = i.precoBase * patch.quantidade
        return novo
      }),
    )
  }

  const removerItem = (uid: string) => setItens((l) => l.filter((i) => i.uid !== uid))

  /** Total da comanda: soma dos itens. Nunca um campo digitado à parte. */
  const valor = itens.reduce((s, i) => s + i.valor, 0)

  const prazoEm = addDias(new Date(), prazoDias)
  const saldoPrevisto = Math.max(0, valor - entrada)

  const podeAvancar = (() => {
    switch (etapa) {
      case 0:
        return modoNovoCli
          ? novoCli.nome.trim().length > 2 && novoCli.telefone.replace(/\D/g, '').length >= 8
          : !!clienteId
      case 1:
        return itens.length > 0
      // Etapa 2 (Fotos): a regra é da loja e mora em app_settings. Quem
      // recusa de verdade é `create_order` — aqui é só para o operador
      // não descobrir na etapa 8, depois de preencher tudo.
      case 2:
        return !exigeFoto || fotos.length > 0
      case 5:
        return valor > 0
      case 6:
        return entrada <= valor
      default:
        return true
    }
  })()

  async function avancar() {
    if (etapa === 0 && modoNovoCli) {
      const c = await criarCli.executar({
        nome: novoCli.nome.trim(),
        telefone: novoCli.telefone,
        email: novoCli.email.trim(),
        cidade: novoCli.cidade,
      })
      if (!c) return // o erro aparece no formulário
      setClienteId(c.id)
      setClienteSel(c)
      setModoNovoCli(false)
      push({ tipo: 'ok', titulo: 'Cliente cadastrado', descricao: c.nome })
    }
    setEtapa((e) => Math.min(ETAPAS.length - 1, e + 1))
  }

  async function confirmar() {
    if (itens.length === 0 || !clienteId) return

    const nova = await criar.executar({
      clienteId,
      itens: itens.map((i) => ({
        servicoId: i.servicoId,
        categoria: i.categoria,
        quantidade: i.quantidade,
        valor: i.valor,
        responsavelId: responsavelId || null,
      })),
      entrada,
      forma: entrada > 0 ? forma : null,
      prazoEm: iso(prazoEm),
      descricao,
      observacoes,
      // TODAS as fotos vão no payload, inclusive as que têm arquivo.
      //
      // Antes só iam as SEM arquivo, e o resto subia depois. Isso funcionava
      // enquanto existia o botão "Sem foto": alguma foto sem arquivo sempre
      // acompanhava a comanda e satisfazia a exigência de `create_order`.
      // Com aquele botão removido, toda foto passou a ter arquivo — o
      // payload ia vazio e a RPC recusava a comanda inteira, com uma
      // mensagem sobre foto obrigatória bem depois de o operador ter
      // anexado três.
      //
      // A ordem não dá para inverter: o caminho do bucket é `<order_id>/…`,
      // então o arquivo só sobe depois que a comanda existe. Ver
      // `anexarArquivo` em src/lib/api/fotos.ts.
      fotos,
    })

    if (!nova) return

    // Os arquivos sobem agora, cada um para a linha que `create_order`
    // acabou de criar. A correlação é pelo `seed`, que o GradeFotos gera
    // único justamente para isto.
    //
    // Uma falha aqui não invalida a comanda, que já existe — a linha fica
    // com o gradiente e o operador é avisado para reanexar na ficha.
    let falhas = 0
    for (const f of fotos.filter((f) => f.arquivo)) {
      const linha = nova.fotos.find((c) => c.seed === f.seed)
      if (!linha) {
        falhas++
        continue
      }
      try {
        await anexarArquivo(nova.id, linha.id, f.arquivo!)
      } catch {
        falhas++
      }
    }

    onCriada?.()
    onClose()

    push({
      tipo: falhas ? 'info' : 'ok',
      titulo: `Comanda ${comandaCod(nova.numero, config?.comandas.prefixo ?? 'CF')} criada`,
      descricao: falhas
        ? `${falhas} foto(s) não subiram — anexe na ficha da comanda.`
        : 'Etiqueta liberada e serviço enviado para produção.',
    })

    nav(`/comandas/${nova.id}?print=1`)
  }

  return (
    <Modal
      open={open && podeCriarComanda}
      onClose={onClose}
      title="Novo atendimento"
      subtitle={`Etapa ${etapa + 1} de ${ETAPAS.length} · ${ETAPAS[etapa]}`}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <button
            className="btn-ghost"
            onClick={() => (etapa === 0 ? onClose() : setEtapa((e) => e - 1))}
            disabled={criar.enviando}
          >
            <ArrowLeft size={15} />
            {etapa === 0 ? 'Cancelar' : 'Voltar'}
          </button>

          {etapa < ETAPAS.length - 1 ? (
            <button
              className="btn-primary"
              onClick={() => void avancar()}
              disabled={!podeAvancar || criarCli.enviando}
            >
              {criarCli.enviando ? <Spinner /> : null}
              Continuar
              <ArrowRight size={15} />
            </button>
          ) : (
            <button className="btn-accent" onClick={() => void confirmar()} disabled={criar.enviando}>
              {criar.enviando ? <Spinner /> : <Check size={16} strokeWidth={2.6} />}
              {criar.enviando ? 'Criando comanda…' : 'Confirmar atendimento'}
            </button>
          )}
        </div>
      }
    >
      {/* Trilha de etapas */}
      <div className="mb-6 flex items-center gap-1.5 overflow-x-auto hide-scroll pb-1">
        {ETAPAS.map((e, i) => (
          <div key={e} className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => i < etapa && setEtapa(i)}
              disabled={i > etapa}
              className={cx(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition',
                i === etapa && 'bg-ink-900 text-white',
                i < etapa && 'bg-pine-50 text-pine-700 hover:bg-pine-100 cursor-pointer',
                i > etapa && 'bg-ink-100 text-ink-400',
              )}
            >
              {i < etapa ? <Check size={11} strokeWidth={3} /> : <span className="num">{i + 1}</span>}
              {e}
            </button>
            {i < ETAPAS.length - 1 && <span className="h-px w-2 bg-ink-200" />}
          </div>
        ))}
      </div>

      {criar.erro && (
        <div className="mb-4">
          <Erro compacto mensagem={criar.erro} onTentarNovamente={criar.limparErro} />
        </div>
      )}

      {/* Sem `mode="wait"`: ele segurava a etapa anterior na tela até o
          `exit` terminar antes de montar a próxima, o que fazia cada
          avanço parecer travado. Ver a mesma correção no Layout. */}
      <motion.div
        key={etapa}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.16 }}
      >
          {/* ------------------------- 1. Cliente ------------------------- */}
          {etapa === 0 && (
            <div>
              {!modoNovoCli ? (
                <>
                  <label className="label" htmlFor="busca-cli">
                    Buscar cliente
                  </label>
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                    <input
                      id="busca-cli"
                      autoFocus
                      className="field pl-9"
                      placeholder="Nome, telefone ou WhatsApp…"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                  </div>

                  <div className="mt-3 space-y-1.5 max-h-[280px] overflow-y-auto scroll-x">
                    {clientes.carregando && !clientes.dados && (
                      <p className="flex items-center justify-center gap-2 py-6 text-[13px] text-ink-400">
                        <Spinner />
                        Buscando clientes…
                      </p>
                    )}

                    {clientes.erro && (
                      <Erro compacto mensagem={clientes.erro} onTentarNovamente={clientes.recarregar} />
                    )}

                    {clientes.dados?.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setClienteId(c.id)
                          setClienteSel(c)
                        }}
                        className={cx(
                          'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                          clienteId === c.id
                            ? 'border-ink-900 bg-ink-50'
                            : 'border-ink-100 hover:border-ink-300 hover:bg-ink-50',
                        )}
                      >
                        <Avatar nome={c.nome} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-ink-900">
                            {c.nome}
                          </span>
                          <span className="num block truncate text-[12px] text-ink-500">
                            {telefoneFmt(c.telefone)} · {c.cidade}
                          </span>
                        </span>
                        {clienteId === c.id && <CircleCheck size={17} className="shrink-0 text-pine-500" />}
                      </button>
                    ))}

                    {clientes.dados?.length === 0 && !clientes.carregando && (
                      <p className="py-6 text-center text-[13px] text-ink-400">
                        {termo
                          ? `Nenhum cliente encontrado para “${termo}”.`
                          : 'Nenhum cliente cadastrado ainda.'}
                      </p>
                    )}
                  </div>

                  {podeCadastrarCliente && (
                    <button onClick={() => setModoNovoCli(true)} className="btn-outline w-full mt-3">
                      <UserPlus size={15} />
                      Cadastrar novo cliente
                    </button>
                  )}
                </>
              ) : (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[13.5px] font-bold text-ink-900">Cadastro rápido</p>
                    <button
                      onClick={() => setModoNovoCli(false)}
                      className="btn-ghost text-[12.5px] px-2 py-1"
                    >
                      Voltar à busca
                    </button>
                  </div>

                  {criarCli.erro && (
                    <Erro compacto mensagem={criarCli.erro} onTentarNovamente={criarCli.limparErro} />
                  )}

                  <div>
                    <label className="label" htmlFor="n-nome">
                      Nome completo *
                    </label>
                    <input
                      id="n-nome"
                      autoFocus
                      className="field"
                      value={novoCli.nome}
                      onChange={(e) => setNovoCli({ ...novoCli, nome: e.target.value })}
                      placeholder="Ex.: Maria Aparecida Souza"
                    />
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="n-tel">
                        Telefone / WhatsApp *
                      </label>
                      <input
                        id="n-tel"
                        className="field num"
                        value={telefoneMask(novoCli.telefone)}
                        onChange={(e) =>
                          setNovoCli({ ...novoCli, telefone: telefoneDigitos(e.target.value) })
                        }
                        placeholder="(37) 99999-0000"
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="n-cid">
                        Cidade
                      </label>
                      <input
                        id="n-cid"
                        className="field"
                        value={novoCli.cidade}
                        onChange={(e) => setNovoCli({ ...novoCli, cidade: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="label" htmlFor="n-mail">
                      E-mail
                    </label>
                    <input
                      id="n-mail"
                      type="email"
                      className="field"
                      value={novoCli.email}
                      onChange={(e) => setNovoCli({ ...novoCli, email: e.target.value })}
                      placeholder="opcional"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ------------------------- 2. Serviço ------------------------- */}
          {etapa === 1 && (
            <div>
              <span className="label">Tipo de atendimento</span>
              <div className="flex flex-wrap gap-2 mb-5">
                {dom.CATEGORIA_LIST.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setCategoria(c)
                      setServicoId('')
                    }}
                    className={cx('chip', categoria === c && 'chip-on')}
                  >
                    <IconeCategoria cat={c} size={13} />
                    {dom.cat(c).label}
                  </button>
                ))}
              </div>

              <span className="label">Serviço</span>

              {servicos.carregando && !servicos.dados && (
                <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink-400">
                  <Spinner />
                  Carregando catálogo…
                </p>
              )}

              {servicos.erro && (
                <Erro compacto mensagem={servicos.erro} onTentarNovamente={servicos.recarregar} />
              )}

              <div className="grid gap-2 sm:grid-cols-2 max-h-[300px] overflow-y-auto scroll-x">
                {servicosCat.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => adicionarServico(s)}
                    className={cx(
                      'rounded-xl border p-3 text-left transition',
                      itens.some((i) => i.servicoId === s.id)
                        ? 'border-ink-900 bg-ink-50'
                        : 'border-ink-100 hover:border-ink-300 hover:bg-ink-50',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-bold text-ink-900 leading-snug">{s.nome}</span>
                      <span className="num shrink-0 text-[13px] font-bold text-ink-900">
                        {brl(s.precoBase)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-ink-500 line-clamp-2 leading-snug">{s.descricao}</p>
                    <p className="num mt-1.5 text-[11.5px] font-semibold text-ink-400">
                      Prazo padrão: {s.prazoDias === 0 ? 'no ato' : `${s.prazoDias} dia(s)`}
                    </p>
                  </button>
                ))}

                {servicosCat.length === 0 && !servicos.carregando && !servicos.erro && (
                  <p className="col-span-full py-6 text-center text-[13px] text-ink-400">
                    Nenhum serviço ativo nesta categoria. Cadastre no módulo Serviços.
                  </p>
                )}
              </div>

              {/* Itens já na comanda. Trocar de categoria acima e clicar em
                  outro serviço acrescenta mais um — é assim que a chave e o
                  sapato entram na mesma comanda. */}
              <div className="mt-5">
                <div className="flex items-baseline justify-between">
                  <span className="label !mb-0">
                    Itens da comanda {itens.length > 0 && `(${itens.length})`}
                  </span>
                  {itens.length > 0 && (
                    <span className="num text-[13.5px] text-ink-500">
                      Total: <strong className="text-ink-900">{brl(valor)}</strong>
                    </span>
                  )}
                </div>

                {itens.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-ink-50 px-3.5 py-3 text-[12.5px] text-ink-500">
                    Escolha um serviço acima. Pode adicionar mais de um — cada item ganha etiqueta
                    própria e anda sozinho na produção.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {itens.map((i, n) => (
                      <li
                        key={i.uid}
                        className="flex items-center gap-3 rounded-xl border border-ink-100 p-2.5"
                      >
                        <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink-100 text-[12px] font-bold text-ink-600">
                          {n + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-bold text-ink-900">{i.servicoNome}</p>
                          <p className="text-[11.5px] text-ink-500">{dom.cat(i.categoria).label}</p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => alterarItem(i.uid, { quantidade: Math.max(1, i.quantidade - 1) })}
                            className="btn-outline h-8 w-8 !px-0"
                            aria-label="Diminuir"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={1}
                            aria-label={`Quantidade de ${i.servicoNome}`}
                            className="field num h-8 w-14 text-center !py-0"
                            value={i.quantidade}
                            onChange={(e) =>
                              alterarItem(i.uid, { quantidade: numeroDeInput(e, { min: 1 }) })
                            }
                          />
                          <button
                            onClick={() => alterarItem(i.uid, { quantidade: i.quantidade + 1 })}
                            className="btn-outline h-8 w-8 !px-0"
                            aria-label="Aumentar"
                          >
                            +
                          </button>
                        </div>

                        <span className="num w-24 shrink-0 text-right text-[13px] font-bold text-ink-900">
                          {brl(i.valor)}
                        </span>

                        <button
                          onClick={() => removerItem(i.uid)}
                          className="shrink-0 grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600 transition"
                          aria-label={`Remover ${i.servicoNome}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* -------------------------- 3. Fotos -------------------------- */}
          {etapa === 2 && (
            <div>
              <p className="text-[13.5px] text-ink-600 mb-4 leading-relaxed">
                Fotografe a peça <strong>como ela chegou</strong>. É este registro que resolve
                discussão sobre o estado em que o item foi recebido — ele fica na comanda, aparece na
                produção, no histórico do cliente e na impressão.
              </p>
              <GradeFotos
                fotos={fotos}
                categoria={categoria}
                // Sem "Depois": aqui a peça está chegando. A foto do serviço
                // pronto é tirada na ficha da comanda, na hora da entrega.
                tiposPermitidos={['antes', 'detalhe']}
                onAdd={(f) => setFotos((l) => [...l, f])}
                onRemove={(id) => setFotos((l) => l.filter((f) => f.id !== id))}
                onTipo={(id, t) => setFotos((l) => l.map((f) => (f.id === id ? { ...f, tipo: t } : f)))}
                altura="h-28"
              />
              {fotos.length === 0 && (
                <p className="mt-4 rounded-xl bg-brass-50 px-3.5 py-2.5 text-[12.5px] text-brass-700">
                  {exigeFoto
                    ? 'Anexe ao menos uma foto do item para continuar. É ela que mostra em que estado a peça foi recebida.'
                    : 'Recomendado anexar ao menos uma foto do item na entrada.'}
                </p>
              )}
            </div>
          )}

          {/* ------------------------ 4. Descrição ------------------------ */}
          {etapa === 3 && (
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="desc">
                  Descrição do serviço
                </label>
                <textarea
                  id="desc"
                  autoFocus
                  rows={4}
                  className="field resize-none"
                  placeholder="Ex.: Bota de couro marrom, sola descolando na ponta direita."
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="obs">
                  Observações internas
                </label>
                <textarea
                  id="obs"
                  rows={3}
                  className="field resize-none"
                  placeholder="Ex.: Cliente pediu para avisar assim que ficar pronto."
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* -------------------------- 5. Prazo -------------------------- */}
          {etapa === 4 && (
            <div className="space-y-5">
              <div>
                <span className="label">Prazo de entrega</span>
                <div className="flex flex-wrap gap-2">
                  {PRAZOS_SUGERIDOS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setPrazoDias(d)}
                      className={cx('chip num', prazoDias === d && 'chip-on')}
                    >
                      {d === 0 ? 'Hoje' : d === 1 ? 'Amanhã' : `${d} dias`}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={PRAZO_MAX_DIAS}
                    className="field num w-24"
                    value={prazoDias}
                    onChange={(e) => setPrazoDias(numeroDeInput(e, { min: 0, max: PRAZO_MAX_DIAS }))}
                    aria-label="Dias de prazo"
                  />
                  <span className="text-[13.5px] text-ink-600">
                    Previsão: <strong className="num text-ink-900">{fmtData(prazoEm)}</strong>
                  </span>
                </div>
              </div>

              <div>
                <span className="label">Responsável pela execução</span>
                <div className="flex flex-wrap gap-2">
                  {dom.EXECUTORES.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setResponsavelId(m.id)}
                      className={cx('chip', responsavelId === m.id && 'chip-on')}
                    >
                      {m.nome}
                    </button>
                  ))}
                </div>
                {dom.EXECUTORES.length === 0 && (
                  <p className="text-[12.5px] text-ink-400">
                    Nenhum responsável cadastrado — a comanda fica sem atribuição.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* -------------------------- 6. Valor -------------------------- */}
          {etapa === 5 && (
            <div className="space-y-4">
              <p className="text-[13.5px] text-ink-600 leading-relaxed">
                O valor é por item — o total da comanda é a soma. É assim que o banco guarda desde
                a migration de itens, e é o que deixa negociar uma linha sem mexer nas outras.
              </p>

              {itens.map((i) => {
                const tabela = i.precoBase * i.quantidade
                return (
                  <div key={i.uid} className="rounded-card border border-ink-100 p-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13px] font-bold text-ink-900">
                        {i.servicoNome}
                      </span>
                      <span className="num shrink-0 text-[11.5px] text-ink-500">
                        {i.quantidade}x · {dom.cat(i.categoria).label}
                      </span>
                    </div>

                    <div className="relative mt-2">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-ink-400">
                        R$
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={`Valor de ${i.servicoNome}`}
                        className="field num pl-10 text-[17px] font-bold"
                        value={i.valor}
                        onChange={(e) => alterarItem(i.uid, { valor: numeroDeInput(e, { min: 0 }) })}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] text-ink-500">
                        Tabela: <strong className="num">{brl(tabela)}</strong>
                      </span>
                      {i.valor !== tabela && (
                        <button
                          onClick={() => alterarItem(i.uid, { valor: tabela })}
                          className="text-[12px] font-bold text-brass-600 hover:underline"
                        >
                          restaurar
                        </button>
                      )}
                      <span className="flex-1" />
                      {AJUSTES_VALOR.map((d) => (
                        <button
                          key={d}
                          onClick={() => alterarItem(i.uid, { valor: Math.max(0, i.valor + d) })}
                          className="chip num !py-1 !text-[12px]"
                        >
                          {d > 0 ? `+${d}` : d}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}

              <div className="flex items-center justify-between rounded-card bg-ink-50 px-4 py-3">
                <span className="text-[13.5px] font-semibold text-ink-700">Total da comanda</span>
                <span className="num text-[20px] font-extrabold text-ink-950">{brl(valor)}</span>
              </div>
            </div>
          )}

          {/* ------------------------ 7. Pagamento ------------------------ */}
          {etapa === 6 && (
            <div className="space-y-5">
              <div className="rounded-card bg-ink-50 p-4">
                <div className="flex items-center justify-between text-[13.5px]">
                  <span className="text-ink-600">Valor total</span>
                  <span className="num font-bold text-ink-900">{brl(valor)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[13.5px]">
                  <span className="text-ink-600">Entrada</span>
                  <span className="num font-bold text-pine-600">{brl(entrada)}</span>
                </div>
                <div className="mt-2 border-t border-ink-200 pt-2 flex items-center justify-between text-[14px]">
                  <span className="font-semibold text-ink-700">Saldo na retirada</span>
                  <span className="num font-bold text-ink-900">{brl(saldoPrevisto)}</span>
                </div>
              </div>

              <div>
                <label className="label" htmlFor="entrada">
                  Entrada (sinal)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-ink-400">
                    R$
                  </span>
                  <input
                    id="entrada"
                    type="number"
                    min={0}
                    max={valor}
                    step="0.01"
                    className="field num pl-10"
                    value={entrada}
                    onChange={(e) => setEntrada(numeroDeInput(e, { min: 0, max: valor }))}
                  />
                </div>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button onClick={() => setEntrada(0)} className={cx('chip', entrada === 0 && 'chip-on')}>
                    Sem entrada
                  </button>
                  <button
                    onClick={() => setEntrada(Math.round(valor * 0.5))}
                    className={cx('chip', entrada === Math.round(valor * 0.5) && entrada > 0 && 'chip-on')}
                  >
                    50%
                  </button>
                  <button
                    onClick={() => setEntrada(valor)}
                    className={cx('chip', entrada === valor && valor > 0 && 'chip-on')}
                  >
                    Pagamento integral
                  </button>
                </div>
              </div>

              {entrada > 0 && (
                <div>
                  <span className="label">Forma de pagamento</span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {dom.FORMA_LIST.map((f) => (
                      <button
                        key={f}
                        onClick={() => setForma(f)}
                        className={cx(
                          'flex items-center justify-center gap-2 rounded-field border px-3 py-2.5 text-[13px] font-semibold transition',
                          forma === f
                            ? 'border-ink-900 bg-ink-900 text-white'
                            : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50',
                        )}
                      >
                        <IconeForma forma={f} size={14} />
                        {dom.forma(f)?.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ------------------------- 8. Revisão ------------------------- */}
          {etapa === 7 && (
            <div className="space-y-4">
              <div className="rounded-card border border-ink-100 p-4">
                <p className="label !mb-2">Cliente</p>
                {clienteSel ? (
                  <div className="flex items-center gap-3">
                    <Avatar nome={clienteSel.nome} size={38} />
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-ink-900">{clienteSel.nome}</p>
                      <p className="num text-[12.5px] text-ink-500">
                        {telefoneFmt(clienteSel.telefone)} · {clienteSel.cidade}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] text-ink-400">Nenhum cliente selecionado.</p>
                )}
              </div>

              {/* Cada linha aqui vira uma etiqueta e um card na produção. */}
              <div className="rounded-card border border-ink-100 divide-y divide-ink-100">
                {itens.map((i, n) => (
                  <div key={i.uid} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-100 text-[11px] font-bold text-ink-600">
                      {n + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink-900">
                        {i.servicoNome}
                      </p>
                      <p className="text-[11.5px] text-ink-500">
                        {dom.cat(i.categoria).label} · {i.quantidade}x
                      </p>
                    </div>
                    <span className="num shrink-0 text-[13px] font-bold text-ink-900">
                      {brl(i.valor)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <LinhaRev
                  label="Itens"
                  valor={<span className="num font-semibold">{itens.length}</span>}
                />
                <LinhaRev
                  label="Quantidade total"
                  valor={<span className="num">{itens.reduce((s, i) => s + i.quantidade, 0)}</span>}
                />
                <LinhaRev label="Responsável" valor={dom.membro(responsavelId)?.nome ?? '—'} />
                <LinhaRev label="Prazo" valor={<span className="num">{fmtData(prazoEm)}</span>} />
                <LinhaRev label="Fotos anexadas" valor={<span className="num">{fotos.length}</span>} />
                <LinhaRev label="Valor total" valor={<span className="num font-bold">{brl(valor)}</span>} />
                <LinhaRev
                  label="Entrada"
                  valor={
                    <span className="num">
                      {brl(entrada)}
                      {entrada > 0 && (
                        <span className="ml-1.5 text-ink-500">· {dom.forma(forma)?.label}</span>
                      )}
                    </span>
                  }
                />
                <LinhaRev
                  label="Saldo na retirada"
                  valor={<span className="num font-bold">{brl(saldoPrevisto)}</span>}
                />
                <LinhaRev
                  label="Próxima comanda"
                  valor={
                    <span className="num">
                      {comandaCod(
                        config?.comandas.proximoNumero ?? 1,
                        config?.comandas.prefixo ?? 'CF',
                      )}
                    </span>
                  }
                />
              </div>

              {descricao && (
                <div className="rounded-card border border-ink-100 p-4">
                  <p className="label !mb-1.5">Descrição</p>
                  <p className="text-[13px] text-ink-700 leading-relaxed">{descricao}</p>
                </div>
              )}

              {fotos.length > 0 && (
                <div className="rounded-card border border-ink-100 p-4">
                  <p className="label !mb-2">Fotos</p>
                  <GradeFotos fotos={fotos} categoria={categoria} editavel={false} altura="h-20" />
                </div>
              )}

              <div className="rounded-card bg-pine-50 p-4">
                <p className="text-[12.5px] font-semibold text-pine-700 leading-relaxed">
                  Ao confirmar: a comanda é criada e numerada, o serviço entra na produção, o histórico é
                  registrado e o financeiro recebe os lançamentos de entrada e saldo.
                </p>
              </div>
            </div>
          )}
      </motion.div>
    </Modal>
  )
}

function LinhaRev({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-100 px-3.5 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <div className="mt-1 text-[13.5px] text-ink-900">{valor}</div>
    </div>
  )
}
