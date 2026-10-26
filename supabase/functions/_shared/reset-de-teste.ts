import { variantesDoTelefone } from './telefone-br.ts'
import { foraDaListaDeTeste, listaDeTeste } from './whatsapp-teste.ts'

/**
 * RESET de teste (25/10/2026, pedido do Edu): a equipe que testa o robo pelo
 * numero de teste escreve RESET e recomeca do zero, para testar de novo
 * depois de ter marcado uma consulta ou passado por uma urgencia.
 *
 * TEMPORARIO: sai antes do numero oficial (ver o LEIA-ME). Enquanto isso, so
 * vale com a clinica em modo teste (lista de teste em Preferencias, coluna
 * whatsapp_telefones_teste) e so para os celulares dessa lista. Na clinica de
 * verdade a lista e nula, e RESET e uma mensagem como outra qualquer.
 *
 * O que zera:
 *  - as consultas futuras marcadas por este telefone, que viram canceladas
 *    (o horario volta para a agenda, e o acompanhamento segue a agenda);
 *  - a conversa: etapa do robo, marcacao em andamento, etiqueta para a
 *    equipe, robo desligado na conversa, e o menu volta a aparecer;
 *  - os alertas de urgencia das ultimas 24 horas da clinica. Sem isso, por 6
 *    horas tudo o que o celular do Dr. Fabio ou da Dayane escreve vira
 *    resposta ao alerta (resposta-ao-alerta.ts), e eles nao conseguem testar
 *    como paciente. Em modo teste, todo alerta e de teste.
 *
 * O cadastro do paciente fica (o robo continua chamando pelo nome), e o
 * historico da conversa tambem, com uma nota dizendo o que o RESET fez.
 */

type Admin = { from: (tabela: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** So a palavra, sozinha: "reset", "RESET", "Reset!". */
export function pediuReset(texto: string | null | undefined): boolean {
  return /^\s*reset\s*[.!]*\s*$/i.test(String(texto ?? ''))
}

/** A clinica esta em modo teste e este celular esta na lista. Nunca lanca. */
export async function podeResetar(admin: Admin, clinicId: string, telefone: string): Promise<boolean> {
  const lista = await listaDeTeste(admin, clinicId)
  return lista !== null && lista.length > 0 && !foraDaListaDeTeste(lista, telefone)
}

export type ResultadoDoReset = { consultas: number; alertas: number; falhas: string[] }

const JANELA_DOS_ALERTAS_MS = 24 * 3600 * 1000

/**
 * Zera o que o teste deixou. Cada parte no seu try: uma que falha nao impede
 * as outras, e entra em `falhas`, que a resposta e a nota mostram.
 */
export async function resetarConversaDeTeste(
  admin: Admin,
  p: { clinicId: string; conversationId: string; telefone: string; agora: Date },
): Promise<ResultadoDoReset> {
  const r: ResultadoDoReset = { consultas: 0, alertas: 0, falhas: [] }
  const quando = p.agora.toISOString()

  try {
    const { data, error } = await admin
      .from('appointments')
      .update({ status: 'cancelled', cancelled_at: quando, cancellation_reason: 'RESET de teste' })
      .eq('clinic_id', p.clinicId)
      .eq('status', 'scheduled')
      .gte('starts_at', quando)
      .in('contact_phone', variantesDoTelefone(p.telefone))
      .select('id')
    if (error) throw error
    r.consultas = (data ?? []).length
  } catch (erro) {
    console.error('RESET de teste: nao cancelei as consultas', erro)
    r.falhas.push('consultas')
  }

  try {
    const { data, error } = await admin
      .from('alertas_de_urgencia')
      .delete()
      .eq('clinic_id', p.clinicId)
      .gte('criado_em', new Date(p.agora.getTime() - JANELA_DOS_ALERTAS_MS).toISOString())
      .select('id')
    if (error) throw error
    r.alertas = (data ?? []).length
  } catch (erro) {
    console.error('RESET de teste: nao encerrei os alertas', erro)
    r.falhas.push('alertas')
  }

  try {
    const { error } = await admin
      .from('whatsapp_conversations')
      .update({
        booking_state: null,
        booking_options: null,
        booking_unit_id: null,
        booking_patient_id: null,
        booking_replaces_id: null,
        booking_intake_id: null,
        booking_insurance: null,
        booking_modality: null,
        auto_replies_while_waiting: 0,
        menu_sent_at: null,
        needs_attention: false,
        attention_reason: null,
        robo_desligado_em: null,
        status: 'open',
      })
      .eq('id', p.conversationId)
    if (error) throw error
  } catch (erro) {
    console.error('RESET de teste: nao zerei a conversa', erro)
    r.falhas.push('conversa')
  }

  try {
    const { error } = await admin.from('conversation_notes').insert({
      clinic_id: p.clinicId,
      conversation_id: p.conversationId,
      texto: notaDoReset(r, p.telefone),
    })
    if (error) throw error
  } catch (erro) {
    console.error('RESET de teste: nota nao gravada', erro)
  }
  return r
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** A nota que a equipe ve na conversa. */
export function notaDoReset(r: ResultadoDoReset, telefone: string): string {
  const final = String(telefone ?? '').replace(/\D/g, '').slice(-4)
  return (
    `🔄 RESET de teste pelo celular final ${final}: ` +
    `${plural(r.consultas, 'consulta de teste cancelada', 'consultas de teste canceladas')}, ` +
    `${plural(r.alertas, 'alerta encerrado', 'alertas encerrados')}, conversa recomeçada.` +
    (r.falhas.length ? ` ⚠️ Não deu para zerar: ${r.falhas.join(', ')}.` : '')
  )
}

/** A resposta para quem escreveu RESET. */
export function respostaDoReset(r: ResultadoDoReset): string {
  return (
    '🔄 *RESET de teste*: a conversa recomeçou do zero.\n\n' +
    `• ${plural(r.consultas, 'consulta de teste cancelada', 'consultas de teste canceladas')}\n` +
    `• ${plural(r.alertas, 'alerta de urgência encerrado', 'alertas de urgência encerrados')}\n\n` +
    (r.falhas.length ? `⚠️ Não deu para zerar: ${r.falhas.join(', ')}. Avise o Edu.\n\n` : '') +
    'Pode testar de novo: mande *Oi*.'
  )
}
