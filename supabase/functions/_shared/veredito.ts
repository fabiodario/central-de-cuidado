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

/**
 * O texto que vai ao paciente, com o nome do medico da clinica. E o mesmo pela
 * tela de Respostas e pelo WhatsApp do medico (o botao "Pode aguardar" do
 * alerta e o "nao e urgente" daqui), para os dois caminhos serem uma coisa so.
 *
 * Nao urgente ganhou o botao de marcar e o "se piorar" (17/10/2026, junto com o
 * alerta no WhatsApp): quem ouve que pode aguardar a consulta precisa do caminho
 * para marcar, e de saber que pode voltar a escrever.
 */
export function textoDoVeredito(veredito: Veredito, clinicId: string | null | undefined): string {
  const medico = quemAtende(clinicId).O
  return veredito === 'urgente'
    ? `🚨 ${medico} viu a sua mensagem e orienta: *procure o pronto-socorro agora*, sem esperar a consulta.`
    : `💙 ${medico} viu a sua mensagem e, pelo que você contou, não parece urgência. A nossa equipe continua com você por aqui.\n\n` +
        'Se quiser, toque em *Marcar uma consulta* para ver os horários mais próximos. Se piorar, é só escrever aqui.'
}

/**
 * Os botoes que vao junto do texto. O id e o mesmo do robo (MARCAR_AGORA em
 * atendimento.ts), que comeca o agendamento mesmo com a conversa na fila da
 * equipe. Tipo proprio, e nao o Toque do motor: esta peca roda na tela, e
 * importar atendimento.ts levaria o robo inteiro para o navegador.
 */
export function botoesDoVeredito(veredito: Veredito): { id: string; titulo: string }[] | undefined {
  return veredito === 'nao_urgente' ? [{ id: 'MARCAR_AGORA', titulo: 'Marcar uma consulta' }] : undefined
}

/**
 * Como a conversa fica depois do veredito. Urgente: o medico ja orientou, e a
 * conversa sai da lista como qualquer resposta da equipe. Nao urgente: a
 * mensagem promete a equipe, entao a conversa fica acesa como "atendente".
 *
 * Nao urgente tambem poe o robo na etapa da fila da equipe (17/10/2026): e nela
 * que o toque em "Marcar uma consulta" comeca o agendamento mesmo com a equipe
 * conversando. Urgencia no meio de um agendamento deixa a etapa do agendamento,
 * e o toque caia no "nao entendi" da etapa.
 */
export function conversaDepoisDoVeredito(veredito: Veredito): {
  needs_attention: boolean
  attention_reason: string | null
  booking_state?: string
  booking_options?: null
} {
  return veredito === 'urgente'
    ? { needs_attention: false, attention_reason: null }
    : { needs_attention: true, attention_reason: 'atendente', booking_state: 'atendente', booking_options: null }
}

/** O registro em whatsapp_bot_events: so o veredito e o motivo de antes, nunca o texto do paciente. */
export function detalheDoVeredito(veredito: Veredito, motivoAntes: string | null | undefined): string {
  return `${veredito} motivo=${motivoAntes ?? 'nenhum'}`.slice(0, 120)
}
