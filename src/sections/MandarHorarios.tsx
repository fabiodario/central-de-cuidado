import { useState } from 'react'
import { CalendarClock, X } from 'lucide-react'
import type { Lugar } from '../../supabase/functions/_shared/campos-do-texto.ts'
import type { PedidoDeHorarios } from '@/lib/repository'
import { publicoDaClinica } from '@/lib/publico'

/**
 * Painel do botao "Mandar horarios" (14/10/2026).
 *
 * A secretaria escolhe a unidade e, se quiser, os dias; o robo manda a lista
 * tocavel e marca quando a familia toca. Ver oferecerHorarios em
 * supabase/functions/_shared/atendimento.ts.
 *
 * Os quatro jeitos de escolher os dias vieram das conversas de 13 e 14/10:
 * "pra quando tem em Santos?" (agenda aberta), retorno ate o dia 25/10 (ate
 * uma data), "dia 27/11" (um dia so, alem da agenda aberta) e "so na semana
 * que vem" (entre datas).
 */
type Modo = 'aberta' | 'ate' | 'dia' | 'entre'

const MODOS: { id: Modo; rotulo: string }[] = [
  { id: 'aberta', rotulo: 'Próximos dias' },
  { id: 'ate', rotulo: 'Até uma data' },
  { id: 'dia', rotulo: 'Um dia' },
  { id: 'entre', rotulo: 'Entre datas' },
]

const campo =
  'rounded-xl border border-[#081b2c]/10 bg-white px-2.5 py-1.5 text-[11px] text-[#081b2c] outline-none focus:border-[#2f7fc1]'

function hojeEmSaoPaulo() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

export default function MandarHorarios({
  lugares,
  enviando,
  erro,
  pacientes,
  onEnviar,
  onFechar,
}: {
  lugares: Lugar[]
  enviando: boolean
  /** Recusa do servidor (sem horario no periodo, janela fechada...). */
  erro: string
  /** Irmaos no mesmo telefone: a equipe escolhe de quem e a consulta. */
  pacientes: { id: string; nome: string }[] | null
  onEnviar: (pedido: PedidoDeHorarios) => void
  onFechar: () => void
}) {
  // Quem recebe a lista: o paciente no otorrino, a familia na pediatria
  // (15/10/2026, ver publico.ts).
  const geral = publicoDaClinica() === 'geral'
  const [unidade, setUnidade] = useState(lugares[0]?.id ?? '')
  const [modo, setModo] = useState<Modo>('aberta')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [pacienteId, setPacienteId] = useState('')
  const hoje = hojeEmSaoPaulo()

  const pedido: PedidoDeHorarios = {
    unidade,
    de: modo === 'dia' || modo === 'entre' ? de || null : null,
    ate: modo === 'dia' ? de || null : modo === 'ate' || modo === 'entre' ? ate || null : null,
    pacienteId: pacienteId || null,
  }
  const falta = !unidade
    ? 'Escolha a unidade.'
    : modo === 'dia' && !de
      ? 'Escolha o dia.'
      : modo === 'ate' && !ate
        ? 'Escolha até que dia.'
        : modo === 'entre' && (!de || !ate)
          ? 'Escolha as duas datas.'
          : modo === 'entre' && ate < de
            ? 'A data final vem antes da inicial.'
            : pacientes && !pacienteId
              ? 'Escolha de quem é a consulta.'
              : ''

  return (
    <div className="mt-2 rounded-[14px] border border-[#2f7fc1]/25 bg-[#f6faff] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#081b2c]">
          <CalendarClock className="h-3.5 w-3.5 text-[#2f7fc1]" />
          Mandar horários livres
        </p>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-lg p-1 text-slate-400 hover:bg-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
        {geral ? 'O paciente' : 'A família'} recebe a lista e toca no dia e no horário. O robô marca na hora, pede o cadastro se faltar e
        manda a confirmação. A consulta aparece na Agenda.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <select value={unidade} onChange={(e) => setUnidade(e.target.value)} className={`${campo} min-w-[180px]`}>
          {lugares.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>
        <div className="inline-flex flex-wrap rounded-xl bg-white p-0.5 ring-1 ring-[#081b2c]/10">
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModo(m.id)}
              className={`rounded-[10px] px-2.5 py-1 text-[10px] font-bold transition ${
                modo === m.id ? 'bg-[#081b2c] text-white' : 'text-slate-500 hover:text-[#081b2c]'
              }`}
            >
              {m.rotulo}
            </button>
          ))}
        </div>
      </div>

      {modo !== 'aberta' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500">
          {(modo === 'dia' || modo === 'entre') && (
            <label className="inline-flex items-center gap-1.5">
              {modo === 'dia' ? 'Dia' : 'De'}
              <input type="date" min={hoje} value={de} onChange={(e) => setDe(e.target.value)} className={campo} />
            </label>
          )}
          {(modo === 'ate' || modo === 'entre') && (
            <label className="inline-flex items-center gap-1.5">
              Até
              <input type="date" min={de || hoje} value={ate} onChange={(e) => setAte(e.target.value)} className={campo} />
            </label>
          )}
          <span className="font-semibold text-slate-400">Pode ser além da agenda aberta, até 6 meses.</span>
        </div>
      )}

      {pacientes && (
        <label className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-[#93370d]">
          Há mais de um paciente neste telefone. A consulta é de:
          <select value={pacienteId} onChange={(e) => setPacienteId(e.target.value)} className={campo}>
            <option value="">Escolha…</option>
            {pacientes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      {erro && <p className="mt-2 text-[10px] font-bold text-red-600">{erro}</p>}

      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        {falta && <span className="mr-auto text-[10px] font-semibold text-slate-400">{falta}</span>}
        <button
          type="button"
          disabled={Boolean(falta) || enviando}
          onClick={() => onEnviar(pedido)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#081b2c] px-3.5 py-2 text-[10px] font-extrabold text-white transition hover:bg-[#102d47] disabled:opacity-40"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          {enviando ? 'Enviando...' : 'Mandar horários'}
        </button>
      </div>
    </div>
  )
}
