import { useEffect, useState } from 'react'
import { CalendarPlus, Loader2, X } from 'lucide-react'
import {
  createAppointment,
  getSchedulePreferences,
  listUnits,
  type Unit,
} from '@/lib/repository'
import { horariosLivresEntre } from '@/lib/prontuario-extra'
import { agruparPorDia, janelaDoRetorno, PRAZOS_DE_RETORNO, prazoDoRetorno, somarDias } from '@/lib/retorno'
import { hojeEmSaoPaulo } from '@/lib/dados-para-memed'

/**
 * Marcar o retorno sem sair do prontuario (25/09/2026).
 *
 * Abre dentro do cartao da consulta, e nao numa janela por cima: o prontuario
 * ja e um painel lateral, e janela sobre painel confunde o foco do teclado.
 *
 * O prazo vem do que o medico escreveu no campo Retorno ("em 30 dias"). A
 * busca olha alguns dias antes e dez depois da data alvo, na unidade da
 * consulta, e oferece os horarios livres. A consulta entra na Agenda como
 * marcada pela equipe, e o lembrete da vespera sai como o de qualquer outra.
 */

const DIA_DA_SEMANA = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

function diaLegivel(iso: string) {
  return DIA_DA_SEMANA.format(new Date(`${iso}T12:00:00Z`)).replace('.', '')
}

export function MarcarRetorno({
  clinicId,
  patientId,
  unidadeDaConsulta,
  textoDoRetorno,
  onFechar,
  onMarcado,
}: {
  clinicId: string | null
  patientId: string
  unidadeDaConsulta: string
  textoDoRetorno: string
  onFechar: () => void
  onMarcado: (mensagem: string) => void
}) {
  const hoje = hojeEmSaoPaulo()
  const prazoEscrito = prazoDoRetorno(textoDoRetorno)
  const [prazo, setPrazo] = useState<number>(prazoEscrito ?? 30)
  const [unidades, setUnidades] = useState<Unit[]>([])
  const [unidadeId, setUnidadeId] = useState('')
  const [duracao, setDuracao] = useState(40)
  const [horarios, setHorarios] = useState<string[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const [marcando, setMarcando] = useState(false)
  const [erro, setErro] = useState('')

  const alvo = somarDias(hoje, prazo)

  useEffect(() => {
    if (!clinicId) return
    let vivo = true
    void (async () => {
      try {
        const [lista, preferencias] = await Promise.all([listUnits(clinicId), getSchedulePreferences(clinicId)])
        if (!vivo) return
        setUnidades(lista)
        setDuracao(preferencias.slotMinutes)
        const nome = unidadeDaConsulta.trim().toLowerCase()
        const daConsulta = lista.find((u) => u.name.trim().toLowerCase() === nome)
        setUnidadeId(daConsulta?.id ?? lista[0]?.id ?? '')
      } catch (causa) {
        if (vivo) setErro(causa instanceof Error ? causa.message : 'Não consegui carregar as unidades.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [clinicId, unidadeDaConsulta])

  useEffect(() => {
    if (!unidadeId) return
    let vivo = true
    const { de, ate } = janelaDoRetorno(alvo, hoje)
    setBuscando(true)
    setEscolhido(null)
    horariosLivresEntre(unidadeId, de, ate)
      .then((lista) => {
        if (vivo) {
          setHorarios(lista)
          setErro('')
        }
      })
      .catch((causa) => {
        if (vivo) {
          setHorarios([])
          setErro(causa instanceof Error ? causa.message : 'Não consegui buscar os horários.')
        }
      })
      .finally(() => {
        if (vivo) setBuscando(false)
      })
    return () => {
      vivo = false
    }
  }, [unidadeId, alvo, hoje])

  async function confirmar() {
    if (!clinicId || !unidadeId || !escolhido) return
    setMarcando(true)
    setErro('')
    try {
      await createAppointment(clinicId, unidadeId, patientId, escolhido, duracao, 'Retorno marcado pelo prontuário')
      const unidade = unidades.find((u) => u.id === unidadeId)?.name ?? ''
      const dia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(escolhido))
      onMarcado(`Retorno marcado para ${dia} às ${HORA.format(new Date(escolhido))}${unidade ? `, ${unidade}` : ''}. Está na Agenda e o lembrete da véspera sai sozinho.`)
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'O retorno não foi marcado.')
    } finally {
      setMarcando(false)
    }
  }

  const grupos = agruparPorDia(horarios ?? [])

  return (
    <div className="mt-3 rounded-[16px] border border-[#1f4f78]/25 bg-[#f4f8fc] p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[12px] font-extrabold text-[#16456b]">
          <CalendarPlus className="h-4 w-4" /> Marcar retorno
        </p>
        <button type="button" onClick={onFechar} className="rounded-lg p-1 text-slate-400 hover:text-slate-600" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {PRAZOS_DE_RETORNO.map((opcao) => (
          <button
            key={opcao.dias}
            type="button"
            onClick={() => setPrazo(opcao.dias)}
            className={`rounded-xl px-3 py-1.5 text-[11px] font-extrabold transition ${
              prazo === opcao.dias ? 'bg-[#1f4f78] text-white' : 'border border-[#081b2c]/10 bg-white text-slate-600'
            }`}
          >
            {opcao.rotulo}
          </button>
        ))}
        {prazoEscrito && !PRAZOS_DE_RETORNO.some((o) => o.dias === prazoEscrito) && (
          <button
            type="button"
            onClick={() => setPrazo(prazoEscrito)}
            className={`rounded-xl px-3 py-1.5 text-[11px] font-extrabold ${
              prazo === prazoEscrito ? 'bg-[#1f4f78] text-white' : 'border border-[#081b2c]/10 bg-white text-slate-600'
            }`}
          >
            {prazoEscrito} dias
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] font-semibold text-slate-500">
        {prazoEscrito ? 'Prazo tirado do campo Retorno. ' : ''}
        Data alvo: <b className="text-[#081b2c]">{diaLegivel(alvo)}</b>. Mostrando horários livres de alguns dias antes até 10 dias depois.
      </p>

      {unidades.length > 1 && (
        <label className="mt-3 block text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
          Unidade
          <select
            value={unidadeId}
            onChange={(evento) => setUnidadeId(evento.target.value)}
            className="mt-1 block w-full rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-[12px] font-semibold normal-case tracking-normal text-[#081b2c]"
          >
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-3">
        {buscando ? (
          <p className="flex items-center gap-2 text-[11px] font-semibold text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procurando horários...
          </p>
        ) : horarios && horarios.length === 0 && !erro ? (
          <p className="text-[11px] font-semibold text-[#93370d]">
            Nenhum horário livre nessa janela. Tente outro prazo ou outra unidade, ou marque pela Agenda.
          </p>
        ) : (
          <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
            {grupos.map((grupo) => (
              <div key={grupo.dia}>
                <p className={`text-[10px] font-extrabold uppercase tracking-wide ${grupo.dia === alvo ? 'text-[#1f4f78]' : 'text-slate-400'}`}>
                  {diaLegivel(grupo.dia)}
                  {grupo.dia === alvo ? ' · data alvo' : ''}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {grupo.horarios.map((inicio) => (
                    <button
                      key={inicio}
                      type="button"
                      onClick={() => setEscolhido(inicio)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                        escolhido === inicio
                          ? 'bg-[#081b2c] text-white'
                          : 'border border-[#081b2c]/10 bg-white text-[#081b2c] hover:border-[#1f4f78]/40'
                      }`}
                    >
                      {HORA.format(new Date(inicio))}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {erro && <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">{erro}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void confirmar()}
          disabled={!escolhido || marcando}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#081b2c] px-3.5 py-2 text-[11px] font-extrabold text-white disabled:opacity-40"
        >
          {marcando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {escolhido
            ? `Marcar ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(escolhido))} às ${HORA.format(new Date(escolhido))}`
            : 'Escolha um horário'}
        </button>
      </div>
    </div>
  )
}
