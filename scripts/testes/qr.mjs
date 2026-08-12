/**
 * O QR desenhado por src/components/Qr.tsx é o mesmo que a biblioteca
 * produz?
 *
 * A codificação em si é da biblioteca e dá para confiar. O que PODE estar
 * errado é a minha leitura da matriz: ordem de linha/coluna trocada, bit
 * invertido, zona de silêncio ausente. Qualquer um desses gera um quadrado
 * bonito e ilegível — exatamente o defeito que este QR veio corrigir.
 *
 * A conferência compara a matriz que o componente percorre com a saída
 * textual da própria biblioteca, que é renderizada por outro caminho.
 */
import QRCode from 'qrcode'

let falhas = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { falhas++; console.log(`  \x1b[31m✗\x1b[0m ${m}`) }

const URL_TESTE = 'http://localhost:5186/comandas/8d9e54c2-b308-421d-943e-73ac55be8f0d'
const PX_POR_MM = 96 / 25.4
const MM_POR_MODULO_MIN = 0.4

console.log('\n1 · a matriz que o componente desenha bate com a da biblioteca')

const dados = QRCode.create(URL_TESTE, { errorCorrectionLevel: 'L' })
const n = dados.modules.size

// Mesma leitura que Qr.tsx faz: data[r * n + c]
const minha = []
for (let r = 0; r < n; r++) {
  let linha = ''
  for (let c = 0; c < n; c++) linha += dados.modules.data[r * n + c] ? '#' : '.'
  minha.push(linha)
}

// A saída utf8 da biblioteca usa MEIO-BLOCO: cada caractere carrega duas
// linhas de módulos (topo e base). Um caractere por coluna.
//   █ = topo e base escuros    ▀ = só o topo
//   ▄ = só a base              (espaço) = nenhum
const utf8 = await QRCode.toString(URL_TESTE, {
  errorCorrectionLevel: 'L',
  type: 'utf8',
  margin: 0,
})

const linhasUtf8 = utf8.split('\n').filter((l) => l.length)
const larguraUtf8 = [...linhasUtf8[0]].length

if (larguraUtf8 === n) ok(`${n} × ${n} módulos, mesma dimensão nos dois caminhos`)
else bad(`dimensões diferentes: componente ${n}, biblioteca ${larguraUtf8}`)

const daBiblioteca = Array.from({ length: n }, () => Array(n).fill('.'))
linhasUtf8.forEach((linha, iChar) => {
  ;[...linha].forEach((ch, c) => {
    const topo = ch === '█' || ch === '▀'
    const base = ch === '█' || ch === '▄'
    const rTopo = iChar * 2
    const rBase = rTopo + 1
    if (rTopo < n && topo) daBiblioteca[rTopo][c] = '#'
    // A última fileira de caracteres pode ter só metade útil: 33 é ímpar.
    if (rBase < n && base) daBiblioteca[rBase][c] = '#'
  })
})

let divergentes = 0
for (let r = 0; r < n; r++) {
  for (let c = 0; c < n; c++) {
    if (minha[r][c] !== daBiblioteca[r][c]) divergentes++
  }
}
if (divergentes === 0) ok(`todos os ${n * n} módulos coincidem — a renderização é fiel`)
else bad(`${divergentes} módulo(s) divergentes de ${n * n} — o QR sairia ilegível`)

console.log('\n2 · o marcador de canto está onde a especificação manda')
// Os três olhos são 7×7 com borda escura. Se a matriz estiver espelhada ou
// rotacionada, isto quebra.
const olho = (r0, c0) =>
  [0, 6].every((d) => minha[r0 + d].slice(c0, c0 + 7) === '#######') &&
  minha[r0 + 2].slice(c0 + 2, c0 + 5) === '###'
if (olho(0, 0) && olho(0, n - 7) && olho(n - 7, 0)) ok('três olhos de posicionamento corretos')
else bad('olhos de posicionamento fora do lugar — matriz espelhada ou rotacionada')

console.log('\n3 · o endereço CURTO das etiquetas encolhe o código')
// A etiqueta usa `/c/<numero>` justamente para caber. Se alguém trocar
// pelo UUID, a etiqueta pequena para de imprimir QR — em silêncio.
const URL_CURTA = 'https://chaveiroformiga.com.br/c/1344'
const nCurto = QRCode.create(URL_CURTA, { errorCorrectionLevel: 'L' }).modules.size
if (nCurto < n) ok(`${nCurto} módulos contra ${n} do endereço com UUID`)
else bad(`o endereço curto não encolheu nada: ${nCurto} contra ${n}`)

console.log('\n4 · o limite físico é respeitado em cada tamanho')
const casos = [
  ['comprovante (UUID)', 78, n, true],
  ['etiqueta grande', 62, nCurto, true],
  ['etiqueta média', 54, nCurto, true],
  ['etiqueta pequena', 44, nCurto, true],
  ['etiqueta pequena com UUID', 44, n, false],
  ['tamanho antigo do QrFake', 26, nCurto, false],
]
for (const [nome, px, modulos, deveriaDesenhar] of casos) {
  const mm = px / PX_POR_MM
  const porModulo = mm / modulos
  const desenha = porModulo >= MM_POR_MODULO_MIN
  const txt = `${nome}: ${px}px = ${mm.toFixed(1)}mm → ${porModulo.toFixed(2)}mm/módulo`
  if (desenha === deveriaDesenhar) ok(`${txt} → ${desenha ? 'desenha' : 'recusa'}`)
  else bad(`${txt} → ${desenha ? 'desenha' : 'recusa'}, esperava o contrário`)
}

console.log('\n5 · os endereços têm o formato que as rotas esperam')
if (/^https?:\/\/[^/]+\/comandas\/[0-9a-f-]{36}$/.test(URL_TESTE)) ok('/comandas/<uuid>')
else bad(`não parece uma URL de comanda: ${URL_TESTE}`)
if (/^https?:\/\/[^/]+\/c\/\d+$/.test(URL_CURTA)) ok('/c/<numero>')
else bad(`não parece o endereço curto: ${URL_CURTA}`)

// Número de comanda cresce com o tempo. Se em cinco dígitos o QR estourar
// o tamanho da etiqueta pequena, é melhor saber agora.
const nGrande = QRCode.create('https://chaveiroformiga.com.br/c/99999', {
  errorCorrectionLevel: 'L',
}).modules.size
const mmPequena = 44 / PX_POR_MM
if (mmPequena / nGrande >= MM_POR_MODULO_MIN) {
  ok(`comanda de 5 dígitos ainda cabe na etiqueta pequena (${nGrande} módulos)`)
} else {
  bad(`na comanda 99999 o QR vai para ${nGrande} módulos e some da etiqueta pequena`)
}

console.log(falhas === 0 ? '\n\x1b[32mTodos os testes passaram.\x1b[0m\n' : `\n\x1b[31m${falhas} falha(s).\x1b[0m\n`)
process.exit(falhas === 0 ? 0 : 1)
