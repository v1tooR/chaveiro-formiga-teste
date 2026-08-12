#!/usr/bin/env node
/**
 * gen-keys.mjs — gera o .env com todos os segredos do stack.
 *
 * O ponto sensível é o REALTIME_ENC_KEY: precisa ter EXATAMENTE 16
 * caracteres (AES-128). Com 15 ou 17 o container sobe, aceita conexão e
 * não entrega evento nenhum — sem erro no log. Gerar programaticamente
 * remove a chance de errar o tamanho na mão.
 *
 * Uso:  node scripts/gen-keys.mjs [--force]
 */
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destino = resolve(raiz, '.env')
const força = process.argv.includes('--force')

if (existsSync(destino) && !força) {
  console.log('.env já existe. Use --force para sobrescrever (isso invalida as sessões atuais).')
  process.exit(0)
}

const b64url = (b) => Buffer.from(b).toString('base64url')

/** JWT HS256 — mesmo formato que o Supabase espera para anon/service_role. */
function jwt(payload, segredo) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const assinatura = createHmac('sha256', segredo).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${assinatura}`
}

const hex = (bytes) => randomBytes(bytes).toString('hex')

const JWT_SECRET = hex(32)                 // 64 caracteres
const POSTGRES_PASSWORD = hex(16)
const DASHBOARD_PASSWORD = hex(12)
const SECRET_KEY_BASE = hex(32)            // 64 caracteres — mínimo do Realtime
const REALTIME_ENC_KEY = hex(8)            // 16 caracteres — AES-128, exato
const SEED_ADMIN_PASSWORD = `Cf${hex(6)}!`

if (REALTIME_ENC_KEY.length !== 16) {
  console.error(`REALTIME_ENC_KEY saiu com ${REALTIME_ENC_KEY.length} caracteres; precisa de 16.`)
  process.exit(1)
}

const emitido = Math.floor(Date.now() / 1000)
const expira = emitido + 60 * 60 * 24 * 365 * 10 // 10 anos

const ANON_KEY = jwt({ role: 'anon', iss: 'supabase', iat: emitido, exp: expira }, JWT_SECRET)
const SERVICE_ROLE_KEY = jwt({ role: 'service_role', iss: 'supabase', iat: emitido, exp: expira }, JWT_SECRET)

const modelo = readFileSync(resolve(raiz, '.env.example'), 'utf8')

const valores = {
  VITE_SUPABASE_URL: 'http://localhost:8000',
  VITE_SUPABASE_ANON_KEY: ANON_KEY,
  POSTGRES_PASSWORD,
  SUPABASE_DB_URL: `postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:54322/postgres`,
  JWT_SECRET,
  ANON_KEY,
  SERVICE_ROLE_KEY,
  REALTIME_ENC_KEY,
  SECRET_KEY_BASE,
  DASHBOARD_PASSWORD,
  SEED_ADMIN_PASSWORD,
}

// Preenche o modelo mantendo comentários e ordem.
const preenchido = modelo
  .split('\n')
  .map((linha) => {
    const m = linha.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!m) return linha
    const [, chave] = m
    return chave in valores ? `${chave}=${valores[chave]}` : linha
  })
  .join('\n')

writeFileSync(destino, preenchido, { mode: 0o600 })

console.log('.env criado (permissão 600).')
console.log('')
console.log(`  REALTIME_ENC_KEY   ${REALTIME_ENC_KEY.length} caracteres  ✓ (AES-128 exige exatamente 16)`)
console.log(`  SECRET_KEY_BASE    ${SECRET_KEY_BASE.length} caracteres  ✓ (mínimo 64)`)
console.log(`  JWT_SECRET         ${JWT_SECRET.length} caracteres  ✓ (mínimo 32)`)
console.log('')
console.log('  Admin inicial:')
console.log('    e-mail: wallace@chaveiroformiga.com.br')
console.log(`    senha : ${SEED_ADMIN_PASSWORD}`)
console.log('')
console.log('  .env NÃO vai para o git (confira com: git check-ignore -v .env)')
