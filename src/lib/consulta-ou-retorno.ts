import {
  retornoPadrao,
  sugestaoDeVisita,
  type TipoDeVisita,
  type Visita,
} from '../../supabase/functions/_shared/prazo-do-retorno.ts'
import type { Consultation, ConsultationDraft } from '@/types/patient'

/**
 * A ponte entre o prontuario e a regra do retorno (26/10/2026, vinda do
 * sistema do Dr. Marcello). A regra mora em
 * supabase/functions/_shared/prazo-do-retorno.ts, a mesma do robo.
 */

export function comoVisita(consulta: Pick<Consultation, 'data' | 'visita' | 'retornoAte'>): Visita {
  return { data: consulta.data, visita: consulta.visita || null, retornoAte: consulta.retornoAte || null }
}

/**
 * O que vai para o banco ao salvar: a escolha do medico ou, sem escolha, a
 * sugestao que a tela estava mostrando - ele viu e salvou. O tipo clinico
 * (encounter_type) acompanha: la, o padrao "Retorno" fixo e que causou a
 * confusao do prazo. Teleconsulta e "outro" deixam de ser tipo: a agenda ja
 * sabe a modalidade.
 */
export function visitaParaGravar(
  form: Pick<ConsultationDraft, 'data' | 'visita' | 'retornoAte'>,
  outras: readonly Pick<Consultation, 'data' | 'visita' | 'retornoAte'>[],
): Pick<ConsultationDraft, 'visita' | 'retornoAte' | 'tipo'> {
  const visita: TipoDeVisita = form.visita || sugestaoDeVisita(outras.map(comoVisita), form.data).tipo
  if (visita === 'retorno') return { visita, retornoAte: '', tipo: 'return' }
  return { visita, retornoAte: form.retornoAte || retornoPadrao(form.data), tipo: 'initial' }
}
