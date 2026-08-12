import { ClipboardList, Clock, Plus, Receipt, Users, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { GradeFotos } from '@/components/Fotos'
import NovoAtendimento from '@/components/NovoAtendimento'
import { CategoriaBadge, Kpi, PageHead, PrazoBadge, StatusBadge } from '@/components/dominio'
import { Erro, SkelCards, SkelLinhas, Vazio } from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { useAsync, useLista } from '@/lib/hooks'
import { listarComandas, type FiltroComandas } from '@/lib/api/comandas'
import { listarClientes } from '@/lib/api/clientes'
import { consultaInicial } from '@/lib/listing'
import { usePodeEditar, useSessao } from '@/store/useSessao'
import { brl, comandaCod, cx, fmtHora, saldo, telefoneFmt } from '@/lib/utils'
import type { Comanda } from '@/types'

export default function Atendimento() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)
  const prefixo = config?.comandas.prefixo ?? 'CF'
  const podeCriar = usePodeEditar('service_desk')

  const [aberto, setAberto] = useState(false)

  // O menu "Criar" abre o fluxo via ?novo=1 — mas só para quem escreve.
  // Sem a guarda, a URL digitada à mão contornava o botão escondido.
  useEffect(() => {
    if (params.get('novo') === '1') {
      if (podeCriar) setAberto(true)
      params.delete('novo')
      setParams(params, { replace: true })
    }
  }, [params, setParams, podeCriar])

  /** Comandas abertas hoje — filtro no servidor, não no array inteiro. */
  const doDia = useAsync(
    () =>
      listarComandas(
        { ...consultaInicial({ campo: 'created_at', direcao: 'desc' }), tamanho: 50 },
        { criadaHoje: true },
      ),
    [],
    { tabelas: ['orders'], canal: 'atendimento-hoje' },
  )

  const totalClientes = useAsync(() => listarClientes({ pagina: 1, tamanho: 1 }, {}), [], {
    tabelas: ['customers'],
    canal: 'atendimento-clientes',
  })

  /** Histórico recente com busca e filtro de categoria. */
  const recentes = useLista<Comanda, FiltroComandas>(listarComandas, {}, {
    ordem: { campo: 'created_at', direcao: 'desc' },
    tabelas: ['orders', 'order_photos'],
    canal: 'atendimento-recentes',
  })

  const hoje = doDia.dados?.linhas ?? []
  const valorDia = hoje.reduce((s, c) => s + c.valor, 0)
  const ticketDia = hoje.length ? valorDia / hoje.length : 0

  return (
    <div>
      <PageHead
        titulo="Atendimento"
        subtitulo="Receba o item, registre as fotos e gere a comanda em poucos passos."
        acoes={
          <>
            <button onClick={() => nav('/comandas')} className="btn-outline">
              <Receipt size={15} />
              Ver comandas
            </button>
            {podeCriar && (
              <button onClick={() => setAberto(true)} className="btn-accent">
                <Plus size={16} strokeWidth={2.6} />
                Novo atendimento
              </button>
            )}
          </>
        }
      />

      {doDia.carregando && !doDia.dados ? (
        <SkelCards />
      ) : doDia.erro ? (
        <Erro compacto mensagem={doDia.erro} onTentarNovamente={doDia.recarregar} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Atendimentos hoje"
            valor={doDia.dados?.total ?? 0}
            hint="Comandas abertas no balcão hoje"
            icon={ClipboardList}
          />
          <Kpi label="Valor do dia" valor={brl(valorDia)} hint="Soma dos serviços registrados" icon={Zap} tom="ok" />
          <Kpi label="Ticket médio do dia" valor={brl(ticketDia)} hint="Média por atendimento" icon={Receipt} />
          <Kpi
            label="Clientes cadastrados"
            valor={totalClientes.dados?.total ?? 0}
            hint="Base ativa da loja"
            icon={Users}
            onClick={() => nav('/clientes')}
          />
        </div>
      )}

      {/* Fluxo em destaque */}
      <section className="card mt-6 overflow-hidden">
        <div className="grid lg:grid-cols-[1.1fr_1fr]">
          <div className="p-5 sm:p-6">
            <h2 className="text-[17px] font-bold text-ink-900">Fluxo de atendimento rápido</h2>
            <p className="mt-1 text-[13.5px] text-ink-500 leading-relaxed">
              Em poucos passos o atendimento cria a comanda, registra as fotos, define o prazo, libera a
              etiqueta e acompanha o serviço até a entrega.
            </p>

            <ol className="mt-5 grid gap-2 sm:grid-cols-2">
              {[
                'Cliente',
                'Tipo de serviço',
                'Fotografias',
                'Descrição',
                'Prazo',
                'Valor',
                'Pagamento',
                'Confirmação',
              ].map((e, i) => (
                <li key={e} className="flex items-center gap-2.5 rounded-xl bg-ink-50 px-3 py-2">
                  <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-[11.5px] font-bold text-ink-600 shadow-soft">
                    {i + 1}
                  </span>
                  <span className="text-[13px] font-semibold text-ink-700">{e}</span>
                </li>
              ))}
            </ol>

            {podeCriar && (
              <button onClick={() => setAberto(true)} className="btn-primary mt-5">
                <Plus size={16} strokeWidth={2.6} />
                Iniciar atendimento
              </button>
            )}
          </div>

          <div className="border-t border-ink-100 bg-ink-50/60 p-5 sm:p-6 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between">
              <h3 className="text-[14.5px] font-bold text-ink-900">Atendimentos de hoje</h3>
              <span className="badge bg-white text-ink-600 num">{doDia.dados?.total ?? 0}</span>
            </div>

            {doDia.carregando && !doDia.dados ? (
              <div className="mt-4">
                <SkelLinhas n={4} />
              </div>
            ) : hoje.length === 0 ? (
              <div className="mt-2">
                <Vazio
                  icon={Clock}
                  titulo="Nenhum atendimento hoje"
                  descricao="Assim que um item for recebido no balcão, ele aparece aqui."
                  acao={
                    podeCriar && (
                      <button onClick={() => setAberto(true)} className="btn-primary">
                        <Plus size={15} />
                        Novo atendimento
                      </button>
                    )
                  }
                />
              </div>
            ) : (
              <div className="mt-4 space-y-2 max-h-[340px] overflow-y-auto scroll-x pr-1">
                {hoje.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => nav(`/comandas/${c.id}`)}
                    className="flex w-full items-center gap-3 rounded-xl border border-ink-100 bg-white px-3 py-2.5 text-left transition hover:border-ink-300 hover:shadow-soft"
                  >
                    <span className="num shrink-0 text-[11.5px] font-bold text-ink-400">
                      {fmtHora(c.criadaEm)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-ink-900">{c.clienteNome}</span>
                      <span className="block truncate text-[11.5px] text-ink-500">{c.servicoNome}</span>
                    </span>
                    <span className="num shrink-0 text-[13px] font-bold text-ink-900">{brl(c.valor)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Histórico recente */}
      <section className="mt-6">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[17px] font-bold text-ink-900">Últimos atendimentos</h2>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="field w-full sm:w-56"
              placeholder="Buscar comanda ou cliente…"
              value={recentes.busca}
              onChange={(e) => recentes.setBusca(e.target.value)}
              aria-label="Buscar atendimento"
            />
            <div className="flex gap-1.5 overflow-x-auto hide-scroll">
              <button
                onClick={() => recentes.setFiltro({ categoria: undefined })}
                className={cx('chip', !recentes.filtro.categoria && 'chip-on')}
              >
                Todas
              </button>
              {dom.CATEGORIA_LIST.slice(0, 3).map((c) => (
                <button
                  key={c}
                  onClick={() => recentes.setFiltro({ categoria: c })}
                  className={cx('chip', recentes.filtro.categoria === c && 'chip-on')}
                >
                  {dom.cat(c).label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {recentes.inicial && recentes.carregando ? (
          <SkelLinhas n={6} />
        ) : recentes.erro ? (
          <div className="card">
            <Erro mensagem={recentes.erro} onTentarNovamente={recentes.recarregar} />
          </div>
        ) : recentes.pagina.total === 0 ? (
          <div className="card">
            <Vazio
              icon={ClipboardList}
              titulo="Nenhum atendimento encontrado"
              descricao="Ajuste a busca ou o filtro de categoria para ver outros registros."
              acao={
                <button
                  onClick={() => recentes.limpar({})}
                  className="btn-outline"
                >
                  Limpar filtros
                </button>
              }
            />
          </div>
        ) : (
          <div className={cx('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', recentes.carregando && 'opacity-60')}>
            {recentes.pagina.linhas.map((c) => (
              <button
                key={c.id}
                onClick={() => nav(`/comandas/${c.id}`)}
                className="card card-hover p-4 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="num text-[12px] font-bold text-ink-400">
                    {comandaCod(c.numero, prefixo)}
                  </span>
                  <StatusBadge status={c.status} />
                </div>

                <p className="mt-2 truncate text-[14.5px] font-bold text-ink-900">{c.clienteNome}</p>
                <p className="num truncate text-[12px] text-ink-500">{telefoneFmt(c.clienteTelefone)}</p>

                <div className="mt-2.5 flex items-center gap-2">
                  <CategoriaBadge cat={c.categoria} />
                  <PrazoBadge prazo={c.prazoEm} status={c.status} compacto />
                </div>

                <p className="mt-2.5 truncate text-[13px] text-ink-700">{c.servicoNome}</p>

                {c.fotos.length > 0 && (
                  <div className="mt-3">
                    {/* O card inteiro é um <button> que abre a comanda.
                        `interativo={false}` impede que a foto vire outro
                        <button> aninhado — DOM inválido, e o clique
                        disparava zoom e navegação ao mesmo tempo. */}
                    <GradeFotos
                      fotos={c.fotos.slice(0, 4)}
                      categoria={c.categoria}
                      editavel={false}
                      interativo={false}
                      colunas="grid-cols-4"
                      altura="h-14"
                    />
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between border-t border-ink-100 pt-2.5">
                  <span className="num text-[13.5px] font-bold text-ink-900">{brl(c.valor)}</span>
                  {saldo(c) > 0 ? (
                    <span className="badge bg-brass-50 text-brass-700 num">Saldo {brl(saldo(c))}</span>
                  ) : (
                    <span className="badge bg-pine-50 text-pine-700">Quitada</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {recentes.pagina.paginas > 1 && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              onClick={recentes.anterior}
              disabled={recentes.pagina.pagina <= 1}
              className="btn-outline px-3 py-1.5 text-[12.5px] disabled:opacity-40"
            >
              Anteriores
            </button>
            <span className="num text-[12.5px] text-ink-500">
              {recentes.pagina.pagina} / {recentes.pagina.paginas}
            </span>
            <button
              onClick={recentes.proxima}
              disabled={!recentes.pagina.temMais}
              className="btn-outline px-3 py-1.5 text-[12.5px] disabled:opacity-40"
            >
              Mais antigos
            </button>
          </div>
        )}
      </section>

      <NovoAtendimento
        open={aberto}
        onClose={() => setAberto(false)}
        onCriada={() => {
          doDia.recarregar()
          recentes.recarregar()
        }}
      />
    </div>
  )
}
