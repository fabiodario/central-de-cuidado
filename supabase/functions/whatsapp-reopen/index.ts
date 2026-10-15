import { adminClient, corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { textoDoModelo } from '../_shared/modelos.ts'
import { primeiroNomeUtil } from '../_shared/nome.ts'
import { chaveDoWhatsApp } from '../_shared/whatsapp-teste.ts'

/**
 * Falar com alguem cuja janela de 24 horas ja fechou.
 *
 * Fora da janela a Meta so aceita modelo aprovado, e existem dois caminhos:
 *
 *  - CONVITE (sem `mensagem`): o modelo pede que a pessoa responda. Nao resolve
 *    o assunto, reabre a porta - ela responde, a janela volta a contar, e a
 *    equipe escreve livremente pela tela de sempre. Serve quando o assunto e
 *    longo demais para caber num modelo.
 *
 *  - RESPOSTA (com `mensagem`): o texto que a equipe digitou vai dentro de um
 *    modelo de utilidade, e a familia le a resposta na hora. Serve para o caso
 *    comum: alguem perguntou algo simples ontem e merece a resposta, nao um
 *    pedido para escrever de novo.
 *
 * Recusa de proposito quando a janela AINDA esta aberta. Ali o texto livre
 * funciona, chega mais completo e (ate outubro de 2026) e gratuito; gastar um
 * modelo no lugar dele seria pagar para dizer menos.
 */

const JANELA_HORAS = 24

/**
 * Limite do texto da equipe.
 *
 * O corpo inteiro do modelo cabe em 1024 caracteres na Meta, e a moldura
 * ("Olá, Fulano. Aqui é o consultório...") ja come uma parte. 700 deixa folga
 * confortavel e ainda e mais do que qualquer resposta de recepcao precisa.
 */
const LIMITE_DA_MENSAGEM = 700

type ReopenRequest = { conversationId?: string; mensagem?: string }

/**
 * Deixa o texto no formato que a Meta aceita como parametro.
 *
 * Parametro de modelo nao pode conter quebra de linha, tabulacao nem quatro
 * espacos seguidos - a Meta recusa a mensagem inteira, com erro generico. Em
 * vez de devolver "erro 132000" para a recepcao, as quebras viram espaco.
 */
function limparParametro(texto: string): string {
  return texto.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

    const body = (await req.json()) as ReopenRequest
    if (!body.conversationId) return json({ error: 'Conversa não informada.' }, 400)

    const mensagem = limparParametro(body.mensagem ?? '')
    if (mensagem.length > LIMITE_DA_MENSAGEM) {
      return json({
        error: `A mensagem passa de ${LIMITE_DA_MENSAGEM} caracteres. Encurte ou envie o convite para conversar livremente.`,
        code: 'TOO_LONG',
      }, 400)
    }

    // A RLS e a autorizacao: so aparece conversa de clinica onde o usuario e
    // membro ativo. Se nao vier nada, ele nao pode escrever para esta pessoa.
    const scoped = userClient(authorization)
    const { data: visivel, error: visivelError } = await scoped
      .from('whatsapp_conversations')
      .select('id,clinic_id,patient_id,wa_id,status,profile_name')
      .eq('id', body.conversationId)
      .maybeSingle()

    if (visivelError) {
      console.error('RLS lookup failed', visivelError)
      return json({ error: 'Falha ao verificar a conversa.', code: 'RLS_LOOKUP_FAILED' }, 500)
    }
    if (!visivel) {
      return json({ error: 'Esta conversa não pertence à sua clínica.', code: 'NOT_VISIBLE' }, 403)
    }
    if (visivel.status === 'opted_out') {
      return json({
        error: 'Este contato pediu para não receber mensagens.',
        code: 'OPTED_OUT',
      }, 409)
    }

    const admin = adminClient()

    const { data: ultimaEntrada } = await admin
      .from('whatsapp_messages')
      .select('created_at')
      .eq('conversation_id', visivel.id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (ultimaEntrada) {
      const fechaEm = new Date(
        new Date(ultimaEntrada.created_at).getTime() + JANELA_HORAS * 3600 * 1000,
      )
      if (Date.now() <= fechaEm.getTime()) {
        return json({
          error: 'A janela ainda está aberta. Responda com texto livre, que chega mais completo.',
          code: 'WINDOW_OPEN',
        }, 409)
      }
    }

    const { data: settings } = await admin
      .from('clinic_settings')
      .select(
        'whatsapp_phone_number_id,whatsapp_reopen_template_name,whatsapp_reply_template_name,whatsapp_template_language',
      )
      .eq('clinic_id', visivel.clinic_id)
      .single()

    if (!settings?.whatsapp_phone_number_id) {
      return json({ error: 'Configuração do WhatsApp incompleta.', code: 'INCOMPLETE' }, 409)
    }

    const token = chaveDoWhatsApp(settings.whatsapp_phone_number_id)
    if (!token) return json({ error: 'Token do WhatsApp não configurado.', code: 'NO_TOKEN' }, 503)

    // O nome de quem recebe. Sem cadastro, vale o nome do perfil do WhatsApp; e
    // sem nenhum dos dois, um tratamento neutro - a Meta recusa a mensagem
    // inteira se a variavel vier vazia.
    //
    // Nome de perfil passa por primeiroNomeUtil: "tudo bem", emoji ou "Mae do
    // Joao" nao viram nome. Sem nome util, o modelo recebe "tudo bem" (vira
    // "Ola, tudo bem!") e o historico diz so "retomar o atendimento".
    let nomeUtil = primeiroNomeUtil(visivel.profile_name)
    if (visivel.patient_id) {
      const { data: paciente } = await admin
        .from('patients')
        .select('name')
        .eq('id', visivel.patient_id)
        .maybeSingle()
      if (paciente?.name) nomeUtil = primeiroNomeUtil(paciente.name, true)
    }
    const primeiroNome = nomeUtil ?? 'tudo bem'

    // Dois modelos, um caminho de codigo. O que muda e o nome e os parametros:
    // o convite leva so o nome; a resposta leva o nome e o texto da equipe.
    const enviandoResposta = mensagem.length > 0
    const templateName = enviandoResposta
      ? settings.whatsapp_reply_template_name || 'resposta_da_clinica'
      : settings.whatsapp_reopen_template_name || 'retomar_atendimento'
    const parametros = enviandoResposta ? [primeiroNome, mensagem] : [primeiroNome]
    const graphVersion = Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'
    const agora = new Date().toISOString()

    const resposta = await fetch(
      `https://graph.facebook.com/${graphVersion}/${settings.whatsapp_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: visivel.wa_id,
          type: 'template',
          template: {
            name: templateName,
            language: { code: settings.whatsapp_template_language || 'pt_BR' },
            components: [
              { type: 'body', parameters: parametros.map((valor) => ({ type: 'text', text: valor })) },
            ],
          },
        }),
      },
    )

    const corpo = await resposta.json()
    // O historico guarda o que a familia LEU, e nao o nome tecnico do modelo.
    // Na resposta isso e essencial: o texto que a equipe escreveu e o conteudo
    // do atendimento, e some se guardarmos "modelo enviado".
    const resumo = enviandoResposta
      ? textoDoModelo(templateName, parametros) ?? mensagem
      // ATENCAO: listConversations (repository.ts) reconhece o convite pelo
      // comeco deste texto para nao conta-lo como resposta. Mudou aqui, muda la.
      : nomeUtil
        ? `Mensagem enviada para retomar o atendimento com ${nomeUtil}.`
        : 'Mensagem enviada para retomar o atendimento.'

    if (!resposta.ok) {
      const motivo = corpo?.error?.message || 'Meta recusou o envio.'
      await admin.from('whatsapp_messages').insert({
        clinic_id: visivel.clinic_id,
        conversation_id: visivel.id,
        patient_id: visivel.patient_id,
        direction: 'outbound',
        automatic: false,
        message_type: 'template',
        template_name: templateName,
        body: resumo,
        status: 'failed',
        failed_at: agora,
        failure_reason: motivo,
      })
      // 132001 = template inexistente ou ainda nao aprovado naquele idioma. E o
      // erro esperado enquanto a Meta nao aprovou, e merece texto proprio.
      const naoAprovado = corpo?.error?.code === 132001 || /template/i.test(String(motivo))
      return json({
        error: naoAprovado
          ? `O modelo "${templateName}" ainda não está aprovado na Meta. Assim que a aprovação sair, este botão funciona.`
          : 'A Meta recusou o envio.',
        code: naoAprovado ? 'TEMPLATE_NOT_APPROVED' : 'META_REJECTED',
        details: motivo,
      }, 502)
    }

    const { error: salvaError } = await admin.from('whatsapp_messages').insert({
      clinic_id: visivel.clinic_id,
      conversation_id: visivel.id,
      patient_id: visivel.patient_id,
      external_message_id: corpo?.messages?.[0]?.id ?? null,
      direction: 'outbound',
      automatic: false,
      message_type: 'template',
      template_name: templateName,
      body: resumo,
      status: 'accepted',
      sent_at: agora,
    })

    if (salvaError) {
      console.error('Message insert failed', salvaError)
      return json({
        error: 'A mensagem foi enviada mas não pôde ser registrada.',
        code: 'SAVE_FAILED',
      }, 500)
    }

    await admin
      .from('whatsapp_conversations')
      // Retomar o atendimento tira a conversa de "Concluida" (23/09/2026).
      .update({
        needs_attention: false,
        // O motivo sai junto (24/09/2026). Ficando, ele "ressuscitava": semanas
        // depois o robo acendia a conversa com o motivo velho ("Enviou um
        // arquivo") para quem so escreveu "boa tarde".
        attention_reason: null,
        last_message_at: agora,
        ...(visivel.status === 'resolved' ? { status: 'open' } : {}),
      })
      .eq('id', visivel.id)

    return json({ ok: true, enviadoPara: primeiroNome })
  } catch (causa) {
    console.error('whatsapp-reopen failed', causa)
    return json({ error: 'Falha inesperada ao enviar.', code: 'UNEXPECTED' }, 500)
  }
})
