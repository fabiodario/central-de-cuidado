import { useState } from 'react'
import { FilePlus2, Loader2 } from 'lucide-react'
import { registrarAdendo, type Adendo } from '@/lib/prontuario-extra'

/**
 * Adendos de um atendimento assinado (25/09/2026).
 *
 * O original nao muda; o adendo entra embaixo, com data, hora e autor, e
 * nunca mais sai (ver a migration). Por isso o botao pede uma confirmacao
 * antes de gravar: nao ha "desfazer" para um adendo.
 */

const DATA_E_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

export function AdendosDaConsulta({
  clinicId,
  patientId,
  consultationId,
  adendos,
  onRegistrado,
}: {
  clinicId: string | null
  patientId: string
  consultationId: string
  adendos: Adendo[]
  onRegistrado: () => void
}) {
  const [escrevendo, setEscrevendo] = useState(false)
  const [texto, setTexto] = useState('')
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState('')

  async function gravar() {
    if (!clinicId || !texto.trim()) return
    if (!window.confirm('Registrar este adendo? Depois de gravado ele não pode ser alterado nem apagado.')) return
    setGravando(true)
    setErro('')
    try {
      await registrarAdendo(clinicId, patientId, consultationId, texto)
      setTexto('')
      setEscrevendo(false)
      onRegistrado()
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'O adendo não foi registrado.')
    } finally {
      setGravando(false)
    }
  }

  return (
    <div>
      {adendos.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Adendos</p>
          {adendos.map((adendo) => (
            <div key={adendo.id} className="rounded-[14px] border border-[#b54708]/20 bg-[#fffaf2] px-4 py-3">
              <p className="text-[10px] font-extrabold text-[#93370d]">
                Adendo de {DATA_E_HORA.format(new Date(adendo.criadoEm))}
                {adendo.autorNome ? ` · ${adendo.autorNome}` : ''}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[#081b2c]">{adendo.texto}</p>
            </div>
          ))}
        </div>
      )}

      {escrevendo ? (
        <div className="mt-3 rounded-[14px] border border-[#b54708]/25 bg-white p-3">
          <p className="text-[11px] font-bold text-[#93370d]">
            O atendimento assinado continua como está. O adendo fica registrado embaixo, com a data de hoje e o seu nome.
          </p>
          <textarea
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            rows={4}
            maxLength={20000}
            autoFocus
            placeholder="Ex.: Onde se lê 5 mL, leia-se 2,5 mL. Resultado do exame chegou: ..."
            className="mt-2 w-full rounded-xl border border-[#081b2c]/10 px-3 py-2 text-[13px] text-[#081b2c] outline-none focus:border-[#b54708]/50"
          />
          {erro && <p className="mt-2 text-[11px] font-bold text-red-600">{erro}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void gravar()}
              disabled={gravando || !texto.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#93370d] px-3.5 py-2 text-[11px] font-extrabold text-white disabled:opacity-40"
            >
              {gravando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Registrar adendo
            </button>
            <button
              type="button"
              onClick={() => {
                setEscrevendo(false)
                setErro('')
              }}
              disabled={gravando}
              className="rounded-xl border border-[#081b2c]/10 bg-white px-3.5 py-2 text-[11px] font-bold text-slate-500"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEscrevendo(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-[#b54708]/25 bg-[#fffaf2] px-3 py-2 text-[10px] font-extrabold text-[#93370d] transition hover:bg-[#fef3e2]"
        >
          <FilePlus2 className="h-3.5 w-3.5" /> Adicionar adendo
        </button>
      )}
    </div>
  )
}
