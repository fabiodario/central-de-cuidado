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
 *  - o cadastro deste telefone (pedido do Edu, mesmo dia: "RESET que desvincula
 *    tudo e apaga o cadastro"), para a proxima marcacao pedir nome,
 *    nascimento e CPF de novo, como para quem escreve pela primeira vez. Vai
 *    junto o que e dele: prontuario, acompanhamentos, exames, receitas. As
 *    consultas da agenda e as mensagens ficam, sem o paciente.
 *
 * O historico da conversa fica, com uma nota dizendo o que o RESET fez.
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

export type ResultadoDoReset = { consultas: number; alertas: number; cadastros: number; arquivados: number; falhas: string[] }

const JANELA_DOS_ALERTAS_MS = 24 * 3600 * 1000

/**
 * Zera o que o teste deixou. Cada parte no seu try: uma que falha nao impede
 * as outras, e entra em `falhas`, que a resposta e a nota mostram.
 */
export async function resetarConversaDeTeste(
  admin: Admin,
  p: { clinicId: string; conversationId: string; telefone: string; agora: Date },
): Promise<ResultadoDoReset> {
  const r: ResultadoDoReset = { consultas: 0, alertas: 0, cadastros: 0, arquivados: 0, falhas: [] }
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
    const ids = await cadastrosDoTelefone(admin, p.clinicId, p.telefone)
    try {
      r.cadastros = await apagarCadastros(admin, p.clinicId, ids)
    } catch (erro) {
      // O banco protege o adendo do prontuario (gatilho
      // consultation_addenda_imutavel): cadastro com adendo nao se apaga.
      // Arquivado, o robo nao o acha mais (ele so busca os nao arquivados), e
      // a proxima marcacao pede tudo de novo; a ficha fica.
      console.warn('RESET de teste: nao apaguei o cadastro; arquivando', erro)
      r.arquivados = await arquivarCadastros(admin, p.clinicId, ids, quando)
    }
  } catch (erro) {
    console.error('RESET de teste: nao apaguei nem arquivei o cadastro', erro)
    r.falhas.push('cadastro')
  }

  try {
    const { error } = await admin
      .from('whatsapp_conversations')
      .update({
        patient_id: null,
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

/**
 * Os cadastros deste telefone, pelo mesmo campo que o robo usa para achar o
 * paciente (phone_digits, com e sem o 55 e o nono digito). Os arquivados
 * entram: tambem sao do teste.
 */
async function cadastrosDoTelefone(admin: Admin, clinicId: string, telefone: string): Promise<string[]> {
  const achados = (await etapa(
    admin.from('patients').select('id').eq('clinic_id', clinicId).in('phone_digits', variantesDoTelefone(telefone)),
  )) as { id: string }[]
  return achados.map((p) => p.id)
}

/** O recuo quando o cadastro nao se apaga: arquivar, que o robo nao acha. */
async function arquivarCadastros(admin: Admin, clinicId: string, ids: string[], quando: string): Promise<number> {
  if (!ids.length) return 0
  const arquivados = await etapa(
    admin.from('patients').update({ archived_at: quando }).eq('clinic_id', clinicId).in('id', ids).is('archived_at', null).select('id'),
  )
  return arquivados.length
}

/** Uma etapa do apagar: lanca no erro, que para as seguintes. */
async function etapa(consulta: PromiseLike<{ data?: unknown; error: unknown }>): Promise<unknown[]> {
  const { data, error } = await consulta
  if (error) throw error
  return Array.isArray(data) ? data : []
}

/**
 * Apaga o cadastro deste telefone e o que e dele. Na ordem que o banco exige
 * (as chaves estrangeiras de 25/10/2026): primeiro solta o que aponta para o
 * paciente e nao e dele (mensagens, conversas, consultas da agenda), apaga o
 * que e dele e trava (acompanhamentos, adendos, prontuario, exames) e so
 * entao o cadastro; rascunhos, receitas e pedidos de assinatura vao junto,
 * pelo proprio banco. Qualquer etapa que falha para as seguintes: o cadastro
 * nao some pela metade. Devolve quantos cadastros apagou.
 */
async function apagarCadastros(admin: Admin, clinicId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const acompanhamentos = ((await etapa(admin.from('followups').select('id').in('patient_id', ids))) as { id: string }[]).map((f) => f.id)

  await etapa(admin.from('whatsapp_messages').update({ patient_id: null }).eq('clinic_id', clinicId).in('patient_id', ids))
  if (acompanhamentos.length) {
    await etapa(admin.from('whatsapp_messages').update({ followup_id: null }).in('followup_id', acompanhamentos))
  }
  await etapa(admin.from('whatsapp_conversations').update({ patient_id: null, booking_patient_id: null }).eq('clinic_id', clinicId).in('patient_id', ids))
  await etapa(admin.from('appointments').update({ patient_id: null }).eq('clinic_id', clinicId).in('patient_id', ids))
  await etapa(admin.from('followups').delete().in('patient_id', ids))
  await etapa(admin.from('consultation_addenda').delete().in('patient_id', ids))
  await etapa(admin.from('consultations').delete().in('patient_id', ids))
  await etapa(admin.from('patient_exams').delete().in('patient_id', ids))
  const apagados = await etapa(admin.from('patients').delete().eq('clinic_id', clinicId).in('id', ids).select('id'))
  return apagados.length
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "1 cadastro apagado", e o arquivado quando houve (o que tinha adendo). */
function cadastrosDoResultado(r: ResultadoDoReset): string {
  return (
    plural(r.cadastros, 'cadastro apagado', 'cadastros apagados') +
    (r.arquivados ? `, ${plural(r.arquivados, 'arquivado', 'arquivados')} (tinha adendo no prontuário, que não se apaga)` : '')
  )
}

/** A nota que a equipe ve na conversa. */
export function notaDoReset(r: ResultadoDoReset, telefone: string): string {
  const final = String(telefone ?? '').replace(/\D/g, '').slice(-4)
  return (
    `🔄 RESET de teste pelo celular final ${final}: ` +
    `${plural(r.consultas, 'consulta de teste cancelada', 'consultas de teste canceladas')}, ` +
    `${plural(r.alertas, 'alerta encerrado', 'alertas encerrados')}, ` +
    `${cadastrosDoResultado(r)}, conversa recomeçada.` +
    (r.falhas.length ? ` ⚠️ Não deu para zerar: ${r.falhas.join(', ')}.` : '')
  )
}

/** A resposta para quem escreveu RESET. */
export function respostaDoReset(r: ResultadoDoReset): string {
  return (
    '🔄 *RESET de teste*: a conversa recomeçou do zero.\n\n' +
    `• ${plural(r.consultas, 'consulta de teste cancelada', 'consultas de teste canceladas')}\n` +
    `• ${plural(r.alertas, 'alerta de urgência encerrado', 'alertas de urgência encerrados')}\n` +
    `• ${cadastrosDoResultado(r)}` +
    (r.cadastros + r.arquivados ? ': na próxima marcação o robô pede nome, nascimento e CPF de novo' : '') +
    '\n\n' +
    (r.falhas.length ? `⚠️ Não deu para zerar: ${r.falhas.join(', ')}. Avise o Edu.\n\n` : '') +
    'Pode testar de novo: mande *Oi*.'
  )
}
