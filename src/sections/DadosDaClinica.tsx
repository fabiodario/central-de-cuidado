import { useEffect, useState } from 'react'
import { Check, Save, Stethoscope } from 'lucide-react'
import { Ajuda } from '@/components/Ajuda'
import {
  getCurrentMembership,
  getDadosDaClinica,
  saveDadosDaClinica,
  type DadosDaClinica as Dados,
} from '@/lib/repository'

const campo =
  'mt-1.5 w-full rounded-[13px] border border-[#081b2c]/10 bg-[#fafaf8] px-3.5 py-2.5 text-xs font-semibold text-[#081b2c] outline-none transition placeholder:font-normal placeholder:text-slate-300 focus:border-[#2f7fc1] focus:bg-white focus:ring-4 focus:ring-[#2f7fc1]/10'

const vazio: Dados = {
  medicoNome: '',
  crm: '',
  telefone: '',
  telefone2: '',
  medicoEmail: '',
  medicoNascimento: '',
}

/**
 * Quem assina e de onde sai o documento.
 *
 * Nome, CRM, telefone e e-mail vao para a chancela do prontuario assinado, para
 * o cabecalho da receita e para o cadastro do medico na Memed. Ate 07/09/2026
 * o telefone era uma constante no codigo e os outros so mudavam por SQL: uma
 * clinica nova, ou um numero trocado, dependia de programador.
 */
export default function DadosDaClinica() {
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [dados, setDados] = useState<Dados>(vazio)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const membership = await getCurrentMembership()
        if (!membership || !vivo) return
        setClinicId(membership.clinicId)
        const atual = await getDadosDaClinica(membership.clinicId)
        if (vivo) setDados(atual)
      } catch (causa) {
        if (vivo) setErro(causa instanceof Error ? causa.message : 'Não foi possível carregar os dados.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  function set<K extends keyof Dados>(chave: K, valor: Dados[K]) {
    setDados((antes) => ({ ...antes, [chave]: valor }))
    setSalvo(false)
  }

  async function salvar() {
    if (!clinicId) return
    setSalvando(true)
    setErro('')
    try {
      await saveDadosDaClinica(clinicId, dados)
      setSalvo(true)
      window.setTimeout(() => setSalvo(false), 2500)
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="surface-card overflow-hidden rounded-[26px]">
      <div className="border-b border-[#081b2c]/[0.06] bg-gradient-to-r from-white to-[#f3f7f5] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#e4efeb] text-[#557f75]">
            <Stethoscope className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#557f75]">Identificação</p>
            <h2 className="mt-1 text-base font-extrabold tracking-[-0.03em] text-[#081b2c]">Médico e clínica</h2>
            <p className="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-slate-400">
              É o que sai no prontuário assinado, no cabeçalho da receita e no cadastro do médico na Memed. Os endereços ficam em Agenda → Unidades.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <label className="block">
          <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
            Nome do médico
            <Ajuda texto="Nome completo, como deve aparecer na chancela do prontuário assinado e na receita." />
          </span>
          <input className={campo} value={dados.medicoNome} onChange={(e) => set('medicoNome', e.target.value)} placeholder="Nome completo" />
        </label>
        <label className="block">
          <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
            CRM
            <Ajuda texto="Só o número. O estado (SP) vai junto no cadastro da Memed." />
          </span>
          <input className={campo} value={dados.crm} onChange={(e) => set('crm', e.target.value)} placeholder="85878" inputMode="numeric" />
        </label>
        <label className="block">
          <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
            Telefone da clínica
            <Ajuda texto="Telefone principal, impresso na receita. É ele que vai para o cadastro do médico na Memed, onde só cabe um número." />
          </span>
          <input className={campo} value={dados.telefone} onChange={(e) => set('telefone', e.target.value)} placeholder="(13) 0000-0000" inputMode="tel" />
        </label>
        <label className="block">
          <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
            Segundo telefone
            <Ajuda texto="Opcional: WhatsApp ou outro número de contato. Sai na receita junto do primeiro." />
          </span>
          <input className={campo} value={dados.telefone2} onChange={(e) => set('telefone2', e.target.value)} placeholder="(13) 90000-0000" inputMode="tel" />
        </label>
        <label className="block">
          <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
            E-mail do médico
            <Ajuda texto="Usado no cadastro do médico na Memed. Não é mostrado ao paciente." />
          </span>
          <input className={campo} value={dados.medicoEmail} onChange={(e) => set('medicoEmail', e.target.value)} placeholder="medico@clinica.com.br" inputMode="email" />
        </label>
        <label className="block">
          <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
            Nascimento do médico
            <Ajuda texto="A Memed exige a data de nascimento do prescritor (RDC 1000/25). Não aparece em documento nenhum." />
          </span>
          <input className={campo} type="date" value={dados.medicoNascimento} onChange={(e) => set('medicoNascimento', e.target.value)} />
        </label>

        <div className="flex flex-col justify-end gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] text-red-600">{erro}</p>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || !clinicId}
            className={`inline-flex items-center justify-center gap-2 rounded-[14px] px-5 py-3 text-xs font-extrabold text-white shadow-[0_10px_22px_rgba(8,27,44,.15)] transition disabled:opacity-60 ${
              salvo ? 'bg-[#6f9d91]' : 'bg-[#081b2c] hover:bg-[#102d47]'
            }`}
          >
            {salvo ? <Check className="h-4 w-4" strokeWidth={3} /> : <Save className="h-4 w-4 text-[#6aa8d9]" />}
            {salvando ? 'Salvando...' : salvo ? 'Dados salvos' : 'Salvar dados'}
          </button>
        </div>
      </div>
    </section>
  )
}
