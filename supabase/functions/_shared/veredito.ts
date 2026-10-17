/**
 * O veredito do medico sobre uma urgencia (17/10/2026, pedido do Edu).
 *
 * A urgencia (da regra ou do Jev) toca o celular do Dr. Fabio e da Dayane, e o
 * paciente ja recebeu na hora a orientacao de procurar atendimento. Aqui volta
 * a resposta de quem atende: "e urgente" ou "nao e urgente". O robo manda ao
 * paciente um texto fixo, em nome do medico, e o veredito fica registrado em
 * whatsapp_bot_events para comparar com a nota do Jev e com o que a regra fez.
 *
 * O paciente nunca espera este clique: e confirmacao ou alivio depois da
 * orientacao de seguranca. Os textos falam em nome do medico; mudar a redacao
 * e decisao dele.
 */
import { quemAtende } from './quem-atende.ts'

export type Veredito = 'urgente' | 'nao_urgente'

/** Conversas em que o veredito faz sentido: as acesas como urgencia. */
export const MOTIVOS_COM_VEREDITO = ['urgencia', 'sangramento']

export function vereditoValido(valor: unknown): Veredito | null {
  return valor === 'urgente' || valor === 'nao_urgente' ? valor : null
}

/** O texto que vai ao paciente, com o nome do medico da clinica. */
export function textoDoVeredito(veredito: Veredito, clinicId: string | null | undefined): string {
  const medico = quemAtende(clinicId).O
  return veredito === 'urgente'
    ? `🚨 ${medico} viu a sua mensagem e orienta: *procure o pronto-socorro agora*, sem esperar a consulta.`
    : `💙 ${medico} viu a sua mensagem e, pelo que você contou, não parece urgência. A nossa equipe continua com você por aqui.`
}

/**
 * Como a conversa fica depois do veredito. Urgente: o medico ja orientou, e a
 * conversa sai da lista como qualquer resposta da equipe. Nao urgente: a
 * mensagem promete a equipe, entao a conversa fica acesa como "atendente".
 */
export function conversaDepoisDoVeredito(veredito: Veredito): { needs_attention: boolean; attention_reason: string | null } {
  return veredito === 'urgente'
    ? { needs_attention: false, attention_reason: null }
    : { needs_attention: true, attention_reason: 'atendente' }
}

/** O registro em whatsapp_bot_events: so o veredito e o motivo de antes, nunca o texto do paciente. */
export function detalheDoVeredito(veredito: Veredito, motivoAntes: string | null | undefined): string {
  return `${veredito} motivo=${motivoAntes ?? 'nenhum'}`.slice(0, 120)
}
