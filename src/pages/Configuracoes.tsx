import {
  Building2,
  Camera,
  Hammer,
  KeyRound,
  Plug,
  Presentation,
  Receipt,
  Save,
  ShieldCheck,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Etiqueta } from '@/components/ImprimirEtiqueta'
import { Kpi, PageHead, SeloPerfil } from '@/components/dominio'
import { Erro, Select, SkelLinhas, Spinner, Tabs, useToast } from '@/components/ui'
import { useDominioMaps } from '@/lib/dominio'
import { useAcao, useAsync } from '@/lib/hooks'
import { listarComandas } from '@/lib/api/comandas'
import { listarClientes } from '@/lib/api/clientes'
import { listarServicos } from '@/lib/api/servicos'
import { listarIntegracoes, salvarIntegracao, type Integracao } from '@/lib/api/integracoes'
import { configParaBanco } from '@/lib/mappers'
import { consultaInicial } from '@/lib/listing'
import {
  ativarUsuario,
  definirExecutaServico,
  listarEquipe,
  listarPapeis,
  trocarPapel,
} from '@/lib/api/sessao'
import { useSessao } from '@/store/useSessao'
import { brl, comandaCod, cx, numeroDeInput } from '@/lib/utils'
import type { Config } from '@/types'

const ABAS = [
  { id: 'empresa', label: 'Empresa' },
  { id: 'servicos', label: 'Serviços' },
  { id: 'operacao', label: 'Operação' },
  { id: 'comandas', label: 'Comandas' },
  { id: 'etiquetas', label: 'Etiquetas' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'equipe', label: 'Equipe' },
  // Última aba, última etapa da implementação: só existe porque todos os
  // módulos já estão prontos e as APIs externas já foram mapeadas.
  { id: 'integracoes', label: 'Integrações' },
]

export default function Configuracoes() {
  const nav = useNavigate()
  const { push } = useToast()
  const dom = useDominioMaps()

  const config = useSessao((s) => s.config)
  const salvarConfig = useSessao((s) => s.salvarConfig)
  const modoApresentacao = useSessao((s) => s.modoApresentacao)
  const setModo = useSessao((s) => s.setModoApresentacao)

  const [aba, setAba] = useState('empresa')
  const [empresa, setEmpresa] = useState<Config['empresa'] | null>(null)
  const [cmd, setCmd] = useState<Config['comandas'] | null>(null)
  const [etq, setEtq] = useState<Config['etiquetas'] | null>(null)
  const [ope, setOpe] = useState<Config['operacao'] | null>(null)

  const salvar = useAcao((patch: Record<string, unknown>) => salvarConfig(patch))

  // Sincroniza os formulários quando a configuração chega (ou muda em
  // outra aba, via Realtime).
  useEffect(() => {
    if (!config) return
    setEmpresa(config.empresa)
    setCmd(config.comandas)
    setEtq(config.etiquetas)
    setOpe(config.operacao)
  }, [config])

  /** Contadores da base — substituem os "dados da demo" do mock. */
  const contagens = useAsync(
    async () => {
      const [comandas, clientes, servicos] = await Promise.all([
        listarComandas({ pagina: 1, tamanho: 1 }, {}),
        listarClientes({ pagina: 1, tamanho: 1 }, {}),
        listarServicos({ arquivo: 'todos' }),
      ])
      return { comandas: comandas.total, clientes: clientes.total, servicos: servicos.length }
    },
    [],
    { tabelas: ['orders', 'customers', 'services'], canal: 'config-contagens' },
  )

  /** Uma comanda real para a prévia da etiqueta. */
  const exemplo = useAsync(
    () => listarComandas({ ...consultaInicial({ campo: 'number', direcao: 'desc' }), tamanho: 1 }, {}),
    [],
    { canal: 'config-exemplo' },
  )

  if (!config || !empresa || !cmd || !etq || !ope) {
    return (
      <div>
        <div className="skel h-16 rounded-card" />
        <div className="mt-4">
          <SkelLinhas n={6} />
        </div>
      </div>
    )
  }

  const comandaExemplo = exemplo.dados?.linhas[0]

  return (
    <div>
      <PageHead
        titulo="Configurações"
        subtitulo="Ajustes do sistema, impressão, equipe e integrações externas."
        acoes={<SeloPerfil />}
      />

      {salvar.erro && (
        <div className="mb-4">
          <Erro compacto mensagem={salvar.erro} onTentarNovamente={salvar.limparErro} />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 pt-1">
          <Tabs abas={ABAS} ativa={aba} onChange={setAba} />
        </div>

        <div className="p-4 sm:p-6">
          {/* ------------------------------ Empresa ----------------------------- */}
          {aba === 'empresa' && (
            <div className="max-w-2xl">
              <Cabecalho
                icon={Building2}
                titulo="Dados da empresa"
                descricao="Aparecem na comanda impressa, nas etiquetas e nos relatórios."
              />

              <div className="mt-5 space-y-3.5">
                <div>
                  <label className="label" htmlFor="e-nome">
                    Nome da empresa
                  </label>
                  <input
                    id="e-nome"
                    className="field"
                    value={empresa.nome}
                    onChange={(e) => setEmpresa({ ...empresa, nome: e.target.value })}
                  />
                </div>

                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="e-tel">
                      Telefone
                    </label>
                    <input
                      id="e-tel"
                      className="field num"
                      value={empresa.telefone}
                      onChange={(e) => setEmpresa({ ...empresa, telefone: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="e-resp">
                      Responsável
                    </label>
                    <input
                      id="e-resp"
                      className="field"
                      value={empresa.responsavel}
                      onChange={(e) => setEmpresa({ ...empresa, responsavel: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="e-end">
                    Endereço
                  </label>
                  <input
                    id="e-end"
                    className="field"
                    value={empresa.endereco}
                    onChange={(e) => setEmpresa({ ...empresa, endereco: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label" htmlFor="e-hor">
                    Horário de funcionamento
                  </label>
                  <input
                    id="e-hor"
                    className="field"
                    value={empresa.horario}
                    onChange={(e) => setEmpresa({ ...empresa, horario: e.target.value })}
                  />
                </div>

                <button
                  onClick={async () => {
                    const r = await salvar.executar(configParaBanco({ empresa }) as Record<string, unknown>)
                    if (r === null && salvar.erro) return
                    push({ tipo: 'ok', titulo: 'Dados da empresa salvos' })
                  }}
                  className="btn-primary"
                  disabled={salvar.enviando}
                >
                  {salvar.enviando ? <Spinner /> : <Save size={15} />}
                  Salvar alterações
                </button>
              </div>
            </div>
          )}

          {/* ------------------------------ Serviços ---------------------------- */}
          {aba === 'servicos' && (
            <div>
              <Cabecalho
                icon={Hammer}
                titulo="Categorias e serviços"
                descricao="O catálogo completo é gerenciado no módulo Serviços."
              />

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {dom.CATEGORIA_LIST.map((c) => (
                  <CardCategoria key={c} categoria={c} />
                ))}
              </div>

              <button onClick={() => nav('/servicos')} className="btn-primary mt-5">
                <Hammer size={15} />
                Gerenciar catálogo
              </button>
            </div>
          )}

          {/* ------------------------------ Operação ---------------------------- */}
          {aba === 'operacao' && (
            <div className="max-w-2xl">
              <Cabecalho
                icon={Camera}
                titulo="Regras do balcão"
                descricao="Valem para todo mundo: quem aplica é o banco, não a tela."
              />

              <div className="mt-5 space-y-3.5">
                <Toggle
                  label="Exigir foto ao receber o item"
                  desc="Sem foto, a comanda não é aberta. É o registro do estado em que a peça chegou."
                  on={ope.exigirFotoRecebimento}
                  onChange={(v) => setOpe({ ...ope, exigirFotoRecebimento: v })}
                />
                <Toggle
                  label="Exigir foto “Depois” para entregar"
                  desc="Sem uma foto do serviço concluído, a entrega não é finalizada."
                  on={ope.exigirFotoEntrega}
                  onChange={(v) => setOpe({ ...ope, exigirFotoEntrega: v })}
                />

                <div className="rounded-field border border-ink-200 p-4">
                  <label className="label" htmlFor="abandono">
                    Avisar quando a peça não for retirada
                  </label>
                  <div className="mt-1.5 flex items-center gap-2.5">
                    <input
                      id="abandono"
                      type="number"
                      min={0}
                      max={3650}
                      value={ope.diasParaAbandono}
                      onChange={(e) =>
                        setOpe({ ...ope, diasParaAbandono: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="input num w-28"
                    />
                    <span className="text-[13px] text-ink-600">dias na prateleira</span>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
                    {ope.diasParaAbandono > 0 ? (
                      <>
                        Peça pronta há mais de {ope.diasParaAbandono} dias e ainda na loja aparece no
                        painel e no filtro “Não retiradas”. A contagem começa quando a comanda fica
                        pronta e não reinicia se a peça voltar para a bancada.
                      </>
                    ) : (
                      <>Com 0 o aviso fica desligado e o filtro “Não retiradas” some da tela.</>
                    )}
                  </p>
                </div>

                <div className="rounded-card bg-pine-50 p-4">
                  <p className="text-[12.5px] font-semibold text-pine-700 leading-relaxed">
                    Toda entrega registra quem retirou, com documento opcional, e quem no balcão
                    entregou. Esses campos são obrigatórios e não dependem desta tela.
                  </p>
                </div>

                <button
                  onClick={async () => {
                    const r = await salvar.executar(
                      configParaBanco({ operacao: ope }) as Record<string, unknown>,
                    )
                    if (r === null && salvar.erro) return
                    push({ tipo: 'ok', titulo: 'Regras de operação salvas' })
                  }}
                  className="btn-primary"
                  disabled={salvar.enviando}
                >
                  {salvar.enviando ? <Spinner /> : <Save size={15} />}
                  Salvar regras
                </button>
              </div>
            </div>
          )}

          {/* ------------------------------ Comandas ---------------------------- */}
          {aba === 'comandas' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div>
                <Cabecalho
                  icon={Receipt}
                  titulo="Numeração e impressão"
                  descricao="Define como a comanda é numerada e o que sai na via impressa."
                />

                <div className="mt-5 space-y-3.5">
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="c-pref">
                        Prefixo
                      </label>
                      <input
                        id="c-pref"
                        className="field"
                        maxLength={4}
                        value={cmd.prefixo}
                        onChange={(e) =>
                          setCmd({ ...cmd, prefixo: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })
                        }
                      />
                      <p className="mt-1 text-[11.5px] text-ink-400">Até 4 letras maiúsculas.</p>
                    </div>
                    <div>
                      <label className="label" htmlFor="c-prox">
                        Próximo número
                      </label>
                      <input
                        id="c-prox"
                        type="number"
                        min={1}
                        className="field num"
                        value={cmd.proximoNumero}
                        onChange={(e) =>
                          setCmd({ ...cmd, proximoNumero: numeroDeInput(e, { min: 1 }) })
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <label className="label" htmlFor="c-rod">
                      Rodapé da comanda
                    </label>
                    <textarea
                      id="c-rod"
                      rows={2}
                      className="field resize-none"
                      value={cmd.rodape}
                      onChange={(e) => setCmd({ ...cmd, rodape: e.target.value })}
                    />
                  </div>

                  <Toggle
                    label="Imprimir observações"
                    desc="Inclui as observações internas na via do cliente."
                    on={cmd.mostrarObservacoes}
                    onChange={(v) => setCmd({ ...cmd, mostrarObservacoes: v })}
                  />
                  <Toggle
                    label="Imprimir miniatura da foto"
                    desc="Mostra a foto principal do item na comanda."
                    on={cmd.mostrarFoto}
                    onChange={(v) => setCmd({ ...cmd, mostrarFoto: v })}
                  />

                  <button
                    onClick={async () => {
                      const r = await salvar.executar(
                        configParaBanco({ comandas: cmd }) as Record<string, unknown>,
                      )
                      if (r === null && salvar.erro) return
                      push({ tipo: 'ok', titulo: 'Configuração de comandas salva' })
                    }}
                    className="btn-primary"
                    disabled={salvar.enviando || !cmd.prefixo}
                  >
                    {salvar.enviando ? <Spinner /> : <Save size={15} />}
                    Salvar alterações
                  </button>
                </div>
              </div>

              <aside className="rounded-card border border-ink-100 bg-ink-50 p-4">
                <p className="label">Prévia da numeração</p>
                <p className="num text-[26px] font-extrabold text-ink-900">
                  {comandaCod(cmd.proximoNumero, cmd.prefixo || 'CF')}
                </p>
                <p className="mt-1 text-[12.5px] text-ink-500 leading-relaxed">
                  Será o número da próxima comanda criada no atendimento.
                </p>
              </aside>
            </div>
          )}

          {/* ------------------------------ Etiquetas --------------------------- */}
          {aba === 'etiquetas' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div>
                <Cabecalho
                  icon={Tag}
                  titulo="Layout das etiquetas"
                  descricao="Tamanho padrão, campos exibidos e quantidade por folha."
                />

                <div className="mt-5 space-y-4">
                  <div>
                    <span className="label">Tamanho padrão</span>
                    <div className="flex flex-wrap gap-2">
                      {(['pequena', 'media', 'grande'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setEtq({ ...etq, tamanhoPadrao: t })}
                          className={cx('chip capitalize', etq.tamanhoPadrao === t && 'chip-on')}
                        >
                          {t === 'media' ? 'Média' : t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="label" htmlFor="et-folha">
                      Etiquetas por folha
                    </label>
                    <input
                      id="et-folha"
                      type="number"
                      min={1}
                      max={60}
                      className="field num w-32"
                      value={etq.porFolha}
                      onChange={(e) =>
                        setEtq({ ...etq, porFolha: numeroDeInput(e, { min: 1, max: 60 }) })
                      }
                    />
                    <p className="mt-1 text-[11.5px] text-ink-400">Entre 1 e 60.</p>
                  </div>

                  <Toggle
                    label="Mostrar QR Code"
                    desc="Código visual para leitura rápida na bancada."
                    on={etq.mostrarQr}
                    onChange={(v) => setEtq({ ...etq, mostrarQr: v })}
                  />
                  <Toggle
                    label="Mostrar responsável"
                    desc="Identifica quem executa o serviço."
                    on={etq.mostrarResponsavel}
                    onChange={(v) => setEtq({ ...etq, mostrarResponsavel: v })}
                  />

                  <button
                    onClick={async () => {
                      const r = await salvar.executar(
                        configParaBanco({ etiquetas: etq }) as Record<string, unknown>,
                      )
                      if (r === null && salvar.erro) return
                      push({ tipo: 'ok', titulo: 'Configuração de etiquetas salva' })
                    }}
                    className="btn-primary"
                    disabled={salvar.enviando}
                  >
                    {salvar.enviando ? <Spinner /> : <Save size={15} />}
                    Salvar alterações
                  </button>
                </div>
              </div>

              <aside className="rounded-card border border-ink-100 bg-ink-50 p-4">
                <p className="label">Prévia</p>
                {comandaExemplo ? (
                  <div className="flex justify-center py-2">
                    <Etiqueta
                      comanda={comandaExemplo}
                      tamanho={etq.tamanhoPadrao}
                      mostrarQr={etq.mostrarQr}
                      mostrarResponsavel={etq.mostrarResponsavel}
                      prefixo={cmd.prefixo || 'CF'}
                      empresa={empresa.nome}
                    />
                  </div>
                ) : (
                  <p className="text-[13px] text-ink-400">
                    Nenhuma comanda cadastrada para pré-visualizar.
                  </p>
                )}
                <button onClick={() => nav('/etiquetas')} className="btn-outline mt-3 w-full">
                  <Tag size={14} />
                  Abrir etiquetas
                </button>
              </aside>
            </div>
          )}

          {/* ------------------------------ Financeiro -------------------------- */}
          {aba === 'financeiro' && (
            <div>
              <Cabecalho
                icon={Wallet}
                titulo="Categorias e formas de pagamento"
                descricao="Opções disponíveis ao registrar lançamentos e pagamentos. Definidas nas tabelas de domínio do banco."
              />

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <div className="rounded-card border border-ink-100 p-4">
                  <p className="text-[13.5px] font-bold text-ink-900 mb-3">Formas de pagamento</p>
                  <div className="space-y-1.5">
                    {dom.FORMA_LIST.map((f) => (
                      <div key={f} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2">
                        <span className="text-[13px] font-semibold text-ink-800">{dom.forma(f)?.label}</span>
                        <span className="badge bg-pine-50 text-pine-700">Ativa</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-card border border-ink-100 p-4">
                  <p className="text-[13.5px] font-bold text-ink-900 mb-3">Categorias de entrada</p>
                  <div className="space-y-1.5">
                    {dom.CAT_ENTRADA.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-[12.5px] text-ink-700"
                      >
                        {c.nome}
                        {c.sistema && (
                          <span className="badge bg-ink-100 text-ink-500" title="Usada pela automação">
                            auto
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-card border border-ink-100 p-4">
                  <p className="text-[13.5px] font-bold text-ink-900 mb-3">Categorias de saída</p>
                  <div className="space-y-1.5">
                    {dom.CAT_SAIDA.map((c) => (
                      <div key={c.id} className="rounded-lg bg-ink-50 px-3 py-2 text-[12.5px] text-ink-700">
                        {c.nome}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-card border border-ink-100 p-4">
                <p className="text-[13.5px] font-bold text-ink-900 mb-3">Status de lançamento</p>
                <div className="flex flex-wrap gap-2">
                  {Object.values(dom.LANCAMENTO_STATUS).map((m) => (
                    <span key={m.key} className="badge" style={{ background: m.bg, color: m.cor }}>
                      {m.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* -------------------------------- Equipe ---------------------------- */}
          {aba === 'equipe' && (
            <div>
              <Cabecalho
                icon={Users}
                titulo="Equipe e permissões"
                descricao="Quem executa serviços e o que cada papel pode fazer no sistema."
              />

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {/* Lista `profiles`, não `staff`.
                    São tabelas diferentes por design: `staff` são as pessoas
                    da loja (Marcelo e Rita executam sem ter login),
                    `profiles` são os logins. Listar `staff` aqui escondia o
                    usuário `consulta`, que tem login mas nenhum vínculo com
                    a equipe de execução. */}
                <PainelEquipe />

                <div className="rounded-card border border-ink-100 p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700">
                      <ShieldCheck size={18} />
                    </span>
                    <div>
                      <p className="text-[13.5px] font-bold text-ink-900">Papéis e acessos</p>
                      <p className="mt-1 text-[12.5px] text-ink-500 leading-relaxed">
                        A matriz módulo × papel vive no banco (<span className="num">role_modules</span>) e é
                        a mesma fonte que as políticas de segurança consultam. Alterá-la muda o menu e o
                        acesso aos dados ao mesmo tempo.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5">
                    {dom.MODULOS.map((m) => (
                      <div
                        key={m.key}
                        className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-[12.5px]"
                      >
                        <span className="text-ink-700">{m.label}</span>
                        <span className="num text-ink-400">{m.rota}</span>
                      </div>
                    ))}
                  </div>

                  <p className="mt-4 rounded-xl bg-brass-50 px-3.5 py-2.5 text-[12px] text-brass-700 leading-relaxed">
                    Papel e situação de acesso são geridos ao lado. <strong>Criar</strong> um usuário
                    novo ainda passa pelo script de provisionamento (
                    <span className="num">npm run db:bootstrap</span>): a criação exige a chave de
                    serviço, que nunca pode chegar ao navegador.
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <Cabecalho
                  icon={Presentation}
                  titulo="Modo apresentação"
                  descricao="Destaca os indicadores principais durante uma apresentação comercial. É preferência local deste navegador."
                />
                <button
                  onClick={() => {
                    setModo(!modoApresentacao)
                    push({
                      tipo: 'ok',
                      titulo: modoApresentacao
                        ? 'Modo apresentação desativado'
                        : 'Modo apresentação ativado',
                    })
                  }}
                  className={cx('mt-4', modoApresentacao ? 'btn-outline' : 'btn-accent')}
                >
                  <Presentation size={15} />
                  {modoApresentacao ? 'Desativar' : 'Ativar modo apresentação'}
                </button>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Kpi label="Clientes" valor={contagens.dados?.clientes ?? 0} hint="Na base" />
                <Kpi label="Comandas" valor={contagens.dados?.comandas ?? 0} hint="Registradas" />
                <Kpi label="Serviços" valor={contagens.dados?.servicos ?? 0} hint="No catálogo" />
              </div>
            </div>
          )}

          {/* ---------------------------- Integrações ---------------------------- */}
          {aba === 'integracoes' && <AbaIntegracoes />}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Aba de integrações — a última etapa da implementação
 * ------------------------------------------------------------------ */

function AbaIntegracoes() {
  const { push } = useToast()
  const integracoes = useAsync(() => listarIntegracoes(), [], { canal: 'config-integracoes' })
  const salvar = useAcao(salvarIntegracao)
  const recarregarIntegracoes = useSessao((s) => s.recarregarIntegracoes)

  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<{ provedor: string; segredoRef: string; config: string }>({
    provedor: '',
    segredoRef: '',
    config: '{}',
  })

  const GRUPOS: Record<Integracao['tipo'], string> = {
    messaging: 'Mensagens',
    document: 'Documentos',
    export: 'Exportação',
  }

  function abrir(i: Integracao) {
    setEditando(i.id)
    setRascunho({
      provedor: i.provedor,
      segredoRef: i.segredoRef ?? '',
      config: JSON.stringify(i.config, null, 2),
    })
  }

  async function aplicar(i: Integracao, habilitada?: boolean) {
    let config: Record<string, unknown>
    try {
      config = JSON.parse(rascunho.config || '{}')
    } catch {
      push({ tipo: 'erro', titulo: 'Configuração inválida', descricao: 'O JSON está malformado.' })
      return
    }

    const r = await salvar.executar(i.id, {
      provedor: rascunho.provedor,
      segredoRef: rascunho.segredoRef,
      config,
      ...(habilitada !== undefined && { habilitada }),
    })

    if (!r) {
      push({ tipo: 'erro', titulo: 'Não foi possível salvar', descricao: salvar.erro ?? '' })
      return
    }

    setEditando(null)
    push({ tipo: 'ok', titulo: `${r.nome} salva`, descricao: r.habilitada ? 'Ativa.' : 'Inativa.' })
    integracoes.recarregar()
    // O status alimenta os botões de outras telas ("Avisar cliente").
    // Só as integrações: `iniciar()` remontaria o app inteiro.
    void recarregarIntegracoes()
  }

  const lista = integracoes.dados ?? []

  return (
    <div>
      <Cabecalho
        icon={Plug}
        titulo="Integrações externas"
        descricao="Serviços de terceiros usados pelo sistema. Cada um é um módulo isolado — trocar de provedor não afeta o resto."
      />

      <div className="mt-4 flex items-start gap-3 rounded-card border border-brass-200 bg-brass-50 p-4">
        <KeyRound size={17} className="mt-0.5 shrink-0 text-brass-700" />
        <div className="text-[12.5px] leading-relaxed text-brass-700">
          <p className="font-bold">Segredos não ficam no banco.</p>
          <p className="mt-1">
            Aqui você informa apenas o <strong>nome</strong> da variável que guarda a chave (ex.{' '}
            <span className="num font-semibold">WHATSAPP_API_TOKEN</span>). O valor é publicado nos
            secrets da Edge Function com{' '}
            <span className="num font-semibold">supabase secrets set</span> e nunca passa pelo
            navegador. O banco rejeita qualquer campo de configuração com cara de segredo.
          </p>
        </div>
      </div>

      {integracoes.carregando && !integracoes.dados ? (
        <div className="mt-5">
          <SkelLinhas n={5} />
        </div>
      ) : integracoes.erro ? (
        <div className="mt-5">
          <Erro mensagem={integracoes.erro} onTentarNovamente={integracoes.recarregar} />
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {(Object.keys(GRUPOS) as Integracao['tipo'][]).map((tipo) => {
            const doTipo = lista.filter((i) => i.tipo === tipo)
            if (!doTipo.length) return null

            return (
              <section key={tipo}>
                <p className="label">{GRUPOS[tipo]}</p>
                <div className="space-y-2">
                  {doTipo.map((i) => (
                    <div key={i.id} className="rounded-card border border-ink-100 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[14px] font-bold text-ink-900">{i.nome}</p>
                            {i.habilitada ? (
                              <span className="badge bg-pine-50 text-pine-700">Ativa</span>
                            ) : (
                              <span className="badge bg-ink-100 text-ink-500">Inativa</span>
                            )}
                            {i.segredoRef && (
                              <span className="badge num bg-ink-100 text-ink-600">{i.segredoRef}</span>
                            )}
                          </div>
                          <p className="mt-1 text-[12.5px] text-ink-500 leading-relaxed">{i.descricao}</p>
                          {i.ultimoErro && (
                            <p className="mt-1.5 text-[12px] text-danger">Último erro: {i.ultimoErro}</p>
                          )}
                        </div>

                        <div className="flex shrink-0 gap-2">
                          {editando === i.id ? (
                            <button className="btn-ghost text-[12.5px]" onClick={() => setEditando(null)}>
                              Cancelar
                            </button>
                          ) : (
                            <button className="btn-outline text-[12.5px]" onClick={() => abrir(i)}>
                              Configurar
                            </button>
                          )}
                        </div>
                      </div>

                      {editando === i.id && (
                        <div className="mt-4 space-y-3 border-t border-ink-100 pt-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="label" htmlFor={`prov-${i.id}`}>
                                Provedor
                              </label>
                              <input
                                id={`prov-${i.id}`}
                                className="field"
                                value={rascunho.provedor}
                                onChange={(e) => setRascunho({ ...rascunho, provedor: e.target.value })}
                                placeholder="Ex.: Meta Cloud API"
                              />
                            </div>
                            <div>
                              <label className="label" htmlFor={`sec-${i.id}`}>
                                Nome da variável do segredo
                              </label>
                              <input
                                id={`sec-${i.id}`}
                                className="field num"
                                value={rascunho.segredoRef}
                                onChange={(e) =>
                                  setRascunho({ ...rascunho, segredoRef: e.target.value.toUpperCase() })
                                }
                                placeholder="WHATSAPP_API_TOKEN"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="label" htmlFor={`cfg-${i.id}`}>
                              Configuração (JSON não sensível)
                            </label>
                            <textarea
                              id={`cfg-${i.id}`}
                              rows={5}
                              className="field num resize-none text-[12.5px]"
                              value={rascunho.config}
                              onChange={(e) => setRascunho({ ...rascunho, config: e.target.value })}
                            />
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              className="btn-primary"
                              disabled={salvar.enviando}
                              onClick={() => void aplicar(i)}
                            >
                              {salvar.enviando ? <Spinner /> : <Save size={15} />}
                              Salvar
                            </button>
                            {i.habilitada ? (
                              <button
                                className="btn-outline"
                                disabled={salvar.enviando}
                                onClick={() => void aplicar(i, false)}
                              >
                                Desativar
                              </button>
                            ) : (
                              <button
                                className="btn-accent"
                                disabled={salvar.enviando || !rascunho.segredoRef.trim()}
                                onClick={() => void aplicar(i, true)}
                                title={
                                  !rascunho.segredoRef.trim()
                                    ? 'Informe o nome da variável do segredo antes de ativar'
                                    : undefined
                                }
                              >
                                Ativar
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CardCategoria({ categoria }: { categoria: string }) {
  const dom = useDominioMaps()
  const meta = dom.cat(categoria)

  const servicos = useAsync(
    () => listarServicos({ categoria, arquivo: 'todos' }),
    [categoria],
    { canal: `config-cat-${categoria}` },
  )

  const todos = servicos.dados ?? []
  const ativos = todos.filter((s) => s.ativo)
  const media = todos.length ? todos.reduce((a, s) => a + s.precoBase, 0) / todos.length : 0

  return (
    <div className="rounded-card border border-ink-100 p-4">
      <div className="flex items-center gap-2.5">
        <span className="h-3 w-3 rounded-sm" style={{ background: meta.cor }} />
        <p className="text-[14px] font-bold text-ink-900">{meta.label}</p>
      </div>
      {servicos.carregando && !servicos.dados ? (
        <div className="mt-3 space-y-1.5">
          <div className="skel h-4 rounded" />
          <div className="skel h-4 rounded" />
          <div className="skel h-4 rounded" />
        </div>
      ) : (
        <div className="mt-3 space-y-1 text-[12.5px]">
          <Linha label="Serviços ativos" valor={String(ativos.length)} />
          <Linha label="Total cadastrado" valor={String(todos.length)} />
          <Linha label="Preço médio" valor={brl(media)} />
        </div>
      )}
    </div>
  )
}

function Cabecalho({
  icon: Icon,
  titulo,
  descricao,
}: {
  icon: LucideIcon
  titulo: string
  descricao: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700">
        <Icon size={18} />
      </span>
      <div>
        <h2 className="text-[16px] font-bold text-ink-900">{titulo}</h2>
        <p className="mt-0.5 text-[13px] text-ink-500 leading-relaxed">{descricao}</p>
      </div>
    </div>
  )
}

function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className="num font-bold text-ink-900">{valor}</span>
    </div>
  )
}

function Toggle({
  label,
  desc,
  on,
  onChange,
}: {
  label: string
  desc: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className="flex w-full items-center justify-between gap-4 rounded-card border border-ink-100 px-4 py-3 text-left transition hover:bg-ink-50"
    >
      <span className="min-w-0">
        <span className="block text-[13.5px] font-bold text-ink-900">{label}</span>
        <span className="block text-[12px] text-ink-500 mt-0.5 leading-snug">{desc}</span>
      </span>
      <span
        className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-pine-500' : 'bg-ink-200')}
      >
        <span
          className={cx(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-transform',
            on ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Equipe — usuários do sistema
 * ------------------------------------------------------------------ */

/**
 * Gestão de acesso: papel e situação de cada login.
 *
 * Antes esta área era só leitura, e ainda lia a tabela errada (`staff`,
 * as pessoas que executam serviço, em vez de `profiles`, quem tem
 * login) — o usuário `consulta` nunca aparecia. Contratar ou desligar
 * alguém exigia abrir o Supabase Studio.
 *
 * As guardas de verdade estão no banco (20260730170000): a tela desabilita
 * o que não pode, mas quem recusa é a RPC.
 */
function PainelEquipe() {
  const { push } = useToast()
  const perfil = useSessao((s) => s.perfil)

  // Sem assinatura de Realtime: `profiles` não está na publicação
  // `supabase_realtime` (só as tabelas de operação estão). Cada ação
  // chama `equipe.recarregar()`, que é suficiente para uma tela de
  // administração.
  const equipe = useAsync(() => listarEquipe(), [])
  const papeis = useAsync(() => listarPapeis(), [])

  const mudarPapel = useAcao(trocarPapel)
  const mudarAtivo = useAcao(ativarUsuario)
  const mudarExecuta = useAcao(definirExecutaServico)

  const lista = equipe.dados ?? []
  /** Um só administrador ativo: desativá-lo deixaria a loja sem acesso. */
  const adminsAtivos = lista.filter((u) => u.administrador && u.ativo).length

  return (
    <div className="rounded-card border border-ink-100 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13.5px] font-bold text-ink-900">Usuários do sistema</p>
        <span className="badge bg-ink-100 text-ink-600 num">{lista.length}</span>
      </div>

      {(mudarPapel.erro || mudarAtivo.erro || mudarExecuta.erro) && (
        <div className="mt-3">
          <Erro
            compacto
            mensagem={mudarPapel.erro ?? mudarAtivo.erro ?? mudarExecuta.erro ?? ''}
            onTentarNovamente={() => {
              mudarPapel.limparErro()
              mudarAtivo.limparErro()
              mudarExecuta.limparErro()
            }}
          />
        </div>
      )}

      {equipe.carregando && !equipe.dados ? (
        <div className="mt-3">
          <SkelLinhas n={4} />
        </div>
      ) : equipe.erro ? (
        <div className="mt-3">
          <Erro compacto mensagem={equipe.erro} onTentarNovamente={equipe.recarregar} />
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {lista.map((u) => {
            const euMesmo = u.id === perfil?.id
            const ultimoAdmin = u.administrador && u.ativo && adminsAtivos <= 1
            return (
              <div
                key={u.id}
                className={cx(
                  'rounded-lg border px-3 py-2.5',
                  u.ativo ? 'border-ink-100 bg-ink-50' : 'border-dashed border-ink-200 bg-white',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                      <span className="truncate">{u.nome}</span>
                      {euMesmo && <span className="badge bg-ink-200 text-ink-600">você</span>}
                      {!u.ativo && <span className="badge bg-ink-100 text-ink-500">inativo</span>}
                    </p>
                    <p className="truncate text-[11.5px] text-ink-500">{u.email}</p>
                    {u.cargo ? (
                      <p className="text-[11.5px] text-ink-400">
                        {u.cargo}
                        {u.executa ? ' · executa serviço' : ' · balcão'}
                      </p>
                    ) : (
                      <p className="text-[11.5px] text-ink-400">Sem vínculo com a equipe de execução</p>
                    )}
                  </div>

                  <button
                    onClick={async () => {
                      const r = await mudarAtivo.executar(u.id, !u.ativo)
                      if (r === null) return
                      push({
                        tipo: 'ok',
                        titulo: u.ativo ? 'Acesso desativado' : 'Acesso reativado',
                        descricao: u.nome,
                      })
                      equipe.recarregar()
                    }}
                    disabled={mudarAtivo.enviando || (u.ativo && (euMesmo || ultimoAdmin))}
                    title={
                      euMesmo
                        ? 'Você não pode desativar o próprio acesso.'
                        : ultimoAdmin && u.ativo
                          ? 'É o único responsável ativo — o sistema ficaria sem administrador.'
                          : undefined
                    }
                    className="btn-outline shrink-0 !px-2.5 !py-1.5 text-[12px] disabled:opacity-40"
                  >
                    {u.ativo ? 'Desativar' : 'Reativar'}
                  </button>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Select
                    value={u.papel}
                    onChange={async (v) => {
                      if (v === u.papel) return
                      const r = await mudarPapel.executar(u.id, v)
                      if (r === null) return
                      push({ tipo: 'ok', titulo: 'Papel alterado', descricao: `${u.nome} → ${v}` })
                      equipe.recarregar()
                    }}
                    disabled={euMesmo || mudarPapel.enviando}
                    title={euMesmo ? 'Você não pode alterar o próprio papel.' : undefined}
                    aria-label={`Papel de ${u.nome}`}
                    className="w-40"
                    options={(papeis.dados ?? []).map((p) => ({ value: p.key, label: p.label }))}
                  />

                  {u.membroId && (
                    <button
                      onClick={async () => {
                        const r = await mudarExecuta.executar(u.membroId!, !u.executa)
                        if (r === null) return
                        push({
                          tipo: 'ok',
                          titulo: u.executa ? 'Removido da execução' : 'Marcado como executor',
                          descricao: u.nome,
                        })
                        equipe.recarregar()
                      }}
                      disabled={mudarExecuta.enviando}
                      className="btn-ghost !px-2.5 !py-1.5 text-[12px]"
                    >
                      {u.executa ? 'Tirar da produção' : 'Marcar como executor'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
