import '../_shared/whatsapp.ts'
import { adminClient, digits, sha256HmacHex, safeEqual } from '../_shared/whatsapp.ts'
import { colherEventos, etiquetaQueFica, type Estado, type Toque, tratarConversa } from '../_shared/atendimento.ts'
import { montarMensagens } from '../_shared/conteudo.ts'
import { RegistroDeEventos } from '../_shared/eventos-do-webhook.ts'
import { variantesDoTelefone } from '../_shared/telefone-br.ts'
import {
  destinoDaNaoSuportada,
  semRespostaDoRobo,
  textoDaLocalizacao,
  textoDosContatos,
  TEXTO_NAO_SUPORTADA,
} from '../_shared/mensagem-recebida.ts'
import { roboRespondeNaConversa } from '../_shared/robo-da-conversa.ts'
import { chaveDoWhatsApp } from '../_shared/whatsapp-teste.ts'
import { montarAviso } from '../_shared/aviso-da-equipe.ts'
import { avisarEquipe } from '../_shared/push-da-equipe.ts'
import {
  alertaEmAberto,
  deveAlertar,
  enviarAlertaDeUrgencia,
  lerNumeros as lerNumerosDoAlerta,
  type MotivoDoAlerta,
  quemNoAlerta,
  whatsAppPelaApi,
} from '../_shared/alerta-de-urgencia.ts'
import { ANEXO_RECENTE_MS, anexoQueVai, anexoRecenteDaConversa, type AnexoParaEquipe } from '../_shared/anexo-para-equipe.ts'
import { acompanharEnvioDoAnexo, entregarAnexosPendentes } from '../_shared/anexos-pendentes.ts'
import { MOTIVOS_COM_VEREDITO } from '../_shared/veredito.ts'
import { pediuReset, podeResetar, resetarConversaDeTeste, respostaDoReset } from '../_shared/reset-de-teste.ts'
import { repassarRespostaDoPaciente, tratarRespostaDaEquipe } from '../_shared/resposta-ao-alerta.ts'
import {
  BOTOES_URGENCIA_OU_DUVIDA,
  contextoDaLeitura,
  decidirSegundaLeitura,
  lerComJev,
  type Leitura,
  type MensagemDoHistorico,
  modoDaSegundaLeitura,
  PERGUNTA_URGENCIA_OU_DUVIDA,
  precisaDeLeitura,
  temBotaoDeUrgencia,
} from '../_shared/segunda-leitura.ts'
import {
  ESPERA_MAXIMA_MS,
  complementoDaRajada,
  precisaEsperar,
  qualquerMensagem,
  rajadaJaRespondida,
  anteriorEmCurso,
  ESPERA_PELA_ANTERIOR_MS,
  JANELA_DA_FILA_MS,
  type EventoDeMensagem,
} from '../_shared/rajada.ts'

// O runtime das Edge Functions deixa terminar trabalho depois da resposta.
// Fora dele (teste local) cai no await comum.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
import {
  acompanhamentoEncerraConversa,
  avisoDaResposta,
  depoisDoAcompanhamento,
  depoisDoPedidoDeSair,
  lembreteRecente,
  unidadeNoLembrete,
  respostaAoAcompanhamento,
  equipeFalouRecentemente as equipeFalouHaPouco,
  interpretarResposta,
  mudancaDaConsulta,
  oQueFoiEscolhido,
  respondendoEnvioNosso as dentroDaJanelaDeResposta,
} from '../_shared/lembrete.ts'

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

type Midia = { id?: string; mime_type?: string; caption?: string; filename?: string }

type WebhookMessage = {
  type?: string
  text?: { body?: string }
  image?: Midia
  document?: Midia
  audio?: Midia
  video?: Midia
  sticker?: Midia
  voice?: Midia
  button?: { text?: string; payload?: string }
  interactive?: {
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string }
  }
  /** Em qual mensagem nossa estava o botao tocado. */
  context?: { id?: string; from?: string }
  location?: { latitude?: number; longitude?: number; name?: string; address?: string; url?: string }
  contacts?: {
    name?: { formatted_name?: string; first_name?: string }
    phones?: { phone?: string; wa_id?: string }[]
  }[]
}

type DeliveryError = { title?: string; message?: string }

/**
 * Identificador do que a pessoa tocou, quando ela tocou em vez de digitar.
 *
 * Os ids sao escritos iguais ao que o robo ja aceita por escrito ("2", "SIM",
 * "CANCELAR"), entao toque e digitacao entram pelo mesmo caminho e nenhuma
 * regra precisou ser duplicada. O texto legivel continua indo para o historico.
 */
function idDoToque(message: WebhookMessage): string {
  if (message.type === 'interactive') {
    return (
      message.interactive?.button_reply?.id ??
      message.interactive?.list_reply?.id ??
      ''
    )
  }
  // Botao de modelo aprovado: a Meta manda o payload configurado no template.
  if (message.type === 'button') return message.button?.payload ?? ''
  return ''
}

/**
 * A mensagem e um arquivo, e nao texto.
 *
 * Foto, documento, audio, video, figurinha: o robo nao le nenhum deles. Servem
 * para decidir entregar para a equipe em vez de responder o menu. Localizacao e
 * contato ficam de fora porque tambem nao sao pergunta - mas sao raros o
 * bastante para nao valer regra propria hoje.
 */
function ehAnexo(message: WebhookMessage) {
  // Localizacao e contato entram aqui desde 25/09/2026: nao sao pergunta, e o
  // robo nao tem o que fazer com eles - quem precisa ver e a equipe. Antes
  // caiam como "[location]" e recebiam o menu inteiro.
  return ['image', 'document', 'audio', 'video', 'sticker', 'voice', 'location', 'contacts'].includes(
    String(message.type),
  )
}

/** O bloco de midia da mensagem, qualquer que seja o tipo dela. */
function midiaDaMensagem(message: WebhookMessage): Midia | null {
  return (
    message.image ?? message.document ?? message.audio ??
    message.video ?? message.sticker ?? message.voice ?? null
  )
}

/**
 * Traz o arquivo da Meta para o nosso acervo.
 *
 * Precisa acontecer AGORA, no recebimento. A Meta nao entrega o arquivo no
 * webhook: entrega um id, e a URL que esse id resgata vive poucos minutos.
 * Guardar so o id para baixar depois nao funciona - quando alguem da equipe
 * abrisse a conversa, o link ja teria morrido.
 *
 * Sao duas chamadas: o id devolve uma URL, e a URL devolve os bytes. As duas
 * exigem o token, inclusive a segunda, que e o detalhe que costuma passar
 * despercebido.
 *
 * Nunca interrompe o recebimento. Se o download falhar, a mensagem entra do
 * jeito antigo, marcada como anexo e sem arquivo - melhor a equipe saber que
 * chegou algo do que perder a mensagem inteira por causa do anexo.
 */
async function guardarAnexo(
  admin: ReturnType<typeof adminClient>,
  clinicId: string,
  messageId: string,
  midia: Midia,
  phoneNumberId: string,
): Promise<{ path: string; mime: string } | null> {
  const token = chaveDoWhatsApp(phoneNumberId)
  if (!token || !midia.id) return null
  const graphVersion = Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'

  try {
    const aviso = await fetch(`https://graph.facebook.com/${graphVersion}/${midia.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!aviso.ok) {
      console.error('Meta recusou o endereco da midia', aviso.status, await aviso.text())
      return null
    }
    const { url, mime_type } = await aviso.json() as { url?: string; mime_type?: string }
    if (!url) return null

    // O download tambem vai autenticado: sem o token a Meta devolve 401.
    const arquivo = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!arquivo.ok) {
      console.error('Nao consegui baixar a midia', arquivo.status)
      return null
    }
    const bytes = new Uint8Array(await arquivo.arrayBuffer())
    const mime = midia.mime_type ?? mime_type ?? 'application/octet-stream'
    const path = `${clinicId}/${messageId}`

    const { error } = await admin.storage
      .from('whatsapp-anexos')
      .upload(path, bytes, { contentType: mime, upsert: true })
    if (error) {
      console.error('Nao consegui guardar a midia no acervo', error)
      return null
    }
    return { path, mime }
  } catch (causa) {
    console.error('Falha ao trazer a midia', causa)
    return null
  }
}

function messageBody(message: WebhookMessage) {
  if (message.type === 'text') return message.text?.body ?? ''
  if (message.type === 'button') return message.button?.text ?? message.button?.payload ?? ''
  if (message.type === 'interactive') {
    return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? ''
  }
  // Localizacao e contato viram texto legivel no historico (25/09/2026), em
  // vez de "[location]" e "[contacts]" - a equipe precisa do endereco e do
  // telefone, nao do nome do tipo.
  if (message.type === 'location') return textoDaLocalizacao(message.location)
  if (message.type === 'contacts') return textoDosContatos(message.contacts)
  // A legenda da foto e a mensagem de verdade: "olha o exame dele" diz mais
  // do que "[image]", e antes ela era jogada fora.
  const midia = midiaDaMensagem(message)
  const legenda = (midia?.caption ?? '').trim()
  if (legenda) return legenda
  if (midia?.filename) return midia.filename
  return `[${message.type || 'mensagem'}]`
}


/**
 * Ordem dos estados de uma mensagem: um aviso so substitui outro de ordem
 * igual ou maior.
 *
 * "failed" era o mais alto e travava a mensagem ali. Em 23/09/2026 a Meta
 * mandou "Message undeliverable" para um convite que chegou no celular, e o
 * "entregue" que veio depois foi descartado: a tela mostrou "falhou" para uma
 * mensagem recebida. Entregue e lida sao prova de que chegou, entao valem mais
 * do que uma falha. Falha continua valendo mais do que aceita e enviada.
 */
const statusRank: Record<string, number> = {
  queued: 0,
  accepted: 1,
  sent: 2,
  failed: 2.5,
  delivered: 3,
  read: 4,
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN')?.trim()
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (verifyToken && mode === 'subscribe' && token === verifyToken && challenge) return text(challenge)
    return text('Webhook verification failed', 403)
  }

  if (req.method !== 'POST') return text('Method not allowed', 405)

  const rawBody = await req.text()
  const appSecret = Deno.env.get('META_APP_SECRET')?.trim()
  const providedSignature = req.headers.get('x-hub-signature-256') ?? ''
  if (!appSecret || !providedSignature.startsWith('sha256=')) return text('Unauthorized', 401)

  const expected = `sha256=${await sha256HmacHex(appSecret, rawBody)}`
  if (!safeEqual(expected, providedSignature)) return text('Invalid signature', 401)

  // Fora do try: o catch precisa dele para liberar o evento que falhou.
  let registro: RegistroDeEventos | null = null

  try {
    const payload = JSON.parse(rawBody)
    const admin = adminClient()
    registro = new RegistroDeEventos({
      inserir: (linha) => admin.from('whatsapp_webhook_events').insert(linha),
      apagar: (chave) => admin.from('whatsapp_webhook_events').delete().eq('event_key', chave),
      // Conclusao e retomada (23/10/2026, vindo do sistema do Dr. Marcello): ver
      // eventos-do-webhook.ts. Condicional: so a linha sem conclusao e gravada
      // antes do corte. Dois reenvios ao mesmo tempo nao retomam juntos (o
      // primeiro move processed_at).
      concluir: (chave) =>
        admin.from('whatsapp_webhook_events').update({ concluded_at: new Date().toISOString() }).eq('event_key', chave),
      retomar: (chave, gravadoAntesDe) =>
        admin.from('whatsapp_webhook_events')
          .update({ processed_at: new Date().toISOString() })
          .eq('event_key', chave)
          .is('concluded_at', null)
          .lt('processed_at', gravadoAntesDe)
          .select('event_key'),
    })

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        // Tudo que veio antes terminou; um erro daqui ate o proximo registrar
        // nao pertence a nenhum evento.
        await registro.concluir()
        if (change.field !== 'messages') continue
        const value = change.value ?? {}
        const phoneNumberId = String(value.metadata?.phone_number_id ?? '')
        if (!phoneNumberId) continue

        const { data: settings } = await admin
          .from('clinic_settings')
          .select(
            'clinic_id,whatsapp_autoreply_enabled,whatsapp_autoreply_text,whatsapp_autoreply_known_text,whatsapp_menu_info_text',
          )
          .eq('whatsapp_phone_number_id', phoneNumberId)
          .maybeSingle()
        if (!settings?.clinic_id) continue
        const clinicId = settings.clinic_id

        // O modo do Jev (17/10/2026, Preferencias) em consulta separada: a
        // coluna e nova, e o Postgres recusa a query inteira quando uma coluna
        // nao existe. Sem ler, fica desligado e o robo segue como sempre.
        let opcaoDoJev: string | null = null
        try {
          const { data: jev, error: erroDoJev } = await admin
            .from('clinic_settings')
            .select('jev_segunda_leitura')
            .eq('clinic_id', clinicId)
            .maybeSingle()
          if (erroDoJev) console.warn('meta-webhook: nao li o modo do Jev; segue desligado', erroDoJev.message)
          opcaoDoJev = (jev?.jev_segunda_leitura as string | null | undefined) ?? null
        } catch (erro) {
          console.warn('meta-webhook: nao li o modo do Jev; segue desligado', erro)
        }

        // A Meta manda em `contacts` o nome que a pessoa configurou no WhatsApp
        // dela. Nao e nome verificado, mas para um contato sem cadastro e a
        // unica coisa que a equipe tem para saber com quem esta falando.
        const nomePorWaId = new Map<string, string>()
        for (const contato of value.contacts ?? []) {
          const id = digits(String(contato?.wa_id ?? ''))
          const nome = String(contato?.profile?.name ?? '').trim()
          if (id && nome) nomePorWaId.set(id, nome.slice(0, 120))
        }

        // Os numeros do alerta de urgencia (17/10/2026), lidos uma vez por
        // lote e so quando chega mensagem: ver resposta-ao-alerta.ts.
        let numerosDoAlerta: string[] | null | undefined

        for (const message of value.messages ?? []) {
          // A mensagem anterior do lote terminou (inclusive pelos continue).
          await registro.concluir()
          const externalId = String(message.id ?? '')
          if (!externalId) continue

          // Reacao (o emoji apertado em cima de uma mensagem) nao e conversa.
          //
          // A Meta manda a reacao pelo mesmo caminho de uma mensagem de texto.
          // Como ela nao tem corpo, virava "[reaction]" e o robo respondia o
          // menu inteiro. Aconteceu com o Henrique em 15/09/2026: ele respondeu
          // "Estou bem" ao acompanhamento, recebeu o "que bom saber", reagiu com
          // um emoji e levou de volta "Como podemos ajudar hoje?", como se
          // tivesse perguntado alguma coisa.
          //
          // Ignorada por inteiro, e nao so na resposta: guardar "[reaction]" no
          // historico suja a leitura de quem abre a conversa depois para
          // entender o caso.
          if (message.type === 'reaction') continue

          // Ver eventos-do-webhook.ts: se algo falhar daqui em diante, a chave
          // e apagada no catch e o reenvio da Meta processa de novo.
          if ((await registro.registrar(`message:${externalId}`, 'message', { entry_id: entry.id, change })) === 'repetido') {
            continue
          }

          const waId = digits(String(message.from ?? ''))
          // RESET de teste (25/10/2026, TEMPORARIO, ver _shared/reset-de-teste.ts):
          // so com a clinica em modo teste e de um celular da lista. Lido aqui,
          // antes da resposta ao alerta: o RESET do Dr. Fabio ou da Dayane nao
          // pode virar resposta a um alerta de teste.
          const ehReset = pediuReset(messageBody(message)) && (await podeResetar(admin, clinicId, waId))

          // O medico respondendo ao alerta de urgencia pelo WhatsApp dele
          // (17/10/2026, ver _shared/resposta-ao-alerta.ts): o toque ou o texto
          // dele vai para o paciente, e nao para o robo, que responderia o menu
          // como se ele fosse paciente. Antes de tudo o mais, para a mensagem
          // dele nao virar conversa de paciente. Falhando aqui, segue o caminho
          // de sempre, e grita no log.
          try {
            if (numerosDoAlerta === undefined) numerosDoAlerta = await lerNumerosDoAlerta(admin, clinicId)
            // O celular do alerta escreveu (ou tocou num botao): a janela de 24
            // horas da Meta abriu, e o arquivo do paciente que ela tinha recusado
            // vai agora (25/10/2026, vindo do sistema do Dr. Marcello, ver
            // _shared/anexos-pendentes.ts).
            if (numerosDoAlerta?.some((numero) => variantesDoTelefone(numero).includes(waId))) {
              const foram = await entregarAnexosPendentes(
                admin,
                clinicId,
                waId,
                whatsAppPelaApi(phoneNumberId, chaveDoWhatsApp(phoneNumberId)),
                new Date(),
              )
              if (foram) console.info(`Anexos pendentes: ${foram} entregue(s) ao celular final ${waId.slice(-4)}`)
            }
            if (numerosDoAlerta?.length && !ehReset) {
              const tratada = await tratarRespostaDaEquipe(
                {
                  admin,
                  clinicId,
                  agora: new Date(),
                  numeros: numerosDoAlerta,
                  enviarWhatsApp: whatsAppPelaApi(phoneNumberId, chaveDoWhatsApp(phoneNumberId)),
                },
                waId,
                message,
              )
              if (tratada) continue
            }
          } catch (erro) {
            console.error('Resposta ao alerta de urgencia falhou; segue como mensagem comum', erro)
          }

          // Com e sem o nono digito (ver telefone-br.ts): numero antigo chega
          // da Meta sem o 9, e o cadastro guarda com ele.
          const grafias = variantesDoTelefone(waId)

          // Conversa aberta por um envio nosso com a outra grafia do numero
          // (lembrete ou acompanhamento para "13991234567", resposta chegando
          // de "551391234567"). Sem isto a pessoa ficava com duas conversas, e
          // a resposta caia na que nao tinha o lembrete. A grafia da Meta e a
          // verdadeira: a conversa antiga passa a usa-la.
          try {
            const { data: exata } = await admin
              .from('whatsapp_conversations')
              .select('id')
              .eq('clinic_id', clinicId)
              .eq('wa_id', waId)
              .maybeSingle()
            if (!exata) {
              const { data: outra } = await admin
                .from('whatsapp_conversations')
                .select('id,wa_id')
                .eq('clinic_id', clinicId)
                .in('wa_id', grafias.filter((g) => g !== waId))
                .order('last_message_at', { ascending: false })
                .limit(1)
                .maybeSingle()
              if (outra) {
                await admin.from('whatsapp_conversations').update({ wa_id: waId }).eq('id', outra.id)
                console.warn(`Conversa ${outra.id} passou de ${outra.wa_id} para ${waId} (nono digito)`)
              }
            }
          } catch (causa) {
            console.warn('Nao consegui juntar a conversa das duas grafias do numero', causa)
          }
          // Todos os pacientes deste telefone, e nao o primeiro que aparecer.
          // Numa gastropediatria a mae cadastra os dois filhos com o proprio
          // celular; escolher sozinho marcava consulta no nome do irmao errado.
          const { data: patientRows } = await admin
            .from('patients')
            .select('id,name,birth_date,guardian_name,cpf,email')
            .eq('clinic_id', clinicId)
            .is('archived_at', null)
            .in('phone_digits', grafias)
            .order('name')

          const pacientes = (patientRows ?? []).map((p) => {
            const linha = p as Record<string, unknown>
            return {
              id: p.id as string,
              name: (p.name as string) ?? '',
              // O que o cadastro ja tem. O robo so pergunta o que falta.
              nascimento: (linha.birth_date as string | null) ?? null,
              responsavel: (linha.guardian_name as string | null) ?? null,
              cpf: (linha.cpf as string | null) ?? null,
              email: (linha.email as string | null) ?? null,
            }
          })
          // Para ligar a conversa e as mensagens basta um: sao da familia toda.
          // Quem precisa de precisao e a consulta, e essa o robo pergunta.
          const patient = pacientes[0] ?? null

          // Consultas futuras deste telefone. Alimentam a opcao 4 do menu e o
          // aviso de "voce ja tem uma marcada" antes de criar uma segunda.
          const { data: futurasRows } = await admin
            .from('appointments')
            .select('id,starts_at,unit_id,contact_name,patient_id,confirmed_by_clinic')
            .eq('clinic_id', clinicId)
            .eq('status', 'scheduled')
            .gte('starts_at', new Date().toISOString())
            // contact_phone e gravado so com digitos (createAppointment), entao
            // as grafias do numero servem direto.
            .in('contact_phone', grafias)
            .order('starts_at')

          const idsUnidades = [...new Set((futurasRows ?? []).map((a) => a.unit_id))]
          const unidadesPorId = new Map<string, { name: string; address: string }>()
          if (idsUnidades.length > 0) {
            const { data: us } = await admin
              .from('clinic_units')
              .select('id,name,address')
              .in('id', idsUnidades)
            for (const u of us ?? []) unidadesPorId.set(u.id, { name: u.name, address: u.address })
          }

          const nomePorPacienteId = new Map(pacientes.map((p) => [p.id, p.name]))
          const consultas = (futurasRows ?? []).map((a) => ({
            id: a.id as string,
            inicio: a.starts_at as string,
            unidade: unidadesPorId.get(a.unit_id)?.name ?? 'nossa unidade',
            endereco: unidadesPorId.get(a.unit_id)?.address ?? '',
            paciente:
              (a.patient_id ? nomePorPacienteId.get(a.patient_id) : null) ??
              (a.contact_name as string) ??
              '',
            confirmada: Boolean(a.confirmed_by_clinic),
          }))

          // Consulta de hoje e consulta recente (09/10/2026), em consulta propria
          // e dentro de try/catch: falhar aqui custa so os dois tratamentos
          // abaixo, nunca a conversa.
          //  - consultaHoje: "vou atrasar" vira recado para a equipe.
          //  - consultouHaPouco: atendido nos ultimos 10 dias. O que a familia
          //    escreve contando como a crianca esta e recado para o medico, como
          //    a resposta ao acompanhamento - e nao "isso e avaliacao para a
          //    consulta". A mae do Otavio contou, dois dias depois da consulta,
          //    que ele seguia com dor, e ouviu exatamente isso.
          let consultaHoje = false
          let consultouHaPouco = false
          try {
            const agoraMs = Date.now()
            const diaSP = (iso: string | Date) =>
              new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
            const hoje = diaSP(new Date(agoraMs))
            const { data: recentes, error: erroRecentes } = await admin
              .from('appointments')
              .select('starts_at,status')
              .eq('clinic_id', clinicId)
              .in('status', ['scheduled', 'attended'])
              .gte('starts_at', new Date(agoraMs - 10 * 24 * 3600 * 1000).toISOString())
              .lte('starts_at', new Date(agoraMs + 24 * 3600 * 1000).toISOString())
              .in('contact_phone', grafias)
            if (erroRecentes) throw erroRecentes
            for (const r of recentes ?? []) {
              if (diaSP(r.starts_at as string) === hoje) consultaHoje = true
              if (r.status === 'attended' && new Date(r.starts_at as string).getTime() <= agoraMs) consultouHaPouco = true
            }
          } catch (erro) {
            console.warn('Nao consegui ler as consultas recentes deste telefone', erro)
          }

          // Estado da conversa ANTES de gravar esta mensagem. E o que diz se a
          // pessoa e nova: depois do upsert a linha ja existe sempre.
          //
          // A coluna nova vem num segundo pedido, e nao junto das outras. O
          // Postgres nao ignora coluna que nao existe: recusa a consulta
          // INTEIRA. Em 19/09/2026 esta linha pediu booking_insurance antes de
          // a migration rodar, linhaAnterior voltou nula, e o webhook passou a
          // tratar TODA mensagem como a primeira da conversa - com a regra de
          // "primeira mensagem sempre mostra o menu", o paciente digitava 1 e
          // recebia o menu, tres vezes seguidas, sem nenhum erro aparente.
          //
          // Perder o convenio e um arranhao. Perder o estado da conversa
          // desliga o atendimento inteiro. Por isso os dois pedidos.
          // Rajada (01/10/2026, ver _shared/rajada.ts): se a familia acabou de
          // escrever e ainda nao teve resposta, esta mensagem espera essa
          // resposta sair antes de ler a conversa. Sem isto as duas rodavam
          // juntas e a segunda respondia por cima da primeira. Era so nota
          // fiscal ate 14/10/2026; agora vale para qualquer mensagem.
          //
          // E se esta mensagem for so o complemento ("Tudo bem?", "?") de uma
          // que o robo acabou de responder, ela nao recebe resposta propria:
          // o Vicente recebeu dois menus por "boa tarde!" + "Tudo bem?".
          //
          // Em try/catch e com limite: a espera e cortesia. Se a consulta
          // falhar ou o tempo acabar, segue como antes - com aviso no log.
          let complementoDeRajada = false
          // Antes de tudo, a fila (24/10/2026, vindo do sistema do Dr. Marcello;
          // ver anteriorEmCurso em _shared/rajada.ts): se a mensagem anterior
          // desta pessoa ainda esta sendo atendida - mesmo antes de ser
          // gravada -, esta espera ela terminar. A espera abaixo so enxerga
          // mensagem ja gravada.
          try {
            const inicioDaFila = Date.now()
            let esperou = false
            while (Date.now() - inicioDaFila < ESPERA_PELA_ANTERIOR_MS) {
              const { data: eventos, error: erroDaFila } = await admin
                .from('whatsapp_webhook_events')
                .select('id,event_key,concluded_at')
                .eq('event_kind', 'message')
                .eq('payload->change->value->messages->0->>from', String(message.from ?? ''))
                .gte('processed_at', new Date(Date.now() - JANELA_DA_FILA_MS).toISOString())
              if (erroDaFila) throw erroDaFila
              const fila: EventoDeMensagem[] = ((eventos ?? []) as { id: number; event_key: string; concluded_at: string | null }[])
                .map((e) => ({ id: Number(e.id), chave: String(e.event_key), concluidoEm: e.concluded_at }))
              if (!anteriorEmCurso(fila, `message:${externalId}`)) break
              esperou = true
              await new Promise((ok) => setTimeout(ok, 500))
            }
            if (esperou && Date.now() - inicioDaFila >= ESPERA_PELA_ANTERIOR_MS) {
              console.warn('Fila: a mensagem anterior desta pessoa nao terminou a tempo; seguindo assim mesmo', waId)
            }
          } catch (erro) {
            console.warn('Fila: nao consegui conferir a mensagem anterior desta pessoa; seguindo sem esperar', erro)
          }
          try {
            const { data: conversaDaRajada } = await admin
              .from('whatsapp_conversations')
              .select('id')
              .eq('clinic_id', clinicId)
              .eq('wa_id', waId)
              .maybeSingle()
            if (conversaDaRajada?.id) {
              const inicio = Date.now()
              while (Date.now() - inicio < ESPERA_MAXIMA_MS) {
                const { data: ultima } = await admin
                  .from('whatsapp_messages')
                  .select('direction,created_at,body')
                  .eq('conversation_id', conversaDaRajada.id)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
                const resumo = ultima
                  ? {
                      direction: ultima.direction as 'inbound' | 'outbound',
                      criadaEm: String(ultima.created_at),
                      corpo: (ultima.body as string | null) ?? '',
                    }
                  : null
                if (!precisaEsperar(resumo, Date.now(), qualquerMensagem)) break
                await new Promise((ok) => setTimeout(ok, 500))
              }
              if (Date.now() - inicio >= ESPERA_MAXIMA_MS) {
                console.warn('Rajada: a mensagem anterior nao teve resposta a tempo; seguindo assim mesmo', waId)
              }
              if (message.type === 'text' && complementoDaRajada(messageBody(message))) {
                const { data: recentes } = await admin
                  .from('whatsapp_messages')
                  .select('direction,automatic,created_at')
                  .eq('conversation_id', conversaDaRajada.id)
                  .order('created_at', { ascending: false })
                  .limit(3)
                complementoDeRajada = rajadaJaRespondida(
                  ((recentes ?? []) as { direction: 'inbound' | 'outbound'; automatic?: boolean | null; created_at: string }[])
                    .map((m) => ({ direction: m.direction, automatic: m.automatic, criadaEm: m.created_at })),
                  Date.now(),
                )
              }
            }
          } catch (erro) {
            console.warn('Rajada: nao consegui conferir a mensagem anterior', erro)
          }

          const COLUNAS_ESTAVEIS =
            'id,booking_state,booking_options,booking_unit_id,booking_patient_id,' +
            'booking_replaces_id,booking_intake_id,booking_modality,needs_attention,' +
            'attention_reason,profile_name,booking_updated_at,auto_replies_while_waiting,' +
            'menu_sent_at,status'

          const { data: linhaAnterior } = await admin
            .from('whatsapp_conversations')
            .select(COLUNAS_ESTAVEIS)
            .eq('clinic_id', clinicId)
            .eq('wa_id', waId)
            .maybeSingle()

          // O convenio vem num pedido proprio, e nao junto: se a coluna ainda
          // nao existe, so ele se perde.
          let convenioEmAndamento: string | null = null
          if (linhaAnterior) {
            const { data: extra } = await admin
              .from('whatsapp_conversations')
              .select('booking_insurance')
              .eq('clinic_id', clinicId)
              .eq('wa_id', waId)
              .maybeSingle()
            convenioEmAndamento =
              (extra as { booking_insurance?: string | null } | null)?.booking_insurance ?? null
          }

          // Etapa vencida: depois de 24h parada, a conversa recomeca do zero.
          //
          // A varredura de hora em hora (liberar_conversas_travadas) limpa o
          // banco e a tela, mas ela roda no minuto 10. Sem esta conferencia,
          // quem escrevesse 24h05 depois cairia na etapa velha ate a hora
          // cheia seguinte - o robo cobrando o CPF de um agendamento que a
          // pessoa ja esqueceu, ou calado porque a equipe "assumiu" ontem.
          //
          // 24h e a janela da Meta: passou dela, a sessao anterior acabou de
          // verdade e esta mensagem inaugura outra.
          const carimbo = linhaAnterior?.booking_updated_at as string | null | undefined
          // 48h quando a clinica e que ficou devendo resposta: o anexo que
          // alguem precisa abrir, o "Preciso de ajuda" respondido ao
          // acompanhamento, e o pedido de 2a via ou de exame - da familia ou da
          // farmacia. Nesses a equipe costuma precisar de mais de um dia util, e
          // o robo voltando a falar no meio seria atropelo. Nos outros, 24h.
          //
          // A MESMA LISTA vive em liberar_conversas_travadas(), no banco. As
          // duas precisam concordar: esta decide se a proxima mensagem da
          // familia reabre o menu, aquela limpa conversa parada. Em 20/09/2026
          // os motivos novos entraram so na do banco, e o efeito era este -
          // pedido feito sexta as 18h, familia escreve domingo, 40h > 24h, e o
          // robo respondia com a saudacao inteira como se nada estivesse
          // pendente. Exatamente o que a migration dizia estar evitando.
          const motivoDaEspera = String(linhaAnterior?.attention_reason ?? '')
          const ESPERA_LONGA = ['anexo', 'ajuda', 'documento', 'farmacia']
          const horasDeEspera = ESPERA_LONGA.includes(motivoDaEspera) ? 48 : 24
          const etapaVenceu = Boolean(
            linhaAnterior?.booking_state &&
              (!carimbo || Date.now() - new Date(carimbo).getTime() > horasDeEspera * 60 * 60 * 1000),
          )
          const conversaAnterior =
            linhaAnterior && etapaVenceu
              ? {
                  ...linhaAnterior,
                  booking_state: null,
                  booking_options: null,
                  booking_unit_id: null,
                  booking_patient_id: null,
                  booking_replaces_id: null,
                  booking_intake_id: null,
                  booking_modality: null,
                }
              : linhaAnterior
          if (etapaVenceu) convenioEmAndamento = null

          // A ultima coisa que NOS mandamos foi um lembrete de consulta ou um
          // acompanhamento? So nesse caso "1", "2" e "3" significam confirmar,
          // remarcar e cancelar. Fora dele sao opcoes de menu.
          //
          // Antes isso era decidido por "esta no meio de um agendamento?", o
          // que deixava o numero ambiguo em toda conversa parada. Amarrar a
          // leitura ao que acabamos de perguntar acaba com a duvida.
          let respondendoEnvioNosso = false
          // Alguem da EQUIPE escreveu para esta pessoa ha pouco: conversa humana
          // em andamento, e o robo nao entra no meio dela oferecendo menu.
          //
          // A pergunta precisa ser sobre gente. Ate 30/08/2026 ela era so "saiu
          // alguma mensagem daqui?", e o robo se calava por causa da propria
          // voz: respondeu 11:36, a pessoa escreveu "Oi" as 14:28 e nao recebeu
          // nada.
          let equipeFalouRecentemente = false
          // Id da nossa mensagem mais recente, para saber se um toque veio de
          // uma lista antiga. Ver oQueFoiEscolhido em _shared/lembrete.ts.
          let ultimoEnvioId: string | null = null
          // A conversa ainda e a do acompanhamento pos-consulta (03/10/2026).
          // Ver depoisDoAcompanhamento em _shared/lembrete.ts.
          let acompanhamentoRecente = false
          // Lembrete de consulta nas ultimas 48h, ainda que nao seja a ultima
          // mensagem nossa (06/10/2026). Ver lembreteRecente em lembrete.ts.
          let comLembreteRecente = false
          // A ultima mensagem nossa foi o lembrete em si (20/10/2026, vindo do
          // sistema do Dr. Marcello): so ai "sim" e "ok" confirmam. Ver
          // interpretarResposta.
          let ultimaFoiLembrete = false
          if (conversaAnterior?.id) {
            const [ultimoNossoResult, ultimoHumanoResult, ultimoAcompanhamentoResult, ultimoLembreteResult] = await Promise.all([
              admin
                .from('whatsapp_messages')
                .select('followup_id,appointment_id,created_at,external_message_id,template_name')
                .eq('conversation_id', conversaAnterior.id)
                .eq('direction', 'outbound')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
              admin
                .from('whatsapp_messages')
                .select('created_at')
                .eq('conversation_id', conversaAnterior.id)
                .eq('direction', 'outbound')
                .eq('automatic', false)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
              admin
                .from('whatsapp_messages')
                .select('created_at')
                .eq('conversation_id', conversaAnterior.id)
                .eq('direction', 'outbound')
                .not('followup_id', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
              admin
                .from('whatsapp_messages')
                .select('created_at')
                .eq('conversation_id', conversaAnterior.id)
                .eq('direction', 'outbound')
                .not('appointment_id', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            ])

            // A consulta da ultima mensagem nossa ainda esta marcada? Aviso de
            // cancelamento tambem vai ligado a consulta, e o "digite 2" dele e
            // do menu, nao do lembrete (13/10/2026, ver respondendoEnvioNosso).
            // Consulta propria e try/catch: falhando, vale o de antes.
            let consultaAindaMarcada: boolean | null = null
            const consultaDoEnvio = (ultimoNossoResult.data as { appointment_id?: string | null } | null)?.appointment_id
            if (consultaDoEnvio) {
              try {
                const { data: situacao, error: erroSituacao } = await admin
                  .from('appointments')
                  .select('status')
                  .eq('id', consultaDoEnvio)
                  .maybeSingle()
                if (erroSituacao) throw erroSituacao
                if (situacao) consultaAindaMarcada = (situacao as { status?: string }).status === 'scheduled'
              } catch (erro) {
                console.warn('Nao consegui ler a consulta da ultima mensagem; 1/2/3 seguem como resposta ao lembrete', erro)
              }
            }
            respondendoEnvioNosso = dentroDaJanelaDeResposta(ultimoNossoResult.data, Date.now(), consultaAindaMarcada)
            {
              const u = ultimoNossoResult.data as { appointment_id?: string | null; followup_id?: string | null; template_name?: string | null } | null
              ultimaFoiLembrete = respondendoEnvioNosso && Boolean(u?.appointment_id && !u.followup_id && u.template_name)
            }
            // Falha aqui custa so o tratamento especial do pos-consulta: a
            // mensagem segue o caminho de sempre. Mas avisa, para nao virar
            // mais um defeito mudo.
            if (ultimoAcompanhamentoResult.error) {
              console.warn('Nao consegui ler o ultimo acompanhamento da conversa', ultimoAcompanhamentoResult.error)
            }
            acompanhamentoRecente = depoisDoAcompanhamento(ultimoAcompanhamentoResult.data)
            if (ultimoLembreteResult.error) {
              console.warn('Nao consegui ler o ultimo lembrete da conversa', ultimoLembreteResult.error)
            }
            comLembreteRecente = lembreteRecente(ultimoLembreteResult.data)
            ultimoEnvioId = (ultimoNossoResult.data as { external_message_id?: string | null } | null)?.external_message_id ?? null
            // Coluna nova (01/10/2026) em consulta propria: sem ela, perde-se
            // so o "Destravar" valendo contra a regra das 12h - nao a conversa.
            let roboLiberadoEm: string | null = null
            try {
              const { data: liberacao, error: erroLiberacao } = await admin
                .from('whatsapp_conversations')
                .select('robo_liberado_em')
                .eq('id', conversaAnterior.id)
                .maybeSingle()
              if (erroLiberacao) throw erroLiberacao
              roboLiberadoEm = (liberacao as { robo_liberado_em?: string | null } | null)?.robo_liberado_em ?? null
            } catch (erro) {
              console.warn('Coluna robo_liberado_em indisponivel; Destravar nao vence a regra das 12h', erro)
            }
            equipeFalouRecentemente = equipeFalouHaPouco(ultimoHumanoResult.data, Date.now(), roboLiberadoEm)
          }

          const body = messageBody(message)
          // O que a pessoa quis dizer. Vindo de toque, e o id do botao; digitado,
          // e o proprio texto. O `body` segue sendo o que aparece no historico.
          //
          // Toque em lista do robo passa por oQueFoiEscolhido: se a lista era de
          // uma mensagem antiga, o numero da opcao responderia a pergunta errada.
          // Botao de modelo aprovado (lembrete) fica fora - o payload dele,
          // "CONFIRMAR", significa a mesma coisa em qualquer mensagem.
          const escolhido =
            message.type === 'interactive'
              ? oQueFoiEscolhido({
                  id: idDoToque(message),
                  titulo: body,
                  respondeA: message.context?.id ?? null,
                  ultimoEnvio: ultimoEnvioId,
                })
              : idDoToque(message) || body
          // Uma chamada so, e a regra mora em _shared/lembrete.ts, coberta por
          // testes. Aqui ficou apenas o desempacotar.
          // O lembrete de ontem nao vale com a equipe conversando (09/10/2026).
          // A Luana remarcou com a secretaria, que escreveu "sua consulta foi
          // remarcada"; ela respondeu "pode confirmar amanha 09h20" e o robo leu
          // como resposta ao lembrete da vespera - "essa consulta nao aparece
          // mais como marcada" - no meio da conversa das duas. A janela curta
          // (lembrete como ultima mensagem nossa) continua valendo.
          const resposta = interpretarResposta(
            escolhido,
            respondendoEnvioNosso,
            comLembreteRecente && !equipeFalouRecentemente,
            ultimaFoiLembrete,
          )
          const { respondeuLembrete, optedOut, paraTudo, isWell, pediuAjuda, motivoAtencao } = resposta
          // A conversa so fica "nao quer receber" quando e para nao receber
          // nada. Paciente que saiu so do acompanhamento continua com lembrete
          // e com a equipe podendo responder (15/10/2026). Quem nao e paciente
          // nao tem acompanhamento: qualquer pedido de sair e para tudo.
          const receivedAt = message.timestamp
            ? new Date(Number(message.timestamp) * 1000).toISOString()
            : new Date().toISOString()

          // A bandeira de atencao so sobe aqui, nunca desce: quem baixa e a
          // equipe, abrindo a conversa na tela. Antes cada nova mensagem do
          // paciente apagava o pedido anterior - quem escrevia duas vezes
          // sumia da lista de quem esperava retorno.
          // A bandeira so sobe, nunca desce por mensagem do paciente: quem
          // baixa e a equipe, abrindo a conversa na tela.
          // Pediu para sair: o "ok, obrigado" seguinte nao desfaz o pedido, e o
          // robo nao responde a ele. Mensagem de verdade reabre e o robo atende.
          // Ver depoisDoPedidoDeSair.
          const statusDaConversa = depoisDoPedidoDeSair(
            linhaAnterior?.status as string | null | undefined,
            optedOut && (paraTudo || !patient?.id),
            body,
          )
          const foraDaLista = statusDaConversa === 'opted_out'
          const marcarAtencao =
            Boolean(conversaAnterior?.needs_attention) || Boolean(motivoAtencao)

          // Sem nome novo no evento, mantem o que ja estava gravado em vez de
          // apagar: nem todo evento traz o bloco `contacts`.
          const nomeDoPerfil = nomePorWaId.get(waId) ?? ''

          const { data: conversation, error: conversationError } = await admin
            .from('whatsapp_conversations')
            .upsert({
              clinic_id: clinicId,
              // So quando o telefone achou um paciente. Mandar nulo aqui
              // apagava o vinculo que a equipe fez a mao (irmaos no mesmo
              // celular, numero antigo sem o nono digito): a proxima mensagem
              // devolvia a conversa para "Contato sem cadastro" (24/09/2026).
              ...(patient?.id ? { patient_id: patient.id } : {}),
              wa_id: waId,
              display_phone: waId,
              status: statusDaConversa,
              needs_attention: marcarAtencao,
              last_message_at: receivedAt,
              ...(nomeDoPerfil ? { profile_name: nomeDoPerfil } : {}),
            }, { onConflict: 'clinic_id,wa_id' })
            .select('id,unread_count,patient_id')
            .single()
          if (conversationError) throw conversationError

          const atualizacaoConversa: Record<string, unknown> = {
            unread_count: (conversation.unread_count ?? 0) + 1,
            needs_attention: marcarAtencao,
            status: statusDaConversa,
          }
          if (motivoAtencao) atualizacaoConversa.attention_reason = motivoAtencao
          if (nomeDoPerfil) atualizacaoConversa.profile_name = nomeDoPerfil
          await admin
            .from('whatsapp_conversations')
            .update(atualizacaoConversa)
            .eq('id', conversation.id)

          // O arquivo e buscado ANTES de gravar a mensagem: a URL da Meta dura
          // poucos minutos, e se a gravacao demorasse ela ja teria expirado.
          const midia = midiaDaMensagem(message)
          const anexo = midia && externalId
            ? await guardarAnexo(admin, clinicId, externalId, midia, phoneNumberId)
            : null
          // O arquivo vai junto para os celulares do alerta (25/10/2026, vindo
          // do sistema do Dr. Marcello, ver _shared/anexo-para-equipe.ts), por
          // link assinado do acervo: o id da Meta serve para baixar, nao para
          // reenviar. Sem o link, vai so o alerta, como antes, e o log diz.
          let anexoParaEquipe: AnexoParaEquipe | undefined
          if (anexo && anexoQueVai(message.type)) {
            try {
              const { data: assinado, error: erroDoLink } = await admin.storage
                .from('whatsapp-anexos')
                .createSignedUrl(anexo.path, 24 * 3600)
              if (erroDoLink) throw erroDoLink
              if (assinado?.signedUrl) {
                anexoParaEquipe = {
                  tipo: String(message.type),
                  link: assinado.signedUrl,
                  nome: midia?.filename,
                  caminho: anexo.path,
                  recebidoEm: receivedAt,
                }
              }
            } catch (erro) {
              console.warn('Nao gerei o link do anexo para os celulares; vai so o alerta', erro)
            }
          }

          const { error: messageError } = await admin.from('whatsapp_messages').insert({
            clinic_id: clinicId,
            conversation_id: conversation.id,
            // O vinculo da conversa vale quando o telefone sozinho nao achou.
            patient_id: patient?.id ?? conversation.patient_id ?? null,
            external_message_id: externalId,
            direction: 'inbound',
            message_type: message.type || 'text',
            body,
            status: 'delivered',
            delivered_at: receivedAt,
            ...(anexo ? { media_path: anexo.path, media_mime: anexo.mime } : {}),
          })
          if (messageError?.code === '23505') {
            // A mensagem ja esta gravada: isto e o reenvio da Meta depois de
            // uma tentativa que caiu DEPOIS de salvar e antes de terminar (ver
            // eventos-do-webhook.ts). Refazer o resto arriscaria resposta ou
            // consulta dobrada; em vez disso a conversa acende para a equipe,
            // que ve a mensagem e confere se o robo chegou a responder.
            console.warn('Reenvio de mensagem ja gravada; entregue a equipe', externalId)
            await admin
              .from('whatsapp_conversations')
              .update({ needs_attention: true, attention_reason: 'falha' })
              .eq('id', conversation.id)
            continue
          }
          if (messageError) throw messageError

          // O paciente citou uma mensagem nossa (o "responder" do WhatsApp,
          // 20/10/2026, vindo do sistema do Dr. Marcello): a tela mostra a
          // citacao em cima do balao. Coluna nova, gravada a parte - sem ela,
          // so a citacao some.
          const idCitado = message.context?.id
          if (idCitado && externalId) {
            try {
              const { data: citada } = await admin
                .from('whatsapp_messages')
                .select('id')
                .eq('conversation_id', conversation.id)
                .eq('external_message_id', idCitado)
                .maybeSingle()
              if (citada?.id) {
                const { error: erroCitacao } = await admin
                  .from('whatsapp_messages')
                  .update({ responde_a: citada.id })
                  .eq('conversation_id', conversation.id)
                  .eq('external_message_id', externalId)
                if (erroCitacao) throw erroCitacao
              }
            } catch (erro) {
              console.warn('Nao gravei qual mensagem o paciente citou', erro)
            }
          }

          // O paciente respondendo a uma conversa que o medico (ou a Dayane)
          // esta levando pelo WhatsApp dele (18/10/2026, vindo do sistema do
          // Dr. Marcello): a mensagem vai aos celulares, na mesma conversa. Ver
          // repassarRespostaDoPaciente. O robo segue como sempre: quem respondeu
          // pelo celular e gente falando, e ele ja fica quieto.
          try {
            if (numerosDoAlerta === undefined) numerosDoAlerta = await lerNumerosDoAlerta(admin, clinicId)
            if (numerosDoAlerta?.length && !ehReset) {
              await repassarRespostaDoPaciente(
                {
                  admin,
                  clinicId,
                  agora: new Date(),
                  numeros: numerosDoAlerta,
                  enviarWhatsApp: whatsAppPelaApi(phoneNumberId, chaveDoWhatsApp(phoneNumberId)),
                },
                {
                  conversationId: conversation.id,
                  quem: quemNoAlerta({
                    pacientes,
                    nomeDoPerfil: nomeDoPerfil || String(conversaAnterior?.profile_name ?? ''),
                    telefone: waId,
                  }),
                  texto: body,
                  anexo: anexoParaEquipe,
                },
              )
            }
          } catch (erro) {
            console.warn('Repasse do paciente aos celulares falhou; segue como sempre', erro)
          }

          if (patient?.id && optedOut) {
            if (paraTudo) {
              await admin.from('patients').update({ whatsapp_opt_out_at: receivedAt }).eq('id', patient.id)
            } else {
              // Coluna nova (migration 20261015120000), gravada a parte. Sem
              // ela, vale a marca antiga, que barra tudo: perder a separacao e
              // arranhao; perder o pedido de sair nao pode acontecer.
              const { error: semColuna } = await admin
                .from('patients')
                .update({ followup_opt_out_at: receivedAt })
                .eq('id', patient.id)
              if (semColuna) {
                console.warn('Sem followup_opt_out_at; gravando o pedido de sair como total', semColuna)
                await admin.from('patients').update({ whatsapp_opt_out_at: receivedAt }).eq('id', patient.id)
              }
            }
          }

          /** Envia texto livre. Vale porque a mensagem que acabou de chegar
              abriu a janela de 24h - nao precisa de modelo aprovado. */
          async function responder(
            texto: string,
            appointmentId: string | null = null,
            toques?: { botoes?: Toque[]; lista?: { rotulo: string; linhas: Toque[] } },
          ) {
            const token = chaveDoWhatsApp(phoneNumberId)
            if (!token || !texto.trim()) return false
            const graphVersion = Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'
            const enviadoEm = new Date().toISOString()

            // Uma ou duas mensagens (01/10/2026, ver montarMensagens): texto
            // longo vai em duas para os botoes nao se perderem. Para no
            // primeiro erro; o registro guarda o texto inteiro e o id da
            // ultima enviada, que e a dos botoes - e o id que o toque cita.
            let envio = new Response(null, { status: 500 })
            let corpoEnvio: { messages?: { id?: string }[]; error?: { message?: string } } = {}
            for (const conteudo of montarMensagens(texto, toques)) {
              envio = await fetch(
                `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
                {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: waId,
                    ...conteudo,
                  }),
                },
              )
              corpoEnvio = await envio.json().catch(() => ({}))
              if (!envio.ok) break
            }

            await admin.from('whatsapp_messages').insert({
              clinic_id: clinicId,
              conversation_id: conversation.id,
              patient_id: patient?.id ?? null,
              appointment_id: appointmentId,
              external_message_id: envio.ok ? corpoEnvio?.messages?.[0]?.id ?? null : null,
              direction: 'outbound',
              message_type: 'text',
              body: texto,
              // Quem falou foi o robo. E o que impede ele de se confundir com a
              // secretaria e ficar mudo depois da propria mensagem.
              automatic: true,
              status: envio.ok ? 'accepted' : 'failed',
              sent_at: envio.ok ? enviadoEm : null,
              failed_at: envio.ok ? null : enviadoEm,
              failure_reason: envio.ok ? null : corpoEnvio?.error?.message ?? 'Meta recusou o envio.',
            })
            return envio.ok
          }

          // RESET de teste: zera o que o teste deixou, responde e para aqui,
          // sem robo, sem alerta e sem repasse aos celulares.
          if (ehReset) {
            try {
              const zerado = await resetarConversaDeTeste(admin, {
                clinicId,
                conversationId: conversation.id,
                telefone: waId,
                agora: new Date(),
              })
              await responder(respostaDoReset(zerado))
            } catch (erro) {
              console.error('RESET de teste falhou', erro)
              await responder('⚠️ O RESET de teste não funcionou agora. Tente de novo em instantes.')
            }
            continue
          }

          // Robo desligado so nesta conversa pela equipe (23/10/2026, vindo do
          // sistema do Dr. Marcello; ver _shared/robo-da-conversa.ts). Coluna
          // nova, lida a parte: sem ela, o robo responde como antes - e o log
          // diz por que.
          let roboDesligadoNaConversaEm: string | null = null
          if (linhaAnterior) {
            try {
              const { data: chave, error: erroDaChave } = await admin
                .from('whatsapp_conversations')
                .select('robo_desligado_em')
                .eq('clinic_id', clinicId)
                .eq('wa_id', waId)
                .maybeSingle()
              if (erroDaChave) throw erroDaChave
              roboDesligadoNaConversaEm = (chave as { robo_desligado_em?: string | null } | null)?.robo_desligado_em ?? null
            } catch (erro) {
              console.warn('Sem whatsapp_conversations.robo_desligado_em; o robo responde nesta conversa como antes', erro)
            }
          }
          const roboLigadoAqui = roboRespondeNaConversa({
            ligadoNaClinica: settings.whatsapp_autoreply_enabled,
            desligadoNaConversaEm: roboDesligadoNaConversaEm,
          })

          // Mensagem que o WhatsApp nao mostra (16/10/2026, vindo do sistema do
          // Dr. Marcello; ver destinoDaNaoSuportada). A janela de 24h so conta
          // mensagem que a pessoa escreveu de verdade: "[unsupported]" nao abre
          // a janela, e responder texto livre ali volta "Message undeliverable".
          let destinoNaoSuportada = destinoDaNaoSuportada(message.type, false)
          if (destinoNaoSuportada !== 'normal') {
            let janelaAberta = false
            try {
              const { data: escrita, error: erroDaJanela } = await admin
                .from('whatsapp_messages')
                .select('id')
                .eq('conversation_id', conversation.id)
                .eq('direction', 'inbound')
                .neq('message_type', 'unsupported')
                .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
                .limit(1)
                .maybeSingle()
              if (erroDaJanela) throw erroDaJanela
              janelaAberta = Boolean(escrita)
            } catch (erro) {
              // Na duvida, janela fechada: o pior caso e a equipe mandar um
              // modelo quando o texto livre teria passado - nada falha.
              console.warn('Nao consegui ver a janela de 24h; tratando como fechada', erro)
            }
            destinoNaoSuportada = destinoDaNaoSuportada(message.type, janelaAberta)
          }

          // ---- Atendimento automatico ----
          //
          // Um unico ponto decide o que responder: menu, informacoes,
          // agendamento ou silencio. Antes eram dois blocos independentes que
          // podiam falar juntos.
          //
          // Nao roda quando a pessoa esta respondendo um lembrete: ali "1" e
          // confirmacao de consulta, e o trecho mais abaixo cuida disso.
          // "Preciso de ajuda" tambem fica de fora: e o bloco do acompanhamento,
          // mais abaixo, que responde e entrega a conversa a equipe. Deixar o
          // menu falar antes mandava "como podemos ajudar hoje?" para quem
          // acabou de dizer que precisa de ajuda.
          if (
            !optedOut &&
            !foraDaLista &&
            !respondeuLembrete &&
            !isWell &&
            !pediuAjuda &&
            !complementoDeRajada &&
            !semRespostaDoRobo(message.type) &&
            destinoNaoSuportada === 'normal' &&
            roboLigadoAqui
          ) {
            // Segunda leitura pelo Jev (17/10/2026, DESLIGADA por padrao; o modo
            // vem de Preferencias, a chave dos segredos): ver
            // _shared/segunda-leitura.ts. Comeca antes do motor para correr
            // junto com ele, e qualquer falha vira "nada a fazer". Conversa ja
            // acesa como urgencia ou sangramento nao e lida.
            const modoJev = modoDaSegundaLeitura(opcaoDoJev)
            const motivoAceso = conversaAnterior?.needs_attention ? ((conversaAnterior.attention_reason as string | null) ?? null) : null
            const leituraJev: Promise<Leitura> | null =
              modoJev !== 'desligada' && precisaDeLeitura(body, message.type === 'interactive', motivoAceso)
                ? (async (): Promise<Leitura> => {
                    const { data: historico } = await admin
                      .from('whatsapp_messages')
                      .select('direction,body,automatic,external_message_id')
                      .eq('conversation_id', conversation.id)
                      .order('created_at', { ascending: false })
                      .limit(10)
                    const linhas = (historico ?? []) as (MensagemDoHistorico & { external_message_id?: string | null })[]
                    // A mensagem de agora ja esta gravada (logo acima): fica de fora do contexto.
                    const antes = externalId
                      ? linhas.filter((m) => m.external_message_id !== externalId)
                      : linhas[0]?.direction === 'inbound' && linhas[0]?.body === body ? linhas.slice(1) : linhas
                    return await lerComJev({ texto: body, ...contextoDaLeitura(antes) }, { chave: Deno.env.get('TYPESAFE_API_KEY') ?? '' })
                  })().catch((erro): Leitura => ({ ok: false, erro: String((erro as Error)?.message ?? erro) }))
                : null

            const resultado = await tratarConversa({
              admin,
              clinicId,
              conversationId: conversation.id,
              estadoAtual: (conversaAnterior?.booking_state ?? null) as Estado | null,
              opcoesAtuais: conversaAnterior?.booking_options ?? null,
              unidadeEmAndamento: conversaAnterior?.booking_unit_id ?? null,
              podeIniciarMenu: !respondendoEnvioNosso && !equipeFalouRecentemente,
              // Com a equipe ja conversando, quem responde e ela - o robo nao
              // entra nem para dizer "passei sua mensagem".
              // Consulta atendida ha poucos dias conta igual (ver consultouHaPouco).
              posAcompanhamento: (acompanhamentoRecente || consultouHaPouco) && !equipeFalouRecentemente,
              consultaHoje,
              // Conversa de sangramento ou urgencia na fila: a mensagem nova
              // recebe o "nao espere" (ver lembreteDeUrgencia). Etapa vencida
              // e conversa nova, e o motivo velho nao conta.
              motivoDaAtencao: etapaVenceu ? null : ((conversaAnterior?.attention_reason as string | null) ?? null),
              texto: escolhido,
              telefone: waId,
              pacientes,
              pacienteEmAndamento: conversaAnterior?.booking_patient_id ?? null,
              consultas,
              consultaASubstituir: conversaAnterior?.booking_replaces_id ?? null,
              consultaEmCadastro: conversaAnterior?.booking_intake_id ?? null,
              convenioEmAndamento,
              modalidadeEmAndamento: (conversaAnterior?.booking_modality ?? null) as 'presencial' | 'telemedicina' | null,
              // Quantas respostas prontas o robo ja deu nesta espera pela
              // equipe. Etapa vencida recomeca do zero junto com o resto.
              respostasNaEspera: etapaVenceu
                ? 0
                : Number(conversaAnterior?.auto_replies_while_waiting ?? 0),
              anexo: ehAnexo(message),
              // Etapa vencida zera o menu junto: depois de um dia parada, a
              // conversa recomeca do zero e a pessoa ve a apresentacao de novo.
              jaViuOMenu: !etapaVenceu && Boolean(linhaAnterior?.menu_sent_at),
              nomeDoPerfil: nomeDoPerfil || conversaAnterior?.profile_name || '',
              textos: {
                saudacao: settings.whatsapp_autoreply_text ?? '',
                saudacaoConhecida: settings.whatsapp_autoreply_known_text ?? '',
                informacoes: settings.whatsapp_menu_info_text ?? '',
              },
            })

            // A decisao da segunda leitura (ver decidirSegundaLeitura): so
            // acrescenta. A resposta do robo sai igual; a urgencia acesa pelo
            // Jev entra no lugar do motivo que a regra deu (atendente, anexo),
            // nunca no de urgencia ou sangramento, que a regra ja acendeu.
            const decisaoJev = leituraJev
              ? decidirSegundaLeitura(await leituraJev, {
                  modo: modoJev,
                  motivoDoRobo: resultado?.atencao ?? motivoAceso,
                  roboRespondeu: Boolean(resultado),
                  jaTemBotaoDeUrgencia: temBotaoDeUrgencia(resultado),
                })
              : null
            if (resultado && decisaoJev?.atencao) {
              resultado.atencao = decisaoJev.atencao
              resultado.concluida = false
            }

            if (resultado) {
              const respondeu = await responder(resultado.resposta, null, {
                botoes: resultado.botoes,
                lista: resultado.lista,
              })
              // A pergunta com os dois botoes vai DEPOIS da resposta, numa
              // mensagem propria. Toque na lista da mensagem de antes chega como
              // o titulo da opcao (oQueFoiEscolhido), que o motor le na unidade,
              // no convenio, no dia e no horario; no menu principal, "Duvidas
              // sobre a consulta" tocado assim vira "nao entendi" (conferido no
              // simulador em 17/10/2026).
              if (respondeu && decisaoJev?.botoes) {
                await responder(PERGUNTA_URGENCIA_OU_DUVIDA, null, { botoes: BOTOES_URGENCIA_OU_DUVIDA })
              }
              // Atendimento fechado pelo robô, sem nada pendente para a
              // equipe. A conversa passa a "Resolvida", como se alguém
              // tivesse clicado em Concluir.
              //
              // Não é definitivo, e é por isso que dá para fazer sozinho: a
              // próxima mensagem da família devolve status 'open' algumas
              // linhas acima, no mesmo bloco que trata a mensagem recebida. O
              // que se ganha é a lista mostrando só o que ainda espera gente.
              //
              // A bandeira de atenção vence: se o mesmo resultado pedir a
              // equipe, quem manda é o pedido, e o `else` abaixo garante isso.
              //
              // E a que já estava acesa também (14/10/2026, painel de
              // famílias). Fechar a ficha ou dizer "ta bom, obrigada" apagava o
              // pedido que ninguém tinha atendido: a dúvida da dipirona, o "precisa
              // de app?", o aviso "Cancelou pelo WhatsApp" de 3 minutos antes. A
              // família achava que alguém ia responder; a lista dizia "Resolvida".
              // Quem baixa a bandeira é a equipe, como no resto deste arquivo.
              if (resultado.concluida && !resultado.atencao && !conversaAnterior?.needs_attention) {
                await admin
                  .from('whatsapp_conversations')
                  .update({
                    status: 'resolved',
                    needs_attention: false,
                    attention_reason: null,
                  })
                  .eq('id', conversation.id)
              }
              if (resultado.atencao) {
                // Urgencia e sangramento nao descem por outra etiqueta, e
                // pendencia com a equipe nao desce para etiqueta so
                // informativa (25/10/2026, vindo do sistema do Dr. Marcello).
                // Ver etiquetaQueFica.
                const etiqueta = etiquetaQueFica(conversaAnterior, resultado.atencao)
                const { error: erroDaBandeira } = await admin
                  .from('whatsapp_conversations')
                  .update({ needs_attention: true, attention_reason: etiqueta })
                  .eq('id', conversation.id)
                // Motivo novo, banco antigo.
                //
                // A coluna tem CHECK com a lista de motivos aceitos, e a lista
                // cresce por migration. A funcao costuma subir antes: entre um
                // deploy e outro, gravar 'documento' faz o Postgres recusar o
                // UPDATE inteiro - e a conversa fica sem bandeira nenhuma, que
                // e o mesmo que o pedido nao ter chegado.
                //
                // 'atendente' e o motivo mais antigo que existe e sempre passa.
                // Perder a etiqueta exata e um arranhao; perder o pedido de
                // vista e o defeito que tudo isto veio corrigir.
                if (erroDaBandeira) {
                  console.warn('Motivo de atencao recusado pelo banco; marcando como atendente', erroDaBandeira)
                  await admin
                    .from('whatsapp_conversations')
                    .update({ needs_attention: true, attention_reason: 'atendente' })
                    .eq('id', conversation.id)
                }
              }
            } else {
              /**
               * O robo decidiu ficar calado: quem responde e uma pessoa.
               *
               * Calar e certo em tres situacoes - a conversa ja esta na fila da
               * equipe, alguem da equipe falou ha pouco, ou a pessoa respondeu a
               * um lembrete ou acompanhamento com algo que o robo nao sabe ler.
               * O erro era calar SEM AVISAR NINGUEM.
               *
               * Em 22/09/2026 duas familias ficaram assim o dia inteiro. Uma mae
               * pediu para remarcar respondendo ao lembrete; uma
               * outra familia, que ja estava na fila desde a vespera, mandou
               * "Boa tarde". O robo se calou nas duas - corretamente - e as duas
               * conversas ficaram apagadas na tela, so com o contador de nao
               * lidas. Ninguem da equipe olhou.
               *
               * Silencio deliberado agora acende a conversa. O motivo que ja
               * existia fica; sem motivo, entra "atendente", que o banco aceita
               * desde sempre (um motivo novo exigiria migration, e a funcao
               * costuma subir antes dela).
               */
              try {
                const { error: erroDoSilencio } = await admin
                  .from('whatsapp_conversations')
                  .update({
                    needs_attention: true,
                    // A urgencia que o Jev leu, com a equipe conversando (17/10/2026,
                    // prototipo): a notificacao sai como urgencia, e o robo segue calado.
                    attention_reason: decisaoJev?.atencao ?? (conversaAnterior?.attention_reason || 'atendente'),
                  })
                  .eq('id', conversation.id)
                if (erroDoSilencio) {
                  console.warn('Robo calou mas nao consegui acender a conversa', erroDoSilencio)
                }
              } catch (erro) {
                console.warn('Robo calou mas nao consegui acender a conversa', erro)
              }
            }

            /**
             * Registro do que o robo fez, para o painel de numeros
             * (21/09/2026). Ver a migration 20260921120000.
             *
             * DEPOIS de responder, e dentro de try/catch, porque contagem nao
             * pode atrapalhar atendimento. Se a tabela ainda nao existe - a
             * funcao sobe antes das migrations - isto falha, escreve um aviso
             * e a conversa segue inteira.
             */
            try {
              const eventos = colherEventos(conversation.id)
              // O pedido de gente vem do resultado, e nao de um registrar()
              // espalhado: os quatro pontos que levantam a bandeira ficam em
              // funcoes diferentes, e aqui existe um so.
              if (resultado?.atencao) {
                eventos.push({ evento: 'chamou_equipe', detalhe: resultado.atencao })
              }
              if (resultado?.concluida) eventos.push({ evento: 'concluiu_sozinho' })
              // A nota do Jev e o que foi feito com ela, para medir com mensagem de verdade.
              if (decisaoJev) eventos.push({ evento: 'segunda_leitura', detalhe: decisaoJev.detalhe })

              if (eventos.length > 0) {
                const { error: erroDoRegistro } = await admin
                  .from('whatsapp_bot_events')
                  .insert(eventos.map((e) => ({
                    clinic_id: clinicId,
                    conversation_id: conversation.id,
                    evento: e.evento,
                    detalhe: (e.detalhe ?? '').slice(0, 120),
                  })))
                if (erroDoRegistro) {
                  console.warn('Nao consegui registrar os eventos do robo', erroDoRegistro)
                }
              }
            } catch (erro) {
              console.warn('Nao consegui registrar os eventos do robo', erro)
            }

            /**
             * Notificacao no celular da equipe (28/09/2026). Ver
             * _shared/aviso-da-equipe.ts para quando avisa.
             *
             * O motivo final espelha o que as linhas de cima gravaram: o do
             * resultado; se o robo respondeu sem pedir gente, a bandeira que
             * ja estava (ela so sobe); se calou, a mesma regra do silencio.
             *
             * Por ultimo e fora do caminho: a resposta a familia ja saiu, e o
             * envio roda depois de o webhook responder a Meta. Falha aqui vira
             * aviso no log e ultimo_erro no aparelho, nunca mensagem perdida.
             */
            try {
              // Concluida nao apaga bandeira que ja estava acesa (ver acima).
              const motivoAgora = resultado
                ? resultado.atencao ??
                  (conversaAnterior?.needs_attention
                    ? String(conversaAnterior.attention_reason ?? '') || null
                    : null)
                : decisaoJev?.atencao ?? (String(conversaAnterior?.attention_reason ?? '') || 'atendente')
              const aviso = montarAviso({
                conversationId: conversation.id,
                atencaoAntes: Boolean(conversaAnterior?.needs_attention),
                motivoAntes: (conversaAnterior?.attention_reason as string | null) ?? null,
                motivoAgora,
                texto: body,
                pacientes,
                nomeDoPerfil: nomeDoPerfil || String(conversaAnterior?.profile_name ?? ''),
                telefone: waId,
              })
              if (aviso) {
                const envio = avisarEquipe(admin, clinicId, aviso)
                if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(envio)
                else await envio
              }
              // Alerta no WhatsApp pessoal do medico, com botoes (17/10/2026),
              // a qualquer hora, so quando a conversa ENTRA em urgencia ou
              // sangramento. A notificacao de cima continua. Ver
              // _shared/alerta-de-urgencia.ts.
              const motivoAntes = (conversaAnterior?.attention_reason as string | null) ?? null
              if (deveAlertar({ atencaoAntes: Boolean(conversaAnterior?.needs_attention), motivoAntes, motivoAgora })) {
                const alerta = enviarAlertaDeUrgencia(admin, {
                  clinicId,
                  motivo: motivoAgora as MotivoDoAlerta,
                  quem: quemNoAlerta({
                    pacientes,
                    nomeDoPerfil: nomeDoPerfil || String(conversaAnterior?.profile_name ?? ''),
                    telefone: waId,
                  }),
                  texto: body,
                  agora: new Date(),
                  conversationId: conversation.id,
                  // A foto desta mensagem; sem ela, a que o paciente mandou
                  // pouco antes ("olha o meu nariz" e depois "ta sangrando").
                  anexo: anexoParaEquipe ?? (await anexoRecenteDaConversa(admin, conversation.id, new Date(Date.now() - ANEXO_RECENTE_MS))),
                })
                if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(alerta)
                else await alerta
              }
            } catch (erro) {
              console.warn('Notificacao no celular: nao consegui montar o aviso', erro)
            }
          }

          // O arquivo que o paciente manda depois, com o alerta ainda aberto
          // (25/10/2026, ver alertaEmAberto): so o arquivo vai aos celulares.
          // Fora do bloco do robo de proposito: a foto que chega colada no
          // texto (rajada) ou com o robo calado na conversa tambem vai. O
          // alerta novo desta mesma mensagem nao acontece aqui: com a conversa
          // ja em urgencia, deveAlertar e falso.
          if (anexoParaEquipe && !optedOut && conversaAnterior?.needs_attention &&
            MOTIVOS_COM_VEREDITO.includes(String(conversaAnterior.attention_reason ?? ''))) {
            try {
              if (await alertaEmAberto(admin, clinicId, conversation.id, new Date())) {
                const soOArquivo = enviarAlertaDeUrgencia(admin, {
                  clinicId,
                  motivo: conversaAnterior.attention_reason as MotivoDoAlerta,
                  quem: quemNoAlerta({
                    pacientes,
                    nomeDoPerfil: nomeDoPerfil || String(conversaAnterior?.profile_name ?? ''),
                    telefone: waId,
                  }),
                  texto: body,
                  agora: new Date(),
                  conversationId: conversation.id,
                  anexo: anexoParaEquipe,
                  soOAnexo: true,
                })
                if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(soOArquivo)
                else await soOArquivo
              }
            } catch (erro) {
              console.warn('Anexo para a equipe: o arquivo nao foi aos celulares; esta na Central', erro)
            }
          }

          // Mensagem que o WhatsApp nao mostra: o robo nao manda o menu (ver
          // destinoDaNaoSuportada). Com a janela aberta pede texto; fechada,
          // nao responde - falharia - e a conversa acende para a equipe, com a
          // etiqueta que diz para usar um modelo. Tudo em try/catch: falhar
          // aqui nao pode derrubar o resto.
          if (destinoNaoSuportada !== 'normal' && !foraDaLista && !optedOut) {
            try {
              let respondeu = false
              if (destinoNaoSuportada === 'pedir_texto' && roboLigadoAqui && !equipeFalouRecentemente) {
                respondeu = await responder(TEXTO_NAO_SUPORTADA)
              }
              if (!respondeu) {
                const motivo = destinoNaoSuportada === 'so_equipe' ? 'nao_suportada' : 'atendente'
                const { error: erroDaEtiqueta } = await admin
                  .from('whatsapp_conversations')
                  .update({ needs_attention: true, attention_reason: motivo })
                  .eq('id', conversation.id)
                // Motivo novo, banco antigo: 'atendente' sempre passa.
                if (erroDaEtiqueta) {
                  console.warn('Etiqueta nao_suportada recusada pelo banco; marcando como atendente', erroDaEtiqueta)
                  await admin
                    .from('whatsapp_conversations')
                    .update({ needs_attention: true, attention_reason: 'atendente' })
                    .eq('id', conversation.id)
                }
                const aviso = montarAviso({
                  conversationId: conversation.id,
                  atencaoAntes: Boolean(conversaAnterior?.needs_attention),
                  motivoAntes: (conversaAnterior?.attention_reason as string | null) ?? null,
                  motivoAgora: motivo,
                  texto: 'Tentou falar (talvez uma ligação pelo WhatsApp)',
                  pacientes,
                  nomeDoPerfil: nomeDoPerfil || String(conversaAnterior?.profile_name ?? ''),
                  telefone: waId,
                })
                if (aviso) {
                  const envio = avisarEquipe(admin, clinicId, aviso)
                  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(envio)
                  else await envio
                }
              }
              const { error: erroDoEvento } = await admin.from('whatsapp_bot_events').insert({
                clinic_id: clinicId,
                conversation_id: conversation.id,
                evento: 'nao_suportada',
                detalhe: respondeu ? 'pediu_texto' : 'passou_a_equipe',
              })
              if (erroDoEvento) console.warn('Nao consegui registrar o evento nao_suportada', erroDoEvento)
            } catch (erro) {
              console.warn('Mensagem nao suportada: nao consegui avisar a equipe', erro)
            }
          }

          // Confirmar, remarcar ou cancelar referem-se sempre a ultima consulta
          // sobre a qual mandamos lembrete nesta conversa.
          //
          // Nao exige paciente cadastrado. Quem manda aqui e a consulta: o
          // lembrete passou a sair tambem para quem marcou sem cadastro, e
          // exigir cadastro para LER a resposta fazia a confirmacao sumir em
          // silencio. Foi o que aconteceu em 31/08/2026 - o paciente confirmou
          // as 10:00 e so foi cadastrado depois.
          if (respondeuLembrete) {
            // Irmaos (24/09/2026): a mae recebe um lembrete por filho no mesmo
            // celular. Tocando o botao de um deles, o WhatsApp diz a qual
            // mensagem ela respondeu (context.id) - e e ESSA consulta que vale.
            // Antes valia sempre o ultimo lembrete enviado, e o outro irmao
            // ficava "sem resposta" para sempre. Sem context (resposta
            // digitada), continua valendo o ultimo, como antes.
            const respondidoId = String(message.context?.id ?? '')
            const { data: lembreteTocado } = respondidoId
              ? await admin
                  .from('whatsapp_messages')
                  .select('appointment_id')
                  .eq('conversation_id', conversation.id)
                  .eq('external_message_id', respondidoId)
                  .not('appointment_id', 'is', null)
                  .maybeSingle()
              : { data: null }
            const { data: ultimoLembrete } = lembreteTocado?.appointment_id
              ? { data: lembreteTocado }
              : await admin
                  .from('whatsapp_messages')
                  .select('appointment_id')
                  .eq('conversation_id', conversation.id)
                  .eq('direction', 'outbound')
                  .not('appointment_id', 'is', null)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()

            // A consulta ainda estava marcada? Ate 24/09/2026 isto nao era
            // conferido: se a clinica ja tinha cancelado, o UPDATE nao mudava
            // nada e mesmo assim a familia lia "Consulta confirmada!" - e vinha.
            let consultaValida = false
            // Onde e a consulta, para repetir o endereco na confirmacao (ver
            // unidadeNoLembrete em lembrete.ts).
            let ondeConfirmado = ''
            if (ultimoLembrete?.appointment_id) {
              // Cancelar muda o status: o indice unico de horario ignora
              // canceladas, entao a vaga volta a aparecer como livre na hora.
              const mudanca = mudancaDaConsulta(resposta, receivedAt)

              const { data: mudou } = await admin
                .from('appointments')
                .update(mudanca)
                .eq('id', ultimoLembrete.appointment_id)
                .eq('status', 'scheduled')
                .select('id,modality,clinic_units(name,address)')
              consultaValida = (mudou ?? []).length > 0
              const linha = (mudou ?? [])[0] as unknown as
                | { modality?: string; clinic_units?: { name?: string; address?: string } | null }
                | undefined
              if (linha && linha.modality !== 'telemedicina' && linha.clinic_units?.name) {
                ondeConfirmado = unidadeNoLembrete(linha.modality, linha.clinic_units.name, linha.clinic_units.address)
              }
            }

            if (!consultaValida) {
              console.warn('Resposta a lembrete de consulta que nao esta mais marcada', conversation.id)
              await admin
                .from('whatsapp_conversations')
                .update({ needs_attention: true, attention_reason: 'atendente' })
                .eq('id', conversation.id)
              await responder(
                'Recebi sua resposta, mas essa consulta não aparece mais como marcada na nossa agenda. ' +
                  'Já avisei a equipe, que confirma com você por aqui.',
              )
              continue
            }

            // Cancelou: deixa o menu ativo, para o "2" do botao abrir a agenda
            // direto em vez de mostrar o menu de novo.
            if (resposta.cancela) {
              const agora = new Date().toISOString()
              await admin
                .from('whatsapp_conversations')
                .update({
                  booking_state: 'menu',
                  booking_options: null,
                  menu_sent_at: agora,
                  booking_updated_at: agora,
                })
                .eq('id', conversation.id)
            }
            await responder(avisoDaResposta(resposta, ondeConfirmado), null, {
              botoes: resposta.cancela ? [{ id: '2', titulo: 'Escolher nova data' }] : undefined,
            })

            // Resposta ao lembrete tambem entra nos numeros (22/09/2026). Ate
            // aqui so o menu registrava eventos, e o painel nao sabia quantas
            // familias confirmaram ou cancelaram pelo lembrete - que e justamente
            // o que o lembrete existe para produzir.
            try {
              const evento = resposta.confirma
                ? 'lembrete_confirmou'
                : resposta.cancela
                  ? 'lembrete_cancelou'
                  : 'lembrete_remarcar'
              const { error: erroDoEvento } = await admin.from('whatsapp_bot_events').insert({
                clinic_id: clinicId,
                conversation_id: conversation.id,
                evento,
              })
              if (erroDoEvento) console.warn('Nao consegui registrar a resposta ao lembrete', erroDoEvento)
            } catch (erro) {
              console.warn('Nao consegui registrar a resposta ao lembrete', erro)
            }
          }

          // "Preciso de ajuda" explicito, e nao qualquer coisa que acendeu a
          // bandeira de atencao: um pedido de remarcacao nao reabre um
          // acompanhamento clinico.
          if (patient?.id && (isWell || pediuAjuda)) {
            const { data: lastOutbound } = await admin
              .from('whatsapp_messages')
              .select('followup_id')
              .eq('conversation_id', conversation.id)
              .eq('direction', 'outbound')
              .not('followup_id', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (lastOutbound?.followup_id) {
              await admin.from('followups').update(isWell
                ? { status: 'completed', completed_at: receivedAt }
                : { status: 'opened' })
                .eq('id', lastOutbound.followup_id)

              // Responde ao botao. "Preciso de ajuda" tambem entrega a conversa
              // a equipe, como o 9 do menu faria: o robo se cala ate alguem
              // assumir, em vez de mandar menu por cima de um pedido de ajuda.
              const texto = respostaAoAcompanhamento(resposta)
              if (texto) await responder(texto)
              // "Estamos bem": nada ficou para a equipe. Ver
              // acompanhamentoEncerraConversa.
              if (acompanhamentoEncerraConversa(resposta, marcarAtencao)) {
                const { error: erroAoEncerrar } = await admin
                  .from('whatsapp_conversations')
                  .update({ status: 'resolved', needs_attention: false, attention_reason: null })
                  .eq('id', conversation.id)
                if (erroAoEncerrar) console.warn('Nao consegui encerrar a conversa do "Estamos bem"', erroAoEncerrar)
              }
              if (pediuAjuda) {
                await admin
                  .from('whatsapp_conversations')
                  .update({
                    booking_state: 'atendente',
                    booking_options: null,
                    // Sem o carimbo a espera pela equipe ja nasceria vencida.
                    booking_updated_at: new Date().toISOString(),
                    // Espera nova, contagem nova de respostas prontas.
                    auto_replies_while_waiting: 0,
                  })
                  .eq('id', conversation.id)
              }
            }
          }

          // "Nao quero receber" apertado no acompanhamento: confirma de volta.
          // Sem isso a pessoa apertava e o silencio parecia que nao pegou.
          // Quem nao e paciente tambem ouve a confirmacao (14/10/2026): no
          // painel, um senhor que recebeu mensagem por engano pediu tres vezes
          // para tirarem o numero e ficou sem resposta nenhuma.
          if (optedOut) {
            const texto = patient?.id
              ? respostaAoAcompanhamento(resposta)
              : 'Pronto, retiramos este número: não vamos mais enviar mensagens. Desculpe o incômodo. 🙏'
            if (texto) await responder(texto)
          }
        }

        for (const delivery of value.statuses ?? []) {
          await registro.concluir()
          const externalId = String(delivery.id ?? '')
          const status = String(delivery.status ?? '')
          if (!externalId || statusRank[status] === undefined) continue

          const eventKey = `status:${externalId}:${status}:${delivery.timestamp ?? ''}`
          if ((await registro.registrar(eventKey, `status_${status}`, { entry_id: entry.id, change })) === 'repetido') {
            continue
          }

          // Arquivo do paciente mandado a um celular do alerta (25/10/2026, ver
          // _shared/anexos-pendentes.ts): a Meta aceita na hora e recusa por
          // aqui. Esses envios nao estao em whatsapp_messages.
          if (await acompanharEnvioDoAnexo(admin, externalId, status, delivery.errors, new Date())) continue

          const { data: stored } = await admin
            .from('whatsapp_messages')
            .select('id,status,followup_id')
            .eq('external_message_id', externalId)
            .maybeSingle()
          if (!stored) continue
          if (statusRank[status] < (statusRank[stored.status] ?? 0)) {
            if (status === 'failed') {
              console.warn('Meta marcou como falha mensagem ja entregue; mantida como entregue', externalId, delivery.errors)
            }
            continue
          }

          const at = delivery.timestamp
            ? new Date(Number(delivery.timestamp) * 1000).toISOString()
            : new Date().toISOString()
          const errorText = delivery.errors
            ?.map((item: DeliveryError) => item.title || item.message)
            .filter(Boolean)
            .join('; ') || null
          const update: Record<string, unknown> = { status }
          if (status === 'sent') update.sent_at = at
          if (status === 'delivered') update.delivered_at = at
          if (status === 'read') update.read_at = at
          // Chegou depois de um "falhou": a falha era falsa, e o motivo dela
          // nao pode continuar aparecendo embaixo de uma mensagem entregue.
          if ((status === 'delivered' || status === 'read') && stored.status === 'failed') {
            console.warn('Meta entregou mensagem que tinha marcado como falha', externalId)
            update.failed_at = null
            update.failure_reason = null
          }
          if (status === 'failed') {
            update.failed_at = at
            update.failure_reason = errorText || 'Falha informada pela Meta.'
          }
          await admin.from('whatsapp_messages').update(update).eq('id', stored.id)

          if (stored.followup_id) {
            const followupUpdate: Record<string, unknown> = {}
            if (status === 'delivered') followupUpdate.whatsapp_delivered_at = at
            if (status === 'read') followupUpdate.whatsapp_read_at = at
            if (status === 'failed') {
              followupUpdate.whatsapp_failed_at = at
              followupUpdate.whatsapp_failure_reason = errorText || 'Falha informada pela Meta.'
            }
            if (Object.keys(followupUpdate).length) {
              await admin.from('followups').update(followupUpdate).eq('id', stored.followup_id)
            }
          }
        }
      }
    }

    // O ultimo evento do lote tambem terminou.
    await registro.concluir()
    return text('EVENT_RECEIVED')
  } catch (error) {
    console.error(error)
    // O 500 pede para a Meta reenviar. Sem liberar a chave do evento que
    // falhou, o reenvio seria descartado como repetido e a mensagem sumiria.
    await registro?.desfazerEmCurso()
    return text('Processing failed', 500)
  }
})
