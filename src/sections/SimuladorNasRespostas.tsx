import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, ExternalLink, Play, X } from 'lucide-react'

/**
 * O simulador do robo dentro de Respostas (16/10/2026).
 *
 * Pedido do Edu: testar ali mesmo o robo "ja como vai ser" o do Dr. Fabio,
 * antes de ligar o numero da Meta, e depois treinar e melhorar as respostas.
 * O simulador le a configuracao desta clinica (unidades, horarios, saudacao,
 * respostas prontas) e responde com o robo de producao, num banco falso: nada
 * e enviado a ninguem nem gravado.
 *
 * Ele e a pagina simuladorbot/ aberta num quadro (iframe) por cima da tela, e
 * nao um componente daqui: o sistema e um arquivo unico, e embutir o robo e os
 * roteiros faria toda a recepcao baixar a demonstracao a cada abertura (ver
 * vite.simulador.config.ts). No quadro ela so carrega quando alguem abre.
 * Mesmo endereco, mesma sessao: entra direto, sem novo login.
 */
const ENDERECO = './simuladorbot/?no-sistema'

export default function SimuladorNasRespostas({ compacto = false }: { compacto?: boolean }) {
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    if (!aberto) return
    const comEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    window.addEventListener('keydown', comEsc)
    // A pagina de tras nao rola enquanto o simulador esta aberto.
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', comEsc)
      document.body.style.overflow = antes
    }
  }, [aberto])

  return (
    <>
      <div className={`surface-card flex items-center gap-3 rounded-[18px] p-3 ${compacto ? 'hidden' : ''}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eef3f2] text-[#557f75]">
          <Bot className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-extrabold text-[#081b2c]">Simulador do robô</span>
          <span className="block text-[10.5px] leading-snug text-slate-500">
            Converse como paciente e veja o robô responder com a configuração desta clínica. Nada é enviado nem gravado.
          </span>
        </span>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#081b2c] px-3 py-2 text-[11px] font-bold text-white transition hover:bg-[#10304d]"
        >
          <Play className="h-3.5 w-3.5" /> Abrir simulador
        </button>
      </div>

      {aberto &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Simulador do robô"
            className="fixed inset-0 z-[70] flex flex-col bg-[#081b2c]/70 backdrop-blur-sm sm:p-3"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white shadow-[0_30px_80px_rgba(0,0,0,.35)] sm:rounded-[20px]">
              <div className="flex items-center gap-2 bg-[#081b2c] px-3 py-2 text-white">
                <Bot className="h-4 w-4 text-[#9fc2b8]" />
                <p className="mr-auto truncate text-[12px] font-bold">Simulador do robô · nada é enviado nem gravado</p>
                <a
                  href={ENDERECO}
                  target="_blank"
                  rel="noopener"
                  className="hidden items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-white/70 hover:bg-white/10 hover:text-white sm:flex"
                >
                  Abrir em outra aba <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => setAberto(false)}
                  aria-label="Fechar o simulador"
                  className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <iframe src={ENDERECO} title="Simulador do robô" className="min-h-0 w-full flex-1 border-0" />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
