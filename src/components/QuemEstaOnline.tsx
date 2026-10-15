import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw } from 'lucide-react'
import { corDoNome, iniciais, linkDaFoto, type PessoaOnline } from '@/lib/equipe-online'
import AjustarFoto from '@/components/AjustarFoto'

/**
 * As fotinhas no topo (01/10/2026): a sua primeiro, clicavel para trocar, e
 * a de quem mais esta com a Central aberta - so quando a clinica tem a
 * presenca ligada (ver lib/equipe-online.ts).
 */

function Avatar({
  nome,
  caminho,
  tamanho,
  anel,
}: {
  nome: string
  caminho: string | null
  tamanho: number
  anel: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void linkDaFoto(caminho).then((u) => vivo && setUrl(u))
    return () => {
      vivo = false
    }
  }, [caminho])

  const estilo = { width: tamanho, height: tamanho }
  return url ? (
    <img src={url} alt={nome} style={estilo} className={`rounded-full object-cover ring-2 ${anel}`} />
  ) : (
    <span
      style={{ ...estilo, backgroundColor: corDoNome(nome), fontSize: tamanho * 0.36 }}
      className={`flex items-center justify-center rounded-full font-extrabold text-white ring-2 ${anel}`}
    >
      {iniciais(nome)}
    </span>
  )
}

export default function QuemEstaOnline({
  nome,
  foto,
  outros,
  tema,
  onEscolherFoto,
}: {
  nome: string
  foto: string | null
  outros: PessoaOnline[]
  tema: 'claro' | 'escuro'
  onEscolherFoto: (arquivo: File) => Promise<void>
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const escuro = tema === 'escuro'
  const tamanho = escuro ? 34 : 40
  const anel = escuro ? 'ring-[#081b2c]' : 'ring-[#f7f5f1]'
  // No celular a barra escura divide espaco com o logo, o sino e o sair.
  const visiveis = outros.slice(0, escuro ? 1 : 4)
  const resto = outros.length - visiveis.length

  // A foto escolhida passa primeiro pelo ajuste (centralizar e aproximar).
  const [paraAjustar, setParaAjustar] = useState<File | null>(null)

  function escolher(arquivo: File | undefined) {
    if (entrada.current) entrada.current.value = ''
    if (!arquivo) return
    if (!arquivo.type.startsWith('image/')) {
      setErro('Escolha uma imagem.')
      window.setTimeout(() => setErro(''), 6000)
      return
    }
    setErro('')
    setParaAjustar(arquivo)
  }

  async function salvarAjustada(foto: File) {
    setEnviando(true)
    try {
      await onEscolherFoto(foto)
      setParaAjustar(null)
    } catch (causa) {
      setParaAjustar(null)
      setErro(causa instanceof Error ? causa.message : 'Não foi possível trocar a foto.')
      window.setTimeout(() => setErro(''), 6000)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="relative flex items-center">
      {/* Colegas: lado a lado, com o ponto verde de "online". Sobrepostos
          (ate 15/10/2026), um cobria o ponto verde do outro e a fileira
          parecia intercalada. */}
      {visiveis.length > 0 && (
        <div className="mr-2 flex items-center gap-1.5" aria-label={`${outros.length} colega(s) online`}>
          {visiveis.map((p) => (
            <span key={p.userId} className="relative" title={`${p.nome} · online`}>
              <Avatar nome={p.nome} caminho={p.foto} tamanho={tamanho} anel={anel} />
              <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ${anel}`} />
            </span>
          ))}
          {resto > 0 && (
            <span
              style={{ width: tamanho, height: tamanho }}
              title={outros.slice(visiveis.length).map((p) => p.nome).join(', ')}
              className={`flex items-center justify-center rounded-full text-[11px] font-extrabold ring-2 ${anel} ${
                escuro ? 'bg-white/15 text-white' : 'bg-[#dceaf7] text-[#1f4f78]'
              }`}
            >
              +{resto}
            </span>
          )}
        </div>
      )}

      {/* Voce: clique para trocar a foto. */}
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        disabled={enviando}
        title={`${nome} · trocar foto`}
        aria-label="Trocar minha foto"
        className={`group relative rounded-full transition hover:scale-105 disabled:cursor-wait ${escuro ? 'foto-pulsante-escura' : 'foto-pulsante'}`}
      >
        <Avatar nome={nome} caminho={foto} tamanho={tamanho} anel={anel} />
        <span
          className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white transition ${
            enviando ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {enviando ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </span>
      </button>
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => escolher(e.target.files?.[0])}
      />

      {paraAjustar && (
        <AjustarFoto arquivo={paraAjustar} onCancelar={() => setParaAjustar(null)} onSalvar={salvarAjustada} />
      )}

      {erro && (
        <p className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700 shadow-lg">
          {erro}
        </p>
      )}
    </div>
  )
}
