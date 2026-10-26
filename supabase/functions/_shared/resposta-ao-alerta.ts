import {
  BOTOES_DO_ALERTA,
  MODELO_DO_PEDIDO,
  parametrosDoPedido,
  payloadDoVeredito,
  type EnviarWhatsApp,
  type VereditoDoAlerta,
} from './alerta-de-urgencia.ts'
import { anexoQueVai, mensagemDoAnexo, type AnexoParaEquipe } from './anexo-para-equipe.ts'
import { registrarEnvioDoAnexo } from './anexos-pendentes.ts'
import { montarConteudo } from './conteudo.ts'
import { quemAtende } from './quem-atende.ts'
import { mesmoTelefone } from './telefone-br.ts'
import { botoesDoVeredito, conversaDepoisDoVeredito, detalheDoVeredito, textoDoVeredito, type Veredito } from './veredito.ts'

/**
 * A resposta do medico ao alerta de urgencia, pelo WhatsApp dele (17/10/2026,
 * pedido do Edu).
 *
 * O alerta chega no celular do Dr. Fabio (ver alerta-de-urgencia.ts), e a
 * resposta dele volta ao paciente sem ele abrir a Central:
 *   - toca num botao: "E urgente" (pronto-socorro agora), "Pode aguardar" (o
 *     paciente ganha o botao de marcar e o "se piorar, escreva aqui") ou "Eu
 *     respondo" (ele vai falar com o paciente);
 *   - escreve a orientacao. O robo mostra o que vai mandar e espera o
 *     "Enviar": e orientacao medica em nome dele, e um "liga pra ela" que era
 *     para a Dayane nao pode chegar ao paciente.
 *
 * "E urgente" e "Pode aguardar" sao o MESMO veredito dos botoes da tela de
 * Respostas (veredito.ts): mesmo texto, mesma mudanca na conversa, mesmo evento
 * veredito_urgencia. Vale o primeiro, pelo WhatsApp ou pela tela.
 *
 * Quem e quem: o primeiro numero do alerta e o do medico; os outros sao
 * equipe. So o medico classifica; a equipe pode dizer que vai responder e
 * mandar mensagem, que sai como "equipe do consultorio".
 *
 * Mensagem desses numeros so vira resposta ao alerta quando e um toque nos
 * botoes, quando responde em cima de um alerta, ou quando houve alerta nas
 * ultimas 6 horas. Fora disso segue o robo de sempre: e assim que o Edu
 * continua testando o robo pelo proprio celular.
 *
 * Feito a partir do sistema do Dr. Marcello (mesma data). Diferencas: sem
 * Instagram; o veredito e o da tela de Respostas; com a janela de 24 horas do
 * paciente fechada nada sai e o medico fica sabendo, como na tela (o modelo
 * resposta_da_clinica do Dr. Fabio ainda nao existe na Meta).
 *
 * Em 25/10/2026 vieram de la as pecas do primeiro dia de uso do Dr. Marcello
 * (18/10/2026): o texto sem citar segue para o paciente da ultima resposta de
 * quem escreve; o nome do paciente sozinho escolhe a conversa; com mais de um
 * aviso, a escolha e num toque; o "Mandar para o celular" da Central (pedido,
 * ver alerta-de-urgencia.ts) volta pelo mesmo caminho; e o que o paciente
 * escreve depois vai aos celulares (repassarRespostaDoPaciente).
 */

type Admin = { from: (tabela: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
type Consulta = ReturnType<Admin['from']>

const JANELA_DO_ALERTA_MS = 6 * 3600 * 1000
const JANELA_DA_META_MS = 24 * 3600 * 1000
/** O texto do medico cabe na confirmacao com os botoes (ver o fim do arquivo). */
export const LIMITE_DO_TEXTO = 800

export type MensagemRecebida = {
  type?: string
  text?: { body?: string }
  button?: { text?: string; payload?: string }
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } }
  /** A mensagem nossa em cima da qual ele respondeu. */
  context?: { id?: string }
}

export type RespostaDaEquipe =
  | { tipo: 'veredito'; alertaId: string; veredito: VereditoDoAlerta }
  | { tipo: 'confirmacao'; alertaId: string; acao: 'enviar' | 'cancelar' }
  | { tipo: 'texto'; texto: string; citado: string | null }
  | { tipo: 'visto'; citado: string | null }
  | { tipo: 'midia'; citado: string | null }

export const payloadDaConfirmacao = (alertaId: string, acao: 'enviar' | 'cancelar') => `URGTXT:${alertaId}:${acao}`

// "ok", "vi", um 👍: e o medico dizendo que viu, nao orientacao para o paciente.
const VISTO = /^(ok|okay|oks|vi|visto|certo|ciente|beleza|blz|obrigad[oa]|valeu|ta bom|tá bom|entendi|combinado|👍|👌|🙏|✅)[\s!.👍👌🙏✅]*$/iu
const MIDIA = ['image', 'audio', 'voice', 'video', 'document', 'sticker']

export function lerRespostaDaEquipe(m: MensagemRecebida): RespostaDaEquipe | null {
  const citado = m.context?.id ? String(m.context.id) : null
  // A lista (escolha do paciente com mais de 2 avisos) volta em list_reply.
  const toque =
    m.type === 'button'
      ? String(m.button?.payload ?? '')
      : m.type === 'interactive'
        ? String(m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? '')
        : ''
  const veredito = /^URG:([0-9a-f-]{36}):(urgente|nao_urgente|responde)$/.exec(toque)
  if (veredito) return { tipo: 'veredito', alertaId: veredito[1], veredito: veredito[2] as VereditoDoAlerta }
  const confirmacao = /^URGTXT:([0-9a-f-]{36}):(enviar|cancelar)$/.exec(toque)
  if (confirmacao) return { tipo: 'confirmacao', alertaId: confirmacao[1], acao: confirmacao[2] as 'enviar' | 'cancelar' }
  // Outro botao (do lembrete, do menu): nao e daqui.
  if (toque) return null
  if (m.type === 'text') {
    const texto = String(m.text?.body ?? '').trim()
    if (!texto) return null
    return VISTO.test(texto) ? { tipo: 'visto', citado } : { tipo: 'texto', texto, citado }
  }
  if (MIDIA.includes(String(m.type))) return { tipo: 'midia', citado }
  return null
}

/** O primeiro numero do alerta e o do medico; os outros, equipe; fora da lista, ninguem. */
export function papelDoNumero(numero: string, numeros: string[]): 'medico' | 'equipe' | null {
  const i = numeros.findIndex((n) => mesmoTelefone(n, numero))
  return i < 0 ? null : i === 0 ? 'medico' : 'equipe'
}

/**
 * O que o paciente le. "E urgente" e "Pode aguardar" sao os textos do veredito
 * da tela (veredito.ts), em nome do medico. Os textos em nome do medico
 * precisam do aval dele (LEIA-ME). null = a equipe nao classifica urgencia.
 */
export function textoParaOPaciente(
  tipo: VereditoDoAlerta | 'texto',
  papel: 'medico' | 'equipe',
  clinicId: string | null | undefined,
  texto = '',
): string | null {
  const quem = quemAtende(clinicId)
  if (tipo === 'urgente' || tipo === 'nao_urgente') return papel === 'medico' ? textoDoVeredito(tipo, clinicId) : null
  if (tipo === 'responde') {
    return papel === 'medico'
      ? `💙 ${quem.O} viu a sua mensagem e vai falar com você por aqui.`
      : '💙 A nossa equipe viu a sua mensagem e vai falar com você por aqui.'
  }
  return papel === 'medico' ? `💬 Mensagem d${quem.o}: ${texto}` : `💬 Mensagem da equipe do consultório: ${texto}`
}

export type Alerta = {
  id: string
  conversation_id: string | null
  teste: boolean
  /** urgencia, sangramento ou pedido (o "Mandar para o celular"). */
  motivo?: string
  quem: string
  mensagens: string[]
  veredito: string | null
  veredito_por: string | null
  veredito_em: string | null
  rascunho: string | null
  rascunho_de: string | null
  rascunho_em: string | null
  criado_em: string
}

const LIGACAO = new Set(['do', 'da', 'de', 'dos', 'das', 'o', 'a', 'e', 'para', 'pra', 'pro', 'paciente', 'conversa', 'sr', 'sra', 'seu', 'dona'])
const palavrasDoNome = (t: string) =>
  t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)

/**
 * O texto e so o nome de um dos pacientes ("Maria", "da Maria Souza")? Entao e
 * a escolha da conversa, e nao mensagem para o paciente (18/10/2026, no Dr.
 * Marcello: o medico escreveu o nome de uma crianca para dizer de quem era a
 * resposta, e a familia recebeu "Mensagem do Dr. ...: (o nome)").
 */
export function pacientePeloNome(texto: string, candidatos: Alerta[]): Alerta | null {
  const palavras = palavrasDoNome(texto).filter((p) => !LIGACAO.has(p))
  // Frase de verdade sempre tem palavra que nao e do nome ("Maria, pode fazer
  // compressa"): nao precisa de limite de tamanho.
  if (!palavras.length) return null
  const achados = candidatos.filter((a) => {
    const nome = new Set(palavrasDoNome(a.quem ?? ''))
    return palavras.every((p) => nome.has(p))
  })
  return achados.length === 1 ? achados[0] : null
}

/** A ultima resposta deste numero: a que aviso e quando (ver ultimaResposta). */
export type UltimaResposta = { id: string; em: string } | null

/**
 * De qual paciente e o texto. Em cima de um alerta: aquele. Sem citar: o
 * alerta das ultimas 6 horas, se for um so. Com mais de um, o da ultima
 * resposta deste numero, enquanto nao chegar aviso novo depois dela
 * (18/10/2026, no Dr. Marcello: depois do "Eu respondo", cada mensagem
 * seguinte voltava "Ha 2 alertas recentes"). Aviso novo depois da ultima
 * resposta: pergunta, porque a mensagem pode ser para o paciente novo.
 */
export function escolherAlerta(
  recentes: Alerta[],
  citado: string | null,
  agora: Date,
  ultima: UltimaResposta = null,
): { alerta: Alerta } | { ambiguos: Alerta[] } | null {
  if (citado) {
    const exato = recentes.find((a) => (a.mensagens ?? []).includes(citado))
    if (exato) return { alerta: exato }
  }
  const candidatos = recentes.filter((a) => agora.getTime() - Date.parse(a.criado_em) <= JANELA_DO_ALERTA_MS)
  if (candidatos.length === 1) return { alerta: candidatos[0] }
  if (candidatos.length > 1) {
    const daConversa = ultima ? candidatos.find((a) => a.id === ultima.id) : undefined
    const chegouOutro = candidatos.some((a) => a.id !== ultima?.id && Date.parse(a.criado_em) > Date.parse(ultima?.em ?? ''))
    if (daConversa && !chegouOutro) return { alerta: daConversa }
    return { ambiguos: candidatos }
  }
  return null
}

export type AmbienteDaResposta = {
  admin: Admin
  clinicId: string
  agora: Date
  /** Os numeros do alerta, ja lidos (o primeiro e o do medico). */
  numeros: string[]
  /** Uma mensagem pelo WhatsApp da clinica: para o medico ou para o paciente. */
  enviarWhatsApp: EnviarWhatsApp
}

const COLUNAS = 'id,conversation_id,teste,motivo,quem,mensagens,veredito,veredito_por,veredito_em,rascunho,rascunho_de,rascunho_em,criado_em'

async function alertasRecentes(amb: AmbienteDaResposta): Promise<Alerta[] | null> {
  try {
    const { data, error } = await amb.admin
      .from('alertas_de_urgencia')
      .select(COLUNAS)
      .eq('clinic_id', amb.clinicId)
      .gte('criado_em', new Date(amb.agora.getTime() - JANELA_DA_META_MS).toISOString())
      .order('criado_em', { ascending: false })
      .limit(20)
    if (error) throw error
    return (data ?? []) as Alerta[]
  } catch (erro) {
    // Sem a tabela, a mensagem segue o caminho de sempre: nada se perde.
    console.error('Resposta ao alerta: nao li alertas_de_urgencia', erro)
    return null
  }
}

/**
 * Colunas de 18/10/2026 (migration 20261025100600 aqui), lidas e gravadas a
 * parte: sem elas, so volta a pergunta de qual paciente, nada mais quebra.
 */
async function ultimaResposta(amb: AmbienteDaResposta, numero: string): Promise<UltimaResposta> {
  try {
    const { data, error } = await amb.admin
      .from('alertas_de_urgencia')
      .select('id,respondido_em')
      .eq('clinic_id', amb.clinicId)
      .eq('respondido_por', numero)
      .gte('respondido_em', new Date(amb.agora.getTime() - JANELA_DO_ALERTA_MS).toISOString())
      .order('respondido_em', { ascending: false })
      .limit(1)
    if (error) throw error
    const linha = (data as { id: string; respondido_em: string }[] | null)?.[0]
    return linha ? { id: linha.id, em: linha.respondido_em } : null
  } catch (erro) {
    console.warn('Resposta ao alerta: sem respondido_em; a conversa ativa nao vale', erro)
    return null
  }
}

async function marcarRespondido(amb: AmbienteDaResposta, id: string, numero: string) {
  try {
    const { error } = await amb.admin
      .from('alertas_de_urgencia')
      .update({ respondido_em: amb.agora.toISOString(), respondido_por: numero })
      .eq('id', id)
    if (error) throw error
  } catch (erro) {
    console.warn('Resposta ao alerta: respondido_em nao gravado', erro)
  }
}

/** Apaga o texto esperando confirmacao em todos os avisos deste numero. */
async function apagarRascunhos(amb: AmbienteDaResposta, numero: string) {
  await amb.admin
    .from('alertas_de_urgencia')
    .update({ rascunho: null, rascunho_de: null, rascunho_em: null })
    .eq('clinic_id', amb.clinicId)
    .eq('rascunho_de', numero)
}

/** Nome curto para botao (20 letras) ou linha de lista (24). */
function nomeCurto(nome: string, limite: number): string {
  const n = nome.trim() || 'Paciente'
  if (n.length <= limite) return n
  const partes = n.split(/\s+/)
  const doisNomes = partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1]}` : n
  return doisNomes.length <= limite ? doisNomes : `${n.slice(0, limite - 1)}…`
}

async function alertaPorId(amb: AmbienteDaResposta, id: string): Promise<Alerta | null> {
  const { data } = await amb.admin.from('alertas_de_urgencia').select(COLUNAS).eq('id', id).eq('clinic_id', amb.clinicId).maybeSingle()
  return (data as Alerta | null) ?? null
}

export const ROTULO_DO_VEREDITO: Record<string, string> = {
  urgente: 'é urgente',
  nao_urgente: 'pode aguardar a consulta',
  responde: 'vai responder',
  texto: 'mandou uma mensagem',
}

type Envio = { ok: true } | { ok: false; erro: string }

/**
 * Manda ao paciente, pela conversa do alerta, com a janela de 24 horas
 * aberta (o normal numa urgencia: o paciente acabou de escrever). Fechada,
 * nada sai e o medico fica sabendo, como na tela de Respostas. O veredito muda
 * a conversa como a tela muda; "Eu respondo" e o texto so a movem para cima.
 */
async function enviarAoPaciente(
  amb: AmbienteDaResposta,
  alerta: Alerta,
  tipo: VereditoDoAlerta | 'texto',
  papel: 'medico' | 'equipe',
  texto: string,
): Promise<Envio & { motivoAntes?: string | null }> {
  const { admin, clinicId, agora } = amb
  if (!alerta.conversation_id) return { ok: false, erro: 'alerta sem conversa' }
  const { data: conversa } = await admin
    .from('whatsapp_conversations')
    .select('id,wa_id,patient_id,status,needs_attention,attention_reason')
    .eq('id', alerta.conversation_id)
    .maybeSingle()
  if (!conversa?.wa_id) return { ok: false, erro: 'conversa do WhatsApp não encontrada' }
  const motivoAntes = conversa.needs_attention ? ((conversa.attention_reason as string | null) ?? null) : null
  if (conversa.status === 'opted_out') return { ok: false, erro: 'o paciente pediu para não receber mensagens', motivoAntes }
  const escrito = textoParaOPaciente(tipo, papel, clinicId, texto)
  if (!escrito) return { ok: false, erro: `só ${quemAtende(clinicId).o} classifica a urgência`, motivoAntes }

  // Ultima mensagem RECEBIDA, como em whatsapp-reply: a janela e dela.
  const { data: ultima } = await admin
    .from('whatsapp_messages')
    .select('created_at')
    .eq('conversation_id', conversa.id)
    .eq('direction', 'inbound')
    .neq('message_type', 'unsupported')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const aberta = Boolean(ultima?.created_at) && agora.getTime() - Date.parse(ultima.created_at) < JANELA_DA_META_MS
  if (!aberta) return { ok: false, erro: 'a janela de 24 horas do WhatsApp do paciente fechou', motivoAntes }

  const botoes = tipo === 'urgente' || tipo === 'nao_urgente' ? botoesDoVeredito(tipo) : undefined
  const conteudo = montarConteudo(escrito, botoes ? { botoes } : undefined)
  const envio = await amb.enviarWhatsApp(conversa.wa_id, conteudo)
  const agoraIso = agora.toISOString()
  // Mensagem de gente (automatic false), como o veredito da tela: o robo fica
  // quieto e a equipe segue. O botao de marcar funciona mesmo assim (ver
  // conversaDepoisDoVeredito).
  const { error: erroDoRegistro } = await admin.from('whatsapp_messages').insert({
    clinic_id: clinicId,
    conversation_id: conversa.id,
    patient_id: conversa.patient_id ?? null,
    external_message_id: envio.ok ? envio.id : null,
    direction: 'outbound',
    automatic: false,
    message_type: botoes ? 'interactive' : 'text',
    body: escrito,
    status: envio.ok ? 'accepted' : 'failed',
    ...(envio.ok ? { sent_at: agoraIso } : { failed_at: agoraIso, failure_reason: envio.erro }),
    created_at: agoraIso,
  })
  if (erroDoRegistro) console.error('Resposta ao alerta: mensagem ao paciente nao registrada', erroDoRegistro)
  if (envio.ok) {
    const { error: erroDaConversa } = await admin
      .from('whatsapp_conversations')
      .update({
        last_message_at: agoraIso,
        ...(tipo === 'urgente' || tipo === 'nao_urgente' ? conversaDepoisDoVeredito(tipo) : {}),
      })
      .eq('id', conversa.id)
    if (erroDaConversa) console.error('Resposta ao alerta: conversa nao atualizada', erroDaConversa)
  }
  return envio.ok ? { ok: true, motivoAntes } : { ok: false, erro: envio.erro, motivoAntes }
}

/** Nota na conversa (a equipe ve na Central) e evento nos Numeros do WhatsApp. */
async function registrarResposta(
  amb: AmbienteDaResposta,
  alerta: Alerta,
  papel: 'medico' | 'equipe',
  tipo: VereditoDoAlerta | 'texto' | 'visto',
  envio: (Envio & { motivoAntes?: string | null }) | null,
) {
  if (!alerta.conversation_id) return
  const quem = papel === 'medico' ? quemAtende(amb.clinicId).O : 'A equipe'
  // O pedido (o "Mandar para o celular") tem nota e evento proprios: o
  // veredito_urgencia e comparado com a nota do Jev e com a regra.
  const pedido = alerta.motivo === 'pedido'
  const oQue = pedido
    ? tipo === 'visto' ? 'viu a conversa enviada ao celular' : `respondeu pelo celular: ${ROTULO_DO_VEREDITO[tipo]}`
    : tipo === 'visto' ? 'viu o alerta' : `respondeu ao alerta: ${ROTULO_DO_VEREDITO[tipo]}`
  const nota =
    `🩺 ${quem} ${oQue} (pelo WhatsApp).` +
    (envio && !envio.ok ? ` ⚠️ A mensagem NÃO chegou ao paciente: ${envio.erro}. Responda por aqui.` : '')
  // O mesmo evento do veredito da tela, para comparar com a nota do Jev e com a
  // regra; o "pelo=whatsapp" separa um caminho do outro.
  const base = tipo === 'urgente' || tipo === 'nao_urgente' ? detalheDoVeredito(tipo, envio?.motivoAntes) : tipo
  const detalhe = `${base} pelo=whatsapp ${papel}${envio && !envio.ok ? ' nao chegou' : ''}`.slice(0, 120)
  try {
    const { error } = await amb.admin.from('conversation_notes').insert({ clinic_id: amb.clinicId, conversation_id: alerta.conversation_id, texto: nota })
    if (error) console.error('Resposta ao alerta: nota nao gravada', error)
  } catch (erro) {
    console.error('Resposta ao alerta: nota nao gravada', erro)
  }
  try {
    const { error } = await amb.admin
      .from('whatsapp_bot_events')
      .insert({ clinic_id: amb.clinicId, conversation_id: alerta.conversation_id, evento: pedido ? 'resposta_ao_pedido' : 'veredito_urgencia', detalhe })
    if (error) console.error('Resposta ao alerta: evento nao gravado', error)
  } catch (erro) {
    console.error('Resposta ao alerta: evento nao gravado', erro)
  }
}

/**
 * Grava o veredito no alerta, se ainda puder: vale o primeiro "e urgente" ou
 * "pode aguardar". "Eu respondo" e o texto nao fecham a classificacao, entao
 * um veredito pode vir depois deles. A condicao fica no banco (update ...
 * where), o que evita corrida entre dois toques. Devolve como estava antes,
 * para desfazer se o envio ao paciente falhar.
 */
async function marcarVeredito(
  admin: Admin,
  alertaId: string,
  veredito: VereditoDoAlerta | 'texto',
  por: string,
  agora: Date,
): Promise<{ antes: string | null } | null> {
  const permitidos: (string | null)[] = veredito === 'urgente' || veredito === 'nao_urgente' ? [null, 'responde', 'texto'] : [null]
  for (const antes of permitidos) {
    const marcar = (q: Consulta) =>
      (antes === null ? q.is('veredito', null) : q.eq('veredito', antes)).select('id')
    const { data } = await marcar(
      admin.from('alertas_de_urgencia').update({ veredito, veredito_por: por, veredito_em: agora.toISOString() }).eq('id', alertaId),
    )
    if (data?.length) return { antes }
  }
  return null
}

/**
 * O veredito dado pela tela de Respostas fecha o alerta da conversa
 * (17/10/2026): sem isto, o medico tocaria "pode aguardar" no WhatsApp depois
 * do "e urgente" da tela, e o paciente receberia os dois. Pega o alerta mais
 * recente da conversa nas ultimas 24 horas que ainda nao foi classificado.
 * Nunca lanca: o veredito ja chegou ao paciente.
 */
export async function marcarVereditoDaTela(admin: Admin, conversationId: string, veredito: Veredito, agora: Date): Promise<void> {
  try {
    const { data, error } = await admin
      .from('alertas_de_urgencia')
      .select('id')
      .eq('conversation_id', conversationId)
      .neq('motivo', 'pedido')
      .gte('criado_em', new Date(agora.getTime() - JANELA_DA_META_MS).toISOString())
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (data?.id) await marcarVeredito(admin, String(data.id), veredito, 'tela', agora)
  } catch (erro) {
    console.error('Veredito pela tela: nao marquei o alerta do WhatsApp', erro)
  }
}

const TESTE = '✅ Era um alerta de teste: a resposta funcionou, e nada foi enviado a nenhum paciente.'

/**
 * Trata a mensagem se ela for resposta a um alerta. Devolve true quando tratou
 * (o webhook nao passa a mensagem ao robo do paciente).
 */
export async function tratarRespostaDaEquipe(amb: AmbienteDaResposta, numero: string, m: MensagemRecebida): Promise<boolean> {
  const papel = papelDoNumero(numero, amb.numeros)
  if (!papel) return false
  const r = lerRespostaDaEquipe(m)
  if (!r) return false
  const recentes = await alertasRecentes(amb)
  if (recentes === null) return false

  const quem = quemAtende(amb.clinicId)
  const responder = (texto: string, botoes?: { id: string; titulo: string }[]) =>
    amb.enviarWhatsApp(numero, montarConteudo(texto, botoes ? { botoes } : undefined))
  const nomeDoPaciente = (a: Alerta) => a.quem || 'o paciente'

  if (r.tipo === 'veredito' || r.tipo === 'confirmacao') {
    const alerta = recentes.find((a) => a.id === r.alertaId) ?? (await alertaPorId(amb, r.alertaId))
    if (!alerta) {
      await responder('Não achei esse alerta. Se precisar, responda ao paciente pela Central.')
      return true
    }
    if (alerta.teste) {
      await responder(TESTE)
      return true
    }

    if (r.tipo === 'veredito') {
      if (papel === 'equipe' && r.veredito !== 'responde') {
        await responder(`Só ${quem.o} classifica a urgência pelos botões. Para mandar algo ao paciente, escreva aqui a mensagem, que ela vai como equipe.`)
        return true
      }
      // "Eu respondo" so vale com o alerta em aberto: depois de um veredito,
      // "vai falar com voce" por cima do "procure o pronto-socorro" confunde.
      const marcado = await marcarVeredito(amb.admin, alerta.id, r.veredito, numero, amb.agora)
      if (!marcado) {
        const atual = await alertaPorId(amb, alerta.id)
        const rotulo = atual?.veredito ? ROTULO_DO_VEREDITO[atual.veredito] ?? atual.veredito : 'respondido'
        const onde = atual?.veredito_por === 'tela' ? ' pela tela de Respostas' : ''
        await responder(`Esse alerta já foi respondido${onde} (${rotulo}). Nada novo foi enviado ao paciente.`)
        return true
      }
      const envio = await enviarAoPaciente(amb, alerta, r.veredito, papel, '')
      if (!envio.ok) {
        // Nao chegou: o alerta volta a ficar como estava, para a tela de
        // Respostas (ou outro toque) poder dar o veredito de novo.
        await amb.admin
          .from('alertas_de_urgencia')
          .update({ veredito: marcado.antes, veredito_por: alerta.veredito_por, veredito_em: alerta.veredito_em })
          .eq('id', alerta.id)
          .eq('veredito', r.veredito)
          .eq('veredito_por', numero)
      }
      if (envio.ok) await marcarRespondido(amb, alerta.id, numero)
      await registrarResposta(amb, alerta, papel, r.veredito, envio)
      await responder(
        envio.ok
          ? `✅ Enviado para ${nomeDoPaciente(alerta)}.`
          : `⚠️ Não consegui enviar para ${nomeDoPaciente(alerta)}: ${envio.erro}. Responda pela Central.`,
      )
      return true
    }

    // Confirmacao do texto.
    if (r.acao === 'cancelar') {
      // Na escolha do paciente o mesmo texto fica em varios avisos: apaga todos.
      await apagarRascunhos(amb, numero)
      await amb.admin.from('alertas_de_urgencia').update({ rascunho: null, rascunho_de: null, rascunho_em: null }).eq('id', alerta.id)
      await responder('Cancelado: nada foi enviado ao paciente.')
      return true
    }
    const atual = (await alertaPorId(amb, alerta.id)) ?? alerta
    const velho = !atual.rascunho_em || amb.agora.getTime() - Date.parse(atual.rascunho_em) > JANELA_DO_ALERTA_MS
    if (!atual.rascunho || velho) {
      await responder('Não achei a mensagem para enviar. Escreva de novo, em cima do alerta.')
      return true
    }
    if (!atual.rascunho_de || !mesmoTelefone(atual.rascunho_de, numero)) {
      await responder('Essa mensagem foi escrita por outra pessoa: só ela pode confirmar o envio.')
      return true
    }
    const envio = await enviarAoPaciente(amb, atual, 'texto', papel, atual.rascunho)
    // O mesmo texto pode estar nos outros avisos (escolha do paciente): sai de todos.
    await apagarRascunhos(amb, numero)
    await amb.admin.from('alertas_de_urgencia').update({ rascunho: null, rascunho_de: null, rascunho_em: null }).eq('id', alerta.id)
    if (envio.ok) {
      await marcarVeredito(amb.admin, alerta.id, 'texto', numero, amb.agora)
      await marcarRespondido(amb, alerta.id, numero)
    }
    await registrarResposta(amb, atual, papel, 'texto', envio)
    await responder(
      envio.ok
        ? `✅ Enviado para ${nomeDoPaciente(atual)}.`
        : `⚠️ Não consegui enviar para ${nomeDoPaciente(atual)}: ${envio.erro}. Responda pela Central.`,
    )
    return true
  }

  // Texto, "ok" ou arquivo: de qual alerta?
  const escolha = escolherAlerta(recentes, r.citado, amb.agora, await ultimaResposta(amb, numero))
  if (!escolha) return false
  // So o nome do paciente: escolhe a conversa e nada vai para ele (ver pacientePeloNome).
  const pelaFala = r.tipo === 'texto' ? pacientePeloNome(r.texto, 'ambiguos' in escolha ? escolha.ambiguos : [escolha.alerta]) : null
  if (pelaFala && !pelaFala.teste) {
    await marcarRespondido(amb, pelaFala.id, numero)
    await responder(`Certo: as próximas mensagens vão para ${nomeDoPaciente(pelaFala)}. Escreva o que quer mandar.`)
    return true
  }
  if ('ambiguos' in escolha) {
    // Texto: o paciente e escolhido num toque, e o toque ja e o "Enviar"
    // (18/10/2026, no Dr. Marcello). O texto fica guardado em cada aviso; o
    // escolhido manda, e os outros sao apagados (apagarRascunhos). Com o
    // limite de sempre: a pergunta leva o texto inteiro e os botoes.
    if (r.tipo === 'texto' && r.texto.length <= LIMITE_DO_TEXTO) {
      const opcoes = escolha.ambiguos.filter((a) => !a.teste).slice(0, 9)
      if (opcoes.length) {
        await amb.admin
          .from('alertas_de_urgencia')
          .update({ rascunho: r.texto, rascunho_de: numero, rascunho_em: amb.agora.toISOString() })
          .in('id', opcoes.map((a) => a.id))
        const pergunta = `Para qual paciente vai esta mensagem?\n\n"${r.texto}"\n\nTocar no nome já envia o texto acima. As próximas seguem para o mesmo paciente, até chegar um aviso novo.`
        const cancelar = { id: payloadDaConfirmacao(opcoes[0].id, 'cancelar'), titulo: 'Cancelar' }
        await amb.enviarWhatsApp(
          numero,
          opcoes.length <= 2
            ? montarConteudo(pergunta, {
                botoes: [...opcoes.map((a) => ({ id: payloadDaConfirmacao(a.id, 'enviar'), titulo: nomeCurto(nomeDoPaciente(a), 20) })), cancelar],
              })
            : montarConteudo(pergunta, {
                lista: {
                  rotulo: 'Escolher paciente',
                  linhas: [...opcoes.map((a) => ({ id: payloadDaConfirmacao(a.id, 'enviar'), titulo: nomeCurto(nomeDoPaciente(a), 24) })), cancelar],
                },
              }),
        )
        return true
      }
    }
    const nomes = escolha.ambiguos.map(nomeDoPaciente).join(', ')
    await responder(
      `Há ${escolha.ambiguos.length} avisos recentes (${nomes}). Para eu saber de qual paciente é, segure a mensagem do aviso certo e toque em Responder.`,
    )
    return true
  }
  const alerta = escolha.alerta
  if (alerta.teste) {
    await responder(TESTE)
    return true
  }
  if (r.tipo === 'visto') {
    await registrarResposta(amb, alerta, papel, 'visto', null)
    await responder('👍 Anotado.')
    return true
  }
  if (r.tipo === 'midia') {
    await responder('Por aqui eu só consigo repassar texto ao paciente. Escreva a orientação, ou mande o arquivo pela Central.')
    return true
  }

  // A confirmacao leva o texto inteiro e os botoes Enviar e Cancelar, e a Meta
  // so aceita botao com ate 1024 caracteres na mensagem: acima disso o envio
  // cairia em texto puro, sem o Enviar, e o medico ficaria sem como confirmar.
  if (r.texto.length > LIMITE_DO_TEXTO) {
    await responder(`A mensagem passa de ${LIMITE_DO_TEXTO} caracteres. Escreva uma mais curta, ou responda ao paciente pela Central.`)
    return true
  }
  const texto = r.texto
  await amb.admin
    .from('alertas_de_urgencia')
    .update({ rascunho: texto, rascunho_de: numero, rascunho_em: amb.agora.toISOString() })
    .eq('id', alerta.id)
  const como = papel === 'medico' ? `mensagem d${quem.o}` : 'mensagem da equipe do consultório'
  await responder(`Vou mandar para ${nomeDoPaciente(alerta)}, como ${como}:\n\n"${texto}"\n\nConfirma?`, [
    { id: payloadDaConfirmacao(alerta.id, 'enviar'), titulo: 'Enviar' },
    { id: payloadDaConfirmacao(alerta.id, 'cancelar'), titulo: 'Cancelar' },
  ])
  return true
}

/**
 * O que o paciente escreve de volta, nos celulares (18/10/2026, no Dr.
 * Marcello: "e quando a familia responder, da para voltar para ele e para mim
 * a mensagem tambem?").
 *
 * Quando alguem respondeu a um aviso desta conversa pelo WhatsApp nas ultimas
 * 6 horas, a conversa esta acontecendo por la: cada mensagem do paciente vai
 * aos numeros do alerta, e a mensagem repassada entra nos ids do aviso, para a
 * resposta em cima dela voltar ao mesmo paciente (escolherAlerta).
 *
 * Texto livre chega a quem escreveu para o numero da clinica nas ultimas 24
 * horas (quem acabou de responder). Para os outros a Meta recusa, e vai o
 * modelo pedido_equipe com o botao "Eu respondo" do mesmo aviso.
 *
 * Devolve true quando repassou. Nunca lanca: o webhook segue com o robo.
 */
const MIDIA_DO_PACIENTE: Record<string, string> = {
  '[image]': '📷 Mandou uma foto (veja na Central)',
  '[audio]': '🎤 Mandou um áudio (ouça na Central)',
  '[voice]': '🎤 Mandou um áudio (ouça na Central)',
  '[video]': '🎥 Mandou um vídeo (veja na Central)',
  '[document]': '📄 Mandou um documento (veja na Central)',
  '[sticker]': 'Mandou uma figurinha',
}

export async function repassarRespostaDoPaciente(
  amb: Pick<AmbienteDaResposta, 'admin' | 'clinicId' | 'agora' | 'numeros' | 'enviarWhatsApp'>,
  p: { conversationId: string; quem: string; texto: string; idioma?: string; anexo?: AnexoParaEquipe },
): Promise<boolean> {
  try {
    if (!amb.numeros.length) return false
    const { data, error } = await amb.admin
      .from('alertas_de_urgencia')
      .select('id,mensagens,quem,teste')
      .eq('clinic_id', amb.clinicId)
      .eq('conversation_id', p.conversationId)
      .gte('respondido_em', new Date(amb.agora.getTime() - JANELA_DO_ALERTA_MS).toISOString())
      .order('respondido_em', { ascending: false })
      .limit(1)
    if (error) throw error
    const alerta = (data as { id: string; mensagens: string[] | null; quem: string; teste?: boolean }[] | null)?.[0]
    if (!alerta || alerta.teste) return false

    const quem = p.quem.trim() || alerta.quem || 'O paciente'
    const fala = MIDIA_DO_PACIENTE[p.texto.trim()] ?? p.texto.trim()
    const livre = montarConteudo(
      `💬 ${quem} respondeu:\n\n"${fala.slice(0, LIMITE_DO_TEXTO)}"\n\nPara responder, escreva aqui: vai para ${quem}.`,
      { botoes: [{ id: payloadDoVeredito(alerta.id, 'responde'), titulo: 'Eu respondo' }] },
    )
    const parametros = parametrosDoPedido({ quem, texto: fala, agora: amb.agora, assunto: 'respondeu à sua mensagem' })
    const modelo = {
      type: 'template',
      template: {
        name: MODELO_DO_PEDIDO,
        language: { code: p.idioma || 'pt_BR' },
        components: [
          { type: 'body', parameters: parametros.map((text) => ({ type: 'text', text })) },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: payloadDoVeredito(alerta.id, 'responde') }] },
        ],
      },
    }
    // O arquivo vai atras do texto livre (25/10/2026, vindo do sistema do
    // Dr. Marcello, ver anexo-para-equipe.ts): se o texto livre passou, a
    // janela de 24 horas daquele celular esta aberta e o arquivo passa tambem.
    // Quem so recebeu o modelo fica com o arquivo pendente, que vai quando
    // ele escrever (anexos-pendentes.ts).
    const corpoDoAnexo = p.anexo && anexoQueVai(p.anexo.tipo) ? mensagemDoAnexo(p.anexo, quem) : null
    const ids: string[] = []
    for (const numero of amb.numeros) {
      let envio = await amb.enviarWhatsApp(numero, livre)
      const livrePassou = envio.ok
      if (!envio.ok) envio = await amb.enviarWhatsApp(numero, modelo)
      if (envio.ok && envio.id) ids.push(envio.id)
      if (!envio.ok) console.error('Repasse do paciente nao chegou a', numero.slice(-4), envio.erro)
      if (corpoDoAnexo && p.anexo) {
        const doAnexo = livrePassou ? await amb.enviarWhatsApp(numero, corpoDoAnexo) : { ok: false as const, erro: 'fora da janela de 24 horas' }
        if (!doAnexo.ok) console.warn('Repasse do paciente: o arquivo ficou pendente para', numero.slice(-4), doAnexo.erro)
        if (p.anexo.caminho) {
          await registrarEnvioDoAnexo(amb.admin, {
            clinicId: amb.clinicId,
            conversationId: p.conversationId,
            numero,
            tipo: p.anexo.tipo,
            caminho: p.anexo.caminho,
            nome: p.anexo.nome,
            quem,
            recebidoEm: p.anexo.recebidoEm ?? amb.agora.toISOString(),
            metaId: doAnexo.ok ? doAnexo.id : null,
            ok: doAnexo.ok,
            erro: doAnexo.ok ? undefined : doAnexo.erro,
          })
        }
      }
    }
    if (ids.length) {
      const { error: erroDosIds } = await amb.admin
        .from('alertas_de_urgencia')
        .update({ mensagens: [...(alerta.mensagens ?? []), ...ids] })
        .eq('id', alerta.id)
      if (erroDosIds) console.error('Repasse do paciente: ids nao gravados', erroDosIds)
    }
    return ids.length > 0
  } catch (erro) {
    // Sem as colunas de 18/10 ou sem a tabela: segue como sempre.
    console.warn('Repasse do paciente: nao consegui ver a conversa no WhatsApp do medico', erro)
    return false
  }
}

// Os titulos dos botoes, para quem monta o modelo na Meta e para os testes.
export const TITULOS_DOS_BOTOES = BOTOES_DO_ALERTA.map((b) => b.titulo)
