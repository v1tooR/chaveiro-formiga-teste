import { Download, Printer, Share2 } from 'lucide-react'
import { useState } from 'react'
import type { Comanda } from '@/types'
import { useDominioMaps } from '@/lib/dominio'
import { useSessao } from '@/store/useSessao'
import { marcarComandaImpressa } from '@/lib/api/comandas'
import { brl, comandaCod, fmtData, fmtHora, saldo, telefoneFmt, totalPago } from '@/lib/utils'
import { imprimirParaPdf } from '@/lib/exportar'
import { Erro, Modal, Spinner, useToast } from './ui'
import { FotoBox, SemFoto } from './dominio'
import { Qr, urlDaComanda } from './Qr'

export default function ImprimirComanda({
  open,
  onClose,
  comanda,
  onImpressa,
}: {
  open: boolean
  onClose: () => void
  comanda: Comanda
  onImpressa?: () => void
}) {
  const { push } = useToast()
  const dom = useDominioMaps()
  const config = useSessao((s) => s.config)
  const integracoes = useSessao((s) => s.integracoes)

  const [processando, setProcessando] = useState<null | string>(null)
  const [erro, setErro] = useState<string | null>(null)

  const empresa = config?.empresa
  const cod = comandaCod(comanda.numero, config?.comandas.prefixo ?? 'CF')
  const pago = totalPago(comanda)
  const emAberto = saldo(comanda)
  const fotoPrincipal = comanda.fotos[0]

  const ativa = (key: string) => !!integracoes.find((i) => i.key === key)?.habilitada

  /**
   * Registra a impressão no banco (RPC `mark_order_printed`, que também
   * grava o evento no histórico) e só então dispara a ação local.
   */
  async function acao(nome: string, fn?: () => void) {
    setProcessando(nome)
    setErro(null)
    try {
      await marcarComandaImpressa(comanda.id)
      onImpressa?.()
    } catch (e) {
      // Falhar em REGISTRAR a impressão não pode impedir de IMPRIMIR.
      //
      // Antes o `fn?.()` vinha dentro do try, depois do await: qualquer
      // erro da RPC (RLS, rede) abortava a ação de verdade, e o operador
      // via só um <Erro> inline no fim do modal — fora do campo de visão
      // de quem acabou de clicar no rodapé.
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar a impressão.')
    } finally {
      setProcessando(null)
    }
    fn?.()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Impressão da comanda"
      subtitle={`${cod} · pré-visualização`}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Voltar
          </button>

          <div className="flex flex-wrap gap-2">
            {/* Compartilhar depende de provedor de WhatsApp; o botão fica
                desabilitado com o motivo no tooltip. */}
            <button
              className="btn-outline disabled:opacity-45"
              disabled={!!processando || !ativa('whatsapp_order')}
              title={
                !ativa('whatsapp_order')
                  ? 'Ative "WhatsApp — compartilhar comanda" em Configurações → Integrações.'
                  : undefined
              }
              onClick={() =>
                void acao('share', () => push({ tipo: 'ok', titulo: 'Comanda enviada ao cliente' }))
              }
            >
              {processando === 'share' ? <Spinner /> : <Share2 size={15} />}
              Compartilhar
            </button>

            {/* PDF NÃO depende de integração: o navegador gera pela caixa
                de impressão, e o layout de `@media print` desta tela já é o
                que sai no papel. Manter atrás de um portão de integração era
                prometer um recurso que já existia. */}
            <button
              className="btn-outline"
              disabled={!!processando}
              title='Abre a impressão — escolha "Salvar como PDF" no destino.'
              onClick={() =>
                void acao('pdf', () => {
                  push({
                    tipo: 'info',
                    titulo: 'Escolha "Salvar como PDF"',
                    descricao: 'Na caixa de impressão, selecione PDF como destino.',
                  })
                  setTimeout(imprimirParaPdf, 300)
                })
              }
            >
              {processando === 'pdf' ? <Spinner /> : <Download size={15} />}
              Baixar PDF
            </button>

            <button
              className="btn-accent"
              disabled={!!processando}
              onClick={() =>
                void acao('print', () => {
                  push({ tipo: 'ok', titulo: 'Comanda enviada para impressão' })
                  window.print()
                })
              }
            >
              {processando === 'print' ? <Spinner /> : <Printer size={15} />}
              Imprimir
            </button>
          </div>
        </div>
      }
    >
      {erro && (
        <div className="mb-4">
          <Erro compacto mensagem={erro} onTentarNovamente={() => setErro(null)} />
        </div>
      )}

      {/* Folha */}
      <div className="print-sheet mx-auto max-w-[430px] rounded-card border border-ink-200 bg-white p-6 shadow-soft">
        {/* Cabeçalho */}
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

        {/* Número e data */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400">Comanda</p>
            <p className="num text-[24px] font-extrabold leading-none text-ink-950">{cod}</p>
          </div>
          <div className="text-right">
            <p className="num text-[11px] text-ink-600">{fmtData(comanda.criadaEm)}</p>
            <p className="num text-[11px] text-ink-600">{fmtHora(comanda.criadaEm)}</p>
          </div>
        </div>

        <div className="my-3.5 border-t border-dashed border-ink-300" />

        {/* Cliente */}
        <Bloco titulo="Cliente">
          <p className="text-[13px] font-bold text-ink-950">{comanda.clienteNome}</p>
          <p className="num text-[11.5px] text-ink-600">{telefoneFmt(comanda.clienteTelefone)}</p>
        </Bloco>

        {/* Serviço */}
        <Bloco titulo="Serviço">
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

        {/* Prazo */}
        <Bloco titulo="Prazo e responsável">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-ink-600">Previsão de entrega</span>
            <span className="num font-bold text-ink-950">{fmtData(comanda.prazoEm)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11.5px]">
            <span className="text-ink-600">Responsável</span>
            <span className="font-semibold text-ink-900">{comanda.responsavel}</span>
          </div>
        </Bloco>

        {/* Valores */}
        <div className="mt-3.5 rounded-lg bg-ink-50 p-3.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-ink-600">Valor do serviço</span>
            <span className="num font-semibold text-ink-950">{brl(comanda.valor)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11.5px]">
            <span className="text-ink-600">Entrada / pago</span>
            <span className="num font-semibold text-ink-950">{brl(pago)}</span>
          </div>
          {comanda.formaPagamento && (
            <div className="mt-1 flex items-center justify-between text-[11.5px]">
              <span className="text-ink-600">Forma de pagamento</span>
              <span className="font-semibold text-ink-900">{dom.forma(comanda.formaPagamento)?.label}</span>
            </div>
          )}
          <div className="mt-2 border-t border-ink-200 pt-2 flex items-center justify-between">
            <span className="text-[12.5px] font-bold text-ink-800">Saldo na retirada</span>
            <span className="num text-[16px] font-extrabold text-ink-950">{brl(emAberto)}</span>
          </div>
        </div>

        {/* Foto + código */}
        <div className="print-evitar-quebra mt-3.5 flex items-start gap-3">
          <div className="w-[86px] shrink-0">
            <p className="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-ink-400">Item</p>
            {fotoPrincipal ? (
              <FotoBox foto={fotoPrincipal} className="h-[70px]" mostrarTipo={false} />
            ) : (
              <SemFoto className="h-[70px]" texto="—" />
            )}
          </div>

          <div className="flex-1 text-center">
            <p className="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-ink-400">
              Código da comanda
            </p>
            <div className="flex justify-center">
              {config?.etiquetas.mostrarQr && (
                <Qr
                  // 78px ≈ 20,6 mm: 33 módulos a 0,62 mm cada, folga
                  // confortável para câmera de celular. Ver Qr.tsx.
                  texto={urlDaComanda(comanda.id)}
                  size={78}
                  aoNaoCaber={() => null}
                />
              )}
            </div>
            <p className="num mt-1 text-[10px] font-bold text-ink-700">{cod}</p>
            {config?.etiquetas.mostrarQr && (
              <p className="mt-0.5 text-[8px] leading-tight text-ink-400">
                Aponte a câmera para acompanhar
              </p>
            )}
          </div>
        </div>

        {/* Observações */}
        {config?.comandas.mostrarObservacoes && comanda.observacoes && (
          <Bloco titulo="Observações">
            <p className="text-[11px] leading-relaxed text-ink-700">{comanda.observacoes}</p>
          </Bloco>
        )}

        {/* Assinatura */}
        <div className="print-evitar-quebra mt-5 grid grid-cols-2 gap-4">
          <div>
            <div className="border-t border-ink-400 pt-1.5">
              <p className="text-center text-[9.5px] text-ink-500">Assinatura do cliente</p>
            </div>
          </div>
          <div>
            <div className="border-t border-ink-400 pt-1.5">
              <p className="text-center text-[9.5px] text-ink-500">Recebido por</p>
            </div>
          </div>
        </div>

        <div className="my-3.5 border-t border-dashed border-ink-300" />

        <p className="text-center text-[9.5px] leading-relaxed text-ink-500">
          {config?.comandas.rodape}
        </p>
        <p className="mt-2 text-center text-[8.5px] uppercase tracking-wider text-ink-300">
          Comprovante de serviço — sem valor fiscal
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
