import { adminClient, corsHeaders, json, toBrazilE164, userClient } from '../_shared/whatsapp.ts'
import { variantesDoTelefone } from '../_shared/telefone-br.ts'
import { chaveDoWhatsApp, foraDaListaDeTeste, listaDeTeste } from '../_shared/whatsapp-teste.ts'

/**
 * Cancela uma consulta e avisa o paciente pelo WhatsApp.
 *
 * As duas coisas juntas de proposito. Enquanto eram separadas, o botao da
 * agenda apenas liberava o horario e ninguem avisava a familia: o paciente
 * aparecia na unidade no dia, com a crianca, e descobria na recepcao.
 *
 * O aviso nem sempre chega, e a funcao nao esconde isso. Fora da janela de 24
 * horas da Meta so passa template aprovado, e a clinica ainda nao tem um para
 * cancelamento. Quando nao da, a consulta e cancelada do mesmo jeito - o
 * horario precisa ser liberado - mas a resposta diz que ninguem foi avisado,
 * para a recepcao telefonar. Cancelar em silencio achando que avisou seria o
 * pior dos dois mundos.
 */

const JANELA_HORAS = 24

type Pedido = {
  appointmentId?: string
  /** Rotulo escolhido na tela, ou o texto que a pessoa escreveu. */
  motivo?: string
  /** Falso quando a equipe prefere ligar em vez de mandar mensagem. */
  avisarPaciente?: boolean
  /**
   * Manda tres horarios da mesma unidade junto do aviso.
   *
   * Cancelar sem oferecer alternativa empurra o trabalho para a familia, que
   * vai ter de voltar, navegar o menu e escolher tudo de novo. Com as sugestoes
   * o paciente resolve num toque, na mesma mensagem em que recebeu a ma
   * noticia.
   */
  sugerirDatas?: boolean
  /**
   * So avisar: a consulta ja foi cancelada e o paciente ficou sem saber.
   *
   * Sem isto, a unica forma de reenviar seria cancelar de novo - o que a
   * funcao recusa, e com razao. O aviso que falha na hora nao pode virar um
   * beco sem saida: alguem tem de poder tentar outra vez.
   */
  apenasAvisar?: boolean
}

type Horario = { inicio: string; fim: string }

/**
 * O que o paciente le.
 *
 * O motivo entra na mensagem porque "sua consulta foi cancelada" sem explicacao
 * soa a descaso. A excecao e quando o cancelamento partiu da propria familia:
 * ali repetir o motivo de volta seria estranho, e a mensagem vira confirmacao.
 */
function formatarHorario(iso: string, fuso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: fuso,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).replace('-feira', '')
}

function mensagemParaPaciente(
  nome: string,
  quando: string,
  unidade: string | null,
  motivo: string,
  sugestoes: Horario[],
  fuso: string,
) {
  const tratamento = nome ? `Olá, ${nome}! ` : 'Olá! '
  const onde = unidade ? ` em ${unidade}` : ''
  const aPedido = /pedido (do|da) paciente|pedido da fam[ií]lia/i.test(motivo)

  const abertura = aPedido
    ? `${tratamento}Confirmando: sua consulta de *${quando}*${onde} foi cancelada, ` +
      'conforme você pediu.'
    : `${tratamento}Precisamos cancelar sua consulta de *${quando}*${onde}.\n\n` +
      `Motivo: ${motivo}.\n\nSentimos muito pelo transtorno.`

  if (sugestoes.length === 0) {
    return `${aPedido ? '✅' : '⚠️'} ${abertura}\n\n` +
      '🗓️ Para escolher uma nova data, digite *2* aqui mesmo, ou *9* para falar com a nossa equipe.'
  }

  const linhas = sugestoes
    .map((h, i) => `*${i + 1}* ${formatarHorario(h.inicio, fuso)}`)
    .join('\n')

  return (
    `${aPedido ? '✅' : '⚠️'} ${abertura}\n\n` +
    `🗓️ *Já separamos outros horários${unidade ? ` em ${unidade}` : ''}:*\n\n${linhas}\n\n` +
    'Responda com o número para remarcar, ou toque em uma das opções.\n' +
    'Digite *2* para ver mais datas, ou *9* para falar com a nossa equipe.'
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const autorizacao = req.headers.get('Authorization') ?? ''
  if (!autorizacao.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

  try {
    const corpo = (await req.json()) as Pedido
    if (!corpo.appointmentId) return json({ error: 'Consulta não informada.' }, 400)

    // Reenvio: a consulta ja esta cancelada e o que falta e avisar. Acontece
    // quando o aviso falhou na hora - Meta fora do ar, modelo nao aprovado, ou
    // o furo do telefone que existiu ate 11/09/2026 - e alguem precisa poder
    // tentar de novo sem cancelar nada duas vezes.
    const soAvisar = corpo.apenasAvisar === true

    const motivo = (corpo.motivo ?? '').trim()
    if (!motivo && !soAvisar) return json({ error: 'Escolha ou escreva o motivo.' }, 400)

    const escopo = userClient(autorizacao)
    const admin = adminClient()

    // A RLS e a autorizacao: consulta de outra clinica nao aparece.
    const { data: consulta } = await escopo
      .from('appointments')
      .select(
        'id,clinic_id,patient_id,starts_at,status,unit_id,contact_phone,contact_name,cancellation_reason',
      )
      .eq('id', corpo.appointmentId)
      .maybeSingle()

    if (!consulta) return json({ error: 'Consulta não encontrada.', code: 'NOT_VISIBLE' }, 403)
    if (consulta.status === 'cancelled' && !soAvisar) {
      return json({ error: 'Esta consulta já estava cancelada.', code: 'JA_CANCELADA' }, 409)
    }
    if (soAvisar && consulta.status !== 'cancelled') {
      return json({ error: 'Esta consulta não está cancelada.', code: 'NAO_CANCELADA' }, 409)
    }

    const { data: usuario } = await escopo.auth.getUser()
    const agora = new Date().toISOString()

    // No reenvio o motivo e o que ja foi gravado no cancelamento: a familia
    // precisa ler a mesma explicacao, e nao uma nova versao dos fatos.
    const motivoFinal = soAvisar ? (consulta.cancellation_reason ?? '').trim() || 'imprevisto na agenda' : motivo

    // Primeiro cancela. O horario tem de ser liberado mesmo que o aviso falhe:
    // o pior resultado possivel seria uma vaga presa por causa da Meta.
    if (!soAvisar) {
      const { error: erroCancelar } = await admin
        .from('appointments')
        .update({
          status: 'cancelled',
          cancelled_at: agora,
          cancellation_reason: motivoFinal.slice(0, 300),
          cancelled_by: usuario?.user?.id ?? null,
        })
        .eq('id', consulta.id)
        .neq('status', 'cancelled')

      if (erroCancelar) {
        console.error('Falha ao cancelar', erroCancelar)
        return json({ error: 'Não foi possível cancelar a consulta.' }, 500)
      }
    }

    if (corpo.avisarPaciente === false) {
      return json({ ok: true, avisado: false, motivoDoSilencio: 'A equipe escolheu não avisar.' })
    }

    // Correcao interna da agenda nunca vira mensagem (05/10/2026), venha a
    // tela que vier. Ver MOTIVO_CORRECAO_INTERNA em src/lib/repository.ts: a
    // Ana Vitoria recebeu "foi cancelada, conforme voce pediu" de uma consulta
    // que a recepcao so tinha refeito para ligar a ficha.
    if (/^corre[cç][aã]o na agenda/i.test(motivo)) {
      return json({ ok: true, avisado: false, motivoDoSilencio: 'Correção na agenda: o paciente não é avisado.' })
    }

    // ---- Aviso ao paciente ----

    /**
     * A conversa desta pessoa, pelo cadastro OU pelo telefone.
     *
     * Procurar so pelo `patient_id` era um furo grande: quem marca sozinho pelo
     * WhatsApp entra na agenda SEM cadastro, com o nome e o telefone que o robo
     * coletou. Nessas consultas o `patient_id` e nulo, a busca nao achava nada,
     * e a tela dizia "este paciente nunca conversou pelo WhatsApp da clinica" -
     * justamente sobre quem tinha acabado de conversar para marcar. A consulta
     * era cancelada e ninguem avisava a familia.
     *
     * O telefone e a chave que sempre existe: e por ele que a conversa e
     * identificada no WhatsApp, com ou sem prontuario.
     */
    async function acharConversa() {
      if (consulta.patient_id) {
        const { data } = await admin
          .from('whatsapp_conversations')
          .select('id,wa_id,status,profile_name')
          .eq('clinic_id', consulta.clinic_id)
          .eq('patient_id', consulta.patient_id)
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (data) return data
      }

      for (const telefone of telefones) {
        const { data } = await admin
          .from('whatsapp_conversations')
          .select('id,wa_id,status,profile_name')
          .eq('clinic_id', consulta.clinic_id)
          // Todas as grafias do numero: com e sem o nono digito.
          .in('wa_id', variantesDoTelefone(telefone))
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (data) return data
      }
      return null
    }

    // Telefones possiveis: o da consulta e o do cadastro. O do cadastro faltava
    // aqui ate 24/09/2026 - paciente cadastrado sem conversa nunca era achado.
    const { data: cadastro } = consulta.patient_id
      ? await admin
          .from('patients')
          .select('phone,whatsapp_opt_out_at')
          .eq('id', consulta.patient_id)
          .maybeSingle()
      : { data: null }
    const telefones = [...new Set(
      [consulta.contact_phone, cadastro?.phone]
        .map((t) => String(t ?? '').trim())
        .filter((t) => t.replace(/\D/g, '').length >= 10),
    )]

    if (cadastro?.whatsapp_opt_out_at) {
      return json({ ok: true, avisado: false, motivoDoSilencio: 'Este paciente pediu para não receber mensagens.' })
    }

    let conversa = await acharConversa()

    /**
     * Quem nunca escreveu para a clinica tambem e avisado (24/09/2026).
     *
     * Antes, sem conversa, a funcao desistia: "Nao encontrei conversa no
     * WhatsApp da clinica para este telefone". E o caso mais comum de quem
     * marcou por telefone com a recepcao - justamente quem nao tem outro canal.
     * A familia aparecia com a crianca numa consulta cancelada.
     *
     * O lembrete da vespera ja resolvia isso criando a conversa e mandando
     * modelo aprovado; aqui e o mesmo caminho. Sem conversa nao ha janela de 24h,
     * entao o envio sai pelo modelo de cancelamento.
     */
    if (!conversa && telefones.length > 0) {
      const telefone = telefones[0]
      const { data: criada, error: erroCriar } = await admin
        .from('whatsapp_conversations')
        .upsert(
          {
            clinic_id: consulta.clinic_id,
            // So com paciente de verdade: nulo aqui apagaria um vinculo que a
            // conversa ja tivesse (mesmo defeito corrigido no webhook).
            ...(consulta.patient_id ? { patient_id: consulta.patient_id } : {}),
            wa_id: toBrazilE164(telefone),
            display_phone: telefone,
            last_message_at: agora,
          },
          { onConflict: 'clinic_id,wa_id' },
        )
        .select('id,wa_id,status,profile_name')
        .single()
      if (erroCriar) console.error('Nao consegui criar a conversa para avisar o cancelamento', erroCriar)
      conversa = criada ?? null
    }

    if (!conversa) {
      return json({
        ok: true,
        avisado: false,
        motivoDoSilencio: telefones.length > 0
          ? 'Não consegui abrir uma conversa no WhatsApp para este telefone. Ligue para avisar.'
          : 'Esta consulta não tem telefone nem cadastro, então não há para onde avisar.',
      })
    }
    if (conversa.status === 'opted_out') {
      return json({
        ok: true,
        avisado: false,
        motivoDoSilencio: 'Este contato pediu para não receber mensagens.',
      })
    }

    // Clinica de teste (27/09/2026): o numero de teste da Meta so entrega para
    // os celulares cadastrados. Para os outros, diz isso na tela em vez de
    // mostrar uma recusa da Meta que parece defeito.
    if (foraDaListaDeTeste(await listaDeTeste(admin, consulta.clinic_id), String(conversa.wa_id ?? ''))) {
      return json({
        ok: true,
        avisado: false,
        motivoDoSilencio: 'Clínica em modo teste: este telefone não está na lista de teste do WhatsApp.',
      })
    }

    const { data: ultimaEntrada } = await admin
      .from('whatsapp_messages')
      .select('created_at')
      .eq('conversation_id', conversa.id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const dentroDaJanela = ultimaEntrada
      ? Date.now() - new Date(ultimaEntrada.created_at).getTime() < JANELA_HORAS * 3600 * 1000
      : false

    // Fora da janela o texto livre nao passa. O modelo aprovado passa - e e o
    // unico caminho que existe, porque cancelamento quase sempre acontece com
    // dias de antecedencia, quando o paciente nao escreve ha muito tempo.
    const porModelo = !dentroDaJanela

    const { data: paciente } = consulta.patient_id
      ? await admin.from('patients').select('name').eq('id', consulta.patient_id).maybeSingle()
      : { data: null }

    const { data: unidade } = consulta.unit_id
      ? await admin.from('clinic_units').select('name').eq('id', consulta.unit_id).maybeSingle()
      : { data: null }

    const { data: ajustes } = await admin
      .from('clinic_settings')
      .select('whatsapp_phone_number_id,whatsapp_cancel_template_name,whatsapp_template_language')
      .eq('clinic_id', consulta.clinic_id)
      .maybeSingle()

    // O fuso vive em clinics, e nao em clinic_settings. Sem ele, uma consulta
    // das 15:00 seria anunciada como 18:00 para o paciente.
    const { data: clinica } = await admin
      .from('clinics')
      .select('timezone')
      .eq('id', consulta.clinic_id)
      .maybeSingle()

    const token = chaveDoWhatsApp(ajustes?.whatsapp_phone_number_id)
    if (!token || !ajustes?.whatsapp_phone_number_id) {
      return json({
        ok: true,
        avisado: false,
        motivoDoSilencio: 'O WhatsApp da clínica não está configurado.',
      })
    }

    const fuso = clinica?.timezone || 'America/Sao_Paulo'
    const quando = new Date(consulta.starts_at).toLocaleString('pt-BR', {
      timeZone: fuso,
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).replace('-feira', '')

    // Sem cadastro, o nome que a familia deu ao marcar vale mais do que o
    // apelido do WhatsApp - foi ele que a pessoa escreveu para a clinica.
    const primeiroNome = (paciente?.name || consulta.contact_name || conversa.profile_name || '')
      .trim()
      .split(/\s+/)[0] ?? ''

    // ---- Tres horarios da mesma unidade ----
    //
    // Da MESMA unidade de proposito: quem marcou em Santos nao quer sugestao de
    // Ibirapuera. E so tres, porque a mensagem chega junto com uma ma noticia e
    // uma lista longa ali vira ruido.
    //
    // Sugerir e escolha explicita de quem cancela: sem o pedido, a mensagem
    // apenas avisa. Oferecer data nova por conta propria transforma "sua
    // consulta foi cancelada" numa proposta que ninguem fez.
    let sugestoes: Horario[] = []
    if (!porModelo && corpo.sugerirDatas === true && consulta.unit_id) {
      await admin.rpc('liberar_reservas_vencidas')
      const { data: livres } = await admin.rpc('available_slots', { p_unit_id: consulta.unit_id })
      sugestoes = ((livres ?? []) as { slot_start: string; slot_end: string }[])
        .map((h) => ({ inicio: h.slot_start, fim: h.slot_end }))
        // Fora o horario que acabou de ser cancelado: ele voltou a ficar livre
        // no mesmo segundo, e reoferecer a vaga que a clinica acabou de
        // desmarcar e o tipo de coisa que faz a familia duvidar do aviso.
        .filter((h) => h.inicio !== consulta.starts_at)
        .slice(0, 3)
    }

    const texto = mensagemParaPaciente(
      primeiroNome,
      quando,
      unidade?.name ?? null,
      motivoFinal,
      sugestoes,
      fuso,
    )
    const versao = Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'

    // Deixa a conversa no mesmo ponto em que o robo deixaria depois de listar
    // horarios. Assim o toque do paciente cai no fluxo que ja existe, e a
    // remarcacao acontece sem nenhum caminho novo para dar errado.
    if (sugestoes.length > 0) {
      await admin
        .from('whatsapp_conversations')
        .update({
          booking_state: 'aguardando_horario',
          booking_options: sugestoes,
          booking_unit_id: consulta.unit_id,
          booking_patient_id: consulta.patient_id,
          // Carimbo obrigatorio: a etapa expira 24h depois desta data. Sem ele
          // a conversa nasceria vencida e o toque do paciente cairia no menu.
          booking_updated_at: new Date().toISOString(),
        })
        .eq('id', conversa.id)
    } else {
      // Sem sugestoes, a mensagem promete "digite 2 aqui mesmo". Sem deixar o
      // menu ativo, esse 2 chegava numa conversa sem etapa e o robo respondia
      // com o menu inteiro - a pessoa fazia o que foi mandado e recebia outra
      // pergunta. Com o menu ativo, o 2 ja abre a escolha de unidade.
      await admin
        .from('whatsapp_conversations')
        .update({
          booking_state: 'menu',
          booking_options: null,
          booking_unit_id: null,
          booking_patient_id: consulta.patient_id,
          booking_replaces_id: null,
          booking_updated_at: new Date().toISOString(),
        })
        .eq('id', conversa.id)
    }

    // Pelo modelo nao ha lista tocavel nem texto livre: a Meta so aceita o
    // corpo aprovado com as variaveis preenchidas. As sugestoes de horario
    // ficam de fora, e a mensagem convida a responder - a resposta reabre a
    // janela e o paciente cai no robo, que ai sim oferece os horarios.
    const corpoPorModelo = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: conversa.wa_id,
      type: 'template',
      template: {
        name: ajustes.whatsapp_cancel_template_name || 'consulta_cancelada',
        language: { code: ajustes.whatsapp_template_language || 'pt_BR' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: (primeiroNome || 'tudo bem').slice(0, 60) },
            { type: 'text', text: quando.slice(0, 120) },
            { type: 'text', text: motivoFinal.slice(0, 200) },
          ],
        }],
      },
    }

    const corpoDaMensagem = porModelo
      ? corpoPorModelo
      : sugestoes.length > 0
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: conversa.wa_id,
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: texto },
            action: {
              button: 'Escolher horário',
              sections: [{
                rows: [
                  ...sugestoes.map((h, i) => ({
                    id: String(i + 1),
                    title: formatarHorario(h.inicio, fuso).slice(0, 24),
                  })),
                  { id: '9', title: 'Falar com a equipe' },
                  { id: '0', title: 'Voltar ao menu' },
                ],
              }],
            },
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: conversa.wa_id,
          type: 'text',
          text: { preview_url: false, body: texto },
        }

    const envio = await fetch(
      `https://graph.facebook.com/${versao}/${ajustes.whatsapp_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoDaMensagem),
      },
    )

    const resposta = await envio.json()

    await admin.from('whatsapp_messages').insert({
      clinic_id: consulta.clinic_id,
      conversation_id: conversa.id,
      patient_id: consulta.patient_id,
      appointment_id: consulta.id,
      external_message_id: resposta?.messages?.[0]?.id ?? null,
      direction: 'outbound',
      automatic: true,
      message_type: porModelo ? 'template' : sugestoes.length > 0 ? 'interactive' : 'text',
      template_name: porModelo ? (ajustes.whatsapp_cancel_template_name || 'consulta_cancelada') : null,
      body: texto,
      status: envio.ok ? 'accepted' : 'failed',
      sent_at: envio.ok ? agora : null,
      failed_at: envio.ok ? null : agora,
      failure_reason: envio.ok ? null : String(resposta?.error?.message ?? '').slice(0, 300),
    })

    if (!envio.ok) {
      console.error('Meta recusou o aviso de cancelamento', resposta)
      // 132001 = modelo inexistente ou ainda nao aprovado. E o erro esperado
      // enquanto a clinica nao criou o modelo, e merece texto proprio: "a Meta
      // recusou" mandaria a recepcao procurar defeito onde nao ha.
      const semModelo = porModelo &&
        (resposta?.error?.code === 132001 || /template/i.test(String(resposta?.error?.message ?? '')))
      return json({
        ok: true,
        avisado: false,
        motivoDoSilencio: semModelo
          ? 'O paciente não escreve há mais de 24 horas e o modelo de cancelamento ainda ' +
            'não foi aprovado pela Meta. Ligue para avisar.'
          : 'A Meta recusou o envio. Ligue para avisar.',
      })
    }

    await admin
      .from('appointments')
      .update({ cancellation_notified_at: agora })
      .eq('id', consulta.id)

    return json({ ok: true, avisado: true, enviadoPara: primeiroNome || null })
  } catch (causa) {
    console.error('appointment-cancel falhou', causa)
    return json({ error: causa instanceof Error ? causa.message : 'Falha inesperada.' }, 500)
  }
})
