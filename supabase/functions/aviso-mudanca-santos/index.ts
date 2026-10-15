import { adminClient, corsHeaders, json, toBrazilE164 } from '../_shared/whatsapp.ts'
import { textoDoModelo } from '../_shared/modelos.ts'
import { variantesDoTelefone } from '../_shared/telefone-br.ts'
import { chaveDoWhatsApp, listaDeTeste } from '../_shared/whatsapp-teste.ts'
import {
  MODELO_DO_AVISO,
  VIRADA,
  dataEHoraDoAviso,
  motivoParaNaoAvisar,
} from '../_shared/aviso-mudanca.ts'

/**
 * Aviso unico: Santos muda da Liferty para a Livance em 01/10/2026.
 *
 * Vai para cada consulta presencial ja marcada na Livance · Santos de 01/10 em
 * diante, com o modelo mudanca_santos_livance (data, hora, endereco novo e
 * como funciona o totem). Quem marcar daqui para frente ja marca na Livance e
 * recebe o endereco na confirmacao do agendamento; o aviso e para quem marcou
 * pensando na Liferty.
 *
 * Nao tem agendamento: e chamada a mao, pelo editor SQL, com
 * private.disparar_aviso_mudanca_santos(). Primeiro com simular = true, que
 * devolve a lista de quem receberia e com que texto, sem enviar nada. So
 * depois de alguem ler essa lista, com simular = false.
 *
 * As travas:
 *  - uma vez por consulta: se ja ha uma mensagem deste modelo aceita pela Meta
 *    para a consulta, ela e pulada. Rodar de novo so tenta quem falhou.
 *  - opt-out e respeitado, no paciente e na conversa, como no lembrete.
 *  - so das 9h as 20h: o envio real fora dessa faixa e recusado inteiro.
 *  - falha nao some: vira mensagem "falhou" na conversa da familia, com o
 *    motivo da Meta, e aparece na resposta desta funcao.
 */

const HORA_INICIAL = 9
const HORA_FINAL = 20

function horaLocal(timezone: string) {
  return Number(
    new Date().toLocaleString('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }),
  )
}

type Linha = {
  consulta: string
  quando: string
  paciente: string
  telefone: string
  resultado: string
  texto?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const esperado = Deno.env.get('CRON_SECRET')?.trim()
  if (!esperado) return json({ error: 'CRON_SECRET não configurado no servidor.' }, 503)
  if (req.headers.get('x-cron-secret')?.trim() !== esperado) return json({ error: 'Não autorizado.' }, 401)

  const pedido = await req.json().catch(() => ({})) as { simular?: boolean }
  // Na duvida, simula. Um corpo que nao chegou ou veio torto nao pode virar
  // envio para familias de verdade.
  const simular = pedido?.simular !== false

  if (!simular && !chaveDoWhatsApp(null)) return json({ error: 'Token do WhatsApp não configurado.' }, 503)

  try {
    const admin = adminClient()
    const graphVersion = Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'

    const { data: clinicas, error: erroClinicas } = await admin
      .from('clinic_settings')
      .select('clinic_id,whatsapp_phone_number_id,whatsapp_template_language,clinics(timezone)')
      .not('whatsapp_phone_number_id', 'is', null)
    if (erroClinicas) return json({ error: 'Erro ao ler as configurações.', details: erroClinicas.message }, 500)

    const resumo = { simulacao: simular, candidatas: 0, enviados: 0, pulados: 0, falhas: 0 }
    const linhas: Linha[] = []

    for (const clinica of clinicas ?? []) {
      // Aviso da mudanca de Santos e da clinica real. A clinica de teste
      // (27/09/2026) tambem tem unidade "Livance Santos" e, com o numero de
      // teste ligado, entraria aqui - com um modelo que nem existe na conta de
      // teste da Meta.
      if ((await listaDeTeste(admin, clinica.clinic_id)) !== null) continue
      const token = chaveDoWhatsApp(clinica.whatsapp_phone_number_id)
      const timezone = (clinica.clinics as { timezone?: string } | null)?.timezone || 'America/Sao_Paulo'
      const idioma = clinica.whatsapp_template_language || 'pt_BR'

      if (!simular) {
        const hora = horaLocal(timezone)
        if (hora < HORA_INICIAL || hora >= HORA_FINAL) {
          return json({ error: `Fora do horário de envio (${hora}h). Envie entre ${HORA_INICIAL}h e ${HORA_FINAL}h.` }, 409)
        }
      }

      const { data: consultas, error: erroConsultas } = await admin
        .from('appointments')
        .select('id,patient_id,starts_at,status,modality,confirmed_by_clinic,contact_name,contact_phone,clinic_units(name)')
        .eq('clinic_id', clinica.clinic_id)
        .gte('starts_at', VIRADA)
        .neq('status', 'cancelled')
        .order('starts_at', { ascending: true })
        .limit(500)
      if (erroConsultas) {
        console.error('aviso-mudanca-santos: consultas', erroConsultas)
        return json({ error: 'Erro ao ler as consultas.', details: erroConsultas.message }, 500)
      }

      for (const consulta of consultas ?? []) {
        const unidade = (consulta.clinic_units as { name?: string } | null)?.name
        const motivo = motivoParaNaoAvisar({ ...consulta, unidade })
        // Outra unidade nem entra na conta: so polui a lista.
        if (motivo === 'outra unidade') continue
        resumo.candidatas += 1

        const { data: dataTexto, hora } = dataEHoraDoAviso(consulta.starts_at, timezone)
        const quando = `${dataTexto} ${hora}`

        const { data: paciente } = consulta.patient_id
          ? await admin
              .from('patients')
              .select('id,name,phone,whatsapp_opt_out_at')
              .eq('id', consulta.patient_id)
              .maybeSingle()
          : { data: null }
        const nome = paciente?.name || consulta.contact_name || 'paciente'
        const telefone = paciente?.phone || consulta.contact_phone || ''
        const linha: Linha = { consulta: consulta.id, quando, paciente: nome, telefone, resultado: '' }
        linhas.push(linha)

        if (motivo) {
          resumo.pulados += 1
          linha.resultado = `pulada: ${motivo}`
          continue
        }
        if (paciente?.whatsapp_opt_out_at) {
          resumo.pulados += 1
          linha.resultado = 'pulada: pediu para não receber mensagens'
          continue
        }
        if (!telefone) {
          resumo.pulados += 1
          linha.resultado = 'pulada: sem telefone'
          continue
        }

        const { data: jaEnviada } = await admin
          .from('whatsapp_messages')
          .select('id')
          .eq('appointment_id', consulta.id)
          .eq('template_name', MODELO_DO_AVISO)
          .neq('status', 'failed')
          .limit(1)
          .maybeSingle()
        if (jaEnviada) {
          resumo.pulados += 1
          linha.resultado = 'pulada: aviso já enviado'
          continue
        }

        const { data: conversaAtual } = await admin
          .from('whatsapp_conversations')
          .select('status,wa_id')
          .eq('clinic_id', clinica.clinic_id)
          .in('wa_id', variantesDoTelefone(telefone))
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (conversaAtual?.status === 'opted_out') {
          resumo.pulados += 1
          linha.resultado = 'pulada: pediu para não receber mensagens'
          continue
        }
        const waId = (conversaAtual?.wa_id as string | undefined) ?? toBrazilE164(telefone)

        const parametros = [nome, dataTexto, hora]
        const texto = textoDoModelo(MODELO_DO_AVISO, parametros) ?? ''
        linha.texto = texto

        if (simular) {
          linha.resultado = 'receberia'
          continue
        }

        const agora = new Date().toISOString()
        const { data: conversa, error: erroConversa } = await admin
          .from('whatsapp_conversations')
          .upsert(
            {
              clinic_id: clinica.clinic_id,
              // Nulo apagaria o vinculo que a conversa ja tinha (irmaos no
              // mesmo celular). Mesmo cuidado do lembrete.
              ...(paciente?.id ? { patient_id: paciente.id } : {}),
              wa_id: waId,
              display_phone: telefone,
              last_message_at: agora,
            },
            { onConflict: 'clinic_id,wa_id' },
          )
          .select('id')
          .single()
        if (erroConversa || !conversa) {
          console.error('aviso-mudanca-santos: conversa', erroConversa)
          resumo.falhas += 1
          linha.resultado = 'FALHOU: não foi possível abrir a conversa'
          continue
        }

        const envio = await fetch(`https://graph.facebook.com/${graphVersion}/${clinica.whatsapp_phone_number_id}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: waId,
            type: 'template',
            template: {
              name: MODELO_DO_AVISO,
              language: { code: idioma },
              components: [
                { type: 'body', parameters: parametros.map((valor) => ({ type: 'text', text: valor })) },
              ],
            },
          }),
        })
        const corpo = await envio.json().catch(() => ({}))
        const falha = envio.ok ? null : corpo?.error?.message || 'Meta recusou o envio.'

        // O appointment_id amarra a resposta da familia a esta consulta: um
        // "preciso remarcar" logo depois cai no mesmo caminho da resposta ao
        // lembrete e acende a conversa para a equipe.
        await admin.from('whatsapp_messages').insert({
          clinic_id: clinica.clinic_id,
          conversation_id: conversa.id,
          patient_id: paciente?.id ?? null,
          appointment_id: consulta.id,
          external_message_id: envio.ok ? corpo?.messages?.[0]?.id ?? null : null,
          direction: 'outbound',
          automatic: true,
          message_type: 'template',
          template_name: MODELO_DO_AVISO,
          body: texto,
          status: envio.ok ? 'accepted' : 'failed',
          sent_at: envio.ok ? agora : null,
          failed_at: envio.ok ? null : agora,
          failure_reason: falha,
        })

        if (falha) {
          resumo.falhas += 1
          linha.resultado = `FALHOU: ${falha}`
          console.warn('aviso-mudanca-santos: Meta recusou', consulta.id, falha)
        } else {
          resumo.enviados += 1
          linha.resultado = 'enviado'
        }
      }
    }

    console.log('aviso-mudanca-santos', JSON.stringify(resumo))
    return json({ ok: true, ...resumo, linhas })
  } catch (error) {
    console.error(error)
    return json({ error: 'Falha no aviso da mudança de Santos.' }, 500)
  }
})
