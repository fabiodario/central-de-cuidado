import type { FollowupKey, Patient } from '@/types/patient'
import { FOLLOWUP_LABEL } from '@/types/patient'

export const FOLLOWUP_DAYS: Record<FollowupKey, number> = { d15: 15, d30: 30, m90: 90 }

/** Os tres contatos, na ordem em que acontecem. */
export const FOLLOWUP_KEYS: FollowupKey[] = ['d15', 'd30', 'm90']

export function todayISO(): string {
  const d = new Date()
  return toISO(d)
}

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return toISO(d)
}

export function dueDate(p: Patient, key: FollowupKey): string {
  return addDays(p.dataConsulta, FOLLOWUP_DAYS[key])
}

/** diferença entre hoje e `iso` (positivo = atrasado, negativo = futuro) */
export function daysFromToday(iso: string): number {
  const dueDate = new Date(iso + 'T12:00:00').getTime()
  const today = new Date(todayISO() + 'T12:00:00').getTime()
  return Math.round((today - dueDate) / 86400000)
}

export function fmtBR(iso: string | undefined): string {
  if (!iso) return '-'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function idade(nascimento: string): string {
  if (!nascimento) return '-'
  const n = new Date(nascimento + 'T12:00:00')
  const h = new Date()
  let anos = h.getFullYear() - n.getFullYear()
  let meses = h.getMonth() - n.getMonth()
  if (h.getDate() < n.getDate()) meses--
  if (meses < 0) {
    anos--
    meses += 12
  }
  if (anos < 1) return `${Math.max(meses, 0)}m`
  if (anos < 3) return `${anos}a ${meses}m`
  return `${anos} anos`
}

export function idadeAnos(nascimento: string): number {
  if (!nascimento) return 0
  const n = new Date(nascimento + 'T12:00:00')
  const h = new Date()
  let anos = h.getFullYear() - n.getFullYear()
  const meses = h.getMonth() - n.getMonth()
  if (meses < 0 || (meses === 0 && h.getDate() < n.getDate())) anos--
  return Math.max(anos, 0)
}

export function firstName(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome
}

export function pronome(p: Patient): string {
  return p.sexo === 'F' ? 'ela' : 'ele'
}

export function buildMessage(template: string, p: Patient): string {
  return template
    .replaceAll('{nome}', firstName(p.nome))
    .replaceAll('{pronome}', pronome(p))
}

export function waLink(telefone: string, mensagem: string): string {
  const digits = telefone.replace(/\D/g, '')
  const withCountry = digits.startsWith('55') && digits.length > 11 ? digits : `55${digits}`
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(mensagem)}`
}

/**
 * 'aguardando' (25/09/2026): a mensagem ja saiu e falta a equipe concluir.
 * Antes o grupo vinha so da data prevista, e acompanhamento ENVIADO no dia
 * certo aparecia em "Atrasados" no dia seguinte - a equipe lia "nao saiu"
 * quando o que faltava era so clicar em Concluir.
 */
export type FollowupUrgencia = 'atrasado' | 'hoje' | 'proximo' | 'futuro' | 'aguardando'

/** O que o WhatsApp informou sobre a mensagem do acompanhamento. */
export type SituacaoDoEnvio = 'lida' | 'entregue' | 'enviada' | 'falhou'

const PESO_DA_SITUACAO: Record<string, number> = { read: 4, delivered: 3, sent: 2, accepted: 1, queued: 1 }

/**
 * A melhor noticia entre as mensagens do acompanhamento: lida vence entregue,
 * que vence enviada. "Falhou" so quando nenhuma chegou - uma reenviada com
 * sucesso depois de uma falha nao pode continuar marcada como falha.
 */
export function situacaoDoEnvio(statuses: string[]): SituacaoDoEnvio | null {
  if (!statuses.length) return null
  const melhor = Math.max(0, ...statuses.map((s) => PESO_DA_SITUACAO[s] ?? 0))
  if (melhor >= 4) return 'lida'
  if (melhor === 3) return 'entregue'
  if (melhor >= 1) return 'enviada'
  return statuses.includes('failed') ? 'falhou' : null
}

export interface FollowupItem {
  patient: Patient
  key: FollowupKey
  label: string
  due: string
  dias: number // positivo = atrasado, 0 = hoje, negativo = futuro
  urgencia: FollowupUrgencia
}

/** Lista follow-ups pendentes ou enviados (não concluídos), ordenados por data */
export function pendingFollowups(patients: Patient[]): FollowupItem[] {
  const items: FollowupItem[] = []
  for (const p of patients) {
    for (const key of FOLLOWUP_KEYS) {
      const st = p.followups[key]
      if (st.status === 'concluido') continue
      const due = dueDate(p, key)
      const dias = daysFromToday(due)
      let urgencia: FollowupUrgencia = 'futuro'
      if (st.status === 'enviado') urgencia = 'aguardando'
      else if (dias > 0) urgencia = 'atrasado'
      else if (dias === 0) urgencia = 'hoje'
      else if (dias >= -7) urgencia = 'proximo'
      items.push({ patient: p, key, label: FOLLOWUP_LABEL[key], due, dias, urgencia })
    }
  }
  return items.sort((a, b) => b.dias - a.dias)
}

export function dueCount(patients: Patient[]): number {
  return pendingFollowups(patients).filter(
    (i) => i.urgencia === 'atrasado' || i.urgencia === 'hoje',
  ).length
}
