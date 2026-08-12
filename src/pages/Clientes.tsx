import { Download, Plus, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar, ClienteStatusBadge, Kpi, PageHead } from '@/components/dominio'
import {
  Erro,
  Modal,
  Paginacao,
  Select,
  SkelCards,
  SkelLinhas,
  Spinner,
  Vazio,
  useToast,
} from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { baixarCsv, csvData, csvNumero, paraCsv } from '@/lib/exportar'
import { mensagemErro } from '@/lib/supabase'
import { useAcao, useAsync, useLista } from '@/lib/hooks'
import { criarCliente, listarClientes, type FiltroClientes, type NovoCliente } from '@/lib/api/clientes'
import { usePodeEditar } from '@/store/useSessao'
import { brl, cx, fmtData, telefoneDigitos, telefoneFmt, telefoneMask } from '@/lib/utils'
import type { Cliente } from '@/types'

export default function Clientes() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const { push } = useToast()
  const dom = useDominioMaps()
  const podeEditar = usePodeEditar('customers')

  const [novoAberto, setNovoAberto] = useState(false)

  const lista = useLista<Cliente, FiltroClientes>(listarClientes, { ordem: 'recentes' }, {
    tabelas: ['customers', 'orders'],
    canal: 'clientes-lista',
  })

  /**
   * Os KPIs vêm de uma consulta própria de agregação, não da soma da
   * página: com paginação, somar as 30 linhas visíveis daria um total
   * errado no topo da tela.
   */
  const resumo = useAsync(
    async () => {
      const [comPendencia, recorrentes, total] = await Promise.all([
        listarClientes({ pagina: 1, tamanho: 1, ordem: { campo: 'pending_amount', direcao: 'desc' } }, {
          status: 'pendencia',
        }),
        listarClientes({ pagina: 1, tamanho: 1 }, { recorrente: true }),
        listarClientes({ pagina: 1, tamanho: 1 }, {}),
      ])
      return {
        comPendencia: comPendencia.total,
        recorrentes: recorrentes.total,
        total: total.total,
      }
    },
    [],
    { tabelas: ['customers', 'orders'], canal: 'clientes-kpis' },
  )

  const [exportando, setExportando] = useState(false)

  /**
   * Exporta o RECORTE atual, não a página visível.
   *
   * A tela pagina de 30 em 30; exportar o que está na tela daria um
   * arquivo com 30 linhas quando o filtro casa 300. Refaz a consulta com
   * `tamanho` alto e os mesmos filtros.
   */
  async function exportar() {
    setExportando(true)
    try {
      const pagina = await listarClientes(
        { ...lista.consulta, pagina: 1, tamanho: 5000 },
        lista.filtro,
      )
      baixarCsv(
        'clientes',
        paraCsv(pagina.linhas, [
          { titulo: 'Nome', valor: (c) => c.nome },
          { titulo: 'Telefone', valor: (c) => telefoneFmt(c.telefone) },
          { titulo: 'WhatsApp', valor: (c) => telefoneFmt(c.whatsapp) },
          { titulo: 'E-mail', valor: (c) => c.email },
          { titulo: 'Cidade', valor: (c) => c.cidade },
          { titulo: 'Situação', valor: (c) => dom.cliSt(c.status).label },
          { titulo: 'Serviços', valor: (c) => c.qtdComandas ?? 0 },
          { titulo: 'Total gasto', valor: (c) => csvNumero(c.totalGasto ?? 0) },
          { titulo: 'Pendente', valor: (c) => csvNumero(c.pendente ?? 0) },
          { titulo: 'Cadastro', valor: (c) => csvData(c.cadastroEm) },
        ]),
      )
      push({ tipo: 'ok', titulo: 'Arquivo gerado', descricao: `${pagina.linhas.length} clientes.` })
    } catch (e) {
      push({ tipo: 'erro', titulo: 'Falha ao exportar', descricao: mensagemErro(e) })
    } finally {
      setExportando(false)
    }
  }

  const criar = useAcao(criarCliente)

  useEffect(() => {
    if (params.get('novo') === '1') {
      setNovoAberto(true)
      params.delete('novo')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const linhas = lista.pagina.linhas
  // Soma da página — rotulada como tal na UI, para não se confundir com
  // um total geral.
  const pendenteNaPagina = linhas.reduce((s, c) => s + (c.pendente ?? 0), 0)

  return (
    <div>
      <PageHead
        titulo="Clientes"
        subtitulo="Histórico, serviços e valores de cada cliente da loja."
        acoes={
          <>
            <button onClick={exportar} className="btn-outline" disabled={exportando}>
              {exportando ? <Spinner /> : <Download size={15} />}
              Exportar
            </button>
            {podeEditar && (
              <button onClick={() => setNovoAberto(true)} className="btn-accent">
                <Plus size={16} strokeWidth={2.6} />
                Novo cliente
              </button>
            )}
          </>
        }
      />

      {resumo.carregando && !resumo.dados ? (
        <SkelCards />
      ) : resumo.erro ? (
        <Erro compacto mensagem={resumo.erro} onTentarNovamente={resumo.recarregar} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Total de clientes" valor={resumo.dados?.total ?? 0} hint="Base cadastrada" icon={Users} />
          <Kpi
            label="Recorrentes"
            valor={resumo.dados?.recorrentes ?? 0}
            hint="3 ou mais serviços"
            tom="ok"
            onClick={() => lista.trocarFiltro({ recorrente: true, ordem: 'servicos' })}
          />
          <Kpi
            label="Com pendência"
            valor={resumo.dados?.comPendencia ?? 0}
            hint="Saldo em aberto"
            tom="alerta"
            onClick={() => lista.trocarFiltro({ status: 'pendencia', ordem: 'pendente' })}
          />
          <Kpi
            label="Pendente nesta página"
            valor={brl(pendenteNaPagina)}
            hint={`Soma das ${linhas.length} linhas exibidas`}
            tom="perigo"
          />
        </div>
      )}

      {/* Filtros */}
      <div className="card mt-6 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="field pl-9"
              placeholder="Buscar por nome, telefone, e-mail ou cidade…"
              value={lista.busca}
              onChange={(e) => lista.setBusca(e.target.value)}
              aria-label="Buscar cliente"
            />
          </div>

          <div className="flex gap-2">
            <Select
              value={lista.filtro.recorrente ? 'recorrente' : (lista.filtro.status ?? '')}
              // 'recorrente' não existe como status_key gravado (ver
              // FiltroClientes.recorrente): vira recorte por order_count.
              onChange={(v) =>
                lista.setFiltro(
                  v === 'recorrente'
                    ? { status: undefined, recorrente: true }
                    : { status: v || undefined, recorrente: undefined },
                )
              }
              placeholder="Todos os status"
              aria-label="Filtrar por status"
              className="w-full sm:w-44"
              options={dom.CLIENTE_STATUS
                ? Object.values(dom.CLIENTE_STATUS).map((m) => ({ value: m.key, label: m.label }))
                : []}
            />
            <Select
              value={lista.filtro.ordem ?? 'recentes'}
              onChange={(v) => lista.setFiltro({ ordem: v })}
              aria-label="Ordenar"
              className="w-full sm:w-44"
              options={[
                { value: 'recentes', label: 'Mais recentes' },
                { value: 'nome', label: 'Nome (A–Z)' },
                { value: 'gasto', label: 'Maior valor gasto' },
                { value: 'pendente', label: 'Maior pendência' },
                { value: 'servicos', label: 'Mais serviços' },
              ]}
            />
          </div>
        </div>

        {(lista.consulta.busca || lista.filtro.status) && (
          <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-500">
            <span className="num font-semibold">{lista.pagina.total}</span> resultado(s)
            <button
              onClick={() => {
                lista.setBusca('')
                lista.trocarFiltro({ ordem: lista.filtro.ordem })
              }}
              className="ml-1 font-bold text-brass-600 hover:underline"
            >
              limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="mt-4">
        {lista.inicial && lista.carregando ? (
          <SkelLinhas n={8} />
        ) : lista.erro ? (
          <div className="card">
            <Erro mensagem={lista.erro} onTentarNovamente={lista.recarregar} />
          </div>
        ) : lista.pagina.total === 0 ? (
          <div className="card">
            <Vazio
              icon={Users}
              titulo={
                lista.consulta.busca || lista.filtro.status
                  ? 'Nenhum cliente encontrado'
                  : 'Nenhum cliente cadastrado'
              }
              descricao={
                lista.consulta.busca || lista.filtro.status
                  ? 'Ajuste os filtros ou a busca.'
                  : 'Cadastre o primeiro cliente para começar a abrir comandas.'
              }
              acao={
                podeEditar && (
                  <button onClick={() => setNovoAberto(true)} className="btn-primary">
                    <Plus size={15} />
                    Novo cliente
                  </button>
                )
              }
            />
          </div>
        ) : (
          <>
            {/* Tabela — desktop */}
            <div className={cx('card hidden lg:block overflow-hidden', lista.carregando && 'opacity-60')}>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60">
                    {['Cliente', 'Contato', 'Cidade', 'Serviços', 'Último serviço', 'Total pago', 'Pendente', 'Status'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-[11.5px] font-bold uppercase tracking-wider text-ink-500"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => nav(`/clientes/${c.id}`)}
                      className="cursor-pointer border-b border-ink-50 transition hover:bg-ink-50 last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar nome={c.nome} size={32} />
                          <span className="text-[13.5px] font-semibold text-ink-900">{c.nome}</span>
                        </div>
                      </td>
                      <td className="num px-4 py-3 text-[13px] text-ink-600">{telefoneFmt(c.telefone)}</td>
                      <td className="px-4 py-3 text-[13px] text-ink-600">{c.cidade}</td>
                      <td className="num px-4 py-3 text-[13px] font-semibold text-ink-800">
                        {c.qtdComandas ?? 0}
                      </td>
                      <td className="num px-4 py-3 text-[13px] text-ink-600">
                        {c.ultimaComandaEm ? fmtData(c.ultimaComandaEm) : '—'}
                      </td>
                      <td className="num px-4 py-3 text-[13px] font-bold text-ink-900">
                        {brl(c.totalGasto ?? 0)}
                      </td>
                      <td className="num px-4 py-3 text-[13px] font-bold">
                        {(c.pendente ?? 0) > 0.01 ? (
                          <span className="text-danger">{brl(c.pendente ?? 0)}</span>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ClienteStatusBadge status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Paginacao
                pagina={lista.pagina.pagina}
                paginas={lista.pagina.paginas}
                total={lista.pagina.total}
                tamanho={lista.pagina.tamanho}
                carregando={lista.carregando}
                onAnterior={lista.anterior}
                onProxima={lista.proxima}
                rotulo="cliente"
              />
            </div>

            {/* Cards — mobile/tablet */}
            <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {linhas.map((c) => (
                <button
                  key={c.id}
                  onClick={() => nav(`/clientes/${c.id}`)}
                  className="card card-hover p-4 text-left"
                >
                  <div className="flex items-start gap-3">
                    <Avatar nome={c.nome} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-bold text-ink-900">{c.nome}</p>
                      <p className="num truncate text-[12.5px] text-ink-500">
                        {telefoneFmt(c.telefone)} · {c.cidade}
                      </p>
                    </div>
                    <ClienteStatusBadge status={c.status} />
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3">
                    <div>
                      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">Serviços</p>
                      <p className="num text-[14px] font-bold text-ink-900">{c.qtdComandas ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">Pago</p>
                      <p className="num text-[14px] font-bold text-ink-900">{brl(c.totalGasto ?? 0)}</p>
                    </div>
                    <div>
                      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">Pendente</p>
                      <p
                        className={cx(
                          'num text-[14px] font-bold',
                          (c.pendente ?? 0) > 0.01 ? 'text-danger' : 'text-ink-300',
                        )}
                      >
                        {(c.pendente ?? 0) > 0.01 ? brl(c.pendente ?? 0) : '—'}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
              <div className="card sm:col-span-2">
                <Paginacao
                  pagina={lista.pagina.pagina}
                  paginas={lista.pagina.paginas}
                  total={lista.pagina.total}
                  tamanho={lista.pagina.tamanho}
                  carregando={lista.carregando}
                  onAnterior={lista.anterior}
                  onProxima={lista.proxima}
                  rotulo="cliente"
                />
              </div>
            </div>
          </>
        )}
      </div>

      <ModalCliente
        open={novoAberto}
        onClose={() => setNovoAberto(false)}
        enviando={criar.enviando}
        erro={criar.erro}
        onSalvar={async (dados) => {
          const c = await criar.executar(dados)
          if (!c) return
          push({ tipo: 'ok', titulo: 'Cliente cadastrado', descricao: c.nome })
          setNovoAberto(false)
          nav(`/clientes/${c.id}`)
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function ModalCliente({
  open,
  onClose,
  onSalvar,
  inicial,
  titulo = 'Novo cliente',
  enviando,
  erro,
}: {
  open: boolean
  onClose: () => void
  onSalvar: (d: NovoCliente) => void | Promise<void>
  inicial?: Partial<Cliente>
  titulo?: string
  enviando?: boolean
  erro?: string | null
}) {
  const [f, setF] = useState({
    nome: '',
    telefone: '',
    whatsapp: '',
    email: '',
    cidade: 'Formiga',
    observacoes: '',
  })

  useEffect(() => {
    if (open) {
      setF({
        nome: inicial?.nome ?? '',
        telefone: inicial?.telefone ?? '',
        whatsapp: inicial?.whatsapp ?? '',
        email: inicial?.email ?? '',
        cidade: inicial?.cidade ?? 'Formiga',
        observacoes: inicial?.observacoes ?? '',
      })
    }
  }, [open, inicial])

  // Mesmas regras 1 e 2 que o banco valida por CHECK — validar aqui evita
  // uma ida ao servidor para receber uma mensagem menos clara.
  const valido = f.nome.trim().length > 2 && f.telefone.replace(/\D/g, '').length >= 8

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titulo}
      subtitle="O telefone identifica o cliente no balcão e não pode repetir."
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={!valido || enviando} onClick={() => void onSalvar(f)}>
            {enviando ? <Spinner /> : null}
            Salvar cliente
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
          <label className="label" htmlFor="c-nome">
            Nome completo *
          </label>
          <input
            id="c-nome"
            autoFocus
            className="field"
            value={f.nome}
            onChange={(e) => setF({ ...f, nome: e.target.value })}
            placeholder="Ex.: Maria Aparecida Souza"
          />
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="c-tel">
              Telefone *
            </label>
            <input
              id="c-tel"
              className="field num"
              value={telefoneMask(f.telefone)}
              onChange={(e) => setF({ ...f, telefone: telefoneDigitos(e.target.value) })}
              placeholder="(37) 99999-0000"
            />
          </div>
          <div>
            <label className="label" htmlFor="c-wpp">
              WhatsApp
            </label>
            <input
              id="c-wpp"
              className="field num"
              value={telefoneMask(f.whatsapp)}
              onChange={(e) => setF({ ...f, whatsapp: telefoneDigitos(e.target.value) })}
              placeholder="Igual ao telefone se vazio"
            />
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="c-mail">
              E-mail
            </label>
            <input
              id="c-mail"
              type="email"
              className="field"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="c-cid">
              Cidade
            </label>
            <input
              id="c-cid"
              className="field"
              value={f.cidade}
              onChange={(e) => setF({ ...f, cidade: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="c-obs">
            Observações
          </label>
          <textarea
            id="c-obs"
            rows={3}
            className="field resize-none"
            value={f.observacoes}
            onChange={(e) => setF({ ...f, observacoes: e.target.value })}
            placeholder="Preferências de contato, retirada, etc."
          />
        </div>
      </div>
    </Modal>
  )
}
