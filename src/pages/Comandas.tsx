import { Camera, Clock, Filter, LayoutGrid, List, Plus, Receipt, Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FotoContagem } from '@/components/Fotos'
import NovoAtendimento from '@/components/NovoAtendimento'
import { CategoriaBadge, Kpi, PageHead, PrazoBadge, StatusBadge } from '@/components/dominio'
import { Drawer, Erro, Paginacao, Select, SkelCards, SkelLinhas, Vazio } from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { useAsync, useLista } from '@/lib/hooks'
import { listarComandas, type FiltroComandas } from '@/lib/api/comandas'
import { obterKpis } from '@/lib/api/relatorios'
import { useSessao, usePodeEditar } from '@/store/useSessao'
import { brl, comandaCod, cx, fmtData, saldo, telefoneFmt } from '@/lib/utils'
import type { Comanda } from '@/types'

type Vista = 'lista' | 'cards'

const SEM_FILTRO: FiltroComandas = {}

export default function Comandas() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)
  const podeCriar = usePodeEditar('orders') || usePodeEditar('service_desk')
  const prefixo = config?.comandas.prefixo ?? 'CF'
  const diasAbandono = config?.operacao.diasParaAbandono ?? 0

  const [novoAberto, setNovoAberto] = useState(false)
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [vista, setVista] = useState<Vista>('lista')

  const lista = useLista<Comanda, FiltroComandas>(listarComandas, SEM_FILTRO, {
    ordem: { campo: 'number', direcao: 'desc' },
    // Realtime: a lista reflete o que a produção move no Kanban sem F5.
    tabelas: ['orders', 'order_photos'],
    canal: 'comandas-lista',
  })

  const kpis = useAsync(() => obterKpis(), [], { tabelas: ['orders'], canal: 'comandas-kpis' })

  // Deep links vindos do dashboard / busca global.
  useEffect(() => {
    const f = params.get('filtro')
    const c = params.get('cat')
    let mudou = false
    const patch: FiltroComandas = {}

    if (f) {
      if (f === 'prontas') patch.status = 'pronta'
      else patch.rapido = f
      // O filtro de esquecidas precisa do prazo junto — sem ele a consulta
      // não aplica nada e o link do alerta do painel traria a lista
      // inteira, dando a entender que tudo está esquecido.
      if (f === 'esquecidas') patch.diasParaAbandono = diasAbandono
      params.delete('filtro')
      mudou = true
    }
    if (c) {
      patch.categoria = c
      params.delete('cat')
      mudou = true
    }
    if (params.get('novo') === '1') {
      // Esconder o botão não basta: /comandas?novo=1 digitado na barra de
      // endereço abria o wizard para o perfil Consulta, que percorria as 8
      // etapas até a RPC recusar. O param é sempre consumido, para a URL
      // não ficar suja.
      if (podeCriar) setNovoAberto(true)
      params.delete('novo')
      mudou = true
    }
    if (Object.keys(patch).length) lista.setFiltro(patch)
    if (mudou) setParams(params, { replace: true })
    // `diasAbandono` entra porque o deep link de esquecidas depende dele, e
    // a configuração costuma chegar DEPOIS do primeiro render — sem isto o
    // link do painel aplicaria prazo 0 e não filtraria nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams, podeCriar, diasAbandono])

  const f = lista.filtro
  // Todos os campos de FiltroComandas, não só os 6 do painel: o badge e as
  // condições de "Limpar filtros" mentiriam para um filtro vindo de deep
  // link (?filtro=atrasadas define `rapido`, ?etiqueta define `etiqueta`).
  const filtrosAtivos = Object.values(f).filter(
    (v) => v !== undefined && v !== null && v !== false && v !== '',
  ).length

  const limpar = () => {
    lista.limpar(SEM_FILTRO)
    // O painel também tem que fechar. Ele é um Drawer `fixed inset-0
    // z-[150]` ancorado à direita, e cobre justamente o canto onde ficam
    // os botões de lista/cards — o QA leu isso como "o painel reabre
    // sobre o botão de visualização", mas ele simplesmente nunca fechava.
    setFiltrosAbertos(false)
  }

  return (
    <div>
      <PageHead
        titulo="Comandas"
        subtitulo="Cada comanda é a ordem de serviço completa — do recebimento à entrega."
        acoes={
          <>
            <div className="hidden sm:flex rounded-field border border-ink-200 bg-white p-0.5">
              <button
                onClick={() => setVista('lista')}
                aria-label="Visualizar em lista"
                className={cx(
                  'grid h-8 w-9 place-items-center rounded-[9px] transition',
                  vista === 'lista' ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-100',
                )}
              >
                <List size={15} />
              </button>
              <button
                onClick={() => setVista('cards')}
                aria-label="Visualizar em cards"
                className={cx(
                  'grid h-8 w-9 place-items-center rounded-[9px] transition',
                  vista === 'cards' ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-100',
                )}
              >
                <LayoutGrid size={15} />
              </button>
            </div>

            <button onClick={() => setFiltrosAbertos(true)} className="btn-outline">
              <SlidersHorizontal size={15} />
              Filtros
              {filtrosAtivos > 0 && (
                <span className="num ml-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-ink-900 px-1 text-[10.5px] font-bold text-white">
                  {filtrosAtivos}
                </span>
              )}
            </button>

            {podeCriar && (
              <button onClick={() => setNovoAberto(true)} className="btn-accent">
                <Plus size={16} strokeWidth={2.6} />
                Nova comanda
              </button>
            )}
          </>
        }
      />

      {/* KPIs */}
      {kpis.carregando && !kpis.dados ? (
        <SkelCards />
      ) : kpis.erro ? (
        <Erro compacto mensagem={kpis.erro} onTentarNovamente={kpis.recarregar} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Comandas abertas"
            valor={kpis.dados?.comandasAbertas ?? 0}
            hint="Ainda na operação"
            icon={Receipt}
            onClick={() => lista.trocarFiltro({ rapido: 'abertas' })}
          />
          <Kpi
            label="Atrasadas"
            valor={kpis.dados?.atrasados ?? 0}
            hint="Prazo estourado"
            tom={(kpis.dados?.atrasados ?? 0) > 0 ? 'perigo' : 'neutro'}
            onClick={() => lista.trocarFiltro({ rapido: 'atrasadas' })}
          />
          <Kpi
            label="Prontas"
            valor={kpis.dados?.prontos ?? 0}
            hint="Aguardando retirada"
            tom="ok"
            onClick={() => lista.trocarFiltro({ rapido: 'prontas' })}
          />
          {/* `pendente` vem null para quem não lê o financeiro (atendimento,
              produção, consulta). `?? 0` mostraria "R$ 0,00" como fato. */}
          <Kpi
            label="Valor pendente"
            valor={kpis.dados?.pendente == null ? '—' : brl(kpis.dados.pendente)}
            hint={kpis.dados?.pendente == null ? 'Sem acesso ao financeiro' : 'Saldo a receber'}
            tom="alerta"
          />
        </div>
      )}

      {/* Busca + filtros rápidos */}
      <div className="card mt-6 p-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="field pl-9"
            placeholder="Buscar por comanda, cliente, telefone ou serviço…"
            value={lista.busca}
            onChange={(e) => lista.setBusca(e.target.value)}
            aria-label="Buscar comanda"
          />
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto hide-scroll">
          <button
            onClick={limpar}
            className={cx('chip shrink-0', !f.rapido && !f.status && !f.pagamento && 'chip-on')}
          >
            Todas
          </button>
          <button
            onClick={() => lista.trocarFiltro({ rapido: 'abertas' })}
            className={cx('chip shrink-0', f.rapido === 'abertas' && 'chip-on')}
          >
            Em aberto
          </button>
          <button
            onClick={() => lista.trocarFiltro({ rapido: 'atrasadas' })}
            className={cx('chip shrink-0', f.rapido === 'atrasadas' && 'chip-on')}
          >
            Atrasadas
          </button>
          <button
            onClick={() => lista.trocarFiltro({ status: 'pronta' })}
            className={cx('chip shrink-0', f.status === 'pronta' && 'chip-on')}
          >
            Prontas
          </button>
          <button
            onClick={() => lista.trocarFiltro({ rapido: 'semfoto' })}
            className={cx('chip shrink-0', f.rapido === 'semfoto' && 'chip-on')}
          >
            <Camera size={12} />
            Sem foto
          </button>
          {/*
            Some quando a loja desliga a regra (0 dias): um filtro que não
            pode filtrar nada é pior do que filtro nenhum.
          */}
          {diasAbandono > 0 && (
            <button
              onClick={() =>
                lista.trocarFiltro({ rapido: 'esquecidas', diasParaAbandono: diasAbandono })
              }
              className={cx('chip shrink-0', f.rapido === 'esquecidas' && 'chip-on')}
              title={`Prontas há mais de ${diasAbandono} dias e ainda na loja`}
            >
              <Clock size={12} />
              Não retiradas
            </button>
          )}
          <button
            onClick={() => lista.trocarFiltro({ pagamento: 'pendente' })}
            className={cx('chip shrink-0', f.pagamento === 'pendente' && 'chip-on')}
          >
            Com saldo
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-ink-500">
          <span>
            <span className="num font-semibold text-ink-800">{lista.pagina.total}</span> comanda(s)
          </span>
          {(filtrosAtivos > 0 || lista.consulta.busca) && (
            <button onClick={limpar} className="font-bold text-brass-600 hover:underline">
              limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Resultado */}
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
              icon={Filter}
              titulo={
                filtrosAtivos || lista.consulta.busca
                  ? 'Nenhuma comanda encontrada'
                  : 'Nenhuma comanda cadastrada'
              }
              descricao={
                filtrosAtivos || lista.consulta.busca
                  ? 'Ajuste os filtros ou a busca para ver outros registros.'
                  : 'A primeira comanda aparece aqui assim que um item for recebido no balcão.'
              }
              acao={
                <div className="flex gap-2">
                  {(filtrosAtivos > 0 || lista.consulta.busca) && (
                    <button onClick={limpar} className="btn-outline">
                      Limpar filtros
                    </button>
                  )}
                  {podeCriar && (
                    <button onClick={() => setNovoAberto(true)} className="btn-primary">
                      <Plus size={15} />
                      Nova comanda
                    </button>
                  )}
                </div>
              }
            />
          </div>
        ) : vista === 'lista' ? (
          <>
            {/* Tabela desktop */}
            <div className={cx('card hidden lg:block overflow-hidden', lista.carregando && 'opacity-60')}>
              <div className="overflow-x-auto scroll-x">
                <table className="w-full min-w-[1020px]">
                  <thead>
                    <tr className="border-b border-ink-100 bg-ink-50/60">
                      {['Comanda', 'Cliente', 'Serviço', 'Categoria', 'Prazo', 'Valor', 'Saldo', 'Resp.', 'Status', 'Fotos'].map(
                        (h) => (
                          <th
                            key={h}
                            className="whitespace-nowrap px-3.5 py-3 text-left text-[11.5px] font-bold uppercase tracking-wider text-ink-500"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {lista.pagina.linhas.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => nav(`/comandas/${c.id}`)}
                        className="cursor-pointer border-b border-ink-50 transition hover:bg-ink-50 last:border-0"
                      >
                        <td className="num whitespace-nowrap px-3.5 py-3 text-[12.5px] font-bold text-ink-900">
                          {comandaCod(c.numero, prefixo)}
                          <span className="num block text-[11px] font-normal text-ink-400">
                            {fmtData(c.criadaEm)}
                          </span>
                        </td>
                        <td className="px-3.5 py-3">
                          <span className="block max-w-[170px] truncate text-[13px] font-semibold text-ink-900">
                            {c.clienteNome}
                          </span>
                          <span className="num block text-[11.5px] text-ink-500">
                            {telefoneFmt(c.clienteTelefone)}
                          </span>
                        </td>
                        <td className="px-3.5 py-3">
                          <span className="block max-w-[190px] truncate text-[13px] text-ink-700">
                            {c.servicoNome}
                          </span>
                        </td>
                        <td className="px-3.5 py-3">
                          <CategoriaBadge cat={c.categoria} />
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3">
                          <PrazoBadge prazo={c.prazoEm} status={c.status} compacto />
                        </td>
                        <td className="num whitespace-nowrap px-3.5 py-3 text-[13px] font-bold text-ink-900">
                          {brl(c.valor)}
                        </td>
                        <td className="num whitespace-nowrap px-3.5 py-3 text-[13px] font-bold">
                          {saldo(c) > 0.01 ? (
                            <span className="text-danger">{brl(saldo(c))}</span>
                          ) : (
                            <span className="text-pine-600">Quitada</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3 text-[12.5px] text-ink-600">
                          {c.responsavel}
                        </td>
                        <td className="px-3.5 py-3">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-3.5 py-3">
                          <FotoContagem qtd={c.fotosQtd} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Paginacao
                pagina={lista.pagina.pagina}
                paginas={lista.pagina.paginas}
                total={lista.pagina.total}
                tamanho={lista.pagina.tamanho}
                carregando={lista.carregando}
                onAnterior={lista.anterior}
                onProxima={lista.proxima}
                rotulo="comanda"
              />
            </div>

            {/* Cards mobile */}
            <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {lista.pagina.linhas.map((c) => (
                <CardComanda
                  key={c.id}
                  onClick={() => nav(`/comandas/${c.id}`)}
                  cod={comandaCod(c.numero, prefixo)}
                  comanda={c}
                />
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
                  rotulo="comanda"
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={cx('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', lista.carregando && 'opacity-60')}>
              {lista.pagina.linhas.map((c) => (
                <CardComanda
                  key={c.id}
                  onClick={() => nav(`/comandas/${c.id}`)}
                  cod={comandaCod(c.numero, prefixo)}
                  comanda={c}
                />
              ))}
            </div>
            <div className="card mt-3">
              <Paginacao
                pagina={lista.pagina.pagina}
                paginas={lista.pagina.paginas}
                total={lista.pagina.total}
                tamanho={lista.pagina.tamanho}
                carregando={lista.carregando}
                onAnterior={lista.anterior}
                onProxima={lista.proxima}
                rotulo="comanda"
              />
            </div>
          </>
        )}
      </div>

      {/* Drawer de filtros */}
      <Drawer
        open={filtrosAbertos}
        onClose={() => setFiltrosAbertos(false)}
        title="Filtros"
        subtitle={`${lista.pagina.total} comanda(s) no resultado`}
        footer={
          <>
            <button className="btn-ghost" onClick={limpar}>
              Limpar tudo
            </button>
            <button className="btn-primary" onClick={() => setFiltrosAbertos(false)}>
              Aplicar
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <span className="label">Status</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => lista.setFiltro({ status: undefined })}
                className={cx('chip', !f.status && 'chip-on')}
              >
                Todos
              </button>
              {dom.STATUS_LIST.map((s) => (
                <button
                  key={s}
                  onClick={() => lista.setFiltro({ status: s })}
                  className={cx('chip', f.status === s && 'chip-on')}
                >
                  {dom.st(s).label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">Categoria</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => lista.setFiltro({ categoria: undefined })}
                className={cx('chip', !f.categoria && 'chip-on')}
              >
                Todas
              </button>
              {dom.CATEGORIA_LIST.map((c) => (
                <button
                  key={c}
                  onClick={() => lista.setFiltro({ categoria: c })}
                  className={cx('chip', f.categoria === c && 'chip-on')}
                >
                  {dom.cat(c).label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">Responsável</span>
            <Select
              value={f.responsavelId ?? ''}
              onChange={(v) => lista.setFiltro({ responsavelId: v || undefined })}
              placeholder="Todos os responsáveis"
              aria-label="Filtrar responsável"
              options={dom.EXECUTORES.map((m) => ({ value: m.id, label: m.nome }))}
            />
          </div>

          <div>
            <span className="label">Fotos</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => lista.setFiltro({ foto: undefined })}
                className={cx('chip', !f.foto && 'chip-on')}
              >
                Indiferente
              </button>
              <button
                onClick={() => lista.setFiltro({ foto: 'com' })}
                className={cx('chip', f.foto === 'com' && 'chip-on')}
              >
                Com foto
              </button>
              <button
                onClick={() => lista.setFiltro({ foto: 'sem' })}
                className={cx('chip', f.foto === 'sem' && 'chip-on')}
              >
                Sem foto
              </button>
            </div>
          </div>

          <div>
            <span className="label">Pagamento</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => lista.setFiltro({ pagamento: undefined })}
                className={cx('chip', !f.pagamento && 'chip-on')}
              >
                Indiferente
              </button>
              <button
                onClick={() => lista.setFiltro({ pagamento: 'pago' })}
                className={cx('chip', f.pagamento === 'pago' && 'chip-on')}
              >
                Quitadas
              </button>
              <button
                onClick={() => lista.setFiltro({ pagamento: 'pendente' })}
                className={cx('chip', f.pagamento === 'pendente' && 'chip-on')}
              >
                Com saldo
              </button>
            </div>
          </div>

          <div>
            <span className="label">Prazo</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => lista.setFiltro({ rapido: undefined })}
                className={cx('chip', !f.rapido && 'chip-on')}
              >
                Todos
              </button>
              <button
                onClick={() => lista.setFiltro({ rapido: 'atrasadas' })}
                className={cx('chip', f.rapido === 'atrasadas' && 'chip-on')}
              >
                Atrasadas
              </button>
              <button
                onClick={() => lista.setFiltro({ rapido: 'abertas' })}
                className={cx('chip', f.rapido === 'abertas' && 'chip-on')}
              >
                Em aberto
              </button>
            </div>
          </div>
        </div>
      </Drawer>

      <NovoAtendimento
        open={novoAberto}
        onClose={() => setNovoAberto(false)}
        onCriada={() => lista.recarregar()}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CardComanda({
  comanda: c,
  cod,
  onClick,
}: {
  comanda: Comanda
  cod: string
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="card card-hover p-4 text-left">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="num text-[12px] font-bold text-ink-400">{cod}</p>
          <p className="mt-0.5 truncate text-[14.5px] font-bold text-ink-900">{c.clienteNome}</p>
        </div>
        <StatusBadge status={c.status} />
      </div>

      <p className="mt-2 truncate text-[13px] text-ink-700">{c.servicoNome}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <CategoriaBadge cat={c.categoria} />
        <PrazoBadge prazo={c.prazoEm} status={c.status} compacto />
        <FotoContagem qtd={c.fotosQtd} />
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-ink-100 pt-2.5">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">Valor</p>
          <p className="num text-[14px] font-bold text-ink-900">{brl(c.valor)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">Saldo</p>
          <p className={cx('num text-[14px] font-bold', saldo(c) > 0.01 ? 'text-danger' : 'text-pine-600')}>
            {saldo(c) > 0.01 ? brl(saldo(c)) : 'Quitada'}
          </p>
        </div>
      </div>
    </button>
  )
}
