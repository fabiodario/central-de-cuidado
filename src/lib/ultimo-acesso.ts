/**
 * "Ultimo acesso" na lista Quem tem acesso (18/10/2026, pedido do Edu: ver
 * quem ainda usa o sistema antes de suspender alguem).
 *
 * A data vem do login do Supabase (migration 20261018120000): a mais nova
 * entre a ultima entrada e a ultima renovacao da sessao. Com o sistema aberto a
 * sessao se renova sozinha mais ou menos de hora em hora, entao a data pode
 * atrasar ate perto de uma hora.
 */

const FUSO = 'America/Sao_Paulo'

function dia(data: Date) {
  return data.toLocaleDateString('pt-BR', { timeZone: FUSO })
}

function hora(data: Date) {
  return data.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' })
}

/**
 * undefined = o banco ainda nao tem a funcao (ou ela falhou): nao mostra nada,
 * em vez de dizer "nunca entrou" de quem entrou. null = a pessoa nunca entrou.
 */
export function textoDoUltimoAcesso(valor: string | null | undefined, agora: Date = new Date()): string {
  if (valor === undefined) return ''
  if (valor === null) return 'Nunca entrou'
  const quando = new Date(valor)
  if (Number.isNaN(quando.getTime())) return ''
  // O dia de Sao Paulo, nao o de UTC: 22h41 de 17/10 aqui ja e 18/10 em UTC.
  if (dia(quando) === dia(agora)) return `Último acesso hoje, às ${hora(quando)}`
  if (dia(quando) === dia(new Date(agora.getTime() - 86_400_000))) return `Último acesso ontem, às ${hora(quando)}`
  const data = quando.toLocaleDateString('pt-BR', { timeZone: FUSO, day: 'numeric', month: 'short', year: 'numeric' })
  return `Último acesso em ${data}`
}
