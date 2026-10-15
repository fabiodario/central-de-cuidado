import { adminClient, corsHeaders, json, toBrazilE164 } from '../_shared/whatsapp.ts'
import { textoDoModelo } from '../_shared/modelos.ts'
import { cadastrarDaFicha } from '../_shared/cadastro.ts'
import { janelaDeLembrete, unidadeNoLembrete } from '../_shared/lembrete.ts'
import { variantesDoTelefone } from '../_shared/telefone-br.ts'
import { chaveDoWhatsApp, foraDaListaDeTeste, listaDeTeste } from '../_shared/whatsapp-teste.ts'

/**
 * Lembrete automatico de consulta.
 *
 * Roda de hora em hora pelo pg_cron (aos :20, das 9h as 20h no fuso da clinica)
 * e avisa quem tem consulta ate o fim do dia de daqui a N dias (padrao 1, ou
 * seja, a vespera). A passada das 09:20 avisa o dia inteiro de amanha; as
 * seguintes pegam quem marcou depois. A mensagem pede que o paciente confirme
 * ou peca para remarcar; a resposta cai no meta-webhook.
 *
 * Duas regras deliberadas, iguais as do disparo de acompanhamentos:
 *  - so envia para quem ja tem consentimento registrado. Um robo nao presume
 *    opt-in em nome da equipe.
 *  - marca reminder_sent_at antes de considerar o trabalho feito, para uma
 *    reexecucao do cron nao mandar a mesma mensagem duas vezes.
 */


type Settings = {
  clinic_id: string
  timezone: string
  phoneNumberId: string
  templateName: string
  templateLanguage: string
  reminderDays: number
  enabled: boolean
}

/**
 * Nao mandar lembrete de madrugada. Fora desta faixa, espera a proxima hora.
 *
 * Comeca as 9, e nao as 8, desde 21/09/2026: a passada das 09:20 e a "da
 * manha", a que avisa o dia inteiro de amanha de uma vez (ver janelaDeLembrete
 * em _shared/lembrete.ts). As 8 ainda e cedo para mensagem de consultorio.
 */
const HORA_INICIAL = 9
const HORA_FINAL = 20

/** Hora local da clinica, para nao acordar ninguem com lembrete. */
function horaLocal(timezone: string) {
  return Number(
    new Date().toLocaleString('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }),
  )
}

function formatarDataHora(iso: string, timezone: string) {
  const data = new Date(iso)
  const dataBR = data.toLocaleDateString('pt-BR', { timeZone: timezone })
  const hora = data.toLocaleTimeString('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  })
  return { dataBR, hora }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const expected = Deno.env.get('CRON_SECRET')?.trim()
  if (!expected) return json({ error: 'CRON_SECRET não configurado no servidor.' }, 503)
  if (req.headers.get('x-cron-secret')?.trim() !== expected) return json({ error: 'Não autorizado.' }, 401)

  // A chave e por numero desde 27/09/2026 (ver whatsapp-teste.ts). Sem nem a
  // chave geral, nenhuma clinica envia: responde erro para o painel acusar.
  if (!chaveDoWhatsApp(null)) return json({ error: 'Token do WhatsApp não configurado.' }, 503)

  try {
    const admin = adminClient()
    const graphVersion = Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'

    const { data: linhas, error: settingsError } = await admin
      .from('clinic_settings')
      .select(
        'clinic_id,whatsapp_phone_number_id,whatsapp_reminder_template_name,whatsapp_template_language,' +
          'appointment_reminder_days,appointment_reminder_enabled,clinics(timezone)',
      )
      .eq('appointment_reminder_enabled', true)
      .not('whatsapp_phone_number_id', 'is', null)

    if (settingsError) {
      console.error('Settings lookup failed', settingsError)
      return json({ error: 'Erro ao ler as configurações.', details: settingsError.message }, 500)
    }

    const clinicas: Settings[] = (linhas ?? []).map((linha) => ({
      clinic_id: linha.clinic_id,
      timezone:
        (linha.clinics as { timezone?: string } | null)?.timezone || 'America/Sao_Paulo',
      phoneNumberId: linha.whatsapp_phone_number_id as string,
      templateName: linha.whatsapp_reminder_template_name || 'lembrete_consulta',
      templateLanguage: linha.whatsapp_template_language || 'pt_BR',
      reminderDays: linha.appointment_reminder_days ?? 1,
      enabled: true,
    }))

    const resumo = { candidatas: 0, enviados: 0, pulados: 0, falhas: 0 }
    const detalhes: { appointmentId: string; resultado: string }[] = []

    for (const clinica of clinicas) {
      const hora = horaLocal(clinica.timezone)
      if (hora < HORA_INICIAL || hora >= HORA_FINAL) {
        detalhes.push({ appointmentId: '-', resultado: `fora do horario (${hora}h)` })
        continue
      }

      const { inicio, fim } = janelaDeLembrete(new Date(), clinica.reminderDays, clinica.timezone)
      const token = chaveDoWhatsApp(clinica.phoneNumberId) as string
      const listaTeste = await listaDeTeste(admin, clinica.clinic_id)

      const { data: consultas, error: consultasError } = await admin
        .from('appointments')
        .select('id,patient_id,starts_at,unit_id,modality,contact_name,contact_phone,clinic_units(name,address),' +
          'intake_patient_name,intake_birth_date,intake_guardian,intake_cpf,intake_email,reminder_failed_at')
        .eq('clinic_id', clinica.clinic_id)
        .eq('status', 'scheduled')
        .is('reminder_sent_at', null)
        .gte('starts_at', inicio.toISOString())
        .lt('starts_at', fim.toISOString())
        // Consulta sem paciente vinculado tambem recebe lembrete: quem marcou
        // sozinho pelo WhatsApp e justamente quem mais falta, e o telefone do
        // contato basta para avisar.
        .order('starts_at', { ascending: true })
        .limit(200)

      if (consultasError) {
        console.error('Appointment lookup failed', consultasError)
        continue
      }

      resumo.candidatas += consultas?.length ?? 0

      for (const consulta of consultas ?? []) {
        // Recusado pela Meta ha menos de 3 horas: nao tenta de novo ainda.
        // Ate 24/09/2026 a recusa voltava a cada passada de hora em hora e
        // deixava ate onze mensagens "falhou" na conversa. A etiqueta "Lembrete
        // falhou" e o "Ligar hoje" da Agenda ja avisam a recepcao; aqui fica so
        // uma nova tentativa espacada, para o caso de a Meta ter caido.
        const falhouEm = (consulta as { reminder_failed_at?: string | null }).reminder_failed_at
        if (falhouEm && Date.now() - new Date(falhouEm).getTime() < 3 * 3600 * 1000) {
          resumo.pulados += 1
          detalhes.push({ appointmentId: consulta.id, resultado: 'recusado ha pouco; nova tentativa em 3h' })
          continue
        }

        const { data: encontrado } = consulta.patient_id
          ? await admin
              .from('patients')
              .select('id,name,phone,whatsapp_opt_out_at')
              .eq('id', consulta.patient_id)
              .maybeSingle()
          : { data: null }

        // Sem cadastro na vespera: cria agora, com o que a familia informou ao
        // marcar. Se nao der, o lembrete segue assim mesmo - avisar a pessoa da
        // consulta dela nao depende de haver prontuario.
        const paciente =
          encontrado ??
          (consulta.patient_id ? null : await cadastrarDaFicha(admin, clinica.clinic_id, consulta))

        // Quem pediu para nao receber nada e respeitado sempre, e essa e a
        // unica trava que sobrou. A exigencia de opt-in registrado saiu daqui:
        // ela so era gravada no envio do acompanhamento de 30 dias, entao
        // paciente novo com consulta na semana seguinte nunca recebia lembrete.
        // Avisar alguem da propria consulta que ele marcou nao depende de
        // consentimento de marketing.
        if (paciente?.whatsapp_opt_out_at) {
          resumo.pulados += 1
          detalhes.push({ appointmentId: consulta.id, resultado: 'opt-out' })
          continue
        }

        const telefone = paciente?.phone || consulta.contact_phone || ''
        const nomeParaMensagem =
          paciente?.name || consulta.contact_name || 'paciente'

        if (!telefone) {
          resumo.pulados += 1
          detalhes.push({ appointmentId: consulta.id, resultado: 'sem telefone' })
          continue
        }

        // Clinica de teste: so os celulares cadastrados no numero de teste da
        // Meta recebem. O resto e paciente ficticio - tentar seria so uma
        // recusa da Meta por dia em cada um.
        if (foraDaListaDeTeste(listaTeste, telefone)) {
          resumo.pulados += 1
          detalhes.push({ appointmentId: consulta.id, resultado: 'fora da lista de teste' })
          continue
        }

        const agora = new Date().toISOString()

        // Quem nao tem cadastro tambem pode ter pedido para sair - nesse caso o
        // "sair" fica gravado na conversa, e nao no paciente. Sem esta checagem
        // o lembrete furaria justamente quem pediu silencio.
        //
        // Procurada em todas as grafias do numero (nono digito, ver
        // telefone-br.ts). Achando, o lembrete vai para o numero que o
        // WhatsApp da pessoa usa de fato e cai na MESMA conversa - antes abria
        // uma segunda, e a resposta da familia chegava na outra.
        const { data: conversaAtual } = await admin
          .from('whatsapp_conversations')
          .select('status,wa_id,needs_attention,attention_reason')
          .eq('clinic_id', clinica.clinic_id)
          .in('wa_id', variantesDoTelefone(telefone))
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const waId = (conversaAtual?.wa_id as string | undefined) ?? toBrazilE164(telefone)

        if (conversaAtual?.status === 'opted_out') {
          resumo.pulados += 1
          detalhes.push({ appointmentId: consulta.id, resultado: 'opt-out' })
          continue
        }

        // Numero que respondeu "nao sou o Rogerio" (06/10/2026): o telefone da
        // ficha e de outra pessoa. Mandar de novo e incomodar um estranho e
        // deixar o paciente sem lembrete do mesmo jeito. O lembrete fica como
        // FALHOU na Agenda, com o motivo - barulho para alguem corrigir o
        // cadastro, e nao silencio. Corrigido o telefone (ou concluida a
        // conversa), volta a sair.
        if (conversaAtual?.needs_attention && conversaAtual?.attention_reason === 'numero_errado') {
          resumo.pulados += 1
          detalhes.push({ appointmentId: consulta.id, resultado: 'numero errado' })
          await admin
            .from('appointments')
            .update({
              reminder_failed_at: new Date().toISOString(),
              reminder_failure_reason: 'O telefone do cadastro é de outra pessoa (respondeu que não é o paciente). Corrija o telefone.',
            })
            .eq('id', consulta.id)
          continue
        }
        const { dataBR, hora } = formatarDataHora(consulta.starts_at, clinica.timezone)
        // Na telemedicina o lembrete diz "por vídeo", e nao o nome da unidade
        // que cedeu o horario - senao a familia sai de casa para uma consulta
        // que era online.
        //
        // O texto em volta e do modelo aprovado na Meta ("na unidade {{4}}") e
        // nao muda sem nova aprovacao. Ate 22/09/2026 o parametro era
        // "telemedicina (por vídeo)", e a familia lia "na unidade telemedicina
        // (por vídeo)". Com "virtual", a frase fecha: "na unidade virtual
        // (consulta por vídeo)".
        const lugar = consulta.clinic_units as { name?: string; address?: string } | null
        const unidade = unidadeNoLembrete(consulta.modality, lugar?.name, lugar?.address)

        const { data: conversa, error: conversaError } = await admin
          .from('whatsapp_conversations')
          .upsert(
            {
              clinic_id: clinica.clinic_id,
              // Nulo aqui apagaria o vinculo que a conversa ja tinha (irmao,
              // responsavel). Mesmo defeito corrigido no webhook em 24/09/2026.
              ...(paciente?.id ? { patient_id: paciente.id } : {}),
              wa_id: waId,
              display_phone: telefone,
              // status fica de fora: o padrao da coluna ja e 'open' para uma
              // conversa nova, e forcar aqui reabriria quem estava resolvido.
              last_message_at: agora,
            },
            { onConflict: 'clinic_id,wa_id' },
          )
          .select('id')
          .single()

        if (conversaError || !conversa) {
          console.error('Conversation upsert failed', conversaError)
          resumo.falhas += 1
          detalhes.push({ appointmentId: consulta.id, resultado: 'CONVERSATION_FAILED' })
          continue
        }

        const resposta = await fetch(
          `https://graph.facebook.com/${graphVersion}/${clinica.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: waId,
              type: 'template',
              template: {
                name: clinica.templateName,
                language: { code: clinica.templateLanguage },
                components: [
                  {
                    type: 'body',
                    parameters: [
                      { type: 'text', text: nomeParaMensagem },
                      { type: 'text', text: dataBR },
                      { type: 'text', text: hora },
                      { type: 'text', text: unidade },
                    ],
                  },
                ],
              },
            }),
          },
        )

        const corpo = await resposta.json()
        // Igual ao acompanhamento: guarda a mensagem que a pessoa leu, para a
        // conversa na plataforma bater com o celular dela.
        const resumoTexto =
          textoDoModelo(clinica.templateName, [nomeParaMensagem, dataBR, hora, unidade]) ??
          `Lembrete de consulta em ${dataBR} às ${hora} (${unidade}) enviado para ${nomeParaMensagem}.`

        if (!resposta.ok) {
          const motivo = corpo?.error?.message || 'Meta recusou o envio.'
          await admin.from('whatsapp_messages').insert({
            clinic_id: clinica.clinic_id,
            conversation_id: conversa.id,
            patient_id: paciente?.id ?? null,
            appointment_id: consulta.id,
            direction: 'outbound',
            automatic: true,
            message_type: 'template',
            template_name: clinica.templateName,
            body: resumoTexto,
            status: 'failed',
            failed_at: agora,
            failure_reason: motivo,
          })
          await admin
            .from('appointments')
            .update({ reminder_failed_at: agora, reminder_failure_reason: motivo })
            .eq('id', consulta.id)
          resumo.falhas += 1
          detalhes.push({ appointmentId: consulta.id, resultado: `META_REJECTED: ${motivo}` })
          continue
        }

        await admin.from('whatsapp_messages').insert({
          clinic_id: clinica.clinic_id,
          conversation_id: conversa.id,
          patient_id: paciente?.id ?? null,
          appointment_id: consulta.id,
          external_message_id: corpo?.messages?.[0]?.id ?? null,
          direction: 'outbound',
          automatic: true,
          message_type: 'template',
          template_name: clinica.templateName,
          body: resumoTexto,
          status: 'accepted',
          sent_at: agora,
        })

        await admin
          .from('appointments')
          .update({ reminder_sent_at: agora, reminder_failed_at: null, reminder_failure_reason: null })
          .eq('id', consulta.id)

        resumo.enviados += 1
        detalhes.push({ appointmentId: consulta.id, resultado: 'enviado' })
      }
    }

    console.log('appointment-reminders', JSON.stringify(resumo))
    return json({ ok: true, ...resumo, detalhes })
  } catch (error) {
    console.error(error)
    return json({ error: 'Falha no envio dos lembretes.' }, 500)
  }
})
