import { useEffect, useState } from 'react'
import { KeyRound, RefreshCw, Users, X } from 'lucide-react'
import { definirPresencaLigada, presencaLigada } from '@/lib/equipe-online'

/**
 * Painel "Administracao" (01/10/2026): so o responsavel pelo sistema ve.
 *
 * Aqui ficam as opcoes que mudam de clinica para clinica conforme o contrato
 * - "para o Dr. Marcello da para liberar, medicos mais chatos nao". O banco
 * confere de novo em cada gravacao (definir_presenca_ligada); esconder o botao
 * e so conforto.
 *
 * Por enquanto uma opcao: ver quem esta online. Novas chaves entram como
 * linhas novas deste painel.
 */
export default function PainelAdministracao({ clinicId, onFechar }: { clinicId: string; onFechar: () => void }) {
  const [ligada, setLigada] = useState<boolean | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    void presencaLigada(clinicId).then(setLigada)
  }, [clinicId])

  async function alternar() {
    if (ligada === null) return
    setErro('')
    setSalvando(true)
    try {
      await definirPresencaLigada(clinicId, !ligada)
      setLigada(!ligada)
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="surface-card overflow-hidden rounded-[26px] border-2 border-[#1f4f78]/20">
      <div className="flex items-start justify-between gap-3 border-b border-[#081b2c]/[0.06] bg-gradient-to-r from-[#081b2c] to-[#163a5a] p-5 text-white sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-white/10">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#86bce4]">Só você vê</p>
            <h2 className="mt-1 text-base font-extrabold">Administração</h2>
            <p className="mt-1 text-xs leading-relaxed text-white/70">
              Opções do sistema para esta clínica. Valem para todos que usam a clínica.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar administração"
          className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-[#081b2c]/[0.07] bg-white p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#dceaf7] text-[#1f4f78]">
              <Users className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-extrabold text-[#081b2c]">Ver quem está online</p>
              <p className="mt-1 text-xs leading-relaxed text-[#50677b]">
                Ligado: a equipe vê, no topo da tela, a foto de quem está com a Central aberta. Desligado: ninguém vê
                ninguém — cada um vê só a própria foto.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ligada === true}
            onClick={() => void alternar()}
            disabled={ligada === null || salvando}
            className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition disabled:opacity-60 ${
              ligada ? 'bg-[#1c6b3a]' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-all ${
                ligada ? 'left-6' : 'left-1'
              }`}
            >
              {salvando && <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />}
            </span>
          </button>
        </div>
        {erro && <p className="mt-3 text-[11px] font-bold text-red-600">{erro}</p>}
      </div>
    </div>
  )
}
