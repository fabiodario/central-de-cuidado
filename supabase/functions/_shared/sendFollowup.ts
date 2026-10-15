import { adminClient, formatDateBR, toBrazilE164 } from './whatsapp.ts'
import { parametrosDoAcompanhamento, textoDoModelo } from './modelos.ts'
import { variantesDoTelefone } from './telefone-br.ts'
import { chaveDoWhatsApp, foraDaListaDeTeste, listaDeTeste } from './whatsapp-teste.ts'

/**
 * Envio de um acompanhamento pelo WhatsApp.
 *
 * Esta logica vive fora das funcoes de borda porque dois caminhos precisam dela:
 *  - whatsapp-send: disparo manual, com sessao de usuario e checagem de RLS.
 *  - whatsapp-dispatch: disparo automatico diario, sem usuario nenhum.
 *
 * Manter uma copia so evita que os dois caminhos divirjam com o tempo.
 */

export type SendResult =
  | { ok: true; alreadySent?: boolean; message?: unknown }
  | { ok: false; status: number; error: string; code?: string; details?: string }

type SendOptions = {
  /** Registra o consentimento em nome da equipe quando ela confirma na tela. */
  consentConfirmed?: boolean
  /**
   * No envio automatico nao ha quem confirme consentimento. Nesse modo o
   * paciente sem opt-in e pulado em vez de gerar erro - nunca presumimos
   * consentimento em nome de ninguem.
   */
  requireExistingConsent?: boolean
  /**
   * O que fica gravado em whatsapp_consent_source. Existe para o registro ser
   * honesto sobre de onde veio a autorizacao, em vez de dizer sempre a mesma
   * coisa para origens diferentes.
   */
  consentSource?: string
}

export async function sendFollowup(followupId: string, options: SendOptions = {}): Promise<SendResult> {
  const admin = adminClient()

  const { data: followup, error: followupError } = await admin
    .from('followups')
    .select('id,clinic_id,patient_id,consultation_id,followup_key,due_date,archived_at')
    .eq('id', followupId)
    .maybeSingle()

  if (followupError) {
    console.error('Admin lookup failed', followupError)
    return {
      ok: false,
      status: 500,
      error: 'Erro ao ler o acompanhamento no banco.',
      code: 'ADMIN_LOOKUP_FAILED',
      details: followupError.message,
    }
  }
  if (!followup) {
    return {
      ok: false,
      status: 500,
      error: 'O acompanhamento não foi lido pelo servidor. Verifique a chave de serviço.',
      code: 'ADMIN_ROW_MISSING',
    }
  }
  if (followup.archived_at) {
    return {
      ok: false,
      status: 409,
      error: 'Este acompanhamento foi arquivado. Atualize a página para ver a lista atual.',
      code: 'ARCHIVED',
    }
  }

  // Trava de reenvio: se ja existe mensagem de saida nao falhada, nao manda de novo.
  const { data: previous } = await admin
    .from('whatsapp_messages')
    .select('id,external_message_id,status')
    .eq('followup_id', followup.id)
    .eq('direction', 'outbound')
    .neq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (previous) return { ok: true, alreadySent: true, message: previous }

  const [{ data: patient }, { data: consultation }, { data: settings }] = await Promise.all([
    admin
      .from('patients')
      .select('id,name,phone,whatsapp_opt_in_at,whatsapp_opt_out_at')
      .eq('id', followup.patient_id)
      .single(),
    admin
      .from('consultations')
      .select('consultation_date')
      .eq('id', followup.consultation_id)
      .single(),
    admin
      .from('clinic_settings')
      .select('whatsapp_phone_number_id,whatsapp_template_name,whatsapp_template_language')
      .eq('clinic_id', followup.clinic_id)
      .single(),
  ])

  if (!patient?.phone || !consultation || !settings?.whatsapp_phone_number_id) {
    return { ok: false, status: 409, error: 'Cadastro ou configuração do WhatsApp incompleta.', code: 'INCOMPLETE' }
  }
  if (patient.whatsapp_opt_out_at) {
    return { ok: false, status: 409, error: 'Este contato pediu para não receber mensagens.', code: 'OPTED_OUT' }
  }
  // Saiu so do acompanhamento (15/10/2026): coluna nova, lida a parte. Sem a
  // coluna, segue como antes - quem pediu tudo continua barrado acima.
  {
    const { data: soAcompanhamento, error: semColuna } = await admin
      .from('patients')
      .select('followup_opt_out_at')
      .eq('id', patient.id)
      .maybeSingle()
    if (semColuna) console.warn('Sem patients.followup_opt_out_at; seguindo sem essa trava', semColuna)
    if ((soAcompanhamento as { followup_opt_out_at?: string | null } | null)?.followup_opt_out_at) {
      return { ok: false, status: 409, error: 'Este paciente pediu para não receber acompanhamento.', code: 'OPTED_OUT' }
    }
  }
  // Clinica de teste (27/09/2026): fora dos celulares cadastrados no numero de
  // teste da Meta, nao tenta. Volta como TEST_LIST, que o disparo conta como
  // "pulado" e nao como falha.
  if (foraDaListaDeTeste(await listaDeTeste(admin, followup.clinic_id), patient.phone)) {
    return {
      ok: false,
      status: 409,
      error: 'Clínica em modo teste: este telefone não está na lista de teste do WhatsApp.',
      code: 'TEST_LIST',
    }
  }
  if (!patient.whatsapp_opt_in_at) {
    if (options.requireExistingConsent) {
      return { ok: false, status: 409, error: 'Paciente ainda sem consentimento registrado.', code: 'CONSENT_MISSING' }
    }
    if (!options.consentConfirmed) {
      return {
        ok: false,
        status: 409,
        error: 'Confirme o consentimento do paciente ou responsável antes do envio.',
        code: 'CONSENT_REQUIRED',
      }
    }
    await admin
      .from('patients')
      .update({
        whatsapp_opt_in_at: new Date().toISOString(),
        whatsapp_consent_source: options.consentSource ?? 'clinic_system',
      })
      .eq('id', patient.id)
  }

  // A conversa que ja existe, em qualquer grafia do numero (nono digito, ver
  // telefone-br.ts): o acompanhamento vai para o numero que o WhatsApp da
  // pessoa usa e cai na mesma conversa, em vez de abrir outra.
  const { data: existente } = await admin
    .from('whatsapp_conversations')
    .select('wa_id')
    .eq('clinic_id', followup.clinic_id)
    .in('wa_id', variantesDoTelefone(patient.phone))
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const waId = (existente?.wa_id as string | undefined) ?? toBrazilE164(patient.phone)
  const now = new Date().toISOString()

  const { data: conversation, error: conversationError } = await admin
    .from('whatsapp_conversations')
    .upsert(
      {
        clinic_id: followup.clinic_id,
        patient_id: patient.id,
        wa_id: waId,
        display_phone: patient.phone,
        // status fica de fora (25/09/2026): 'open' forcado aqui reabria toda
        // conversa ja concluida quando o acompanhamento saia. Conversa nova
        // nasce 'open' pelo padrao da coluna.
        last_message_at: now,
      },
      { onConflict: 'clinic_id,wa_id' },
    )
    .select('id')
    .single()
  if (conversationError) {
    console.error('Conversation upsert failed', conversationError)
    return {
      ok: false,
      status: 500,
      error: 'Não foi possível registrar a conversa.',
      code: 'CONVERSATION_FAILED',
      details: conversationError.message,
    }
  }

  const token = chaveDoWhatsApp(settings.whatsapp_phone_number_id)
  if (!token) {
    return { ok: false, status: 503, error: 'Token do WhatsApp ainda não foi configurado no servidor.', code: 'NO_TOKEN' }
  }

  const graphVersion = Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'
  const nomeDoModelo = settings.whatsapp_template_name || 'acompanhamento_pos_consulta'
  // Nome completo ou so o primeiro, conforme o modelo (03/10/2026). Ver
  // parametrosDoAcompanhamento em modelos.ts.
  const parametros = parametrosDoAcompanhamento(
    nomeDoModelo,
    patient.name,
    formatDateBR(consultation.consultation_date),
  )
  const graphResponse = await fetch(
    `https://graph.facebook.com/${graphVersion}/${settings.whatsapp_phone_number_id}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: waId,
        type: 'template',
        template: {
          name: nomeDoModelo,
          language: { code: settings.whatsapp_template_language || 'pt_BR' },
          components: [
            {
              type: 'body',
              parameters: parametros.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }),
    },
  )

  const graphBody = await graphResponse.json()
  const followupLabel =
    followup.followup_key === 'd15' ? '15 dias' : followup.followup_key === 'd30' ? '30 dias' : '3 meses'
  // O registro guarda a mensagem que a familia leu, e nao um resumo do que o
  // sistema fez. Quem abre a conversa na plataforma precisa ver a mesma coisa
  // que esta no celular dela; o resumo ficava parecendo que o sistema tinha
  // mandado outra mensagem.
  const summary =
    textoDoModelo(nomeDoModelo, parametros) ??
    `Acompanhamento de ${followupLabel} enviado para ${patient.name} ` +
      `(consulta em ${formatDateBR(consultation.consultation_date)}).`

  if (!graphResponse.ok) {
    const reason = graphBody?.error?.message || 'Meta recusou o envio.'
    await admin.from('whatsapp_messages').insert({
      clinic_id: followup.clinic_id,
      conversation_id: conversation.id,
      patient_id: patient.id,
      followup_id: followup.id,
      direction: 'outbound',
      // Envio do sistema, nao da equipe: o menu automatico usa esta marca
      // para saber que ninguem de carne e osso esta na conversa.
      automatic: true,
      message_type: 'template',
      template_name: settings.whatsapp_template_name,
      body: summary,
      status: 'failed',
      failed_at: now,
      failure_reason: reason,
    })
    await admin
      .from('followups')
      .update({ whatsapp_failed_at: now, whatsapp_failure_reason: reason })
      .eq('id', followup.id)
    return { ok: false, status: 502, error: 'A Meta recusou o envio.', code: 'META_REJECTED', details: reason }
  }

  const { data: savedMessage, error: saveError } = await admin
    .from('whatsapp_messages')
    .insert({
      clinic_id: followup.clinic_id,
      conversation_id: conversation.id,
      patient_id: patient.id,
      followup_id: followup.id,
      external_message_id: graphBody?.messages?.[0]?.id ?? null,
      direction: 'outbound',
      // Envio do sistema, nao da equipe: o menu automatico usa esta marca
      // para saber que ninguem de carne e osso esta na conversa.
      automatic: true,
      message_type: 'template',
      template_name: settings.whatsapp_template_name,
      body: summary,
      status: 'accepted',
      sent_at: now,
    })
    .select('id,external_message_id,status')
    .single()

  if (saveError) {
    console.error('Message insert failed', saveError)
    return {
      ok: false,
      status: 500,
      error: 'A mensagem foi enviada mas não pôde ser registrada.',
      code: 'SAVE_FAILED',
      details: saveError.message,
    }
  }

  await admin
    .from('followups')
    .update({
      status: 'opened',
      opened_at: now,
      whatsapp_sent_at: now,
      whatsapp_failure_reason: null,
      whatsapp_failed_at: null,
    })
    .eq('id', followup.id)

  return { ok: true, message: savedMessage }
}
