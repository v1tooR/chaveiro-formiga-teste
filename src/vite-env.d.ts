/// <reference types="vite/client" />

/**
 * Variáveis de ambiente do front.
 *
 * Só o que tem prefixo VITE_ chega ao navegador — e o que chega ao
 * navegador é público. Nada de service_role key ou token de API aqui.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
