import { CircleCheck, Receipt, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDominioMaps } from '@/lib/dominio'
import { useAcao, useAsync } from '@/lib/hooks'
import { consultaInicial } from '@/lib/listing'
import { listarComandas, obterComanda, registrarPagamento, type Recibo } from '@/lib/api/comandas'
import { useSessao } from '@/store/useSessao'
import { brl, comandaCod, cx, fmtDataHora, numeroDeInput } from '@/lib/utils'
import type { FormaPagamento } from '@/types'
import { Erro, Modal, Spinner, useToast } from './ui'
import { IconeForma } from './dominio'
import { Qr, urlDaComanda } from './Qr'

/**
 * Registra pagamento de uma comanda.
 *
 * A RPC `register_order_payment` faz tudo numa transação: trava a comanda,
 * limita o valor ao saldo (regra 16), cria o pagamento e o lançamento, e
 * baixa ou ajusta a pendência (regra 31). O front não recalcula nada — o
 * recibo é montado com o que a RPC devolve.
 */
export default function RegistrarPagamento({
  open,
  onClose,
  comandaId,
  onRegistrado,
}: {
  open: boolean
  onClose: () => void
  comandaId?: string
  onRegistrado?: () => void
}) {
  const { push } = useToast()
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)
  const prefixo = config?.comandas.prefixo ?? 'CF'
  const perfil = useSessao((s) => s.perfil)

  const [sel, setSel] = useState(comandaId ?? '')
  const [busca, setBusca] = useState('')
  const [termo, setTermo] = useState('')
  const [valor, setValor] = useState(0)
  const [forma, setForma] = useState<FormaPagamento>('pix')
  const [obs, setObs] = useState('')
  const [recibo, setRecibo] = useState<(Recibo & { cliente: string }) | null>(null)

  const acao = useAcao(registrarPagamento)

  useEffect(() => {
    if (!open) return
    setSel(comandaId ?? '')
    setBusca('')
    setTermo('')
    setObs('')
    setRecibo(null)
    acao.limparErro()
    setForma(dom.FORMA_LIST[0] ?? 'pix')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comandaId])

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 300)
    return () => clearTimeout(t)
  }, [busca])

  /** Comandas com saldo em aberto, mais urgentes primeiro. */
  const abertas = useAsync(
    () =>
      listarComandas(
        { ...consultaInicial({ campo: 'due_date', direcao: 'asc' }), busca: termo, tamanho: 12 },
        { pagamento: 'pendente' },
      ),
    [termo],
    { ativo: open && !comandaId, tabelas: ['orders', 'order_payments'], canal: 'pgto-abertas' },
  )

  const comanda = useAsync(() => (sel ? obterComanda(sel) : Promise.resolve(null)), [sel], {
    ativo: open && !!sel,
    tabelas: ['orders', 'order_payments'],
    canal: 'pgto-comanda',
  })

  const c = comanda.dados
  const emAberto = c?.saldoAberto ?? 0

  // Ao escolher a comanda, sugere o saldo integral.
  useEffect(() => {
    setValor(emAberto)
  }, [emAberto])

  async function confirmar() {
    if (!c || valor <= 0) return

    const r = await acao.executar(c.id, valor, forma, obs)
    if (!r) return

    setRecibo({ ...r, cliente: c.clienteNome })
    onRegistrado?.()
    push({
      tipo: 'ok',
      titulo: 'Pagamento registrado',
      descricao: `${brl(r.applied_amount)} · ${dom.forma(forma)?.label ?? forma}`,
    })
  }

  /* ------------------------------ Recibo ------------------------------ */
  if (recibo) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Pagamento confirmado"
        subtitle="Comprovante do recebimento"
        size="sm"
        footer={
          <>
            <button
              className="btn-outline"
              onClick={() => {
                window.print()
              }}
            >
              Imprimir
            </button>
            <button className="btn-primary" onClick={onClose}>
              Concluir
            </button>
          </>
        }
      >
        <div className="print-sheet rounded-card border border-ink-100 bg-ink-50/60 p-5 text-center">
          <CircleCheck size={38} className="mx-auto text-pine-500" />
          <p className="num mt-3 text-[28px] font-bold text-ink-900">{brl(recibo.applied_amount)}</p>
          <p className="mt-1 text-[13px] text-ink-500">
            {dom.forma(forma)?.label ?? forma} · {fmtDataHora(recibo.paid_at)}
          </p>

          <div className="mt-4 space-y-1.5 border-t border-ink-200 pt-4 text-left">
            <LinhaRecibo label="Comanda" valor={comandaCod(recibo.order_number, prefixo)} />
            <LinhaRecibo label="Cliente" valor={recibo.cliente} />
            <LinhaRecibo
              label="Saldo restante"
              valor={recibo.balance > 0.01 ? brl(recibo.balance) : 'Quitado'}
            />
            <LinhaRecibo label="Recebido por" valor={`${perfil?.nome ?? '—'} · ${perfil?.cargo ?? ''}`} />
          </div>

          {/*
            O QR falso codificava `recibo-<numero>-<valor>` — que nem era
            um endereço, era só texto para o hash desenhar. Agora aponta
            para a comanda: quem recebe o comprovante confere o saldo pelo
            celular, que é a pergunta que traz o cliente de volta.
          */}
          <div className="mt-4 flex justify-center">
            <Qr texto={urlDaComanda(recibo.order_id)} size={78} aoNaoCaber={() => null} />
          </div>
          <p className="mt-2 text-[10.5px] uppercase tracking-wider text-ink-400">
            {config?.empresa.nome ?? 'Chaveiro Formiga'}
          </p>
        </div>
      </Modal>
    )
  }

  /* ------------------------------ Formulário --------------------------- */
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar pagamento"
      subtitle={
        c ? `${comandaCod(c.numero, prefixo)} · ${c.clienteNome}` : 'Selecione a comanda'
      }
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn-accent"
            onClick={() => void confirmar()}
            disabled={!c || valor <= 0 || acao.enviando}
          >
            {acao.enviando ? <Spinner /> : null}
            {acao.enviando
              ? 'Registrando…'
              : `Confirmar ${valor > 0 ? brl(Math.min(valor, emAberto)) : ''}`}
          </button>
        </>
      }
    >
      {acao.erro && (
        <div className="mb-5">
          <Erro compacto mensagem={acao.erro} onTentarNovamente={acao.limparErro} />
        </div>
      )}

      {!comandaId && (
        <div className="mb-5">
          <label className="label" htmlFor="pg-busca">
            Comanda com saldo em aberto
          </label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              id="pg-busca"
              className="field pl-9"
              placeholder="Número da comanda, cliente ou serviço…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <div className="mt-2.5 space-y-1.5 max-h-[220px] overflow-y-auto scroll-x">
            {abertas.carregando && !abertas.dados && (
              <p className="flex items-center justify-center gap-2 py-6 text-[13px] text-ink-400">
                <Spinner />
                Carregando…
              </p>
            )}

            {abertas.erro && (
              <Erro compacto mensagem={abertas.erro} onTentarNovamente={abertas.recarregar} />
            )}

            {abertas.dados?.linhas.map((o) => (
              <button
                key={o.id}
                onClick={() => setSel(o.id)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                  sel === o.id ? 'border-ink-900 bg-ink-50' : 'border-ink-100 hover:border-ink-300 hover:bg-ink-50',
                )}
              >
                <span className="num shrink-0 text-[12px] font-bold text-ink-500">
                  {comandaCod(o.numero, prefixo)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink-900">{o.clienteNome}</span>
                  <span className="block truncate text-[11.5px] text-ink-500">{o.servicoNome}</span>
                </span>
                <span className="num shrink-0 text-[13px] font-bold text-danger">{brl(o.saldoAberto)}</span>
              </button>
            ))}

            {abertas.dados && abertas.dados.total === 0 && !abertas.carregando && (
              <p className="py-6 text-center text-[13px] text-ink-400">
                Nenhuma comanda com saldo em aberto.
              </p>
            )}
          </div>
        </div>
      )}

      {comanda.carregando && !c && sel && (
        <p className="flex items-center justify-center gap-2 py-8 text-[13.5px] text-ink-400">
          <Spinner />
          Carregando comanda…
        </p>
      )}

      {comanda.erro && <Erro compacto mensagem={comanda.erro} onTentarNovamente={comanda.recarregar} />}

      {c && (
        <div className="space-y-5">
          <div className="rounded-card bg-ink-50 p-4">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink-600">Valor da comanda</span>
              <span className="num font-semibold text-ink-900">{brl(c.valor)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[13px]">
              <span className="text-ink-600">Já pago</span>
              <span className="num font-semibold text-pine-600">{brl(c.pago)}</span>
            </div>
            <div className="mt-1.5 border-t border-ink-200 pt-2 flex items-center justify-between text-[14px]">
              <span className="font-semibold text-ink-700">Saldo em aberto</span>
              <span className="num font-bold text-danger">{brl(emAberto)}</span>
            </div>
          </div>

          {c.quitada ? (
            <p className="rounded-xl bg-pine-50 px-3.5 py-3 text-[13px] font-semibold text-pine-700">
              Esta comanda já está quitada.
            </p>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="pg-valor">
                  Valor recebido
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-ink-400">
                    R$
                  </span>
                  <input
                    id="pg-valor"
                    type="number"
                    min={0}
                    max={emAberto}
                    step="0.01"
                    className="field num pl-10 text-[19px] font-bold"
                    value={valor}
                    onChange={(e) => setValor(numeroDeInput(e, { min: 0, max: emAberto }))}
                  />
                </div>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button onClick={() => setValor(emAberto)} className={cx('chip', valor === emAberto && 'chip-on')}>
                    Saldo total
                  </button>
                  <button onClick={() => setValor(Math.round(emAberto * 0.5 * 100) / 100)} className="chip">
                    50%
                  </button>
                </div>

                {valor > emAberto && (
                  <p className="mt-2 text-[12.5px] text-brass-700">
                    O valor será limitado ao saldo em aberto ({brl(emAberto)}).
                  </p>
                )}
              </div>

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

              <div>
                <label className="label" htmlFor="pg-obs">
                  Observação
                </label>
                <input
                  id="pg-obs"
                  className="field"
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Ex.: pago na retirada"
                />
              </div>
            </>
          )}
        </div>
      )}

      {!c && !comandaId && !sel && (abertas.dados?.total ?? 0) > 0 && (
        <p className="flex items-center justify-center gap-2 py-2 text-[13px] text-ink-400">
          <Receipt size={15} />
          Selecione uma comanda acima para continuar.
        </p>
      )}
    </Modal>
  )
}

function LinhaRecibo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="text-ink-500">{label}</span>
      <span className="num font-semibold text-ink-900">{valor}</span>
    </div>
  )
}
