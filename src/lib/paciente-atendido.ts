import { diaEmSaoPaulo } from '../../supabase/functions/_shared/consulta-aconteceu.ts'

/**
 * Quem ja foi atendido, e quem so marcou (25/10/2026, vindo do sistema do Dr.
 * Marcello no mesmo dia).
 *
 * A ficha de quem marca pelo robo nasce na hora do agendamento. Ate aqui ela
 * entrava na lista de Pacientes, no painel e no acompanhamento como se a
 * crianca ja tivesse passado pelo medico - e 9 delas nunca vieram. O Edu pediu
 * duas listas, "atendidos" e "pre-agendados", e o painel contando so os
 * atendidos.
 *
 * Atendido e quem tem sinal de que veio:
 *  - presenca ("Chegou") em algum horario da agenda ligado a ficha;
 *  - ou prontuario escrito (so o medico enxerga; a recepcao fica com os outros
 *    dois sinais, e o prontuario ja marca a presenca sozinho);
 *  - ou a data da consulta ja passou e a agenda nao tem horario dele naquele
 *    dia: e a ficha cadastrada a mao depois do atendimento, o uso de antes do
 *    robo, ou consulta marcada pelo nome, sem ligar a ficha.
 * O resto e pre-agendado: marcou e ainda nao veio, ou cancelou, ou faltou.
 */
export type HorarioDoPaciente = { patientId: string; startsAt: string; status: string }

export function pacientesAtendidos(
  pacientes: readonly { id: string; dataConsulta: string }[],
  agenda: readonly HorarioDoPaciente[],
  comProntuario: ReadonlySet<string>,
  hoje: string,
): Set<string> {
  const atendidos = new Set<string>()
  const diasNaAgenda = new Map<string, Set<string>>()
  for (const horario of agenda) {
    if (horario.status === 'attended') atendidos.add(horario.patientId)
    const dias = diasNaAgenda.get(horario.patientId) ?? new Set<string>()
    dias.add(diaEmSaoPaulo(horario.startsAt))
    diasNaAgenda.set(horario.patientId, dias)
  }
  for (const paciente of pacientes) {
    if (comProntuario.has(paciente.id)) atendidos.add(paciente.id)
    const dia = paciente.dataConsulta
    if (dia && dia <= hoje && !diasNaAgenda.get(paciente.id)?.has(dia)) atendidos.add(paciente.id)
  }
  return atendidos
}
