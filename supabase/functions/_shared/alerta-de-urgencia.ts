import { montarConteudo } from './conteudo.ts'
import { textoDoModelo } from './modelos.ts'
import { quemAtende } from './quem-atende.ts'
import { chaveDoWhatsApp } from './whatsapp-teste.ts'
import { MOTIVOS_COM_VEREDITO } from './veredito.ts'

/**
 * Alerta de urgencia no WhatsApp pessoal do medico, com botoes (17/10/2026,
 * pedido do Edu).
 *
 * Ate aqui a urgencia e o sangramento so tocavam o celular do Dr. Fabio e da
 * Dayane pela notificacao do navegador (aviso-da-equipe.ts), que no iPhone nao
 * aceita botoes e depende de cada um ter ativado o aparelho. Agora, quando a
 * conversa ENTRA em urgencia ou sangramento, sai tambem um modelo aprovado da
 * Meta para o WhatsApp de cada numero de clinic_settings.alerta_urgencia_telefones,
 * a qualquer hora. A notificacao do navegador continua: um nao substitui o outro.
 *
 * Por modelo aprovado porque fora da janela de 24 horas a Meta nao aceita texto
 * livre, e o medico quase nunca escreveu para o numero do robo no dia. Os
 * botoes levam o id do alerta (URG:<id>:<veredito>), e e assim que a resposta
 * dele volta ao paciente certo (ver resposta-ao-alerta.ts).
 *
 * O paciente SEMPRE recebe primeiro a resposta do robo (pronto-socorro no
 * sangramento e nos sinais de alarme). O alerta e reforco, nunca a unica
 * protecao: roda depois da resposta, fora do caminho do atendimento, e nada
 * aqui derruba o webhook.
 *
 * Falha nao pode ser silenciosa: todo envio vira nota na conversa, que a equipe
 * ve, e evento alerta_urgencia nos Numeros do WhatsApp. Se nao saiu, a nota diz
 * e manda avisar o medico por telefone.
 *
 * Feito a partir do alerta do sistema do Dr. Marcello (mesma data), sem o
 * Instagram (o Dr. Fabio nao tem) e com o veredito igual ao da tela de
 * Respostas (veredito.ts).
 */

/** Sem botoes: o recuo enquanto o modelo com botoes nao e aprovado. */
export const MODELO_DO_ALERTA = 'alerta_urgencia'
/** Com os tres botoes de resposta rapida. */
export const MODELO_COM_BOTOES = 'alerta_urgencia_botoes'
/**
 * Validade da mensagem na Meta: 12 horas, configurada no proprio modelo
 * (message_send_ttl_seconds). O padrao curto faria o alerta sumir sem aviso com
 * o celular do medico desligado por algumas horas. Ver o LEIA-ME do projeto.
 */
export const VALIDADE_DO_ALERTA_S = 12 * 3600

/**
 * Pedido que nao e urgencia, nos mesmos celulares (18/10/2026 no sistema do
 * Dr. Marcello, trazido em 25/10/2026): "Mandar para o celular", na conversa
 * aberta da Central, manda a conversa ao WhatsApp do medico e da Dayane, e a
 * resposta de la volta ao paciente pelo mesmo caminho do alerta
 * (resposta-ao-alerta.ts): texto em cima da mensagem, ou o botao "Eu respondo".
 *
 * Aqui so sai pela mao de alguem da equipe. No Dr. Marcello o robo tambem
 * encaminha sozinho o que depende do medico (receita, foto de exame, duvida de
 * conduta); no Dr. Fabio isso espera ele e a Cintia decidirem o que vai ao
 * celular dele - o relatorio da Cintia so pede o aviso do sangramento.
 */
export const MODELO_DO_PEDIDO = 'pedido_equipe'

export type VereditoDoAlerta = 'urgente' | 'nao_urgente' | 'responde'

/** Os botoes do modelo, na ordem cadastrada na Meta. */
export const BOTOES_DO_ALERTA: { veredito: VereditoDoAlerta; titulo: string }[] = [
  { veredito: 'urgente', titulo: 'É urgente' },
  { veredito: 'nao_urgente', titulo: 'Pode aguardar' },
  { veredito: 'responde', titulo: 'Eu respondo' },
]

/** O que volta no webhook quando o medico toca: qual alerta e qual botao. */
export const payloadDoVeredito = (alertaId: string, veredito: VereditoDoAlerta) => `URG:${alertaId}:${veredito}`

// So o pedaco do cliente do Supabase que estas pecas usam. Tabela e coluna
// novas: o resto do clinic_settings e lido em consulta separada.
type Admin = { from: (tabela: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

export type Enviado = { ok: true; id: string | null } | { ok: false; erro: string; codigo?: number }
/** Uma mensagem pelo WhatsApp da clinica. O simulador passa uma de mentira. */
export type EnviarWhatsApp = (para: string, conteudo: Record<string, unknown>) => Promise<Enviado>

// Pelo globalThis, como em whatsapp-teste.ts: este arquivo tambem roda no
// simulador, no navegador, onde nao existe Deno.
const doAmbiente = (nome: string) =>
  (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(nome)?.trim()

/**
 * Id novo para o alerta. randomUUID so existe em contexto seguro; o simulador
 * aberto de um arquivo pode nao ter, e ali o id so precisa ser unico.
 */
function novoId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`
}

/** O envio de verdade, pela API da Meta. */
export function whatsAppPelaApi(phoneNumberId: string, token: string | undefined, buscar: typeof fetch = fetch): EnviarWhatsApp {
  const versao = doAmbiente('META_GRAPH_VERSION') || 'v25.0'
  return async (para, conteudo) => {
    if (!token) return { ok: false, erro: 'WhatsApp da clínica sem token no servidor' }
    try {
      const r = await buscar(`https://graph.facebook.com/${versao}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, ...conteudo }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok) return { ok: true, id: j?.messages?.[0]?.id ? String(j.messages[0].id) : null }
      const codigo = typeof j?.error?.code === 'number' ? j.error.code : undefined
      return { ok: false, erro: `${codigo ? `(#${codigo}) ` : ''}${j?.error?.message ?? `HTTP ${r.status}`}`, codigo }
    } catch (erro) {
      return { ok: false, erro: String(erro).slice(0, 200) }
    }
  }
}

/**
 * Um celular pronto para a Meta: 55 + DDD + numero, com o nono digito no
 * celular antigo (a Meta so entrega com ele). Fixo (2 a 5 na frente) fica como
 * esta. null = nao fecha um telefone brasileiro.
 */
function paraOAlerta(bruto: string): string | null {
  const digitos = String(bruto ?? '').replace(/\D/g, '')
  let local = digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos
  if (local.length === 10 && /^[6-9]/.test(local.slice(2))) local = `${local.slice(0, 2)}9${local.slice(2)}`
  return local.length === 10 || local.length === 11 ? `55${local}` : null
}

/**
 * Os numeros do alerta, prontos para a Meta, na ordem (o primeiro e o do
 * medico). Aceita a lista do banco ou o texto da tela (um por linha, ou
 * separados por virgula). Numero que nao fecha um telefone fica de fora: melhor
 * um alerta a menos do que um erro da Meta que esconde os outros.
 */
export function numerosDoAlerta(valor: unknown): string[] {
  const brutos = Array.isArray(valor) ? valor.map(String) : String(valor ?? '').split(/[\n,;]+/)
  const vistos: string[] = []
  for (const bruto of brutos) {
    const numero = paraOAlerta(bruto)
    if (numero && !vistos.includes(numero)) vistos.push(numero)
  }
  return vistos
}

/**
 * Alertar agora? So quando a conversa ENTRA em urgencia ou sangramento. Quem
 * continua escrevendo na mesma urgencia nao dispara outro alerta a cada
 * mensagem (a notificacao do navegador, sim): o medico ja foi avisado e a
 * conversa esta no topo da lista. Sangramento que vira urgencia e a mesma
 * ocorrencia. Urgencia nova, depois de a equipe resolver a anterior (ou depois
 * do "pode aguardar", que deixa a conversa como "atendente"), alerta de novo.
 */
export function deveAlertar(e: { atencaoAntes: boolean; motivoAntes: string | null; motivoAgora: string | null }): boolean {
  if (!e.motivoAgora || !MOTIVOS_COM_VEREDITO.includes(e.motivoAgora)) return false
  return !(e.atencaoAntes && e.motivoAntes && MOTIVOS_COM_VEREDITO.includes(e.motivoAntes))
}

/**
 * Sem CPF, e-mail e telefone (LGPD): o medico precisa saber o que aconteceu, e
 * o resto esta na Central. O CPF vem antes do telefone porque os 11 digitos
 * dele tambem parecem celular.
 */
export function semDadosPessoais(texto: string): string {
  return String(texto ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/(\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
}

/**
 * Parametro de modelo nao pode ter quebra de linha, tabulacao nem quatro
 * espacos seguidos (a Meta recusa o envio inteiro), nem ficar vazio.
 */
function parametro(texto: string, limite: number): string {
  const limpo = String(texto ?? '').replace(/\s+/g, ' ').trim()
  if (!limpo) return '-'
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo
}

export type MotivoDoAlerta = 'urgencia' | 'sangramento'
/** O que vai aos celulares: o alerta (urgencia, sangramento) ou o pedido. */
export type MotivoDoAviso = MotivoDoAlerta | 'pedido'

const NOME_DO_MOTIVO: Record<MotivoDoAlerta, string> = { urgencia: 'urgência', sangramento: 'sangramento' }

/**
 * Os quatro parametros do modelo, na ordem: o motivo ("Alerta de sangramento"),
 * quem, a hora de Brasilia e o trecho da mensagem.
 */
export function parametrosDoAlerta(e: { motivo: MotivoDoAlerta; quem: string; texto: string; agora: Date }): string[] {
  const hora = e.agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return [NOME_DO_MOTIVO[e.motivo] ?? 'urgência', parametro(e.quem, 60), hora, parametro(semDadosPessoais(e.texto), 300)]
}

/**
 * Os quatro parametros do pedido: quem, a hora, o assunto e o trecho. Sem o
 * canal do Dr. Marcello (la tambem vem do Instagram).
 */
export function parametrosDoPedido(e: { quem: string; texto: string; agora: Date; assunto?: string }): string[] {
  const hora = e.agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return [parametro(e.quem, 60), hora, parametro(e.assunto ?? 'pedido para a equipe', 80), parametro(semDadosPessoais(e.texto), 300)]
}

/**
 * Quem escreveu, para o medico reconhecer: o paciente unico do telefone, o
 * nome do perfil do WhatsApp, ou o final do numero. O numero inteiro nao vai:
 * o alerta fica no celular pessoal de quem recebe.
 */
export function quemNoAlerta(e: { pacientes: { name: string }[]; nomeDoPerfil: string; telefone: string }): string {
  if (e.pacientes.length === 1 && e.pacientes[0].name.trim()) return e.pacientes[0].name.trim()
  if (e.nomeDoPerfil.trim()) return e.nomeDoPerfil.trim()
  const digitos = String(e.telefone ?? '').replace(/\D/g, '')
  return digitos.length >= 4 ? `Paciente sem cadastro (final ${digitos.slice(-4)})` : 'Paciente sem cadastro'
}

export type EnvioDoAlerta = { numero: string; ok: boolean; erro?: string }

const final = (numero: string) => `final ${numero.slice(-4)}`

/**
 * O que fica registrado: o detalhe curto do evento (ate 120 caracteres) e a
 * nota que a equipe le na conversa.
 */
export function descreverEnvio(
  envios: EnvioDoAlerta[],
  clinicId: string | null | undefined,
  motivo: MotivoDoAviso = 'urgencia',
): { detalhe: string; nota: string; falhou: boolean } {
  if (motivo === 'pedido') return descreverPedido(envios)
  const medico = quemAtende(clinicId).o
  const nome = NOME_DO_MOTIVO[motivo] ?? 'urgência'
  if (!envios.length) {
    return {
      detalhe: 'sem numero cadastrado',
      nota: `⚠️ O alerta de ${nome} no WhatsApp NÃO saiu: nenhum número cadastrado em Preferências. Avise ${medico} por telefone.`,
      falhou: true,
    }
  }
  const certos = envios.filter((e) => e.ok)
  const errados = envios.filter((e) => !e.ok)
  if (!errados.length) {
    return {
      detalhe: `enviado ${certos.length}/${envios.length}`,
      nota: `🚨 Alerta de ${nome} enviado no WhatsApp para ${envios.length === 1 ? '1 número' : `${envios.length} números`} (${certos.map((e) => final(e.numero)).join(', ')}).`,
      falhou: false,
    }
  }
  const motivoDoErro = errados[0].erro ?? 'sem detalhe'
  const naoAprovado = /132001|template name does not exist|does not exist in/i.test(motivoDoErro)
  const explicacao = naoAprovado ? `o modelo ${MODELO_DO_ALERTA} ainda não foi aprovado na Meta` : motivoDoErro
  return {
    detalhe: `falhou ${errados.length}/${envios.length}: ${motivoDoErro}`.slice(0, 120),
    nota:
      `⚠️ O alerta de ${nome} no WhatsApp NÃO chegou a ${errados.map((e) => final(e.numero)).join(', ')}: ${explicacao}. ` +
      `Avise ${medico} por telefone.` +
      (certos.length ? ` Chegou a ${certos.map((e) => final(e.numero)).join(', ')}.` : ''),
    falhou: true,
  }
}

/**
 * A nota do pedido. Sem telefonema: a fila da Central continua sendo o
 * caminho. Deu certo tambem vira nota (no Dr. Marcello so a falha vira; aqui
 * o "Mandar para o celular" mostra a nota embaixo do botao, e em branco
 * parecia que nada tinha acontecido).
 */
function descreverPedido(envios: EnvioDoAlerta[]): { detalhe: string; nota: string; falhou: boolean } {
  if (!envios.length) {
    return {
      detalhe: 'sem numero cadastrado',
      nota: '⚠️ A conversa NÃO foi para o celular: nenhum número cadastrado em Preferências (Alerta de urgência no WhatsApp do médico). Responda o paciente por aqui.',
      falhou: true,
    }
  }
  const certos = envios.filter((e) => e.ok)
  const errados = envios.filter((e) => !e.ok)
  if (!errados.length) {
    return {
      detalhe: `enviado ${certos.length}/${envios.length}`,
      nota: `📲 Conversa enviada para o WhatsApp de ${envios.length === 1 ? '1 número' : `${envios.length} números`} (${certos.map((e) => final(e.numero)).join(', ')}). A resposta de lá volta para o paciente.`,
      falhou: false,
    }
  }
  const motivoDoErro = errados[0].erro ?? 'sem detalhe'
  // Sem o modelo aprovado, o pedido vai como texto livre, que so chega a quem
  // escreveu para o numero da clinica nas ultimas 24 horas (131047).
  const foraDaJanela = /131047|re-engagement|24 hours|132001|template name does not exist|does not exist in/i.test(motivoDoErro)
  const explicacao = foraDaJanela
    ? `o modelo ${MODELO_DO_PEDIDO} ainda não foi aprovado na Meta, e esse celular não escreveu para o número da clínica nas últimas 24 horas`
    : motivoDoErro
  return {
    detalhe: `falhou ${errados.length}/${envios.length}: ${motivoDoErro}`.slice(0, 120),
    nota:
      `⚠️ A conversa NÃO chegou ao celular ${errados.map((e) => final(e.numero)).join(', ')}: ${explicacao}. Responda o paciente por aqui.` +
      (certos.length ? ` Chegou a ${certos.map((e) => final(e.numero)).join(', ')}.` : ''),
    falhou: true,
  }
}

/**
 * Os numeros salvos na clinica. null = nao deu para ler (a coluna ainda nao
 * existe): diferente de lista vazia, e o log grita.
 */
export async function lerNumeros(admin: Admin, clinicId: string): Promise<string[] | null> {
  try {
    const { data, error } = await admin.from('clinic_settings').select('alerta_urgencia_telefones').eq('clinic_id', clinicId).maybeSingle()
    if (error) throw error
    return numerosDoAlerta((data as { alerta_urgencia_telefones?: unknown } | null)?.alerta_urgencia_telefones)
  } catch (erro) {
    console.error('Alerta de urgencia: nao li clinic_settings.alerta_urgencia_telefones (falta a migration?)', erro)
    return null
  }
}

/** 132001: modelo inexistente ou ainda nao aprovado nesse idioma. */
function modeloInexistente(envio: Enviado): boolean {
  return !envio.ok && (envio.codigo === 132001 || /132001|template name does not exist|does not exist in/i.test(envio.erro))
}

export type PedidoDeAlerta = {
  clinicId: string
  /** 'pedido' (25/10/2026): o "Mandar para o celular", pelo modelo pedido_equipe. */
  motivo: MotivoDoAviso
  /** A linha "Assunto" do pedido. */
  assunto?: string
  quem: string
  texto: string
  agora: Date
  /** A conversa do paciente; sem ela, e o alerta de teste da tela. */
  conversationId?: string
  /** Para o teste da tela e o simulador: manda para estes, sem ler o banco. */
  numeros?: string[]
}

export type ResultadoDoAlerta = {
  envios: EnvioDoAlerta[]
  /** O alerta registrado em alertas_de_urgencia; null = saiu sem botoes, ou nem saiu. */
  alertaId: string | null
  detalhe: string
  nota: string
  falhou: boolean
}

/** O registro antes do envio: e o id dele que vai nos botoes. */
async function registrarAlerta(admin: Admin, p: PedidoDeAlerta): Promise<string | null> {
  try {
    // O id nasce aqui, e nao no banco, para ir nos botoes sem depender do
    // insert devolver a linha.
    const id = novoId()
    const { error } = await admin.from('alertas_de_urgencia').insert({
      id,
      clinic_id: p.clinicId,
      conversation_id: p.conversationId ?? null,
      teste: !p.conversationId,
      motivo: p.motivo,
      quem: String(p.quem ?? '').slice(0, 120),
      criado_em: p.agora.toISOString(),
    })
    if (error) throw error
    return id
  } catch (erro) {
    console.error('Alerta de urgencia: nao registrei o alerta; vai sem botoes de resposta', erro)
    return null
  }
}

/**
 * Manda o alerta para cada numero e registra o resultado. Nunca lanca: quem
 * chama e o webhook, depois de o paciente ja ter recebido a resposta.
 * `enviar` vem pronto no simulador; no servidor, sai da API da Meta com o
 * numero e a chave da clinica.
 */
export async function enviarAlertaDeUrgencia(admin: Admin, p: PedidoDeAlerta, enviar?: EnviarWhatsApp): Promise<ResultadoDoAlerta> {
  const pedido = p.motivo === 'pedido'
  const naoSaiu = (porque: string) =>
    pedido
      ? `⚠️ A conversa NÃO foi para o celular: ${porque}. Responda o paciente por aqui.`
      : `⚠️ O alerta de ${NOME_DO_MOTIVO[p.motivo as MotivoDoAlerta] ?? 'urgência'} no WhatsApp NÃO saiu: ${porque}. Avise ${quemAtende(p.clinicId).o} por telefone.`
  const registrarNaConversa = async (nota: string, detalhe: string) => {
    if (!p.conversationId) return
    // Cada parte no seu try: perder a nota nao pode custar o evento, e vice-versa.
    try {
      const { error } = await admin.from('conversation_notes').insert({ clinic_id: p.clinicId, conversation_id: p.conversationId, texto: nota })
      if (error) console.error('Alerta de urgencia: nota nao gravada', error)
    } catch (erro) {
      console.error('Alerta de urgencia: nota nao gravada', erro)
    }
    try {
      const { error } = await admin
        .from('whatsapp_bot_events')
        .insert({ clinic_id: p.clinicId, conversation_id: p.conversationId, evento: pedido ? 'pedido_equipe' : 'alerta_urgencia', detalhe: detalhe.slice(0, 120) })
      if (error) console.error('Alerta de urgencia: evento nao gravado', error)
    } catch (erro) {
      console.error('Alerta de urgencia: evento nao gravado', erro)
    }
  }

  try {
    const lidos = p.numeros ?? (await lerNumeros(admin, p.clinicId))
    if (lidos === null) {
      const nota = naoSaiu('não consegui ler os números do alerta')
      await registrarNaConversa(nota, 'falhou: sem a lista de numeros')
      return { envios: [], alertaId: null, detalhe: 'falhou: sem a lista de numeros', nota, falhou: true }
    }
    const numeros = numerosDoAlerta(lidos)
    if (!numeros.length) {
      const r = descreverEnvio([], p.clinicId, p.motivo)
      await registrarNaConversa(r.nota, r.detalhe)
      return { envios: [], alertaId: null, ...r }
    }

    const { data: ajustes, error: erroDosAjustes } = await admin
      .from('clinic_settings')
      .select('whatsapp_phone_number_id,whatsapp_template_language')
      .eq('clinic_id', p.clinicId)
      .maybeSingle()
    if (erroDosAjustes) console.error('Alerta de urgencia: nao li o clinic_settings', erroDosAjustes)
    const numeroDoRobo = (ajustes as { whatsapp_phone_number_id?: string } | null)?.whatsapp_phone_number_id
    const idioma = (ajustes as { whatsapp_template_language?: string } | null)?.whatsapp_template_language || 'pt_BR'
    const mandar = enviar ?? (numeroDoRobo ? whatsAppPelaApi(numeroDoRobo, chaveDoWhatsApp(numeroDoRobo)) : null)
    const parametros = pedido ? parametrosDoPedido(p) : parametrosDoAlerta({ ...p, motivo: p.motivo as MotivoDoAlerta })
    const corpoDoModelo = { type: 'body', parameters: parametros.map((text) => ({ type: 'text', text })) }

    // Sem a tabela (migration nao chegou), sai sem botoes: o medico ainda e avisado.
    const alertaId = await registrarAlerta(admin, p)
    // Com botoes so com alerta registrado; se a Meta disser que o modelo com
    // botoes nao existe (ainda em analise), o resto vai pelo sem botoes.
    // No pedido, "com botoes" e o modelo pedido_equipe; sem ele aprovado, vai
    // o mesmo texto com o botao "Eu respondo", que chega a quem escreveu para
    // o numero da clinica nas ultimas 24 horas (quem acabou de responder um
    // alerta). Fora disso a Meta recusa, e a nota diz.
    let comBotoes = pedido || Boolean(alertaId)
    const eurespondo = alertaId ? [{ id: payloadDoVeredito(alertaId, 'responde'), titulo: 'Eu respondo' }] : undefined
    const doPedido = (modeloAprovado: boolean): Record<string, unknown> =>
      modeloAprovado
        ? {
            type: 'template',
            template: {
              name: MODELO_DO_PEDIDO,
              language: { code: idioma },
              components: [
                corpoDoModelo,
                ...(alertaId
                  ? [{ type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: payloadDoVeredito(alertaId, 'responde') }] }]
                  : []),
              ],
            },
          }
        : montarConteudo(
            // Sem a linha "[Eu respondo]" do registro: o botao vai de verdade.
            (textoDoModelo(MODELO_DO_PEDIDO, parametros) ?? parametros.join(' · ')).replace(/\n\n\[[^\]\n]*\]$/, ''),
            eurespondo ? { botoes: eurespondo } : undefined,
          )
    const doAlerta = (botoes: boolean): Record<string, unknown> => ({
      type: 'template',
      template: botoes
        ? {
            name: MODELO_COM_BOTOES,
            language: { code: idioma },
            components: [
              corpoDoModelo,
              ...BOTOES_DO_ALERTA.map((b, i) => ({
                type: 'button',
                sub_type: 'quick_reply',
                index: String(i),
                parameters: [{ type: 'payload', payload: payloadDoVeredito(alertaId as string, b.veredito) }],
              })),
            ],
          }
        : { name: MODELO_DO_ALERTA, language: { code: idioma }, components: [corpoDoModelo] },
    })
    const modelo = (botoes: boolean) => (pedido ? doPedido(botoes) : doAlerta(botoes))

    const envios: EnvioDoAlerta[] = []
    const mensagens: string[] = []
    for (const numero of numeros) {
      if (!mandar) {
        envios.push({ numero, ok: false, erro: 'WhatsApp da clínica sem número no servidor' })
        continue
      }
      try {
        let r = await mandar(numero, modelo(comBotoes))
        if (comBotoes && modeloInexistente(r)) {
          console.warn(
            pedido
              ? `Pedido para o celular: ${MODELO_DO_PEDIDO} ainda nao aprovado; vai como texto`
              : `Alerta de urgencia: ${MODELO_COM_BOTOES} ainda nao aprovado; vai o modelo sem botoes`,
          )
          comBotoes = false
          r = await mandar(numero, modelo(false))
        }
        if (r.ok) {
          envios.push({ numero, ok: true })
          if (r.id) mensagens.push(r.id)
        } else {
          envios.push({ numero, ok: false, erro: r.erro })
        }
      } catch (erro) {
        envios.push({ numero, ok: false, erro: String(erro).slice(0, 200) })
      }
    }
    if (alertaId && mensagens.length) {
      try {
        const { error } = await admin.from('alertas_de_urgencia').update({ mensagens }).eq('id', alertaId)
        if (error) console.error('Alerta de urgencia: ids das mensagens nao gravados', error)
      } catch (erro) {
        console.error('Alerta de urgencia: ids das mensagens nao gravados', erro)
      }
    }

    const descricao = descreverEnvio(envios, p.clinicId, p.motivo)
    if (descricao.falhou) console.error('Alerta de urgencia nao saiu para todos', descricao.detalhe)
    await registrarNaConversa(descricao.nota, descricao.detalhe)
    return { envios, alertaId, ...descricao }
  } catch (erro) {
    console.error('Alerta de urgencia: falhou antes de enviar', erro)
    const nota = naoSaiu(String(erro).slice(0, 120))
    await registrarNaConversa(nota, `falhou: ${String(erro)}`)
    return { envios: [], alertaId: null, detalhe: `falhou: ${String(erro)}`.slice(0, 120), nota, falhou: true }
  }
}
