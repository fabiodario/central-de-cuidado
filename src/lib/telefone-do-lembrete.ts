/**
 * Para que telefone vai o lembrete da vespera, visto da Agenda (21/10/2026).
 *
 * A mesma regra do appointment-reminders: o telefone do cadastro do paciente
 * e, sem ele, o de quem marcou a consulta.
 *
 * Ate aqui a Agenda so olhava o cadastro, e o cadastro vinha da lista de
 * pacientes carregada quando a tela abriu. A Maria marcou pelo WhatsApp, o robo
 * criou o cadastro dela com o telefone, e a Agenda - aberta antes - nao achou o
 * paciente na lista e mostrou "Sem telefone: nao recebe lembrete". O Edu: "como
 * sem telefone? ela agendou pelo whatsapp, ta la o telefone".
 */
export function telefoneDoLembrete(
  consulta: { patientId: string | null; contactPhone: string | null },
  pacientes: readonly { id: string; telefone?: string | null }[],
): string {
  const doCadastro = consulta.patientId
    ? (pacientes.find((p) => p.id === consulta.patientId)?.telefone ?? '').trim()
    : ''
  return doCadastro || (consulta.contactPhone ?? '').trim()
}
