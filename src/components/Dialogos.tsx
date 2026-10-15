import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Info, X } from 'lucide-react'
import { ContextoDeDialogos, type ApiDeDialogos } from '@/components/dialogos-contexto'

/**
 * Avisos e confirmações da Central de Cuidado.
 *
 * Até 08/09/2026 tudo isto era `alert()` e `confirm()` do navegador: uma caixa
 * cinza escrita "<endereço do site> diz", com a mensagem técnica crua. Num
 * sistema que a equipe usa na frente da família, isso parecia erro do site.
 *
 * Aqui a mesma informação sai na linguagem do sistema: aviso discreto no canto
 * quando é só constatação, e uma pergunta no meio da tela quando alguém precisa
 * decidir. A promessa é a de sempre: nada some sozinho antes de ser lido, e
 * toda pergunta diz o que acontece com cada resposta.
 */

type Tom = 'ok' | 'erro' | 'aviso'

type Aviso = { id: number; tom: Tom; texto: string }

type Pergunta = {
  titulo: string
  detalhe?: string
  confirmar: string
  cancelar: string
  perigo: boolean
  resolver: (resposta: boolean) => void
}

const CORES: Record<Tom, { fundo: string; borda: string; texto: string; Icone: typeof Check }> = {
  ok: { fundo: '#eef7f3', borda: '#6f9d91', texto: '#2f6357', Icone: Check },
  erro: { fundo: '#fdf2f2', borda: '#d98b87', texto: '#a3312a', Icone: AlertTriangle },
  aviso: { fundo: '#eff6fd', borda: '#6aa8d9', texto: '#1f4f78', Icone: Info },
}

export function ProvedorDeDialogos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [pergunta, setPergunta] = useState<Pergunta | null>(null)
  const proximoId = useRef(0)

  const avisar = useCallback((texto: string, tom: Tom = 'ok') => {
    const id = ++proximoId.current
    setAvisos((atuais) => [...atuais, { id, tom, texto }])
    // Sete segundos: tempo de ler duas linhas sem pressa. Erro não some
    // sozinho - quem precisa anotar uma mensagem de falha merece o tempo dele.
    if (tom !== 'erro') {
      window.setTimeout(() => setAvisos((atuais) => atuais.filter((a) => a.id !== id)), 7000)
    }
  }, [])

  const perguntar = useCallback<ApiDeDialogos['perguntar']>(
    (opcoes) =>
      new Promise<boolean>((resolver) => {
        setPergunta({
          titulo: opcoes.titulo,
          detalhe: opcoes.detalhe,
          confirmar: opcoes.confirmar ?? 'Confirmar',
          cancelar: opcoes.cancelar ?? 'Cancelar',
          perigo: opcoes.perigo ?? false,
          resolver,
        })
      }),
    [],
  )

  const api = useMemo(() => ({ avisar, perguntar }), [avisar, perguntar])

  function responder(resposta: boolean) {
    pergunta?.resolver(resposta)
    setPergunta(null)
  }

  return (
    <ContextoDeDialogos.Provider value={api}>
      {children}

      {/* Avisos: canto inferior direito no computador, rodapé no celular, acima
          da barra de navegação para não cobrir os botões. */}
      <div className="pointer-events-none fixed inset-x-3 bottom-24 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end">
        {avisos.map((aviso) => {
          const cor = CORES[aviso.tom]
          return (
            <div
              key={aviso.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-[16px] border px-4 py-3 shadow-[0_14px_34px_rgba(8,27,44,.16)]"
              style={{ background: cor.fundo, borderColor: `${cor.borda}66`, color: cor.texto }}
            >
              <cor.Icone className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <p className="flex-1 text-[11px] font-bold leading-relaxed">{aviso.texto}</p>
              <button
                type="button"
                aria-label="Fechar aviso"
                onClick={() => setAvisos((atuais) => atuais.filter((a) => a.id !== aviso.id))}
                className="shrink-0 rounded-lg p-0.5 opacity-50 transition hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      {pergunta && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[#081b2c]/45 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => responder(false)}
        >
          <div
            className="w-full max-w-sm rounded-[22px] bg-white p-5 shadow-[0_30px_70px_rgba(8,27,44,.3)]"
            onClick={(evento) => evento.stopPropagation()}
          >
            <p className="text-sm font-extrabold leading-snug text-[#081b2c]">{pergunta.titulo}</p>
            {pergunta.detalhe && (
              <p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed text-slate-500">
                {pergunta.detalhe}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => responder(false)}
                className="rounded-xl bg-[#eef3f2] px-3.5 py-2.5 text-[11px] font-bold text-[#557f75] transition hover:bg-[#e2ece9]"
              >
                {pergunta.cancelar}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => responder(true)}
                className={`rounded-xl px-4 py-2.5 text-[11px] font-extrabold text-white transition ${
                  pergunta.perigo ? 'bg-[#b42318] hover:bg-[#96190f]' : 'bg-[#081b2c] hover:bg-[#102d47]'
                }`}
              >
                {pergunta.confirmar}
              </button>
            </div>
          </div>
        </div>
      )}
    </ContextoDeDialogos.Provider>
  )
}
