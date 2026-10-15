import { useEffect, useState } from 'react'
import { BellRing, RefreshCw, Share, SquarePlus, X } from 'lucide-react'
import { ativarNotificacoes, estadoDesteAparelho, situacaoDoAparelho } from '@/lib/notificacoes'

/**
 * Convite para ativar os avisos, na abertura do sistema (28/09/2026).
 *
 * Pedido: "quando abrir o sistema, ele pedir para ativar, sem ter que ir no
 * config". O navegador nao deixa pedir permissao sozinho na abertura - o
 * iPhone exige um toque, e o Chrome esconde o pedido feito sem toque atras de
 * um icone que ninguem ve. Entao o convite e nosso, e o toque em "Ativar" e o
 * que faz aparecer o pedido do proprio celular.
 *
 * Aparece so quando ainda da para ativar: permissao nunca pedida, ou
 * concedida mas sem inscricao nesta clinica. Bloqueado ou sem suporte fica
 * para o cartao de Preferencias, que explica o caminho. "Agora nao" some por
 * 3 dias neste aparelho.
 */

const CHAVE = 'central.convite-avisos'
const PAUSA = 3 * 24 * 60 * 60 * 1000

function adiadoAte(): number {
  try {
    return Number(localStorage.getItem(CHAVE) ?? 0) || 0
  } catch {
    return 0
  }
}

function adiar() {
  try {
    localStorage.setItem(CHAVE, String(Date.now() + PAUSA))
  } catch {
    // Sem armazenamento (aba anonima): o convite volta na proxima abertura.
  }
}

type Modo = 'oculto' | 'ativar' | 'iphone'

export default function ConviteParaAvisos({ clinicId }: { clinicId: string | null }) {
  const [modo, setModo] = useState<Modo>('oculto')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState(false)

  useEffect(() => {
    if (!clinicId) return
    let vivo = true
    void (async () => {
      const situacao = situacaoDoAparelho()
      if (situacao === 'iphone-instalar') {
        if (Date.now() >= adiadoAte()) setModo('iphone')
        return
      }
      if (situacao !== 'pronto') return

      if (Notification.permission === 'granted') {
        // Permissao ja dada, mas este aparelho nao esta inscrito nesta
        // clinica (trocou de clinica, ou o servico de push descartou a
        // inscricao): refaz sem perguntar nada. So se falhar e que convida.
        try {
          const estado = await estadoDesteAparelho(clinicId)
          if (estado.ativo) return
          await ativarNotificacoes(clinicId)
          return
        } catch (causa) {
          console.warn('Nao consegui reativar os avisos sozinho', causa)
        }
      }
      if (vivo && Date.now() >= adiadoAte()) setModo('ativar')
    })()
    return () => {
      vivo = false
    }
  }, [clinicId])

  if (modo === 'oculto') return null

  function fechar() {
    adiar()
    setModo('oculto')
  }

  async function ativar() {
    if (!clinicId) return
    setErro('')
    setOcupado(true)
    try {
      await ativarNotificacoes(clinicId)
      setFeito(true)
      window.setTimeout(() => setModo('oculto'), 2500)
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível ativar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Ativar avisos neste aparelho"
      className="fixed inset-x-3 bottom-[92px] z-50 rounded-[22px] border border-[#081b2c]/10 bg-white p-4 shadow-[0_18px_55px_rgba(8,27,44,.25)] lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[380px]"
    >
      <button
        type="button"
        onClick={fechar}
        aria-label="Agora não"
        className="absolute right-2.5 top-2.5 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#dceaf7] text-[#1f4f78]">
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-[#081b2c]">
            {feito ? 'Avisos ativados ✅' : 'Receber avisos das famílias?'}
          </p>
          {!feito && (
            <p className="mt-1 text-xs leading-relaxed text-[#50677b]">
              Quando alguém pedir para falar com a equipe, marcar urgência ou pedir 2ª via, este aparelho avisa como o
              WhatsApp.
            </p>
          )}
        </div>
      </div>

      {modo === 'iphone' && !feito && (
        <ol className="mt-3 list-decimal space-y-1 rounded-2xl bg-[#f3f8fd] p-3 pl-7 text-xs leading-relaxed text-[#1c3b57]">
          <li>
            No Safari, toque em <Share className="inline h-3.5 w-3.5 align-[-2px]" /> <strong>Compartilhar</strong>.
          </li>
          <li>
            <SquarePlus className="inline h-3.5 w-3.5 align-[-2px]" /> <strong>Adicionar à Tela de Início</strong>.
          </li>
          <li>Abra a Central pelo ícone novo: o convite para ativar aparece lá.</li>
        </ol>
      )}

      {modo === 'ativar' && !feito && (
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={() => void ativar()}
            disabled={ocupado}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#081b2c] px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-[#102d47] disabled:cursor-wait disabled:opacity-70"
          >
            {ocupado ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            {ocupado ? 'Ativando…' : 'Ativar avisos'}
          </button>
          <button
            type="button"
            onClick={fechar}
            className="rounded-xl border border-[#081b2c]/12 px-3 py-2.5 text-xs font-extrabold text-[#50677b] transition hover:bg-[#f3f6f9]"
          >
            Agora não
          </button>
        </div>
      )}

      {erro && <p className="mt-2 text-[11px] font-bold leading-relaxed text-red-600">{erro}</p>}
    </div>
  )
}
