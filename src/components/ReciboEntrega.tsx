import { Download, Printer } from 'lucide-react'
import type { Comanda } from '@/types'
import { useDominioMaps } from '@/lib/dominio'
import { useSessao } from '@/store/useSessao'
import { addDias, brl, comandaCod, fmtData, fmtHora, saldo, telefoneFmt, totalPago } from '@/lib/utils'
import { imprimirParaPdf } from '@/lib/exportar'
import { Modal, useToast } from './ui'
import { FotoBox, SemFoto } from './dominio'

/**
 * Comprovante de RETIRADA — não confundir com ImprimirComanda.
 *
 * A comanda impressa é o documento da ENTRADA: o que o cliente leva ao
 * deixar a peça. Faltava o outro lado. Sem ele, o único vestígio da
 * entrega era `delivered_at`, e a linha "Assinatura do cliente" da
 * comanda de entrada não servia — ela foi assinada semanas antes, quando
 * ninguém sabia como o item ficaria.
 *
 * Por que "antes" e "depois" lado a lado: é isso que responde à disputa
 * mais cara da loja ("não estava assim quando entreguei"). As duas fotos
 * no mesmo papel, com a assinatura de quem retirou embaixo.
 *
 * Não registra impressão no banco: `mark_order_printed` é da comanda de
 * entrada, e o evento da entrega já foi gravado por `change_order_status`.
 */
export default function ReciboEntrega({
  open,
  onClose,
  comanda,
}: {
  open: boolean
  onClose: () => void
  comanda: Comanda
}) {
  const { push } = useToast()
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)

  const empresa = config?.empresa
  const cod = comandaCod(comanda.numero, config?.comandas.prefixo ?? 'CF')
  const pago = totalPago(comanda)
  const emAberto = saldo(comanda)

  const antes = comanda.fotos.find((f) => f.tipo === 'antes') ?? comanda.fotos[0]
  const depois = comanda.fotos.find((f) => f.tipo === 'depois')

  /**
   * Garantia da peça mais longa da comanda. É o que o cliente leva por
   * escrito — sem isso ele volta em três meses sem saber se tem direito, e
   * a discussão vira palavra contra palavra.
   */
  const garantia = comanda.itens.reduce(
    (maior, i) =>
      i.garantiaDias > (maior?.garantiaDias ?? 0) && i.entregueEm ? i : maior,
    null as (typeof comanda.itens)[number] | null,
  )
  const garantiaAte =
    garantia?.entregueEm && garantia.garantiaDias > 0
      ? addDias(new Date(garantia.entregueEm), garantia.garantiaDias)
      : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Recibo de entrega"
      subtitle={`${cod} · comprovante de retirada`}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Voltar
          </button>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn-outline"
              title='Abre a impressão — escolha "Salvar como PDF" no destino.'
              onClick={() => {
                push({
                  tipo: 'info',
                  titulo: 'Escolha "Salvar como PDF"',
                  descricao: 'Na caixa de impressão, selecione PDF como destino.',
                })
                setTimeout(imprimirParaPdf, 300)
              }}
            >
              <Download size={15} />
              Baixar PDF
            </button>

            <button
              className="btn-accent"
              onClick={() => {
                push({ tipo: 'ok', titulo: 'Recibo enviado para impressão' })
                window.print()
              }}
            >
              <Printer size={15} />
              Imprimir
            </button>
          </div>
        </div>
      }
    >
      <div className="print-sheet mx-auto max-w-[430px] rounded-card border border-ink-200 bg-white p-6 shadow-soft">
        <div className="text-center">
          <p className="font-display text-[19px] font-extrabold tracking-tight text-ink-950">
            {(empresa?.nome ?? 'Chaveiro Formiga').toUpperCase()}
          </p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink-500">
            {empresa?.endereco}
            <br />
            {empresa?.telefone} · {empresa?.horario}
          </p>
        </div>

        <div className="my-4 border-t border-dashed border-ink-300" />

        <div className="flex items-start justify-between">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400">
              Recibo de entrega
            </p>
            <p className="num text-[24px] font-extrabold leading-none text-ink-950">{cod}</p>
          </div>
          {comanda.entregueEm && (
            <div className="text-right">
              <p className="num text-[11px] text-ink-600">{fmtData(comanda.entregueEm)}</p>
              <p className="num text-[11px] text-ink-600">{fmtHora(comanda.entregueEm)}</p>
            </div>
          )}
        </div>

        <div className="my-3.5 border-t border-dashed border-ink-300" />

        <Bloco titulo="Cliente">
          <p className="text-[13px] font-bold text-ink-950">{comanda.clienteNome}</p>
          <p className="num text-[11.5px] text-ink-600">{telefoneFmt(comanda.clienteTelefone)}</p>
        </Bloco>

        <Bloco titulo="Serviço executado">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-ink-950">{comanda.servicoNome}</p>
              <p className="text-[11px] text-ink-500">{dom.cat(comanda.categoria).label}</p>
            </div>
            <p className="num shrink-0 text-[11.5px] font-semibold text-ink-700">
              {comanda.quantidade}x
            </p>
          </div>
          {comanda.descricao && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-700">{comanda.descricao}</p>
          )}
        </Bloco>

        {/* O par antes/depois é o miolo do documento. */}
        <Bloco titulo="Estado do item">
          <div className="grid grid-cols-2 gap-3">
            <div>
              {antes ? (
                <FotoBox foto={antes} className="h-[78px]" mostrarTipo={false} />
              ) : (
                <SemFoto className="h-[78px]" texto="—" />
              )}
              <p className="mt-1 text-center text-[9.5px] font-semibold text-ink-500">No recebimento</p>
            </div>
            <div>
              {depois ? (
                <FotoBox foto={depois} className="h-[78px]" mostrarTipo={false} />
              ) : (
                <SemFoto className="h-[78px]" texto="—" />
              )}
              <p className="mt-1 text-center text-[9.5px] font-semibold text-ink-500">Na entrega</p>
            </div>
          </div>
        </Bloco>

        <div className="mt-3.5 rounded-lg bg-ink-50 p-3.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-ink-600">Valor do serviço</span>
            <span className="num font-semibold text-ink-950">{brl(comanda.valor)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11.5px]">
            <span className="text-ink-600">Total pago</span>
            <span className="num font-semibold text-ink-950">{brl(pago)}</span>
          </div>
          <div className="mt-2 border-t border-ink-200 pt-2 flex items-center justify-between">
            <span className="text-[12.5px] font-bold text-ink-800">
              {emAberto > 0.01 ? 'Saldo em aberto' : 'Situação'}
            </span>
            <span className="num text-[16px] font-extrabold text-ink-950">
              {emAberto > 0.01 ? brl(emAberto) : 'QUITADO'}
            </span>
          </div>
        </div>

        <Bloco titulo="Retirada">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-ink-600">Retirado por</span>
            <span className="font-bold text-ink-950">{comanda.entreguePara || '—'}</span>
          </div>
          {comanda.entregueDocumento && (
            <div className="mt-1 flex items-center justify-between text-[11.5px]">
              <span className="text-ink-600">Documento</span>
              <span className="num font-semibold text-ink-900">{comanda.entregueDocumento}</span>
            </div>
          )}
          {comanda.entreguePorNome && (
            <div className="mt-1 flex items-center justify-between text-[11.5px]">
              <span className="text-ink-600">Entregue por</span>
              <span className="font-semibold text-ink-900">{comanda.entreguePorNome}</span>
            </div>
          )}
          {comanda.entregaObservacao && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-700">
              {comanda.entregaObservacao}
            </p>
          )}
        </Bloco>

        {garantiaAte && (
          <Bloco titulo="Garantia">
            <p className="text-[11.5px] leading-relaxed text-ink-700">
              Serviço garantido por <strong className="num">{garantia!.garantiaDias} dias</strong>,
              até <strong className="num">{fmtData(garantiaAte)}</strong>. Dentro do prazo, traga a
              peça para reparo sem custo.
            </p>
          </Bloco>
        )}

        <div className="mt-6">
          <div className="border-t border-ink-400 pt-1.5">
            <p className="text-center text-[9.5px] text-ink-500">
              Assinatura de quem retirou{comanda.entreguePara ? ` — ${comanda.entreguePara}` : ''}
            </p>
          </div>
        </div>

        <div className="my-3.5 border-t border-dashed border-ink-300" />

        <p className="text-center text-[9.5px] leading-relaxed text-ink-500">
          Declaro ter recebido o item acima, conferido e nas condições registradas neste recibo.
        </p>
        <p className="mt-2 text-center text-[8.5px] uppercase tracking-wider text-ink-300">
          Comprovante de entrega — sem valor fiscal
        </p>
      </div>
    </Modal>
  )
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-3.5">
      <p className="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-ink-400">{titulo}</p>
      {children}
    </div>
  )
}
