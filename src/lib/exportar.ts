/**
 * Exportação de dados — CSV e impressão/PDF.
 *
 * Roda INTEIRAMENTE no cliente, de propósito.
 *
 * O relatório de QA classificou "Exportar" e "PDF" como "aguardando
 * integração", mas nenhum dos dois precisa de terceiro: os dados já estão
 * na tela e o navegador sabe gerar arquivo e PDF. A tabela `integrations`
 * existe para integração com serviço EXTERNO — o que exige provedor,
 * segredo e Edge Function é o WhatsApp e o link público de relatório.
 * Colocar exportação atrás daquele portão era só uma promessa quebrada a
 * mais.
 *
 * CSV em vez de XLSX: o Excel abre CSV nativamente, e gerar `.xlsx` de
 * verdade exigiria uma biblioteca de ~400 kB no bundle para produzir o
 * mesmo conteúdo.
 */

/** BOM: sem ele o Excel no Windows lê "José" como "JosÃ©". */
const BOM = '﻿'

function escapar(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // `;` é o separador; aspas e quebra de linha precisam de aspas duplas.
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Separador `;` e não `,`.
 *
 * No Brasil o Excel usa vírgula como separador DECIMAL, então um CSV com
 * vírgulas abre com tudo numa coluna só. `;` é o que o Excel pt-BR espera.
 */
export function paraCsv<T>(linhas: T[], colunas: { titulo: string; valor: (l: T) => unknown }[]): string {
  const cabecalho = colunas.map((c) => escapar(c.titulo)).join(';')
  const corpo = linhas.map((l) => colunas.map((c) => escapar(c.valor(l))).join(';'))
  return BOM + [cabecalho, ...corpo].join('\r\n')
}

/** Número no formato que o Excel pt-BR entende como número. */
export const csvNumero = (v: number) => v.toFixed(2).replace('.', ',')

/** Data ISO → dd/mm/aaaa, sem depender do fuso do navegador. */
export const csvData = (iso: string) => {
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

export function baixarCsv(nomeBase: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nomeBase}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Sem isto o blob fica na memória até a aba fechar.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * PDF pela caixa de impressão do navegador ("Salvar como PDF").
 *
 * Não é gambiarra: é como a comanda e a etiqueta já são impressas neste
 * projeto, o CSS de `@media print` já existe, e o resultado respeita as
 * preferências de papel do usuário. Uma biblioteca de PDF traria um
 * segundo layout para manter em sincronia com o primeiro.
 */
export function imprimirParaPdf() {
  window.print()
}
