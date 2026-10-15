import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Download, ExternalLink, FileText, X } from 'lucide-react'

/**
 * Foto e PDF abertos por cima da tela, e nao numa aba nova (25/09/2026).
 *
 * Pedido da recepcao: abrir o comprovante de Pix numa aba nova tirava a pessoa
 * da conversa - voltar, achar a conversa, achar o ponto onde estava. Aqui o
 * arquivo abre por cima e fecha com Esc, clique fora ou no X, e a conversa
 * continua exatamente onde estava por baixo.
 *
 * Foto e PDF aparecem direto. Word, Excel e o resto o navegador nao mostra:
 * esses ganham o botao de baixar, e a aba nova continua disponivel para quem
 * quiser.
 */
export type ArquivoAberto = { url: string; mime: string | null; titulo?: string }

export function VisualizadorDeArquivo({ arquivo, onFechar }: { arquivo: ArquivoAberto | null; onFechar: () => void }) {
  useEffect(() => {
    if (!arquivo) return
    // Na captura, e parando ali: aberto de dentro do prontuario (um painel
    // lateral), o Esc fecharia o prontuario junto com o arquivo.
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return
      evento.stopImmediatePropagation()
      evento.stopPropagation()
      onFechar()
    }
    window.addEventListener('keydown', aoTeclar, true)
    return () => window.removeEventListener('keydown', aoTeclar, true)
  }, [arquivo, onFechar])

  if (!arquivo) return null
  const tipo = arquivo.mime ?? ''
  const imagem = tipo.startsWith('image/') && !/hei[cf]/.test(tipo)
  const pdf = tipo === 'application/pdf'

  // Portal no body: dentro do painel lateral, "fixed" ficaria preso ao painel
  // (ele usa transform), e o arquivo abriria espremido na lateral.
  return createPortal(
    <div
      // O painel lateral desliga o clique no resto da pagina enquanto esta
      // aberto; o visualizador liga de volta para si.
      style={{ pointerEvents: 'auto' }}
      className="fixed inset-0 z-[100] flex flex-col bg-[#081b2c]/85 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={arquivo.titulo || 'Arquivo'}
      onClick={onFechar}
    >
      <div
        className="mx-auto flex w-full max-w-5xl items-center gap-2 pb-3 text-white"
        onClick={(evento) => evento.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold">{arquivo.titulo || 'Arquivo'}</p>
        <a
          href={arquivo.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold hover:bg-white/20"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Nova aba
        </a>
        {/* O link assinado e de outro dominio, e ai o atributo download o
            navegador ignora; o parametro download do Storage pede o arquivo
            como anexo. */}
        <a
          href={`${arquivo.url}${arquivo.url.includes('?') ? '&' : '?'}download=`}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold hover:bg-white/20"
        >
          <Download className="h-3.5 w-3.5" /> Baixar
        </a>
        <button
          type="button"
          onClick={onFechar}
          className="rounded-xl bg-white/10 p-2 hover:bg-white/20"
          aria-label="Fechar"
          title="Fechar (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-center justify-center"
        onClick={(evento) => evento.stopPropagation()}
      >
        {imagem ? (
          <img src={arquivo.url} alt={arquivo.titulo || 'Imagem'} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        ) : pdf ? (
          <iframe src={arquivo.url} title={arquivo.titulo || 'PDF'} className="h-full w-full rounded-lg bg-white" />
        ) : (
          <div className="rounded-2xl bg-white p-6 text-center">
            <FileText className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-[13px] font-bold text-[#081b2c]">Este tipo de arquivo o navegador não mostra aqui.</p>
            <p className="mt-1 text-[12px] text-slate-500">Use "Baixar" ou "Nova aba" acima.</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
