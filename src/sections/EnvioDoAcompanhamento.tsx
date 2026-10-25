import { useEffect, useState } from 'react'
import { useDialogos } from '@/components/dialogos-contexto'
import { getAcompanhamentoAutomatico, getCurrentMembership, saveAcompanhamentoAutomatico } from '@/lib/repository'

const OPCOES = [
  // Sem os dias no texto (25/10/2026): desde as etapas em Preferencias, a
  // clinica pode ter desligado alguma, e o "15, 30 e 90" ficava errado.
  { ligado: true, rotulo: 'Ligado', explica: 'Sai sozinho às 9h, nas etapas escolhidas abaixo.' },
  {
    ligado: false,
    rotulo: 'Desligado',
    explica: 'Nada sai sozinho. A equipe envia um por um na tela de Acompanhamentos.',
  },
]

/**
 * Liga e desliga o envio automatico das 9h dos acompanhamentos (17/10/2026,
 * pedido do Edu). Antes so dava parando o cron. Mora em
 * clinic_settings.acompanhamento_automatico, so o responsavel muda, e o
 * disparo (whatsapp-dispatch) pula a clinica desligada. Os lembretes de
 * consulta nao passam por aqui.
 */
export default function EnvioDoAcompanhamento() {
  const { perguntar } = useDialogos()
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [responsavel, setResponsavel] = useState(false)
  const [ligado, setLigado] = useState<boolean | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const membership = await getCurrentMembership()
        if (!membership || !vivo) return
        setClinicId(membership.clinicId)
        setResponsavel(membership.role === 'owner')
        const atual = await getAcompanhamentoAutomatico(membership.clinicId)
        if (vivo) setLigado(atual)
      } catch (causa) {
        if (vivo) setErro(causa instanceof Error ? causa.message : 'Não foi possível ler a opção do envio automático.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  async function escolher(novo: boolean) {
    if (!clinicId || !responsavel || salvando || ligado === null || novo === ligado) return
    const certeza = await perguntar(
      novo
        ? {
            titulo: 'Ligar o acompanhamento automático?',
            detalhe:
              'No próximo envio, às 9h, saem também os acompanhamentos que venceram nos últimos 14 dias e ainda não foram enviados.',
            confirmar: 'Ligar',
          }
        : {
            titulo: 'Desligar o acompanhamento automático?',
            detalhe:
              'Os pacientes deixam de receber sozinhos a mensagem de 15, 30 e 90 dias até você religar. A equipe ainda pode enviar um por um na tela de Acompanhamentos.',
            confirmar: 'Desligar',
            perigo: true,
          },
    )
    if (!certeza) return
    setSalvando(true)
    setErro('')
    try {
      await saveAcompanhamentoAutomatico(clinicId, novo)
      setLigado(novo)
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Envio automático</p>
      <div role="radiogroup" aria-label="Envio automático do acompanhamento" className="grid gap-2 sm:grid-cols-2">
        {OPCOES.map((opcao) => {
          const escolhida = ligado === opcao.ligado
          return (
            <button
              key={opcao.rotulo}
              type="button"
              role="radio"
              aria-checked={escolhida}
              onClick={() => void escolher(opcao.ligado)}
              disabled={!responsavel || salvando || ligado === null}
              className={`rounded-[16px] border px-4 py-3 text-left transition disabled:cursor-not-allowed ${
                escolhida
                  ? 'border-[#081b2c] bg-[#081b2c] text-white shadow-[0_10px_22px_rgba(8,27,44,.15)]'
                  : 'border-[#081b2c]/10 bg-[#fafaf8] text-[#081b2c] hover:border-[#2f7fc1] disabled:hover:border-[#081b2c]/10'
              } ${!responsavel && !escolhida ? 'opacity-60' : ''}`}
            >
              <span className="block text-xs font-extrabold">{opcao.rotulo}</span>
              <span className={`mt-1 block text-[10px] leading-relaxed ${escolhida ? 'text-white/70' : 'text-slate-400'}`}>
                {opcao.explica}
              </span>
            </button>
          )
        })}
      </div>
      {ligado === null && !erro && <p className="text-[10px] font-semibold text-slate-400">Carregando...</p>}
      {!responsavel && ligado !== null && (
        <p className="text-[10px] font-semibold text-slate-400">Só o responsável pela clínica muda esta opção.</p>
      )}
      {salvando && <p className="text-[10px] font-semibold text-slate-400">Salvando...</p>}
      {ligado === false && (
        <p className="text-[10px] font-semibold leading-relaxed text-[#9a5a1c]">
          Desligado: nenhum acompanhamento sai sozinho. Os lembretes de consulta continuam normais.
        </p>
      )}
      {erro && <p className="text-[10px] font-bold leading-relaxed text-red-600">{erro}</p>}
    </div>
  )
}
