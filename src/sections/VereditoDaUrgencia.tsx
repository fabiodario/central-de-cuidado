import { useState } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useDialogos } from '@/components/dialogos-contexto'
import { sendUrgencyVerdict } from '@/lib/repository'
import { MOTIVOS_COM_VEREDITO, textoDoVeredito, type Veredito } from '../../supabase/functions/_shared/veredito.ts'

/**
 * O veredito de quem atende sobre uma urgencia (17/10/2026, pedido do Edu):
 * "e urgente" ou "nao e urgente". O paciente ja recebeu a orientacao de
 * seguranca na hora; aqui o medico confirma ou tranquiliza, e o veredito fica
 * registrado para calibrar o Jev e a regra. A confirmacao mostra o texto exato
 * que o paciente vai receber.
 */
export default function VereditoDaUrgencia({
  conversationId,
  clinicId,
  motivo,
  podeDar,
  janelaAberta,
  aoEnviar,
}: {
  conversationId: string
  clinicId: string | null
  motivo: string | null
  podeDar: boolean
  janelaAberta: boolean
  aoEnviar: () => Promise<void> | void
}) {
  const { perguntar } = useDialogos()
  const [enviando, setEnviando] = useState<Veredito | null>(null)
  const [erro, setErro] = useState('')

  if (!motivo || !MOTIVOS_COM_VEREDITO.includes(motivo)) return null

  async function dar(veredito: Veredito) {
    if (enviando) return
    const certeza = await perguntar({
      titulo: veredito === 'urgente' ? 'Confirmar que é urgente?' : 'Não é urgente?',
      detalhe: `O paciente recebe: "${textoDoVeredito(veredito, clinicId)}"`,
      confirmar: 'Enviar ao paciente',
      perigo: veredito === 'urgente',
    })
    if (!certeza) return
    setEnviando(veredito)
    setErro('')
    try {
      await sendUrgencyVerdict(conversationId, veredito)
      await aoEnviar()
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível enviar o veredito.')
    } finally {
      setEnviando(null)
    }
  }

  return (
    <div className="mt-3 rounded-[14px] border border-[#b42318]/25 bg-[#fff5f4] px-3.5 py-2.5">
      <p className="text-[10px] font-extrabold text-[#7a1a12]">
        {podeDar
          ? 'Urgência: o que o médico acha? O paciente já recebeu a orientação de procurar atendimento.'
          : 'Urgência: o veredito (é urgente ou não) é do médico.'}
      </p>
      {podeDar && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={Boolean(enviando) || !janelaAberta}
            onClick={() => void dar('urgente')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#b42318] px-3 py-1.5 text-[10px] font-extrabold text-white transition hover:bg-[#912018] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            {enviando === 'urgente' ? 'Enviando...' : 'É urgente'}
          </button>
          <button
            type="button"
            disabled={Boolean(enviando) || !janelaAberta}
            onClick={() => void dar('nao_urgente')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/15 bg-white px-3 py-1.5 text-[10px] font-extrabold text-[#081b2c] transition hover:bg-[#f3f6f9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {enviando === 'nao_urgente' ? 'Enviando...' : 'Não é urgente'}
          </button>
        </div>
      )}
      {podeDar && !janelaAberta && (
        <p className="mt-1.5 text-[10px] font-semibold text-[#7a1a12]">Janela de 24h fechada: o veredito não pode mais ser enviado por aqui.</p>
      )}
      {erro && <p className="mt-1.5 text-[10px] font-bold text-red-600">{erro}</p>}
    </div>
  )
}
