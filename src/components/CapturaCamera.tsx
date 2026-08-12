import { Camera, RefreshCw, RotateCcw, SwitchCamera } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Erro, Modal, Spinner } from './ui'

/**
 * Captura de foto pela câmera do aparelho.
 *
 * POR QUE ISTO EXISTE
 *
 * O balcão tinha dois caminhos para "anexar foto": escolher um arquivo, e
 * um botão "Sem foto" que registrava só um gradiente. O segundo satisfazia
 * a exigência de foto sem foto nenhuma — a regra do banco pergunta "existe
 * uma linha em order_photos?", não "existe um arquivo?".
 *
 * O `<input capture="environment">` já abre a câmera no celular, mas no PC
 * do balcão — que é onde o atendimento acontece — ele abre o explorador de
 * arquivos. Sem webcam utilizável, o operador clicava em "Sem foto".
 *
 * Aqui a webcam é usada direto, com conferência antes de aceitar: no balcão
 * a peça sai da mão do cliente e a foto tem que estar boa na primeira, senão
 * ninguém repete.
 *
 * ⚠️ getUserMedia só funciona em contexto seguro: https ou localhost. Se a
 * loja abrir o sistema por IP da rede (http://192.168.x.x) a câmera não
 * aparece — e o navegador não explica isso, só devolve undefined. Por isso
 * a checagem é explícita e a mensagem diz o que fazer.
 */

/** Lado maior da imagem gravada. Webcam de 1080p vira ~200 KB em JPEG. */
const LADO_MAX = 1600
const QUALIDADE = 0.85

type Fase = 'abrindo' | 'ao-vivo' | 'previa'

export function CapturaCamera({
  open,
  onClose,
  onCapturar,
  titulo = 'Fotografar item',
  subtitulo,
}: {
  open: boolean
  onClose: () => void
  /** Recebe o arquivo já comprimido. Se lançar, o erro aparece no modal. */
  onCapturar: (file: File) => Promise<void> | void
  titulo?: string
  subtitulo?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [fase, setFase] = useState<Fase>('abrindo')
  const [erro, setErro] = useState<string | null>(null)
  const [previa, setPrevia] = useState<{ url: string; file: File } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [espelhar, setEspelhar] = useState(false)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [indice, setIndice] = useState(0)

  const desligar = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const ligar = useCallback(
    async (deviceId?: string) => {
      setErro(null)
      setFase('abrindo')
      desligar()

      if (!navigator.mediaDevices?.getUserMedia) {
        setErro(
          window.isSecureContext
            ? 'Este navegador não expõe a câmera. Use o Chrome ou o Edge atualizados.'
            : 'A câmera só funciona em endereço seguro. Abra o sistema por "localhost" ou publique em https — por IP da rede o navegador bloqueia o acesso.',
        )
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : // `ideal` e não `exact`: num PC sem câmera traseira o `exact`
              // falharia com OverconstrainedError em vez de usar a que existe.
              { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
          audio: false,
        })
        streamRef.current = stream

        // Espelha a prévia só na câmera frontal — é o que a pessoa espera ao
        // se ver na tela. A imagem GRAVADA nunca é espelhada.
        const modo = stream.getVideoTracks()[0]?.getSettings().facingMode
        setEspelhar(modo !== 'environment')

        // Os rótulos dos dispositivos só vêm depois da permissão concedida,
        // então a enumeração fica aqui e não na montagem.
        const todos = await navigator.mediaDevices.enumerateDevices()
        setCameras(todos.filter((d) => d.kind === 'videoinput'))

        setFase('ao-vivo')
      } catch (e) {
        const nome = e instanceof DOMException ? e.name : ''
        setErro(
          nome === 'NotAllowedError'
            ? 'Permissão de câmera negada. Libere o acesso no cadeado ao lado do endereço e tente de novo.'
            : nome === 'NotFoundError' || nome === 'DevicesNotFoundError'
              ? 'Nenhuma câmera encontrada neste aparelho. Use "Escolher" para anexar um arquivo.'
              : nome === 'NotReadableError'
                ? 'A câmera está em uso por outro programa. Feche-o e tente de novo.'
                : e instanceof Error
                  ? e.message
                  : 'Não foi possível abrir a câmera.',
        )
      }
    },
    [desligar],
  )

  // O <video> só existe no DOM depois de `fase === 'ao-vivo'`, então a
  // ligação do stream não pode acontecer dentro de `ligar()`.
  useEffect(() => {
    if (fase !== 'ao-vivo' || !videoRef.current || !streamRef.current) return
    videoRef.current.srcObject = streamRef.current
    void videoRef.current.play().catch(() => {})
  }, [fase])

  useEffect(() => {
    if (!open) return
    void ligar()
    return () => desligar()
  }, [open, ligar, desligar])

  // Um objectURL vivo depois do modal fechar segura o binário em memória.
  useEffect(() => {
    return () => {
      if (previa) URL.revokeObjectURL(previa.url)
    }
  }, [previa])

  function fechar() {
    desligar()
    if (previa) URL.revokeObjectURL(previa.url)
    setPrevia(null)
    setErro(null)
    setFase('abrindo')
    onClose()
  }

  function disparar() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const escala = Math.min(1, LADO_MAX / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * escala)
    canvas.height = Math.round(video.videoHeight * escala)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErro('Não foi possível capturar a imagem.')
          return
        }
        const file = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' })
        setPrevia({ url: URL.createObjectURL(blob), file })
        setFase('previa')
        // A câmera fica desligada durante a conferência: no notebook a luz
        // acesa enquanto ninguém está filmando assusta o cliente do balcão.
        desligar()
      },
      'image/jpeg',
      QUALIDADE,
    )
  }

  function repetir() {
    if (previa) URL.revokeObjectURL(previa.url)
    setPrevia(null)
    void ligar(cameras[indice]?.deviceId)
  }

  async function usar() {
    if (!previa) return
    setSalvando(true)
    setErro(null)
    try {
      await onCapturar(previa.file)
      URL.revokeObjectURL(previa.url)
      setPrevia(null)
      onClose()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao anexar a foto.')
      setSalvando(false)
      return
    }
    setSalvando(false)
  }

  function trocar() {
    if (cameras.length < 2) return
    const prox = (indice + 1) % cameras.length
    setIndice(prox)
    void ligar(cameras[prox].deviceId)
  }

  return (
    <Modal
      open={open}
      onClose={fechar}
      title={titulo}
      subtitle={subtitulo ?? 'A foto é anexada à comanda e sai na impressão.'}
      size="lg"
      footer={
        fase === 'previa' ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={repetir} disabled={salvando} className="btn-outline">
              <RotateCcw size={14} />
              Repetir
            </button>
            <button type="button" onClick={usar} disabled={salvando} className="btn-primary">
              {salvando ? <Spinner /> : <Camera size={14} />}
              {salvando ? 'Anexando…' : 'Usar esta foto'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {cameras.length > 1 ? (
              <button type="button" onClick={trocar} className="btn-outline">
                <SwitchCamera size={14} />
                Trocar câmera
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={disparar}
              disabled={fase !== 'ao-vivo'}
              className="btn-primary"
            >
              <Camera size={14} />
              Fotografar
            </button>
          </div>
        )
      }
    >
      <div className="overflow-hidden rounded-xl bg-ink-950">
        {erro ? (
          <div className="bg-white p-1">
            <Erro
              compacto
              mensagem={erro}
              onTentarNovamente={() => void ligar(cameras[indice]?.deviceId)}
            />
          </div>
        ) : fase === 'previa' && previa ? (
          <img src={previa.url} alt="Foto capturada" className="max-h-[58vh] w-full object-contain" />
        ) : (
          <div className="relative">
            <video
              ref={videoRef}
              playsInline
              muted
              className="max-h-[58vh] w-full object-contain"
              style={espelhar ? { transform: 'scaleX(-1)' } : undefined}
            />
            {fase === 'abrindo' && (
              <div className="absolute inset-0 grid place-items-center gap-2 bg-ink-950/80 text-white">
                <RefreshCw size={18} className="animate-spin" />
                <p className="text-[12.5px]">Abrindo a câmera…</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
