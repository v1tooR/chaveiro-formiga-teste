import QRCode from 'qrcode'
import { useMemo } from 'react'
import { cx } from '@/lib/utils'

/**
 * QR Code de verdade.
 *
 * Substitui o `QrFake`, que desenhava um padrão bonito a partir de um hash
 * e não codificava nada — o próprio `aria-label` dele dizia "Código
 * demonstrativo". Ele saía impresso na via do cliente sob o título "CÓDIGO
 * DA COMANDA", prometendo uma leitura que não existia. Quem tentasse bipar
 * concluiria que o leitor está com defeito.
 *
 * ⚠️ TAMANHO FÍSICO NÃO É DETALHE ESTÉTICO — É O QUE DECIDE SE LÊ
 *
 * A URL de uma comanda gera um QR de 33 módulos (versão 4, correção L).
 * Câmera de celular precisa de mais ou menos 0,4 mm por módulo para
 * enxergar; abaixo disso o código existe, é válido, e não lê.
 *
 * 33 módulos × 0,4 mm = 13,2 mm. Uma etiqueta pequena (40 × 25 mm) não tem
 * onde pôr isso.
 *
 * Por isso este componente CONFERE antes de desenhar e se recusa a
 * produzir um QR pequeno demais. Trocar um QR falso por um QR real e
 * ilegível seria o mesmo erro com mais passos: o operador continuaria
 * tentando bipar um quadrado que nunca vai ler.
 *
 * A conversão px → mm assume 96 dpi, que é o padrão de impressão do
 * navegador. Não por acaso as etiquetas já são dimensionadas assim:
 * 150 px para 40 mm dá 39,7 mm reais.
 */

const PX_POR_MM = 96 / 25.4 // 3.7795
/** Mínimo por módulo para leitura confiável em câmera de celular. */
const MM_POR_MODULO_MIN = 0.4

export function Qr({
  texto,
  size = 70,
  className,
  /** Fallback quando não cabe um QR legível. Sem isto, nada é desenhado. */
  aoNaoCaber,
}: {
  texto: string
  size?: number
  className?: string
  aoNaoCaber?: (motivo: string) => React.ReactNode
}) {
  const qr = useMemo(() => {
    try {
      // 'L' de propósito: menos redundância, menos módulos, QR menor para
      // o mesmo conteúdo. A via do cliente não enfrenta sujeira de chão de
      // fábrica, que é onde os níveis altos se justificam.
      const dados = QRCode.create(texto, { errorCorrectionLevel: 'L' })
      const n = dados.modules.size
      const mm = size / PX_POR_MM
      return { n, data: dados.modules.data, mmPorModulo: mm / n, mm }
    } catch {
      return null
    }
  }, [texto, size])

  if (!qr) return null

  if (qr.mmPorModulo < MM_POR_MODULO_MIN) {
    const motivo =
      `${qr.n} módulos em ${qr.mm.toFixed(1)} mm dão ` +
      `${qr.mmPorModulo.toFixed(2)} mm por módulo — abaixo de ${MM_POR_MODULO_MIN} mm não lê.`
    if (import.meta.env.DEV) console.warn(`[qr] não desenhado: ${motivo}`)
    return <>{aoNaoCaber?.(motivo) ?? null}</>
  }

  // Quiet zone: 4 módulos de margem branca, exigidos pela especificação.
  // Sem ela o leitor não encontra o código quando há texto encostado —
  // e numa etiqueta tem sempre texto encostado.
  const q = 4
  const total = qr.n + q * 2

  const caminho: string[] = []
  for (let r = 0; r < qr.n; r++) {
    for (let c = 0; c < qr.n; c++) {
      if (qr.data[r * qr.n + c]) caminho.push(`M${c + q} ${r + q}h1v1h-1z`)
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      className={cx('shrink-0', className)}
      role="img"
      aria-label="QR Code da comanda"
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#fff" />
      <path d={caminho.join('')} fill="#111317" />
    </svg>
  )
}

/**
 * Endereço absoluto da comanda — o conteúdo do QR.
 *
 * `window.location.origin` e não uma constante: o mesmo build roda em
 * localhost, na rede da loja e no domínio de produção, e o QR precisa
 * apontar para onde a via foi impressa.
 *
 * ⚠️ Impresso a partir de `localhost`, o QR só abre na própria máquina.
 * Para o celular do cliente funcionar, o sistema precisa estar publicado
 * num endereço que o telefone alcance.
 */
export function urlDaComanda(comandaId: string): string {
  return `${window.location.origin}/comandas/${comandaId}`
}

/**
 * Endereço CURTO, por número — o que vai nas etiquetas.
 *
 * O UUID custa 33 módulos; o número, 29. Parece pouco e é a diferença
 * entre caber e não caber numa etiqueta de 40 × 25 mm, porque o lado
 * mínimo cresce junto com a contagem de módulos.
 *
 * Resolve em `/c/:numero` (AbrirPorNumero.tsx), que redireciona para a
 * ficha.
 */
export function urlCurtaComanda(numero: number): string {
  return `${window.location.origin}/c/${numero}`
}
