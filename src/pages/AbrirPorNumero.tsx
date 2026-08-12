import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Erro, Spinner } from '@/components/ui'

/**
 * `/c/1344` — abre a comanda pelo NÚMERO.
 *
 * POR QUE EXISTE
 *
 * É o destino do QR das etiquetas, e a razão é puramente física: o QR da
 * URL completa (`/comandas/<uuid>`) tem 33 módulos, e a 0,4 mm por módulo
 * — o mínimo para câmera de celular — precisa de 13 mm. Numa etiqueta de
 * 40 × 25 mm não sobra esse espaço.
 *
 * Trocando o UUID pelo número, o QR cai para 29 módulos e passa a caber.
 * O ganho é pequeno em caracteres e decisivo em milímetros.
 *
 * De quebra, o endereço fica legível: quem lê "/c/1344" na tela sabe do
 * que se trata, o que não acontece com um UUID.
 *
 * O uso é interno — quem escaneia é o balcão, com sessão aberta. Por isso
 * a rota é protegida como qualquer outra.
 */
export default function AbrirPorNumero() {
  const { numero } = useParams()
  const [id, setId] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const n = Number(numero)
    if (!Number.isInteger(n) || n <= 0) {
      setErro(`"${numero}" não é um número de comanda.`)
      return
    }

    let vivo = true
    void (async () => {
      // `maybeSingle` e não `single`: número inexistente é um caso comum
      // (etiqueta antiga, comanda excluída) e não deve virar exceção.
      const { data, error } = await supabase
        .from('orders')
        .select('id')
        .eq('number', n)
        .is('deleted_at', null)
        .maybeSingle()

      if (!vivo) return
      if (error) setErro(error.message)
      else if (!data) setErro(`Comanda ${n} não encontrada. Ela pode ter sido excluída.`)
      else setId(data.id)
    })()

    return () => {
      vivo = false
    }
  }, [numero])

  if (id) return <Navigate to={`/comandas/${id}`} replace />

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      {erro ? (
        <div className="w-full max-w-md">
          <Erro titulo="Não foi possível abrir" mensagem={erro} />
        </div>
      ) : (
        <p className="flex items-center gap-2.5 text-[13.5px] text-ink-500">
          <Spinner />
          Abrindo a comanda {numero}…
        </p>
      )}
    </div>
  )
}
