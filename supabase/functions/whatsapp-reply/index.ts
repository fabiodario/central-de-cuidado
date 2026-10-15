import { adminClient, corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { iniciarQuestionario, mostrarMenu, oferecerHorarios } from '../_shared/atendimento.ts'
import { montarConteudo } from '../_shared/conteudo.ts'
import { variantesDoTelefone } from '../_shared/telefone-br.ts'
import { chaveDoWhatsApp } from '../_shared/whatsapp-teste.ts'

/**
 * Resposta livre da equipe para um paciente, a partir da tela de Conversas.
 *
 * A regra que manda aqui e a janela de atendimento da Meta: texto livre so pode
 * ser enviado ate 24 horas depois da ULTIMA mensagem do paciente. Passado isso,
 * so template aprovado. A funcao recusa antes de chamar a Meta para o erro
 * chegar na tela em portugues, e nao como um codigo cru da Graph API.
 */

const JANELA_HORAS = 24
const LIMITE_CARACTERES = 4096

/** Como a Meta recebe cada tipo, e o limite de tamanho de cada um. */
function classificarArquivo(arquivo: File): { tipo: 'image' | 'document'; limite: number } | null {
  const mime = arquivo.type
  if (mime === 'image/jpeg' || mime === 'image/png') return { tipo: 'image', limite: 5 * 1048576 }
  const documentos = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ]
  return documentos.includes(mime) ? { tipo: 'document', limite: 20 * 1048576 } : null
}

/** O que o questionario precisa saber da ficha: o que ja esta preenchido. */
type PacienteDaFicha = {
  id: string
  name: string
  nascimento: string | null
  responsavel: string | null
  cpf: string | null
  email: string | null
}

type ReplyRequest = {
  conversationId?: string
  /**
   * Verdadeiro quando quem escreve e o sistema, e nao alguem da equipe. Muda
   * so a marca da mensagem: o menu automatico usa isso para saber se ha gente
   * de carne e osso na conversa.
   */
  automatico?: boolean
  text?: string
  /**
   * Em vez de texto, manda o menu do robo (a lista tocavel de opcoes) e volta
   * a conversa para o estado "menu". Serve para quando a equipe reabriu a
   * conversa e quer devolver a pessoa ao atendimento automatico.
   */
  menu?: boolean
  /**
   * Em vez de texto, refaz as perguntas do cadastro (nome, nascimento,
   * responsavel, CPF, e-mail) na conversa. Serve para quem marcou e abandonou
   * a ficha: a recepcao dispara pelo botao em vez de ligar.
   */
  questionario?: boolean
  /**
   * Em vez de texto, manda os horarios livres de uma unidade, como lista
   * tocavel do robo (14/10/2026, botao "Mandar horarios"). A familia toca no
   * dia e no horario e o robo marca. `unidade` e o id, ou 'telemedicina';
   * `de`/`ate` (AAAA-MM-DD) limitam os dias; `pacienteId` diz de quem e a
   * consulta quando ha irmaos no mesmo telefone.
   */
  horarios?: { unidade?: string; de?: string | null; ate?: string | null; pacienteId?: string | null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

    // Com arquivo, o pedido chega como formulario (multipart); sem, como JSON.
    let body: ReplyRequest
    let arquivo: File | null = null
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData()
      body = {
        conversationId: String(form.get('conversationId') ?? ''),
        text: String(form.get('text') ?? ''),
      }
      const campo = form.get('arquivo')
      arquivo = campo instanceof File && campo.size > 0 ? campo : null
    } else {
      body = (await req.json()) as ReplyRequest
    }
    const querMenu = body.menu === true
    const querQuestionario = body.questionario === true
    const querHorarios = Boolean(body.horarios?.unidade)
    let texto = (body.text ?? '').trim()
    if (!body.conversationId) return json({ error: 'Conversa não informada.' }, 400)

    // Arquivo da equipe para a familia (24/09/2026): receita, pedido de exame,
    // recibo. Antes so dava pelo celular, e o envio ficava fora do historico.
    // Limites da Meta: imagem ate 5 MB; documento ate 100 MB, mas o acervo da
    // clinica aceita 20 MB. A legenda de midia vai ate 1024 caracteres.
    const envio = arquivo ? classificarArquivo(arquivo) : null
    if (arquivo && !envio) {
      return json({
        error: 'Tipo de arquivo não aceito. Envie PDF, imagem (JPG ou PNG), Word, Excel ou texto.',
        code: 'TIPO_RECUSADO',
      }, 400)
    }
    if (arquivo && envio && arquivo.size > envio.limite) {
      return json({
        error: `Arquivo grande demais: o limite para ${envio.tipo === 'image' ? 'imagem' : 'documento'} é ${Math.round(envio.limite / 1048576)} MB.`,
        code: 'GRANDE_DEMAIS',
      }, 400)
    }
    if (arquivo && texto.length > 1024) {
      return json({ error: 'A legenda de um arquivo vai até 1024 caracteres.' }, 400)
    }
    // So exige texto digitado quando e a equipe escrevendo. O menu e o
    // questionario chegam aqui sem texto de proposito: quem monta a mensagem e
    // o robo, mais abaixo. Sem esta ressalva o botao Questionario batia nesta
    // linha e voltava "Escreva a mensagem antes de enviar" sem nunca enviar.
    if (!texto && !querMenu && !querQuestionario && !querHorarios && !arquivo) {
      return json({ error: 'Escreva a mensagem antes de enviar.' }, 400)
    }
    if (texto.length > LIMITE_CARACTERES) {
      return json({ error: `A mensagem passa de ${LIMITE_CARACTERES} caracteres.` }, 400)
    }

    // A RLS e a autorizacao: so aparece conversa de clinica onde o usuario e
    // membro ativo. Se nao vier nada, ele nao pode responder.
    const scoped = userClient(authorization)
    const { data: visivel, error: visivelError } = await scoped
      .from('whatsapp_conversations')
      .select('id,clinic_id,patient_id,wa_id,status')
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

    // Ultima mensagem RECEBIDA. Nao serve o last_message_at da conversa, que
    // tambem se move quando a clinica envia - isso faria a janela parecer
    // aberta para sempre.
    const { data: ultimaEntrada } = await admin
      .from('whatsapp_messages')
      .select('created_at')
      .eq('conversation_id', visivel.id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!ultimaEntrada) {
      return json({
        error: 'Este contato ainda não escreveu para a clínica, então só é possível enviar um modelo aprovado.',
        code: 'NO_INBOUND',
      }, 409)
    }

    const fechaEm = new Date(new Date(ultimaEntrada.created_at).getTime() + JANELA_HORAS * 3600 * 1000)
    if (Date.now() > fechaEm.getTime()) {
      return json({
        error: 'A janela de 24 horas fechou. Para retomar, é preciso enviar um modelo aprovado pela Meta.',
        code: 'WINDOW_CLOSED',
        windowClosedAt: fechaEm.toISOString(),
      }, 409)
    }

    const { data: settings } = await admin
      .from('clinic_settings')
      .select('whatsapp_phone_number_id,whatsapp_autoreply_text')
      .eq('clinic_id', visivel.clinic_id)
      .single()

    // Menu do robo: o mesmo texto e a mesma lista que o paciente ve quando
    // escreve "menu", e a conversa volta para o estado inicial. A partir daqui
    // o robo responde ao que a pessoa tocar.
    let toques: Parameters<typeof montarConteudo>[1] | undefined
    if (querMenu) {
      const menu = await mostrarMenu(admin, visivel.id, (settings?.whatsapp_autoreply_text ?? '').trim())
      texto = menu?.resposta ?? ''
      toques = menu?.lista ? { lista: menu.lista } : undefined
    }

    // Questionario do cadastro, disparado pela equipe.
    //
    // As respostas precisam de um destino, e ha dois: a consulta e a ficha do
    // paciente. Basta um.
    //
    // Ate 16/09/2026 exigia consulta FUTURA, e isso deixava de fora justamente
    // quem a equipe mais quer alcancar: o paciente antigo que nunca deu o CPF e
    // nao tem nada marcado. Agora a busca e, nesta ordem: consulta futura,
    // consulta passada (a mais recente), ficha. So recusa quem nao tem nenhuma
    // das tres - ai nao ha onde guardar nada, e marcar vem primeiro.
    if (querQuestionario) {
      const agora = new Date().toISOString()
      const telefone = visivel.wa_id

      // A ficha que recebe as respostas quando nao ha consulta nenhuma.
      //
      // Procurada pelo TELEFONE, com a mesma regra do webhook (com e sem o 55
      // do pais, com e sem o nono digito). Tem de ser a mesma: e o webhook que
      // vai reconhecer a pessoa quando a resposta chegar, e um cadastro que ele
      // nao encontra faria o robo perguntar e jogar fora o que a familia
      // digitasse.
      const { data: fichas } = await admin
        .from('patients')
        .select('id,name,nascimento:birth_date,responsavel:guardian_name,cpf,email')
        .eq('clinic_id', visivel.clinic_id)
        .is('archived_at', null)
        .in('phone_digits', variantesDoTelefone(telefone ?? ''))
        .order('name')
      const encontradas = (fichas ?? []) as unknown as PacienteDaFicha[]
      const paciente = encontradas.length === 1 ? encontradas[0] : null

      // A consulta onde pendurar as respostas: a proxima futura; nao havendo,
      // a ultima que ja passou. Qualquer uma serve - o que ela dá é um lugar
      // para o dado ficar até alguém conferir.
      const donoDaConsulta = visivel.patient_id ?? paciente?.id ?? null
      const buscarConsulta = async (futura: boolean) => {
        let busca = admin.from('appointments').select('id').eq('clinic_id', visivel.clinic_id)
        busca = donoDaConsulta
          ? busca.eq('patient_id', donoDaConsulta)
          : busca.eq('contact_phone', telefone)
        busca = futura
          ? busca.eq('status', 'scheduled').gte('starts_at', agora).order('starts_at', { ascending: true })
          : busca.lt('starts_at', agora).order('starts_at', { ascending: false })
        const { data } = await busca.limit(1).maybeSingle()
        return data as { id: string } | null
      }
      const consulta = (await buscarConsulta(true)) ?? (await buscarConsulta(false))

      if (!consulta && !paciente) {
        return json({
          error: encontradas.length > 1
            // Mae com dois filhos cadastrados no mesmo celular: perguntar "qual
            // é o CPF?" sem saber de quem seria gravar no irmao errado.
            ? 'Há mais de um paciente cadastrado neste telefone, e sem consulta marcada não dá para saber de quem são as respostas. Marque a consulta primeiro.'
            : 'Esta pessoa ainda não tem cadastro nem consulta nenhuma, então as respostas não teriam onde ficar. Marque a consulta primeiro - o robô já pergunta tudo na hora.',
          code: 'SEM_DESTINO',
        }, 409)
      }

      const inicio = await iniciarQuestionario(admin, visivel.id, consulta?.id ?? null, paciente)
      // Sem resultado nao ha primeira pergunta para mandar: ou o cadastro ja
      // esta completo, ou a montagem da pergunta falhou. Nos dois casos e
      // melhor a equipe ler o motivo do que a familia receber um vazio.
      if (!inicio?.resultado) {
        return json({
          error: 'O cadastro desta pessoa já está completo. Não há o que perguntar.',
          code: 'CADASTRO_COMPLETO',
        }, 409)
      }
      const quantas =
        inicio.faltam.length === 1 ? 'uma pergunta rápida' : `${inicio.faltam.length} perguntas rápidas`
      texto =
        `📋 Para completar o cadastro, ${quantas}.\n\n` + (inicio.resultado.resposta ?? '')
      toques = inicio.resultado.botoes ? { botoes: inicio.resultado.botoes } : undefined
    }

    if (!settings?.whatsapp_phone_number_id) {
      return json({ error: 'Configuração do WhatsApp incompleta.', code: 'INCOMPLETE' }, 409)
    }

    const token = chaveDoWhatsApp(settings.whatsapp_phone_number_id)
    if (!token) return json({ error: 'Token do WhatsApp não configurado.', code: 'NO_TOKEN' }, 503)

    // Horarios livres pela lista do robo (14/10/2026). Ver oferecerHorarios.
    if (querHorarios && body.horarios) {
      // De quem e a consulta: o que a equipe escolheu; sem escolha, o unico
      // paciente deste telefone (mesma busca do webhook e do questionario).
      // Com irmaos e sem escolha, nada sai: a tela pergunta de quem e, porque
      // marcar no irmao errado e o tipo de erro que so aparece no consultorio.
      let pacienteId = body.horarios.pacienteId ?? null
      if (pacienteId) {
        const { data: daClinica } = await admin
          .from('patients')
          .select('id')
          .eq('id', pacienteId)
          .eq('clinic_id', visivel.clinic_id)
          .maybeSingle()
        if (!daClinica) return json({ error: 'Paciente não encontrado nesta clínica.', code: 'PACIENTE' }, 400)
      } else {
        const { data: fichas } = await admin
          .from('patients')
          .select('id,name')
          .eq('clinic_id', visivel.clinic_id)
          .is('archived_at', null)
          .in('phone_digits', variantesDoTelefone(visivel.wa_id ?? ''))
          .order('name')
        const doTelefone = (fichas ?? []) as { id: string; name: string }[]
        if (doTelefone.length > 1) {
          return json({ escolherPaciente: doTelefone.map((p) => ({ id: p.id, nome: p.name })) })
        }
        pacienteId = doTelefone[0]?.id ?? visivel.patient_id ?? null
      }

      const oferta = await oferecerHorarios(admin, visivel.clinic_id, visivel.id, {
        unidade: String(body.horarios.unidade),
        de: body.horarios.de ?? null,
        ate: body.horarios.ate ?? null,
        pacienteId,
      })
      if ('erro' in oferta) return json({ error: oferta.erro, code: 'SEM_HORARIO' }, 409)
      texto = oferta.resultado.resposta
      toques = oferta.resultado.lista
        ? { lista: oferta.resultado.lista }
        : oferta.resultado.botoes
          ? { botoes: oferta.resultado.botoes }
          : undefined
    }

    const graphVersion = Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'
    const agora = new Date().toISOString()

    // Com arquivo: guarda no acervo da clinica (o historico mostra o que foi
    // enviado), sobe para a Meta e manda pelo id que ela devolve.
    let conteudo: Record<string, unknown> = montarConteudo(texto, toques)
    let tipoDaMensagem = toques ? 'interactive' : 'text'
    let corpoNoHistorico = texto
    let midia: { media_path: string; media_mime: string } | null = null
    if (arquivo && envio) {
      const bytes = new Uint8Array(await arquivo.arrayBuffer())
      const caminho = `${visivel.clinic_id}/saida-${crypto.randomUUID()}`
      const { error: erroAcervo } = await admin.storage
        .from('whatsapp-anexos')
        .upload(caminho, bytes, { contentType: arquivo.type, upsert: false })
      if (erroAcervo) {
        console.error('Nao consegui guardar o arquivo no acervo', erroAcervo)
        return json({ error: 'Não consegui guardar o arquivo. Nada foi enviado.', code: 'ACERVO' }, 500)
      }
      midia = { media_path: caminho, media_mime: arquivo.type }

      const paraMeta = new FormData()
      paraMeta.append('messaging_product', 'whatsapp')
      paraMeta.append('type', arquivo.type)
      paraMeta.append('file', new Blob([bytes], { type: arquivo.type }), arquivo.name || 'arquivo')
      const subida = await fetch(
        `https://graph.facebook.com/${graphVersion}/${settings.whatsapp_phone_number_id}/media`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: paraMeta },
      )
      const subidaCorpo = await subida.json().catch(() => ({}))
      if (!subida.ok || !subidaCorpo?.id) {
        const motivo = subidaCorpo?.error?.message || 'A Meta recusou o arquivo.'
        console.error('Meta recusou o upload do arquivo', subidaCorpo)
        await admin.from('whatsapp_messages').insert({
          clinic_id: visivel.clinic_id,
          conversation_id: visivel.id,
          patient_id: visivel.patient_id,
          direction: 'outbound',
          automatic: false,
          message_type: envio.tipo,
          body: texto || arquivo.name || 'Arquivo',
          status: 'failed',
          failed_at: agora,
          failure_reason: motivo,
          ...midia,
        })
        return json({ error: 'A Meta recusou o arquivo.', code: 'META_REJECTED', details: motivo }, 502)
      }

      const legenda = texto ? { caption: texto } : {}
      conteudo = envio.tipo === 'image'
        ? { type: 'image', image: { id: subidaCorpo.id, ...legenda } }
        : { type: 'document', document: { id: subidaCorpo.id, filename: arquivo.name || 'arquivo', ...legenda } }
      tipoDaMensagem = envio.tipo
      corpoNoHistorico = texto || arquivo.name || 'Arquivo'
    }

    const resposta = await fetch(
      `https://graph.facebook.com/${graphVersion}/${settings.whatsapp_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: visivel.wa_id,
          ...conteudo,
        }),
      },
    )

    const corpo = await resposta.json()

    if (!resposta.ok) {
      const motivo = corpo?.error?.message || 'Meta recusou o envio.'
      await admin.from('whatsapp_messages').insert({
        clinic_id: visivel.clinic_id,
        conversation_id: visivel.id,
        patient_id: visivel.patient_id,
        direction: 'outbound',
        automatic: body.automatico === true || querMenu || querQuestionario || querHorarios,
        message_type: tipoDaMensagem,
        body: corpoNoHistorico,
        status: 'failed',
        failed_at: agora,
        failure_reason: motivo,
        ...(midia ?? {}),
      })
      return json({ error: 'A Meta recusou o envio.', code: 'META_REJECTED', details: motivo }, 502)
    }

    const { data: salva, error: salvaError } = await admin
      .from('whatsapp_messages')
      .insert({
        clinic_id: visivel.clinic_id,
        conversation_id: visivel.id,
        patient_id: visivel.patient_id,
        external_message_id: corpo?.messages?.[0]?.id ?? null,
        direction: 'outbound',
        automatic: body.automatico === true || querMenu || querQuestionario || querHorarios,
        message_type: tipoDaMensagem,
        body: corpoNoHistorico,
        status: 'accepted',
        sent_at: agora,
        ...(midia ?? {}),
      })
      .select('id,status,created_at')
      .single()

    if (salvaError) {
      console.error('Message insert failed', salvaError)
      return json({
        error: 'A mensagem foi enviada mas não pôde ser registrada.',
        code: 'SAVE_FAILED',
      }, 500)
    }

    // Respondeu: a conversa deixa de pedir atencao e some o contador de novas.
    // E se estava concluida, volta a aberta: quem escreve de novo esta
    // retomando o atendimento, e ele nao pode continuar com cara de encerrado
    // (23/09/2026, conversa concluida recebeu mensagem e seguiu "Concluida").
    await admin
      .from('whatsapp_conversations')
      .update({
        needs_attention: false,
        // O motivo sai junto (24/09/2026). Ficando, ele "ressuscitava": semanas
        // depois o robo acendia a conversa com o motivo velho ("Enviou um
        // arquivo") para quem so escreveu "boa tarde".
        attention_reason: null,
        unread_count: 0,
        last_message_at: agora,
        ...(visivel.status === 'resolved' ? { status: 'open' } : {}),
      })
      .eq('id', visivel.id)

    return json({ ok: true, message: salva, windowClosesAt: fechaEm.toISOString() })
  } catch (error) {
    console.error(error)
    return json({ error: 'Não foi possível enviar a mensagem agora.' }, 500)
  }
})
