import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Loader2, PlugZap } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getCurrentMembership } from '@/lib/repository'
import { avaliarSaude, type Avaliacao, type DadosDaSaude } from '@/lib/saude-dos-envios'

/**
 * Cartao "os envios automaticos estao saindo?" (25/09/2026).
 *
 * Verde e discreto quando esta tudo certo; vermelho e aberto quando nao esta.
 * Recarrega a cada 5 minutos enquanto a tela esta aberta. Se nem a consulta
 * funcionar, diz isso - um painel de saude que falha calado seria o pior
 * tipo de ironia.
 */
const db = supabase as unknown as SupabaseClient

export function SaudeDosEnvios() {
  const [estado, setEstado] = useState<Avaliacao | null>(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    let vivo = true
    const consultar = async () => {
      try {
        const membership = await getCurrentMembership()
        if (!membership) return
        const { data, error } = await db.rpc('saude_dos_envios', { p_clinic: membership.clinicId })
        if (error) throw new Error(error.message)
        if (vivo) {
          setEstado(avaliarSaude((data ?? {}) as DadosDaSaude))
          setErro('')
        }
      } catch (causa) {
        if (vivo) setErro(causa instanceof Error ? causa.message : 'falha')
      }
    }
    void consultar()
    const relogio = window.setInterval(() => void consultar(), 5 * 60_000)
    return () => {
      vivo = false
      window.clearInterval(relogio)
    }
  }, [])

  if (erro) {
    return (
      <div className="flex items-start gap-2 rounded-[18px] border border-[#b54708]/25 bg-[#fef6e7] px-4 py-3 text-[11px] font-bold text-[#93370d]">
        <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
        Não consegui conferir se os envios automáticos estão saindo ({erro}).
      </div>
    )
  }
  if (!estado) {
    return (
      <div className="flex items-center gap-2 px-1 text-[11px] font-semibold text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Conferindo os envios automáticos...
      </div>
    )
  }

  if (estado.situacao === 'desligado') {
    return (
      <div className="flex items-center gap-2 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] font-extrabold text-slate-500">
        <PlugZap className="h-4 w-4 shrink-0" />
        {estado.resumo}
        <span className="font-semibold opacity-80">· envios automáticos desligados</span>
      </div>
    )
  }

  const erros = estado.problemas.filter((p) => p.nivel === 'erro')
  const avisos = estado.problemas.filter((p) => p.nivel === 'aviso')
  const mostrar = erros.length > 0 || aberto

  const cor =
    erros.length > 0
      ? 'border-[#b42318]/30 bg-[#fef3f2] text-[#b42318]'
      : avisos.length > 0
        ? 'border-[#b54708]/25 bg-[#fffaf2] text-[#93370d]'
        : 'border-[#1c6b3a]/20 bg-[#eef7f1] text-[#1c6b3a]'

  return (
    <div className={`rounded-[18px] border px-4 py-3 ${cor}`}>
      <button type="button" onClick={() => setAberto((v) => !v)} className="flex w-full items-center gap-2 text-left">
        {erros.length > 0 ? (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        ) : avisos.length > 0 ? (
          <Activity className="h-4 w-4 shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        )}
        <span className="flex-1 text-[12px] font-extrabold">
          {erros.length > 0
            ? 'Os envios automáticos estão com problema'
            : avisos.length > 0
              ? `Envios automáticos funcionando, com ${avisos.length} ${avisos.length === 1 ? 'ponto' : 'pontos'} para olhar`
              : 'Envios automáticos funcionando'}
          <span className="ml-2 font-semibold opacity-70">{estado.resumo}</span>
        </span>
        {erros.length === 0 && estado.problemas.length > 0 && (
          <ChevronDown className={`h-4 w-4 shrink-0 transition ${aberto ? 'rotate-180' : ''}`} />
        )}
      </button>
      {mostrar && estado.problemas.length > 0 && (
        <ul className="mt-2 space-y-1 pl-6 text-[11px] font-semibold">
          {[...erros, ...avisos].map((p, i) => (
            <li key={i} className={`list-disc ${p.nivel === 'erro' ? 'font-extrabold' : ''}`}>
              {p.texto}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
