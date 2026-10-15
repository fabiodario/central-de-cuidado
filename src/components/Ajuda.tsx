import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Um "?" pequeno ao lado de um rotulo, com a explicacao ao passar o mouse ou
 * tocar. Serve para o que o nome sozinho nao conta: "Íntegro", "Janela",
 * "Antecedência".
 */
export function Ajuda({ texto, className = '' }: { texto: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="O que é isto?"
          onClick={(evento) => evento.preventDefault()}
          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[9px] font-extrabold leading-none text-slate-400 transition hover:border-[#2f7fc1] hover:text-[#2f7fc1] ${className}`}
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] bg-[#081b2c] px-3 py-2 text-[11px] font-medium leading-relaxed text-white">
        {texto}
      </TooltipContent>
    </Tooltip>
  )
}
