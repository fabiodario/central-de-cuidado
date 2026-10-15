/**
 * Bloquear um dia que ja tem consulta (25/09/2026).
 *
 * "Bloquear dia" so tira o dia da oferta do robo - as consultas ja marcadas
 * continuam marcadas, e ninguem e avisado. Quem bloqueia um dia porque o
 * medico nao vai atender pode achar que resolveu tudo, e as familias aparecem
 * na porta. Antes de bloquear um dia com consultas, a tela diz quantas e
 * quais, e lembra que cancelar (com aviso) e outra acao.
 */

type ConsultaDaAgenda = {
  startsAt: string
  status: string
  patientName: string
  contactName: string
}

/** Consultas ainda de pe naquele dia (YYYY-MM-DD, pelo relogio de Sao Paulo). */
export function consultasDeUmDia<C extends ConsultaDaAgenda>(consultas: C[], dia: string): C[] {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return consultas.filter(
    (c) => c.status === 'scheduled' && formato.format(new Date(c.startsAt)) === dia.slice(0, 10),
  )
}

/** Texto da pergunta, com ate cinco nomes. */
export function avisoDoBloqueio(consultas: ConsultaDaAgenda[]): { titulo: string; detalhe: string } {
  const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  const nomes = consultas
    .slice(0, 5)
    .map((c) => `${hora.format(new Date(c.startsAt))} ${c.patientName || c.contactName || 'sem nome'}`)
  const resto = consultas.length > 5 ? ` e mais ${consultas.length - 5}` : ''
  const uma = consultas.length === 1
  return {
    titulo: `Este dia tem ${consultas.length} ${uma ? 'consulta marcada' : 'consultas marcadas'}. Bloquear mesmo assim?`,
    detalhe:
      `${nomes.join(' · ')}${resto}.\n\n` +
      `Bloquear só impede novas marcações. ${uma ? 'Essa consulta continua marcada' : 'Essas consultas continuam marcadas'} ` +
      'e as famílias NÃO são avisadas. Se o médico não vai atender, cancele cada uma pela Agenda: o cancelamento avisa a família no WhatsApp.',
  }
}
