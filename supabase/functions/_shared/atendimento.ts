/**
 * Atendimento automatico do WhatsApp.
 *
 * Quem escreve para a clinica cai num menu de tres opcoes: informacoes,
 * agendar, ou falar com a equipe. O agendamento e um sub-fluxo (unidade ->
 * horario) e nao um destino final: de qualquer etapa da a para voltar.
 *
 * Duas regras guiam todo o texto daqui:
 *  1. nenhuma resposta termina sem dizer o que fazer em seguida;
 *  2. MENU sempre volta ao inicio, e isso aparece escrito na mensagem.
 *
 * Regra da clinica para marcar:
 *  - paciente ja cadastrado marca direto;
 *  - pessoa sem cadastro gera solicitacao com a vaga reservada por 24h, e a
 *    recepcao confirma.
 *
 * Este arquivo so decide e escreve no banco. Quem envia a mensagem e o
 * meta-webhook, que ja tem o token e o numero em maos.
 */

import { avisoDeHorario, dentroDoExpediente, EXPEDIENTE } from './expediente.ts'
import { dataDeNascimentoIso } from './datas.ts'
import type { adminClient } from './whatsapp.ts'
import { cadastrarDaFicha, mesmaCrianca, type ConsultaParaCadastro } from './cadastro.ts'
import { situacaoDoRetorno, visitasDoBanco, type FichaDoBanco, type SituacaoDoRetorno } from './prazo-do-retorno.ts'
import { quemAtende, type QuemAtende } from './quem-atende.ts'
import { preencherCampos, temCampo, type Lugar } from './campos-do-texto.ts'
import {
  acharResposta,
  acharRespostas,
  assuntoClinico,
  carregarRespostas,
  medicamentoControlado,
  type RespostaPronta,
} from './respostas.ts'

/** Dias oferecidos de uma vez. Cabe a quinzena inteira numa mensagem so. */
/**
 * Ate oito dias por lista.
 *
 * Nao e limite de tela: e para o *9* poder significar "falar com a equipe" em
 * qualquer etapa. Com dez dias na lista, o nove seria um dia e a saida teria de
 * voltar a ser uma palavra digitada.
 */
const MAX_DIAS = 8
/** Horarios de um dia. Um expediente de 8h as 18h em blocos de 40min da 15. */
// Oito tambem aqui, pelo mesmo motivo dos dias: com nove horarios na lista, o
// *9* seria um horario. Quem precisar de um horario fora dos oito primeiros usa
// justamente o 9 para falar com a equipe, que e o que a linha de saida oferece.
const MAX_HORARIOS_DIA = 8
/** Teto do WhatsApp para linhas de uma lista tocavel. */
const MAX_TOQUES = 10
/** Tetos da Meta para o texto de cada linha. Passar disso derruba a mensagem. */
const LIMITE_TITULO = 24
const LIMITE_DESCRICAO = 72

/**
 * O cliente com service_role que o webhook ja tem em maos. Tipar pelo retorno
 * de adminClient() em vez de `any` mantem o lint honesto sem repetir aqui a
 * definicao inteira do banco.
 */
type Admin = ReturnType<typeof adminClient>

export type Estado =
  | 'menu'
  | 'minha_consulta'
  | 'confirmar_cancelamento'
  | 'ja_tem_consulta'
  | 'aguardando_paciente'
  // Retorno pedido de um telefone sem o paciente (26/10/2026): o nome e o
  // nascimento (ou o CPF) para achar o cadastro. O nome do estado ficou o do
  // sistema do Dr. Marcello, que o criou.
  | 'aguardando_crianca_do_retorno'
  | 'aguardando_unidade'
  | 'aguardando_convenio'
  | 'aguardando_dia'
  | 'aguardando_horario'
  | 'dados_nome'
  | 'dados_nascimento'
  | 'dados_responsavel'
  | 'dados_motivo'
  | 'dados_cpf'
  | 'dados_email'
  | 'informacoes_unidade'
  | 'atendente'
  | 'documento_quem'
  | 'documento_paciente'
  | 'documento_tipo'
  | 'documento_item'
  | 'documento_exigencia'
  | 'documento_farmacia'
export type MotivoAtencao =
  | 'atendente'
  | 'falha'
  | 'cancelou_sozinho'
  | 'urgencia'
  | 'anexo'
  | 'documento'
  | 'farmacia'
  | 'numero_errado'
  // Paciente falou em sangramento (Dr. Fabio, 15/10/2026): o alerta vai na
  // hora para o celular do medico e da secretaria. Ver falouDeSangramento.
  | 'sangramento'
  /** Insistiu no retorno fora da regra (26/10/2026): a equipe avalia. */
  | 'retorno'

/**
 * A etiqueta que fica na conversa quando o robo levanta outra (17 e 18/10/2026
 * no sistema do Dr. Marcello, trazido em 25/10/2026).
 *
 * Urgencia e sangramento nao descem por outra etiqueta: la, um pedido no meio
 * da conversa trocou a urgencia por "atendente" com a crianca ainda vomitando,
 * e a conversa desceu na lista da recepcao. Pendencia com a equipe tambem nao
 * desce para uma etiqueta so informativa (o pedido estava com a equipe, a
 * pessoa confirmou um cancelamento e a etiqueta virou "cancelou sozinho"; o
 * pedido sumiu da fila). Quem baixa e a equipe. Usada pelo webhook e pelo
 * simulador.
 */
export function etiquetaQueFica(
  antes: { needs_attention?: boolean | null; attention_reason?: string | null } | null | undefined,
  nova: string,
): string {
  if (!antes?.needs_attention || !antes.attention_reason) return nova
  const urgentes = ['urgencia', 'sangramento']
  if (urgentes.includes(antes.attention_reason) && !urgentes.includes(nova)) return antes.attention_reason
  const informativas = ['cancelou_sozinho', 'anexo']
  return informativas.includes(nova) && !informativas.includes(antes.attention_reason) ? antes.attention_reason : nova
}

/**
 * A telemedicina como "unidade" do fluxo.
 *
 * Ela nao tem agenda propria: usa os horarios das unidades fisicas, porque e o
 * mesmo medico no mesmo dia. Para o robo, porem, e uma opcao na mesma lista
 * de Santos e Sao Paulo - e tratar como unidade virtual deixa o fluxo inteiro
 * (unidade -> dia -> horario) igual, com um desvio so na hora de buscar os
 * horarios e outro na hora de gravar. O id nao e uuid de proposito: nunca vai
 * para a coluna booking_unit_id; a modalidade fica em booking_modality.
 */
const TELE_ID = 'telemedicina'
const UNIDADE_TELE = { id: TELE_ID, name: 'Telemedicina (por vídeo)', address: '' }
export type Modalidade = 'presencial' | 'telemedicina'

/**
 * Botao ou linha de lista tocavel no WhatsApp.
 *
 * O `id` e o que volta quando a pessoa toca, e ele e escrito de proposito com
 * exatamente o mesmo texto que o robo ja aceita digitado ("2", "CANCELAR",
 * "SIM"). Assim tocar e digitar entram pelo mesmo caminho, e quem prefere
 * escrever - ou usa um aparelho que nao mostra a lista - continua atendido.
 */
export type Toque = { id: string; titulo: string; descricao?: string }

export type Resultado = {
  resposta: string
  /** Preenchido quando a conversa precisa de alguem da equipe. */
  atencao?: MotivoAtencao
  /**
   * O robo terminou o atendimento e nao sobrou nada para a equipe fazer.
   *
   * Vale para o fim da ficha: o cadastro foi completado e, quando havia
   * agendamento, a consulta ficou marcada. Ate 20/09/2026 uma conversa dessas
   * nao ganhava marca nenhuma na lista - so o robo tinha falado, entao
   * "Respondida" (que e sobre gente da equipe) nao valia, e "Resolvida" so vem
   * de alguem clicar em Concluir. O cartao ficava com cara de pendente sem ter
   * pendencia, e a recepcao abria um por um para descobrir isso.
   *
   * Fechar aqui e seguro porque nao e definitivo: qualquer mensagem nova da
   * familia reabre a conversa, no mesmo lugar do webhook que ja trata a
   * mensagem recebida.
   */
  concluida?: boolean
  /** Ate tres botoes lado a lado. Acima disso, use lista. */
  botoes?: Toque[]
  /** Lista tocavel: o rotulo abre o menu, as linhas sao as opcoes (max. 10). */
  lista?: { rotulo: string; linhas: Toque[] }
} | null

/**
 * O que o robo fez, para virar numero depois.
 *
 * Existe desde 21/09/2026, quando a clinica perguntou o que as pessoas mais
 * pedem e nao havia como responder: o booking_state guarda so o estado de
 * agora e zera no fim da conversa. Ver a migration
 * 20260921120000_numeros_do_whatsapp.sql.
 *
 * NAO fica num campo do Resultado, e a razao e pratica: os eventos nascem
 * espalhados - o menu sai de mostrarMenu, o agendamento de marcar(), o "nao
 * entendi" de uma funcao chamada em dez lugares. Costurar isso em cada um dos
 * retornos de tratarConversa seria dezenas de pontos para esquecer um.
 *
 * Em vez disso a conversa em foco e anotada no comeco do atendimento, e quem
 * registra so diz o que aconteceu. O webhook esvazia com colherEventos()
 * depois de responder.
 *
 * ISSO SUPOE UMA CONVERSA DE CADA VEZ, que e como o webhook trata hoje: o laco
 * das mensagens e sequencial, com await em cada uma. Se um dia alguem paralelizar
 * aquele laco, os eventos passam a cair na conversa errada - e ai isto precisa
 * virar parametro. O pior caso e numero trocado, nunca atendimento quebrado.
 */
export type EventoDoRobo = { evento: string; detalhe?: string }

const TETO_DE_CONVERSAS_EM_CURSO = 200
const eventosEmCurso = new Map<string, EventoDoRobo[]>()
let conversaEmFoco: string | null = null

function focar(conversationId: string) {
  conversaEmFoco = conversationId
}

// O relogio da mensagem em tratamento. Em producao e a hora de agora; no
// simulador e nos testes, a hora que eles fixaram - sem isto, a janela de
// jaMandada comparava a hora fixa da conversa com a hora real da maquina e
// nunca achava nada (14/10/2026).
let relogioEmFoco: Date | null = null
// O mesmo vale para o aviso de horario ("fora do expediente, alguem responde
// amanha"): no painel de familias simuladas ele saia pela hora da maquina, e
// uma quarta as 14h virava "fora do horario" (14/10/2026). Em producao as
// duas horas sao a mesma.

// A crianca do telefone, quando ha uma so (15/10/2026). O menu cita o nome
// dela ("Estamos aqui para cuidar de Helena"). Presa a conversa: o menu tambem
// e chamado por fora (whatsapp-reply), e ali vale o texto generico.
let criancaEmFoco: { conversa: string; nome: string } | null = null
// A mensagem em tratamento, presa a conversa como a de cima: e por ela (e
// pelas ultimas gravadas) que o agendamento sabe que o pedido e de retorno
// (26/10/2026).
let textoEmFoco: { conversa: string; texto: string } | null = null

// O perfil da clinica da conversa em tratamento (15/10/2026, ver
// quem-atende.ts). Preso ao foco como o relogio e a crianca: o menu, a ficha e
// a urgencia montam frases sem receber o clinicId, e passar o id por todas
// elas mudaria a assinatura de dezenas de chamadas. Quem chama o robo por
// fora sem passar por tratarConversa (o menu, pelo webhook) fica com o perfil
// padrao, que neste sistema e o do Dr. Fabio.
let perfilEmFoco: QuemAtende | null = null

function perfil(): QuemAtende {
  return perfilEmFoco ?? quemAtende(null)
}

/** O robo fala com o proprio paciente, adulto ou crianca (ver QuemAtende.publico). */
function geral(): boolean {
  return perfil().publico === 'geral'
}

/** O icone do paciente nas mensagens: o bebe da pediatria, ou uma pessoa. */
function iconeDoPaciente(): string {
  return geral() ? '👤' : '👶'
}

/** A orientacao de pronto-socorro do perfil, ou a de sempre. */
function prontoSocorro(): string {
  return perfil().prontoSocorro ?? 'Se for uma emergência com risco de vida, procure o pronto-socorro mais próximo ou ligue 192.'
}

/*
 * O 192 nao vai na mensagem padrao da urgencia do perfil 'geral' (16/10/2026,
 * decisao do Edu depois da rodada 3 do painel): ali ele soava como se o
 * medico nao quisesse resolver o problema. Fica so para quem diz que nao tem
 * como ir, ou pede ambulancia: ai e a resposta ao que a pessoa perguntou (ver
 * complementoDaUrgencia).
 */

/**
 * A saudacao para quem ja e paciente, dita a quem escreve (15/10/2026).
 *
 * O texto da clinica comeca com "Ola, {nome}!", e {nome} e o paciente - a
 * crianca. Quem escreve e quase sempre a mae: o robo cumprimentava a Helena
 * como se fosse ela digitando. O vocativo vira so "Ola!"; o nome continua onde
 * fala DA crianca, e o menu logo abaixo cita o nome dela.
 */
export function saudacaoParaQuemEscreve(texto: string, primeiroNome: string): string {
  return texto
    .replace(/^(\s*)(ol[aá]|oi|bom dia|boa tarde|boa noite)\s*,?\s*\{nome\}\s*[!.,]?/i, '$1$2!')
    .replace(/\{nome\}/g, primeiroNome)
}

function registrar(evento: string, detalhe?: string) {
  if (!conversaEmFoco) return
  // Sem esvaziar, um caminho novo que esqueca de colher deixaria a memoria da
  // funcao crescendo a cada mensagem. Perder contagem e aceitavel; vazar nao.
  if (eventosEmCurso.size > TETO_DE_CONVERSAS_EM_CURSO) eventosEmCurso.clear()
  const lista = eventosEmCurso.get(conversaEmFoco)
  if (lista) lista.push({ evento, detalhe })
  else eventosEmCurso.set(conversaEmFoco, [{ evento, detalhe }])
}

/** Tira da memoria o que o robo registrou nesta conversa. */
export function colherEventos(conversationId: string): EventoDoRobo[] {
  const lista = eventosEmCurso.get(conversationId) ?? []
  eventosEmCurso.delete(conversationId)
  return lista
}

type Unidade = {
  id: string
  name: string
  address: string
  info_text?: string | null
  /** Convenio aceito nesta unidade. Vazio = so particular, e o robo nao pergunta. */
  accepts_insurance?: string | null
}
type Paciente = {
  id: string
  name: string
  /** O que o cadastro ja tem. Vazio = falta, e o robo pergunta. */
  nascimento?: string | null
  responsavel?: string | null
  cpf?: string | null
  email?: string | null
}
/** `unitId` so vem na telemedicina: diz de qual unidade fisica saiu o horario. */
type Horario = { inicio: string; fim: string; unitId?: string }

/** Consulta futura ja marcada para este telefone. */
export type ConsultaMarcada = {
  id: string
  inicio: string
  unidade: string
  endereco: string
  paciente: string
  confirmada: boolean
}

function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

/**
 * "Quero remarcar", "preciso desmarcar a consulta de quinta", "tem como mudar
 * a data?" (07/10/2026).
 *
 * pediuAgendamento recusa essas frases de proposito (quem remarca ja tem
 * consulta), mas nada as levava a lugar nenhum: caiam no menu, e a familia
 * tinha de adivinhar que "Ver, remarcar ou cancelar" era a opcao 4. Agora vao
 * direto para a consulta dela, quando ha uma.
 *
 * "Nao quero cancelar" e "nao precisa remarcar" nao contam. A palavra
 * "cancelar" sozinha tambem nao: em qualquer etapa ela e "desisti daqui", e
 * quem usa assim nao quer ver a consulta.
 */
export function pediuMudarConsulta(texto: string) {
  const t = normalizar(texto)
  if (t === 'cancelar') return false
  // "Nao vou precisar mais ir na consulta", "nao vou poder ir" (16/10/2026,
  // painel): quem nao vai e quem precisa desmarcar, e recebia o menu geral.
  if (naoVaiPoderIr(texto)) return true
  const pedido = /\b(remarc|desmarc|cancel)\w*/.test(t) || /\b(mudar|trocar|alterar)\s+(a\s+|o\s+|de\s+)?(data|dia|horario)\b/.test(t)
  if (!pedido) return false
  return !/\bnao\b(\s+\w+){0,2}\s+(remarc|desmarc|cancel|mudar|trocar|alterar)/.test(t)
}

/**
 * "Nao!! eu queria 16h nao 14h", "o horario ta errado" (16/10/2026, painel):
 * no meio da ficha, e pedido de outro horario, e nao resposta da pergunta.
 */
function pediuOutroHorario(texto: string): boolean {
  const t = normalizar(texto)
  if (intencaoDaConsulta(texto) === 'remarcar') return true
  if (/\b(horario|dia|data)\s+(esta\s+|ta\s+)?errad[oa]\b/.test(t)) return true
  // So a hora, na pergunta do motivo (rodada 2 do painel): "16:40", logo
  // depois de o robo marcar 16:00 para quem pediu "depois das 16h", foi gravado
  // como a queixa da consulta.
  if (/^(as\s+)?\d{1,2}\s*(:\s*\d{2}|h\s*\d{0,2})(\s+(entao|mesmo|ok|pode ser|por favor|pfv|blz|beleza|isso|da manha|da tarde))*\s*[.!]*$/.test(t.trim())) return true
  const corrige = /\b(queria|quero|era|prefiro|pedi|falei|nao)\b/.test(t)
  // "Nao, sexta da semana q vem, dia 23" (rodada 3 do painel): a data tambem,
  // e nao so a hora. Foi lida como nome: "Nao consegui ler o nome".
  if (corrige && (dataEscrita(texto) !== null || /\bdia\s+\d{1,2}\b|\b(semana (que|q) vem|proxima semana)\b/.test(t))) return true
  return horaEscrita(texto) !== null && corrige
}

/**
 * "Depois das 16h", "antes das 10", "a partir das 14h", "ate as 9h"
 * (16/10/2026, rodada 2 do painel): limite, e nao a hora. "Seg dia 26 depois
 * das 16h" foi marcado as 16:00 - antes do que a mae pediu.
 */
function limiteDaHora(texto: string): 'depois' | 'a_partir' | 'antes' | 'ate' | null {
  const t = normalizar(texto)
  const hora = String.raw`(\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|meio)`
  if (new RegExp(String.raw`\b(depois|apos|passado)\s+(d[aeo]s?\s+|as\s+)?${hora}`).test(t)) return 'depois'
  if (new RegExp(String.raw`\ba partir\s+(d[aeo]s?\s+)?${hora}`).test(t)) return 'a_partir'
  if (new RegExp(String.raw`\bantes\s+(d[aeo]s?\s+|as\s+)?${hora}`).test(t)) return 'antes'
  if (new RegExp(String.raw`\bate\s+(as\s+|a\s+)?${hora}`).test(t)) return 'ate'
  return null
}

/** Os horarios dentro do limite pedido (ver limiteDaHora). */
function dentroDoLimite(
  horarios: Horario[],
  pedida: { hora: number; minuto: number | null },
  limite: 'depois' | 'a_partir' | 'antes' | 'ate',
  timezone: string,
): Horario[] {
  const marco = pedida.hora * 60 + (pedida.minuto ?? 0)
  return horarios.filter((h) => {
    const [hh, mm] = formatarHora(h.inicio, timezone).split(':').map(Number)
    const m = hh * 60 + mm
    return limite === 'depois' ? m > marco : limite === 'a_partir' ? m >= marco : limite === 'antes' ? m < marco : m <= marco
  })
}

/** "Depois das 16h, neste dia, ha: 16:40 e 17:20." */
function textoDoLimite(
  horarios: Horario[],
  pedida: { hora: number; minuto: number | null },
  limite: 'depois' | 'a_partir' | 'antes' | 'ate',
  timezone: string,
): string {
  const nome = { depois: 'Depois das', a_partir: 'A partir das', antes: 'Antes das', ate: 'Até as' }[limite]
  const servem = dentroDoLimite(horarios, pedida, limite, timezone).map((h) => formatarHora(h.inicio, timezone))
  return servem.length
    ? `${nome} ${horaFalada(pedida)}, neste dia, há: ${emLista(servem)}. Responda com o horário ou com o número da lista.`
    : `${nome} ${horaFalada(pedida)} não há horário livre neste dia. Escolha outro da lista, ou digite VOLTAR para ver outros dias.`
}

/** "Nao vou poder ir", "nao vou precisar mais ir na consulta" (16/10/2026). */
function naoVaiPoderIr(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')
  return (
    /\bnao (vou|vai|vamos|irei|iremos) (mais )?(poder|conseguir|precisar)( mais)? (ir|comparecer|levar)\b/.test(t) ||
    /\bnao (vou|vai|vamos) (mais )?(na|a|para a|pra) consulta\b/.test(t) ||
    /\bnao (preciso|precisa|precisamos) mais (da|de|ir na) consulta\b/.test(t)
  )
}

/**
 * O que a pessoa quer da consulta marcada, quando a frase diz (16/10/2026,
 * painel): "preciso remarcar minha consulta" recebia a consulta com os botoes
 * Remarcar e Cancelar, como se o robo nao tivesse lido. Null quando nao da
 * para saber: ai a consulta aparece com os botoes.
 */
function intencaoDaConsulta(texto: string): 'remarcar' | 'cancelar' | null {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')
  if (/\b(remarc\w*|trocar|troca|mudar|muda|alterar|outra data|outro dia|outro horario)\b/.test(t) && !/\bnao (quero |precisa )?(remarc|trocar|mudar)/.test(t)) return 'remarcar'
  if ((/\b(cancel\w*|desmarc\w*)\b/.test(t) && !/\bnao (quero |precisa |vou )?(cancel|desmarc)/.test(t)) || naoVaiPoderIr(texto)) return 'cancelar'
  return null
}

/**
 * Resposta automatica do WhatsApp Business da PROPRIA familia (09/10/2026).
 *
 * "No momento, estou fora do meu horario de atendimento. Retorno sua mensagem
 * assim que possivel" chegou em resposta a secretaria, e o robo leu "retorno"
 * como pedido de marcar e ofereceu o botao de agenda - um robo respondendo ao
 * outro, por cima da equipe. "Fulana agradece seu contato. Como podemos
 * ajudar?" e o mesmo caso. Primeira pessoa de proposito: a mae que pergunta
 * "voces estao fora do horario?" nao pode ser calada.
 *
 * 10/10/2026: a imobiliaria da Renata respondeu ao acompanhamento no mesmo
 * segundo - "Seja muito bem-vindo(a)... Agradeco imensamente o seu contato.
 * Em breve eu ou um membro da nossa equipe entraremos em contato". Nada
 * daquilo casava (era "agradeco", nao "agradece"), e o robo leu como recado
 * sobre a crianca: "o Dr. Marcello fica sabendo", e a equipe chamada.
 */
export function respostaAutomaticaDaFamilia(texto: string) {
  const t = normalizar(texto)
  return (
    /\bagradece (o |seu |o seu |pelo |pela sua )?(contato|mensagem)\b/.test(t) ||
    /\bagradec(o|emos) (imensamente |muito |sinceramente )?(o |seu |o seu |pelo |pela |pela sua )?(contato|mensagem)\b/.test(t) ||
    /\bseja (muito )?bem[- ]?vind[oa]/.test(t) ||
    /\bentraremos em contato\b/.test(t) ||
    /\b(retornaremos|responderemos) (o contato |sua mensagem |a sua mensagem )?(em breve|assim que|o mais breve)/.test(t) ||
    /\b(estou|estamos) fora do (meu |nosso )?horario de atendimento\b/.test(t) ||
    /\b(mensagem|resposta) automatica\b/.test(t) ||
    /\bretorno (sua mensagem|seu contato|o contato|a mensagem) (assim que|em breve|o mais breve)/.test(t) ||
    /\bresponderei (assim que|em breve|o mais breve)/.test(t)
  )
}

/**
 * Aviso do dia da consulta: atraso ou chegada (09/10/2026).
 *
 * "Pode ser que o Otavio atrase uns 15 min, pegaram fila na balsa" recebeu o
 * menu inteiro e depois "nao consegui entender"; "Sou a mae do Otavio, estamos
 * aqui na recepcao", o mesmo. E recado para a equipe, que avisa o medico -
 * nao inicio de conversa. So formas de verbo em "atraso": o substantivo solto
 * aparece em "atraso de fala", que e outra conversa.
 */
export function avisoDoDiaDaConsulta(texto: string): 'atraso' | 'chegada' | null {
  const t = normalizar(texto)
  if (
    /\batras(e|em|ar|ada|ado|adas|ados|amos|aremos|ando|aria|ariamos|ei|ou)\b/.test(t) ||
    /\b(vou|vamos) chegar\b.{0,25}\b(tarde|atrasad)/.test(t) ||
    /\b(a caminho|no transito|fila (na|da) balsa|estamos chegando|estou chegando|(chego|chegamos|chegaremos) (em|daqui a) \d+)\b/.test(t)
  ) return 'atraso'
  if (
    /\b(cheguei|chegamos|ja estou aqui|ja estamos aqui)\b/.test(t) ||
    /\b(estou|estamos) (aqui )?(na recepcao|no consultorio|na sala de espera|na portaria)\b/.test(t)
  ) return 'chegada'
  return null
}

/** Frases que abrem o agendamento sem passar pelo menu. */
export function pediuAgendamento(texto: string) {
  const t = normalizar(texto)

  // Remarcar e desmarcar contem "marcar" e sao o oposto: quem pede isso ja tem
  // consulta, e precisa do caminho de remarcacao, nao de uma consulta nova.
  if (/\b(remarc|desmarc|cancel)/.test(t)) return false
  // "Consulta", sozinha (rodada 3 do painel), recebeu duas vezes o mesmo
  // "Nao entendi" com o menu inteiro.
  if (/^(uma |a )?(consulta|consultas)( por favor| pfv| pf)?[.!?\s]*$/.test(t.trim())) return true

  // Palavra solta e nao frase inteira.
  //
  // Ate 15/09/2026 a lista era de frases exatas: valia "quero marcar", nao
  // valia "quero marcar retorno para o Matheus", nem "queria marcar uma
  // consulta", nem "gostaria de agendar para meu filho". Ninguem escreve no
  // WhatsApp do jeito que o programador previu, e cada frase de fora caia no
  // menu ou, pior, numa resposta pronta que nao tinha nada a ver - foi o que
  // aconteceu com a Regina, que pediu para marcar retorno e recebeu a lista de
  // documentos para levar.
  //
  // "Qual o horario de atendimento? Atende a noite?" (16/10/2026, painel) e
  // pergunta sobre o consultorio: abria a escolha de unidade, sem resposta. A
  // resposta pronta de dias e horarios responde, e oferece o 2.
  const horarioDoConsultorio =
    /\bhorarios? de (atendimento|funcionamento)\b|\b(que horas|ate que horas|quando) (abre|fecha|funciona|atende)\b|\b(abre|fecha) (que|as)\b|\batende(m)? (a|de) noite\b|\batende(m)? (aos |no |nos )?(sabados?|domingos?|feriados?)\b/.test(t)
  if (horarioDoConsultorio && !/\b(marcar|marcacao|agendar|agendamento)\b/.test(t)) return false

  // "Preciso dessa garantia antes de marcar qualquer coisa", "nao quero marcar
  // agora, so queria saber ate que horas o doutor atende" e "qual o ultimo
  // horario do dia?" (16/10/2026, rodada 2 do painel): pergunta, e nao pedido.
  // Abriam a agenda, e a pergunta ficava sem resposta. "Nao da pra marcar pra
  // amanha?" continua sendo pedido.
  if (/\b(antes de|sem|nao (quero|vou|preciso|precisa)( mais)?( agora)?)\s+(marcar|agendar)\b/.test(t)) return false
  if (/\b(ultimo|ultima) (horario|consulta|vaga)\b|\bultimo da (tarde|manha)\b|\bate que horas?\b/.test(t) && !/\b(quero|gostaria|preciso|marcar|agendar|marca|marque|agende|agenda)\b/.test(t)) {
    return false
  }

  // "consulta" sozinha fica de fora de proposito: "quanto custa a consulta?" e
  // pergunta de preco, e abriria a escolha de unidade sem ninguem pedir.
  if (/\b(marcar|marcacao|agendar|agendamento|horarios?)\b/.test(t)) return true

  // "Queria consulta semana q vem pela unimed santos" (16/10/2026, painel): o
  // pedido sem o verbo marcar recebia so a resposta de convenios. Querer, precisar
  // ou gostaria de uma consulta e pedido; "quanto custa a consulta" continua
  // sendo pergunta de preco, porque nao tem nenhum desses.
  if (/\b(quero|queria|qria|qro|gostaria( de)?|preciso( de)?|precisava( de)?|procuro|quer)\s+(uma\s+|de\s+uma\s+|um\s+)?(consulta|horario|atendimento|encaixe)\b/.test(t)) return true

  // Verbo conjugado (25/09/2026): "Marca consulta pra minha filha de dois
  // anos" nao tinha "marcar" e ficou so com a resposta de valores. Remarcar e
  // desmarcar ja sairam no primeiro teste desta funcao.
  // "marco" fica de fora ("nasceu em marco", sem cedilha), e "marca de" e
  // "marca da" tambem ("qual marca de formula?").
  if (/\b(marque|marcamos|agende|agendo|agenda|agendamos)\b/.test(t)) return true
  if (/\bmarca\b(?!\s+d[aeo]s?\b)/.test(t)) return true
  // "Mesmo assim ja quero deixar marcado: Higienopolis, terca a tarde" e
  // "quero a de terca as 8h em Higienopolis" (25/10/2026, rodada 5 do painel):
  // a escolha do dia e da hora e pedido, e recebeu a lista de enderecos.
  if (/\b(deixar|deixa|deixo|ja) marcad[oa]\b/.test(t)) return true
  if (
    /\b(quero|queria|prefiro|pode ser|fico com|vou querer)\b/.test(t) &&
    /\b(segunda|terca|quarta|quinta|sexta)\b/.test(t) &&
    /\b\d{1,2} ?h\b|\bas \d{1,2}\b|\b(manha|tarde)\b/.test(t)
  ) {
    return true
  }

  // Pedido de vaga sem o verbo (24/09/2026): "Consigo para amanha com o dr
  // Marcelo" recebeu "Nao entendi". Vaga e dia pedidos juntos sao agendamento.
  // "Consigo pedir reembolso da consulta?" (16/10/2026, painel) e pergunta de
  // pagamento, e abria a agenda.
  return (
    /\b(tem|teria|ha|existe)\s+(uma\s+)?vagas?\b/.test(t) ||
    (/\bconsigo\b.*\b(amanha|hoje|semana|segunda|terca|quarta|quinta|sexta|sabado|dia|consulta)\b/.test(t) &&
      !/\b(reembolso|recibo|nota|pagar|pagamento|parcelar|desconto|valor|carteirinha|guia)\b/.test(t))
  )
}

/**
 * Pedido de marcar com o verbo: "quero marcar", "pode agendar", "queria uma
 * consulta". Mais estreito que pediuAgendamento (16/10/2026, rodada 2 do
 * painel): "tem horario dps das 19h? so posso a noite" e pergunta da agenda, e
 * a resposta e que nao ha horario a noite, e nao so a lista de unidades.
 */
function pediuParaMarcar(texto: string): boolean {
  return pediuAgendamento(texto) && /\b(marcar|marca|marque|agendar|agenda|agende|quero|queria|gostaria|preciso|precisava)\b/.test(normalizar(texto))
}

/**
 * A frase tem cara de pergunta: ponto de interrogacao, ou uma palavra de
 * pergunta. Serve para a fila da equipe nao responder recado ("Aguardo
 * retorno") como se fosse duvida.
 */
export function parecePergunta(texto: string): boolean {
  if (texto.includes('?')) return true
  const t = normalizar(texto)
  // "Qto", "qnto", "qdo" (rodada 3 do painel) tambem.
  return /\b(qual|quais|quanto|quanta|quantos|qto|qnto|qnt|como|onde|quando|qdo|qnd|aceita|aceitam|atende|atendem|tem|teria|pode|posso|faz|fazem|precisa|preciso de|e particular)\b/.test(t)
}

/**
 * So agradecimento ou "ok" - nao e pedido, e nao merece "Nao entendi" nem
 * fila da equipe. Toda palavra da frase precisa ser de cortesia.
 */
export function soAgradecimento(texto: string): boolean {
  // "Obrigada, e o retorno?" e pergunta (rodada 3): com "retorno" e "o" na
  // lista da cortesia, a pergunta passaria por agradecimento.
  if (texto.includes('?')) return false
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').trim()
  if (!t) return /^(?:\s|👍|🙏|😊|🙂|❤️|💙|👏|✅|!|\.)+$/u.test(texto.trim())
  const cortesia = new Set([
    'ok', 'okay', 'okk', 'blz', 'beleza', 'obrigado', 'obrigada', 'obg', 'brigado', 'brigada', 'valeu',
    'grato', 'grata', 'certo', 'combinado', 'perfeito', 'entendi', 'ta', 'bom', 'otimo', 'muito',
    'pela', 'atencao', 'sim', 'tudo', 'bem', 'ate', 'mais', 'amanha', 'boa', 'noite', 'tarde', 'dia',
    'deus', 'abencoe', 'e', 'o', 'a', 'de', 'nada', 'show', 'maravilha', 'agradeco', 'mt', 'mto', 'td',
    // A despedida inteira (16/10/2026, rodada 2 do painel): "Muito obrigado,
    // tenham um otimo dia!" recebeu "Nao consegui entender" e foi para a fila.
    'tenha', 'tenham', 'um', 'uma', 'otima', 'excelente', 'semana', 'fim', 'final', 'abraco', 'abracos',
    'beijo', 'beijos', 'gentileza', 'ajuda', 'paciencia', 'voces', 'vcs', 'vc', 'voce', 'equipe', 'pelo',
    'feliz', 'fiquem', 'fique', 'com', 'saude', 'certinho', 'resolvido', 'ajudou', 'demais', 'pra', 'para',
    // "Ok, obrigada, fico no aguardo do contato" (rodada 2): recado de espera.
    'fico', 'no', 'aguardo', 'aguardando', 'entao', 'esperando', 'espero', 'contato', 'retorno', 'resposta',
    'noticias', 'seu', 'sua', 'vosso', 'vossa', 'do', 'da',
    // "puts, ok vlw", "Eu que agradeco. Tenha um otimo dia!" e "Ah, entao eu
    // me enganei mesmo. Desculpa, obrigada!" (25/10/2026, rodada 5 do painel)
    // receberam "Nao consegui entender" e acenderam a conversa para a equipe.
    'puts', 'vlw', 'vlww', 'falou', 'flw', 'tmj', 'eu', 'que', 'ah', 'ahh', 'desculpa', 'desculpe', 'me',
    'enganei', 'confundi', 'engano', 'mesmo', 'msm', 'foi', 'nos', 'agradecemos',
  ])
  const palavras = t.split(/\s+/)
  // Precisa de UM agradecimento ou "ok" de verdade (25/09/2026): so com a
  // lista de cortesia, "Bom dia" (duas palavras dela) virava "Por nada!".
  const agradece = palavras.some((palavra) => AGRADECIMENTO.has(palavra))
  return agradece && palavras.every((palavra) => cortesia.has(palavra))
}

const AGRADECIMENTO = new Set([
  'ok', 'okay', 'okk', 'blz', 'beleza', 'obrigado', 'obrigada', 'obg', 'brigado', 'brigada', 'valeu',
  'grato', 'grata', 'certo', 'combinado', 'perfeito', 'entendi', 'otimo', 'show', 'maravilha', 'agradeco',
  'vlw', 'vlww', 'agradecemos',
])

/**
 * So cumprimento: "Bom dia", "Oi, tudo bem?". Com o menu ja na tela, a
 * resposta certa e cumprimentar de volta com o menu - nem "Nao entendi", nem
 * "Por nada".
 */
export function soCumprimento(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').trim()
  if (!t) return false
  const cumprimento = new Set([
    'oi', 'oie', 'ola', 'opa', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'como', 'vai',
    'e', 'ai', 'vc', 'voce', 'voces', 'td', 'pessoal', 'doutor', 'dr', 'ate', 'amanha', 'mais', 'logo',
  ])
  return t.split(/\s+/).every((palavra) => cumprimento.has(palavra))
}

/**
 * A pessoa diz que a consulta nao aconteceu (23/10/2026 no sistema do Dr.
 * Marcello, trazido em 25/10/2026). La, o acompanhamento de 30 dias perguntou
 * como a crianca estava "depois da consulta do dia 23/09", e a mae respondeu
 * "Eu nao passei em consulta". A palavra "consulta" fez a frase parecer pedido
 * de marcar, e ela recebeu horarios e preco em vez de um pedido de desculpas.
 * Quem diz isso precisa da equipe: o cadastro esta errado. Pedido de marcar
 * ("nao consegui marcar consulta") nao entra. Os nomes do medico vem do perfil
 * da clinica (la, "marcello"; aqui, "fabio", "dario", "pavani").
 */
export function negouConsulta(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/\b(marcar|agendar|remarcar)\b/.test(t) && !/\b(nao|nunca) (passei|passamos|fui|fomos|tive|tivemos|compareci|comparecemos)\b/.test(t)) return false
  const medico = ['consulta', 'medico', 'doutor', 'dr', 'ai', 'la', 'clinica', 'consultorio', ...perfil().nomesDoMedico].join('|')
  return (
    new RegExp(
      `\\b(nao|nunca|nem) (cheguei a |chegamos a |chegou a )?(passei|passamos|passou|fui|fomos|foi|tive|tivemos|teve|fiz|fizemos|levei|levamos|compareci|comparecemos|consultei|consultamos|consultou)\\b.{0,30}\\b(${medico})\\b`,
    ).test(t) ||
    /\b(nao|nunca) (consultei|consultamos|consultou|compareci|comparecemos)\b/.test(t) ||
    /\b(nao|nunca) (houve|teve|existiu) (essa |esta |nenhuma )?consulta\b/.test(t) ||
    /\b(faltei|faltamos|nao deu para ir|nao deu pra ir|nao conseguimos ir|nao consegui ir)\b/.test(t)
  )
}

/**
 * "Alo", "alguem ai?", "??" (16/10/2026, painel de pacientes simulados): quem
 * quer saber se tem alguem do outro lado. Recebia "Nao entendi. Responda com o
 * numero da opcao" e o menu inteiro, duas vezes seguidas. "Oi?" sozinho
 * continua sendo cumprimento (ver soCumprimento).
 */
export function chamandoAlguem(texto: string): boolean {
  if (/^\s*\?+\s*$/.test(texto)) return true
  const f = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  // "Ei", "opa", "psiu" (rodada 3 do painel) tambem chamam alguem.
  return /^((oi|ola|bom dia|boa tarde|boa noite) )?(e+i+|opa|psiu|alo( alo)*|alguem( ai)?( online)?|tem alguem( ai)?( online)?( ai)?( ainda)?|alguem (pode )?me (ajuda|ajudar|responde|atende)|tem alguem pra (me )?(ajudar|atender|responder))$/.test(f)
}

/**
 * Outro medico citado pelo nome (16/10/2026, painel de pacientes simulados).
 *
 * "E do consultorio do Dr. Marcelo? Quero remarcar com ele." recebeu a
 * saudacao do Dr. Fabio e o menu, sem ninguem dizer que ali e outro
 * consultorio; "preciso remarca minha consulta c dr marcelo", o mesmo. Devolve
 * o nome como titulo ("Dr. Marcelo", "Dra. Ana"), ou null. So com quem atende
 * ou com quem e a consulta ("consultorio do", "com o", "e o"): "o dr Joao me
 * encaminhou para o Dr. Fabio" nao conta.
 */
const NAO_E_NOME = new Set([
  'ele', 'ela', 'pode', 'que', 'me', 'ja', 'esta', 'ta', 'vai', 'atende', 'pediu', 'falou', 'disse', 'mandou',
  'consegue', 'tem', 'faz', 'responde', 'nao', 'sim', 'aqui', 'ai', 'hoje', 'amanha', 'otorrino', 'medico',
  'medica', 'queria', 'quero', 'gostaria', 'preciso', 'precisava', 'mas', 'porque', 'pois', 'para', 'pra',
  'por', 'sobre', 'agora', 'ainda', 'tambem', 'entao', 'mesmo', 'consulta', 'marcar', 'saber', 'falar',
  'passar', 'ver', 'tudo', 'bem', 'boa', 'bom', 'obrigada', 'obrigado', 'sera', 'seria', 'poderia', 'teria',
  'ou', 'e', 'de', 'do', 'da', 'em', 'no', 'na', 'se', 'so', 'meu', 'minha', 'dele', 'dela', 'mais', 'menos',
  'tenho', 'estou', 'to', 'sou', 'fiz', 'ja', 'acho', 'sei', 'quer', 'queremos', 'consigo', 'gosto', 'precisa',
  // "queria passar com o dr pela unimed santos" virou "O Dr. Pela nao atende
  // aqui" (rodada 2 do painel): preposicao, artigo, plano e cidade nao sao nome.
  'pela', 'pelo', 'pelas', 'pelos', 'num', 'numa', 'nesse', 'nessa', 'neste', 'nesta', 'esse', 'essa', 'este',
  'isso', 'aquele', 'aquela', 'ate', 'apos', 'depois', 'antes', 'logo', 'semana', 'mes', 'ano', 'dia', 'unimed',
  'porto', 'santa', 'santos', 'sao', 'paulo', 'convenio', 'plano', 'particular', 'especialista', 'otorrinolaringologista',
  'sobre', 'tambem', 'tbm', 'tb', 'ainda', 'sempre', 'nunca', 'quando', 'onde', 'como', 'qual', 'quem', 'porque',
  'pois', 'entao', 'tipo', 'novo', 'nova', 'mesmo', 'mesma', 'aqui', 'la', 'ali', 'atendeu', 'atendia', 'marcou',
])

export function outroMedico(texto: string): string | null {
  const nomesDoMedico = perfil().nomesDoMedico
  if (nomesDoMedico.length === 0) return null
  // Frase por frase: "queria marcar com o doutor. tenho zumbido" nao tem medico
  // chamado Tenho. O ponto do "Dr." nao separa frase.
  const frases = normalizar(texto)
    .replace(/\b(dr|dra|drs)\.\s*/g, '$1 ')
    .split(/[.!?;,\n]+/)
    .map((f) => f.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const padroes = [
    /\b(consultorio|clinica) d[oa] (dr|dra|doutor|doutora) ([a-z]+)\b/,
    /\b(com|c|pro|pra|para o|para a) (o |a )?(dr|dra|doutor|doutora) ([a-z]+)\b/,
    /^(e|eh|aqui e|ai e) (o |a )?(dr|dra|doutor|doutora) ([a-z]+)\b/,
  ]
  for (const padrao of padroes) {
    const m = frases.map((f) => f.match(padrao)).find(Boolean)
    if (!m) continue
    const nome = m[m.length - 1]
    const titulo = m[m.length - 2]
    if (nome.length < 3 || nomesDoMedico.includes(nome) || NAO_E_NOME.has(nome)) continue
    // Verbo logo depois do "dr" ("pode passar com o dr? queria marcar",
    // "o dr falou", "com o dr marcar"): nao e nome.
    if (/(ou|eu|iu|ndo|ram|rem|riam|ar|er|ir)$/.test(nome) && nome !== 'cesar') continue
    return `${/^d(ra|outora)$/.test(titulo) ? 'Dra.' : 'Dr.'} ${nome.charAt(0).toUpperCase()}${nome.slice(1)}`
  }
  return null
}

/**
 * Mensagem em ingles (16/10/2026, rodada 2 do painel). Uma palavra forte basta
 * em mensagem curta ("appointment", "English?"); em frase, as palavras de
 * ingles precisam ser maioria clara sobre as de portugues: "consulta do dr"
 * nao vira ingles pelo "do".
 */
const INGLES = new Set([
  'hello', 'hi', 'hey', 'please', 'appointment', 'appointments', 'schedule', 'booking', 'book', 'doctor', 'english',
  'speak', 'available', 'insurance', 'price', 'cost', 'how', 'much', 'can', 'could', 'would', 'like', 'need', 'want',
  'the', 'is', 'are', 'you', 'your', 'i', 'my', 'an', 'for', 'with', 'there', 'anyone', 'someone', 'office', 'thanks',
  'thank', 'sorry', 'help', 'when', 'where', 'what', 'ear', 'throat', 'nose', 'morning', 'afternoon', 'tomorrow', 'today',
])
const PORTUGUES = new Set([
  'o', 'a', 'os', 'as', 'de', 'do', 'da', 'que', 'e', 'eu', 'voce', 'vc', 'para', 'pra', 'com', 'uma', 'um', 'nao', 'sim',
  'quero', 'queria', 'tem', 'bom', 'boa', 'dia', 'tarde', 'noite', 'oi', 'ola', 'obrigado', 'obrigada', 'consulta',
  'marcar', 'por', 'favor', 'mais', 'como', 'qual', 'quanto', 'onde', 'quando', 'meu', 'minha', 'ele', 'ela', 'esta', 'ta',
])
const INGLES_FORTE = ['appointment', 'english', 'hello', 'doctor', 'please', 'schedule', 'booking', 'speak']

export function escreveuEmIngles(texto: string): boolean {
  const palavras = normalizar(texto).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return false
  if (palavras.length <= 3 && palavras.some((p) => INGLES_FORTE.includes(p))) return true
  const ingles = palavras.filter((p) => INGLES.has(p)).length
  const portugues = palavras.filter((p) => PORTUGUES.has(p)).length
  return ingles >= 3 && ingles > portugues * 2
}

/** O que o robo mandou nesta conversa na ultima meia hora, do mais novo ao mais velho. */
async function mensagensRecentesDoRobo(admin: Admin, conversationId: string): Promise<string[]> {
  try {
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select('body')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .eq('automatic', true)
      .gte('created_at', new Date((relogioEmFoco ?? new Date()).getTime() - JANELA_SEM_REPETIR_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) throw error
    return ((data ?? []) as { body?: string | null }[]).map((m) => String(m.body ?? ''))
  } catch (erro) {
    console.warn('Nao consegui ler as mensagens recentes do robo', erro)
    return []
  }
}

/**
 * "Obrigada, mas nao respondeu", "nao tem nada sobre estacionamento ai em
 * cima" (16/10/2026, painel de pacientes simulados): a resposta pronta nao
 * serviu, e mais uma resposta pronta seria pior. Vai para a equipe.
 */
export function naoFoiRespondida(texto: string): boolean {
  const f = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return /\b(nao (me )?(respondeu|responderam)|nao era isso|nao e isso que|nao foi isso|nao (foi|e) o que (eu )?perguntei|nao perguntei isso|nao perguntei (de|do|da|sobre)|nao tem nada (sobre|de|disso)|nao (fala|falou|diz|disse) (nada )?(sobre|de)|(voce|vc) nao entendeu|nao entendeu (a |minha )?pergunta|nao ajudou|nao resolveu|nao serviu)\b/.test(f)
}

/**
 * "Nao sou o Rogerio", "numero errado", "foi engano" (06/10/2026).
 *
 * O telefone da ficha e de outra pessoa. Ela respondeu "Nao sou o Rogerio" a
 * dois lembretes, e nas duas o robo ficou calado - quem recebe mensagem por
 * engano merece um pedido de desculpas na hora, e a equipe precisa saber que
 * o problema e o cadastro, nao uma conversa.
 *
 * "Nao sou o/a X" so conta em frase curta: "nao sou a mae, sou a avo dele" e
 * outra coisa, e quem escreve isso e da familia.
 */
export function numeroErrado(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/\b(numero|telefone|contato|whatsapp) (errado|trocado)\b/.test(t)) return true
  if (/\b(foi|e|deve ser|mandou|enviou|enviaram|mandaram) (por |para o |pro )?engano\b/.test(t) || t === 'engano') return true
  if (/\bnao conheco (esse|essa|nenhum|nenhuma|ninguem)\b/.test(t)) return true
  const palavras = t.split(' ').filter(Boolean)
  return /^(oi |ola |bom dia |boa tarde |boa noite )?nao sou (o|a) [a-z]+( [a-z]+)?$/.test(t) && palavras.length <= 7
}

/** A saida de emergencia. Vale em qualquer etapa, inclusive com a equipe. */
function pediuMenu(texto: string) {
  const t = normalizar(texto)
  return (
    t === 'menu' ||
    t === '0' ||
    t === 'inicio' ||
    t === 'voltar ao menu' ||
    t === 'menu principal' ||
    t === 'opcoes' ||
    // Titulos dos botoes de fecho (conteudo.ts). Toque em botao de mensagem
    // ANTIGA chega como o titulo, e nao como "0" (ver oQueFoiEscolhido): em
    // 05/10/2026 o Leandro tocou "Voltar ao inicio" e nao recebeu nada.
    t === 'voltar ao inicio' ||
    t === 'ver as opcoes'
  )
}

/** Um passo atras, nao ate o inicio. */
function pediuVoltar(texto: string) {
  const t = normalizar(texto)
  return t === 'voltar' || t === 'anterior'
}

/**
 * "Quero ver outra unidade" no meio dos dias ou dos horarios (16/10/2026,
 * painel): recebia os enderecos ("unidade"), com "responda com o numero do
 * horario" embaixo. E a lista de unidades de novo.
 */
function pediuOutraUnidade(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')
  return /\b(outra|outras) (unidade|unidades|clinica|clinicas|local|lugar|endereco)\b|\b(trocar|mudar) (de |a )?(unidade|local|lugar)\b|\bver as unidades\b/.test(t)
}

/**
 * O dia da semana citado que nenhuma unidade tem livre (16/10/2026, painel):
 * "queria marcar sabado de manha" recebia a lista de unidades, e a paciente
 * foi procurar o sabado em cada uma. Vazio quando nao ha dia citado, ou quando
 * alguma unidade tem.
 */
async function semDiaDaSemana(admin: Admin, clinicId: string, texto: string): Promise<string> {
  const t = normalizar(texto)
  const citado = DIAS_DA_SEMANA.find((d) => new RegExp(`\\b${d}s?\\b`).test(t))
  if (!citado) return ''
  const fuso = await fusoDaClinica(admin, clinicId)
  const semana = DIAS_DA_SEMANA.indexOf(citado)
  const todas = await primeirosHorarios(admin, clinicId)
  const tem = todas.some((c) => c.horarios.some((h) => new Date(`${chaveDoDia(h.inicio, fuso)}T12:00:00Z`).getUTCDay() === semana))
  if (tem) return ''
  const nome = { domingo: 'no domingo', segunda: 'na segunda', terca: 'na terça', quarta: 'na quarta', quinta: 'na quinta', sexta: 'na sexta', sabado: 'no sábado' }[citado]
  return `Não temos horário livre ${nome} em nenhuma unidade.`
}

/**
 * Chamar a equipe por palavra, e nao por numero.
 *
 * A palavra continua valendo para quem digita, mas deixou de ser o caminho
 * anunciado: hoje o *9* faz o mesmo em qualquer etapa, e pedir uma palavra a
 * quem esta respondendo numeros era trocar de idioma no meio da conversa.
 */
export function pediuAtendente(
  texto: string,
  /** Falso nas perguntas de nome da ficha: "Dayane Souza" ali e o nome do paciente. */
  nomeDaEquipeVale = true,
) {
  const t = normalizar(texto)
  // O 9 vale em qualquer etapa porque nenhuma lista passa de oito opcoes. E a
  // primeira coisa conferida a cada mensagem, entao ele nunca e confundido com
  // a escolha de um dia ou de um horario.
  if (t === '9') return true
  // Sem pontuacao e dentro de frase (16/10/2026, painel de pacientes
  // simulados). So valia a palavra exata: "ATENDENTE!!!" recebeu "Nao entendi"
  // e o menu pela segunda vez; "NINGUEM ME RESPONDE, QUERO FALAR COM UMA
  // PESSOA" recebeu o texto "Como e a consulta"; "Queria falar com a Dayane, e
  // sobre um pedido de exame" e "dayane?", o menu e "Nao entendi".
  const f = t.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (['atendente', 'secretaria', 'equipe', 'falar com atendente', 'falar com a equipe', 'ajuda', 'humano', 'pessoa', 'uma pessoa', 'recepcao'].includes(f)) return true
  if (/\b(falar|conversar|fala|falo) com (a |o |uma |um |alguem d[ao] )?(atendente|pessoa|humano|gente|secretaria|recepcao|recepcionista|equipe|moca|alguem|responsavel|dr|doutor|doutora|medico)\b/.test(f)) return true
  if (/\b(quero|queria|preciso|cade|chama|chamar|tem|me passa|passa pra|passa para) (a |o |uma |um )?(atendente|pessoa de verdade|humano|secretaria|recepcionista|alguem da equipe)\b/.test(f)) return true
  if (/\bninguem (me )?(responde|atende|respondeu|atendeu)\b/.test(f)) return true
  if (/\bnao (quero|aguento|gosto de) (falar com |conversar com )?(robo|maquina|bot)\b/.test(f)) return true
  // "A atendente falou pra eu marcar por aqui" e pedido de marcar.
  if (/\b(atendente|atendimento humano)\b/.test(f) && f.split(' ').length <= 10 && !/\b(marcar|agendar|marca|agenda|remarcar)\b/.test(f)) return true
  // O nome de quem e da equipe: no comeco ("dayane?", "bom dia dayane, aqui e
  // a Sonia...") ou com "com a", "pra", "a" na frente ("a Dayane esta?"). Quem
  // se apresenta com o mesmo nome ("aqui e a Dayane") e paciente.
  if (nomeDaEquipeVale) {
    const palavras = f.split(' ')
    // "Daiane" e a Dayane (rodada 3 do painel): o nome como se fala (ver
    // nomeFalado), e nao letra por letra.
    const faladas = palavras.map((p) => nomeFalado(p))
    for (const nome of perfil().equipe.map((n) => nomeFalado(n))) {
      const i = faladas.indexOf(nome)
      if (i < 0) continue
      const antes = palavras.slice(Math.max(0, i - 3), i).join(' ')
      if (/\b(sou|aqui e|eu sou|me chamo|meu nome e|chamo)( a| o)?$/.test(antes)) continue
      if (i < 4 || /\b(com a|com|pra|para a|para|a|da)$/.test(antes)) return true
    }
  }
  return false
}

/**
 * Quem pede gente reclamando da demora ouve um pedido de desculpas primeiro
 * (16/10/2026): "CADE A ATENDENTE??? TO TENTANDO FAZ 2 DIAS".
 */
function reclamouDaDemora(texto: string): boolean {
  const f = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const letras = texto.replace(/[^\p{L}]/gu, '')
  const gritando = letras.length >= 8 && letras === letras.toUpperCase()
  return gritando || /\b(ninguem|demora|demorando|cade|faz \d+ dias|desde ontem|ate agora|tentando)\b/.test(f)
}

/** "Urgente", "é urgência", ou a linha URGENCIA tocada na lista. */
function pediuUrgencia(texto: string) {
  const t = normalizar(texto)
  // "Nao e urgencia" (06/10/2026): a Patricia tocou "E urgencia" por engano,
  // escreveu "Nao e urgencia. Gostaria de informacoes sobre o valor..." e
  // recebeu de novo "Avisei a nossa equipe de que e urgente".
  if (/\b(nao|nem) (e|eh|era|foi|tem|ha|sou|estou)? ?(nada )?(de )?(urgen|emergen)/.test(t) || /\bsem (urgen|emergen)/.test(t)) return false
  // "Socorro" e "e emergencia" (16/10/2026, painel de pacientes simulados): a
  // paciente com tontura e vomito escreveu os dois e ouviu silencio e "Nao
  // entendi". So "urgen" valia. "Pronto-socorro" tambem entra: quem pergunta
  // se vai para o pronto-socorro precisa da orientacao, e nao do menu.
  if (geral() && urgenciaDeAgenda(texto)) return false
  return /urgen|emergen|\bsocorro\b/.test(t)
}

/**
 * "Quero consulta urgente, o primeiro horario que tiver" (16/10/2026, rodada
 * 2 do painel): pressa para marcar, e nao emergencia. Virava transferencia de
 * urgencia, com notificacao no celular do Dr. Fabio, e a paciente precisou
 * escrever "nao e emergencia" e digitar "menu" para conseguir marcar. Com
 * sintoma, sangramento ou sinal de alarme na frase, continua urgencia.
 */
function urgenciaDeAgenda(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  if (/\b(emergen\w*|socorro)\b/.test(t)) return false
  if (assuntoClinico(texto) || falouDeSangramento(texto) || sinalDeAlarme(texto)) return false
  return (
    /\b(consulta|horario|encaixe|agendamento|vaga|marcar|agendar|retorno)\b( \w+){0,3} (urgente|urgencia)\b/.test(t) ||
    /\b(urgente|com urgencia)\b( \w+){0,3} (consulta|horario|encaixe|vaga|marcar|agendar)\b/.test(t)
  )
}

/**
 * Sangramento na mensagem (pedido do Dr. Fabio Dario, 15/10/2026).
 *
 * No otorrino, sangramento e o alarme: o nariz que nao para de sangrar e,
 * principalmente, o pos-operatorio (septo, amigdalas, rinoplastia). O pedido
 * foi explicito: qualquer mencao - "sangramento", "sangrando", "hemorragia",
 * "epistaxe" - avisa na hora o celular do Dr. Fabio e da Dayane, e o paciente
 * recebe a orientacao de pronto-socorro.
 *
 * Errar para o lado de avisar e o certo: um alerta a mais custa uma olhada no
 * celular; um a menos pode custar o paciente. So ficam de fora a frase que
 * nega o sangramento ("sem sangramento", "nao sangrou", "nunca teve
 * hemorragia") e o sangue que e nome de exame ("exame de sangue"), que chega
 * pelo pedido de 2a via. "Nao para de sangrar" NAO e negacao: e o pior caso,
 * e o "para de" no meio impede a leitura como "nao sangrou".
 */
// Coagulo tambem (16/10/2026, rodada 3 do painel): "to operado do septo, ta
// saindo coagulo pelo nariz e to cuspindo vermelho" recebeu "e uma avaliacao
// para a consulta", sem alerta. O vermelho que sai pela boca ou pelo nariz
// conta como sangue (ver falouDeSangramento).
const SANGRAMENTO = /\b(sangr\w*|sangue|sanguinolent\w*|hemorrag\w*|epistax\w*|coagul\w*)\b/
const SANGRAMENTO_NEGADO = new RegExp(
  '\\b(sem|nenhum|nenhuma)\\s+(nenhum\\s+|nenhuma\\s+|qualquer\\s+)?(sangr\\w*|sangue|hemorrag\\w*|epistax\\w*|coagul\\w*)' +
    '|\\b(nao|nunca|nem)\\s+(tem\\s+|teve\\s+|tive\\s+|tenho\\s+|ha\\s+|houve\\s+|apresenta\\s+|apresentou\\s+)?' +
    '(nenhum\\s+|nenhuma\\s+)?(sangr\\w*|sangue|hemorrag\\w*|epistax\\w*)',
  'g',
)
const SANGUE_DE_EXAME = /\b(exames?|coleta|coletar|colher|tirar|doar|doacao|doador|banco)\s+de\s+sangue\b/g

export function falouDeSangramento(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  return (
    SANGRAMENTO.test(t.replace(SANGUE_DE_EXAME, ' ').replace(SANGRAMENTO_NEGADO, ' ')) ||
    /\b(cusp\w*|escarr\w*|vomit\w*|saindo|saiu|sai|escorr\w*|pingand\w*)( \w+){0,2} vermelh\w*\b/.test(t)
  )
}

/**
 * Sangramento que nao parou, forte ou depois de cirurgia (16/10/2026, rodada
 * 2 do painel). "Meu nariz ta jorrando sangue faz uns 20 min e nao para" e
 * "operei o septo e esta saindo sangue pela boca" ouviam "alguem da equipe
 * fala com voce o mais rapido possivel", com o pronto-socorro so como
 * condicao, e um paciente perguntou "espero ele me ligar?". Nesses, a primeira
 * frase manda ir, sem condicional. "As vezes sangra o nariz", contado ao
 * marcar consulta, continua com o aviso de sempre.
 */
export function sangramentoAtivo(texto: string): boolean {
  if (!falouDeSangramento(texto)) return false
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  return (
    falouDePosOperatorio(texto) ||
    /\bnao (para|parou|estanca|estancou|passa|passou)\b/.test(t) ||
    /\b(jorr\w*|golfad\w*|coagul\w*|escorr\w*|pingando|sem parar)\b/.test(t) ||
    /\b(ta|esta|continua|ainda) (saindo|escorrendo|pingando|descendo) (sangue|vermelho)\b|\bainda (ta |esta )?(sangr\w*|saindo)\b/.test(t) ||
    /\b(muito|bastante|monte de|cheio de) sangue\b/.test(t) ||
    /\bsangr\w* (muito|demais|bastante|forte)\b/.test(t) ||
    /\b(ha|faz|uns|mais de|quase) \d+ ?(min|minutos)\b|\b\d+ minutos\b|\bmeia hora\b|\buma hora\b/.test(t) ||
    /\b(pela boca|pela garganta|engolindo sangue|gosto de sangue|cuspindo sangue|vomit\w* sangue)\b/.test(t)
  )
}

/**
 * Sinal de alarme do otorrino na mensagem (16/10/2026, painel de pacientes
 * simulados).
 *
 * No painel, "meu filho de 4 anos enfiou um feijao no nariz", "engoli uma
 * espinha de peixe e esta doendo muito para engolir", "acordei sem ouvir nada
 * do ouvido direito", "tontura mto forte vomitando nao consigo fica de pe" e
 * "meu bebe de 8 meses esta com um barulho estranho pra respirar" receberam a
 * propaganda "Respirar bem e viver melhor" (a resposta pronta casou "nariz",
 * "ouvido", "respirar") ou "e uma avaliacao para a consulta", com o convite
 * para marcar. Urgencia so era reconhecida pela palavra "urgente" e pelo
 * sangramento. Sao os sinais que o otorrino manda ao pronto-socorro na hora.
 *
 * Como no sangramento, errar para o lado de avisar e o certo: um aviso a mais
 * custa uma olhada da equipe; um a menos pode custar o paciente. Fica de fora
 * de proposito a queixa de sempre do consultorio, que parece alarme e nao e:
 * "nao consigo respirar pelo nariz" (entupimento), "chiado no ouvido"
 * (zumbido), "espinha no nariz" (acne), "durmo muito mal" (ronco).
 *
 * Devolve o tipo do sinal (a resposta muda um pouco com ele) ou null.
 */
export type SinalDeAlarme =
  | 'corpo_estranho'
  | 'respiracao'
  | 'surdez'
  | 'tontura'
  | 'engolir'
  | 'rosto'
  | 'pos_operatorio'
  | 'bebe'
  | 'mal_estar'

const OBJETO_ESTRANHO =
  '(feijao|feijoes|graos?|milho|pipoca|ervilhas?|sementes?|carocos?|pedrinhas?|micangas?|bolinhas?|pilhas?|baterias?|' +
  'botao|brinquedos?|pecinhas?|insetos?|bichos?|bichinhos?|baratas?|formigas?|mosquitos?|besouros?|moedas?|brincos?|tampinhas?|imas?)'
const OBJETO_COMUM = '(objeto|coisa|peca|pedaco|papel|borracha|algodao|cotonete|tampa|plastico)'
const LUGAR_DO_OBJETO = '(nariz|narina|narinas|ouvido|ouvidos|orelha|garganta)'
const PUS_PRA_DENTRO = '(enfiou|enfiei|enfiaram|colocou|coloquei|colocaram|botou|botei|meteu|meti|entrou|caiu|ficou|engoliu|engoli)'
const NAO_CONSEGUE = '(nao|mal) (consigo|consegue|consegui|conseguiu|conseguimos|to conseguindo|estou conseguindo|esta conseguindo|ta conseguindo)'
// "Tontera forte a casa ta girano" (25/10/2026, rodada 5 do painel): a grafia
// falada e o "ta" no meio escapavam, e a mensagem recebeu o menu. O gerundio
// falado ("girano", "vomitano") e corrigido antes, em sinalDeAlarme.
const TONTURA = /\b(tontura|tonteira|tontera|tontiera|tont[oa]|vertigem|vertigens|labirintite|(tudo|mundo|casa|cabeca|quarto)( (ta|esta|fica|ficou|todo|toda))? (rodando|girando|gira|roda)|(rodando|girando) tudo)\b/
const TONTURA_FORTE = new RegExp(
  `\\b(vomit\\w*|${NAO_CONSEGUE} (ficar de pe|ficar em pe|parar em pe|levanta\\w*|me levantar|andar|abrir os olhos)|cai|caiu|desmai\\w*|` +
    'forte|fortissima|horrivel|insuportavel|passando mal|nao para|sem parar)\\b',
)
// Perto da falta de ar, e o nariz entupido de sempre ou o ronco da noite, que
// sao consulta: "nao consigo respirar pelo nariz", "nao respira direito a
// noite, ronca muito", "faz barulho pra respirar quando dorme".
const QUEIXA_DE_SEMPRE = /\b(pelo nariz|pela narina|pelas narinas|pelo lado|nariz entupido|entupid[oa]|a noite|de noite|dormindo|quando dorme|pra dormir|para dormir|ronc\w*)\b/

export function sinalDeAlarme(texto: string): SinalDeAlarme | null {
  // O gerundio como se fala (rodadas 4 e 5 do painel): "tudo rodano, vomitei"
  // e "a casa ta girano. vomitano" ficaram sem alerta. So os verbos do alarme:
  // trocar todo "-ano" estragaria "plano", "cano" e "ano".
  const t = normalizar(texto)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(gir|rod|vomit|sangr|desmai|sufoc|engasg|trem)ano\b/g, '$1ando')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return null
  const tem = (padrao: RegExp | string) => (typeof padrao === 'string' ? new RegExp(padrao) : padrao).test(t)
  /** O padrao casa longe da queixa de sempre (ver QUEIXA_DE_SEMPRE). */
  const semSerOEntupido = (padrao: RegExp) => {
    const achado = new RegExp(padrao.source, 'g')
    for (let m = achado.exec(t); m; m = achado.exec(t)) {
      const volta = t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)
      if (!QUEIXA_DE_SEMPRE.test(volta)) return true
    }
    return false
  }

  // Corpo estranho: no nariz, no ouvido, na garganta, ou engolido.
  if (
    tem(`\\b${OBJETO_ESTRANHO}\\b.{0,40}\\b${LUGAR_DO_OBJETO}\\b`) ||
    tem(`\\b${LUGAR_DO_OBJETO}\\b.{0,40}\\b${OBJETO_ESTRANHO}\\b`) ||
    tem(`\\b${PUS_PRA_DENTRO}\\b.{0,25}\\b${OBJETO_COMUM}\\b.{0,30}\\b${LUGAR_DO_OBJETO}\\b`) ||
    tem(/\bcorpo estranho\b/) ||
    tem(/\bespinha de peixe\b/) ||
    // "Espinha" sozinha tambem e acne: so conta com garganta ou engolir perto.
    tem(/\bespinhas?\b.{0,50}\b(garganta|engol\w*|engul\w*|ental\w*|pres[oa]|atravessad\w*|engasg\w*|espetad\w*|espetando)\b/) ||
    tem(/\b(garganta|engoli|engoliu|engasguei|engasgou|entalou|entalei)\b.{0,50}\bespinhas?\b/) ||
    tem(/\bossos?\b.{0,40}\b(garganta|ental\w*|atravessad\w*|engasg\w*)\b/) ||
    tem(/\b(engoli|engoliu|engoliram)\b.{0,30}\b(ossos?|pilhas?|baterias?|moedas?|imas?|alfinetes?|pregos?|parafusos?|tampinhas?|botao|brinquedos?|pecinhas?|objeto)\b/) ||
    tem(/\b(entalad[oa]|entalou|entalei|preso|presa|atravessad[oa])\b.{0,30}\bgarganta\b/) ||
    tem(/\bgarganta\b.{0,30}\b(entalad[oa]|entalou|preso|presa|atravessad[oa])\b/)
  ) {
    return 'corpo_estranho'
  }

  // Respiracao. "Chiado no ouvido" e zumbido, e nao falta de ar.
  if (
    semSerOEntupido(/\b(falta de ar|sem ar)\b/) ||
    tem(/\b(sufoc\w*|asfixi\w*|cianose|ofegante|arroxead[oa]|engasgad[oa]|engasgando)\b/) ||
    tem(/\b(labio|labios|boca|rosto)\b.{0,15}\b(roxo|roxa|roxos|roxas|roxinho|roxinha)\b/) ||
    tem(/\b(ficou|ficando|esta|ta|fica) (roxo|roxa|roxinho|roxinha)\b/) ||
    // "Chiadinho no peito" (rodada 3 do painel): o diminutivo tambem.
    (tem(/\b(chiad\w*|chiand\w*|chia|chiadeira|estridor)\b/) && !tem(/\b(ouvido|ouvidos|orelha|orelhas|cabeca)\b/)) ||
    semSerOEntupido(new RegExp(`\\b${NAO_CONSEGUE}( mais)?( direito)? respirar\\b`)) ||
    semSerOEntupido(/\b(dificuldade|dificil|esforco) (pra|para|de|ao|em) respirar\b/) ||
    semSerOEntupido(/\brespira(ndo)? com (muita )?dificuldade\b/) ||
    semSerOEntupido(/\b(barulho|ruido|som)( \w+){0,2} (pra|para|ao|quando) respira\w*\b/) ||
    semSerOEntupido(/\brespira(ndo)? (mal|rapid\w*|muito rapid\w*|depressa|estranh\w*|esquisit\w*|diferente|pesad\w*|com barulho)\b|\brespiracao (rapida|acelerada|curta|estranha|esquisita|diferente|pesada|ofegante|dificil)\b/) ||
    // "Respiracao estranha, fazendo um barulhinho" (rodada 2 do painel): o
    // barulho no diminutivo, longe do verbo, na mesma frase da respiracao.
    (tem(/\b(barulh\w*|ruid\w*|chiad\w*|gemid\w*)\b/) && tem(/\b(respira\w*|respiracao|folego)\b/) && !tem(/\b(ronc\w*|dormindo|quando dorme|a noite|de noite|nariz entupido)\b/)) ||
    // A barriga ou as costelas afundando ao respirar (tiragem), dita como se fala.
    tem(/\b(barriga|barriguinha|costela|costelas|costelinha|peito|pescoco)\b.{0,15}\b(afund\w*|puxand\w*)\b|\bafundando (a |as )?(barriga|barriguinha|costela|costelas)\b/) ||
    tem(/\b(puxando|puxa) (o )?ar\b/) ||
    tem(/\b(garganta|lingua) (fechando|inchando|inchada)\b|\bfechando a garganta\b/)
  ) {
    return 'respiracao'
  }

  // Bebe molinho, que nao mama, que nao acorda (rodada 2 do painel): no bebe,
  // isso e sinal de alarme mesmo sem a palavra respiracao.
  if (
    tem(/\b(bebe|bebezinho|bb|nenem|neném|recem nascido|recem nascida|\d{1,2} (meses|mes))\b/) &&
    tem(/\b(molinh[oa]|mole|largad\w*|sem forca|nao (quer )?mam\w*|parou de mamar|nao acorda|cansad[oa]|cansadinh[oa]|abatid[oa]|prostrad[oa]|gemend\w*|roxinh[oa]|desidratad\w*)\b/)
  ) {
    return 'bebe'
  }

  // Surdez subita: o "de repente" (ou "acordei", "desde ontem") e o que separa
  // da perda de audicao de anos, que e consulta comum.
  // "To escutando quase nada" e "tampou do nada" (rodada 3 do painel) tambem.
  const SEM_OUVIR = '(sem (ouvir|escutar)|surd[oa]|nao (ouco|ouvia|ouve|ouvindo|escuto|escuta|escutava|escutando|estou ouvindo|to ouvindo|estou escutando|to escutando)|(escutando|ouvindo|escuto|ouco|escuta|ouve) (quase )?nada|(escutando|ouvindo) (muito )?pouco|perdi a audicao|perdeu a audicao|(ouvido|orelha)( [a-z]+){0,3} (tampou|tapou|entupiu|fechou|abafou|travou))'
  const DE_REPENTE = '(de repente|do nada|subitamente|repentinamente|de uma hora (pra|para) outra)'
  if (
    tem(/\b(surdez|perda auditiva|perda (de|da) audicao) (subita|repentina|aguda|de repente)\b/) ||
    tem(/\b(parei|parou) de (ouvir|escutar)\b/) ||
    tem(new RegExp(`\\b(acordei|acordou|amanheci|amanheceu)\\b.{0,40}\\b(${SEM_OUVIR}|tampad[oa]|abafad[oa])`)) ||
    tem(new RegExp(`\\b${DE_REPENTE}\\b.{0,50}\\b${SEM_OUVIR}`)) ||
    tem(new RegExp(`\\b${SEM_OUVIR}.{0,50}\\b${DE_REPENTE}\\b`)) ||
    tem(new RegExp(`\\b${SEM_OUVIR}.{0,40}\\b(desde|hoje|ontem|de manha|ha (\\d+|um|dois|tres) dias?|faz (\\d+|um|dois|tres) dias?)\\b`)) ||
    tem(new RegExp(`\\b(desde ontem|desde hoje|hoje cedo|de ontem pra hoje)\\b.{0,40}\\b${SEM_OUVIR}`))
  ) {
    return 'surdez'
  }

  // Tontura que derruba: com vomito, sem conseguir ficar de pe, ou "forte".
  if ((tem(TONTURA) && tem(TONTURA_FORTE)) || tem(/\bnao (paro|para|parei|parou) de vomit\w*\b/)) return 'tontura'

  // Nao conseguir engolir, ou dor forte para engolir.
  if (
    tem(new RegExp(`\\b${NAO_CONSEGUE}( nem)?( mais)? (engolir|engulir|engole|abrir a boca|tomar agua|beber agua|beber)\\b`)) ||
    tem(/\bnao desce( nem)?( mais)?( agua| comida| nada| saliva)?\b/) ||
    ((tem(/\b(dor|doi|doe|doendo)\b.{0,25}\b(engolir|engulir|engole)\b/) || tem(/\b(engolir|engulir)\b.{0,25}\b(doi|doe|doendo|dor)\b/)) &&
      tem(/\b(muito|mto|demais|forte|insuportavel|horrivel|bastante|ate a saliva|nem a saliva)\b/)) ||
    (tem(/\bbaban\w*\b/) && tem(/\b(garganta|engolir|engulir|febre|dor)\b/)) ||
    tem(/\b(pescoco|garganta) (inchad[oa]|duro|dura)\b|\binchaco no pescoco\b|\bvoz abafada\b/)
  ) {
    return 'engolir'
  }

  // Rosto torto ou fala enrolada: paralisia facial, ou coisa pior.
  if (
    tem(/\b(boca|rosto|cara) (tort[oa]|caid[oa]|paralisad[oa])\b/) ||
    tem(/\bparalisia (facial|do rosto|da face)\b/) ||
    tem(/\b(metade|lado) do rosto\b.{0,30}\b(paralisad\w*|caid\w*|nao mexe|parad[oa]|dormente)\b/) ||
    tem(/\bnao (consigo|consegue) (fechar|mexer) o olho\b/) ||
    tem(/\bfala enrolada\b/)
  ) {
    return 'rosto'
  }

  // Pos-operatorio com febre, pus, inchaco ou dor forte. Pergunta sobre a
  // cirurgia que ainda vai acontecer ("a cirurgia doi?") nao entra: so o
  // passado ("operei", "depois da cirurgia").
  if (
    tem(/\b(operei|operou|operado|operada|fiz a cirurgia|fez a cirurgia|depois da cirurgia|desde a cirurgia|pos operatorio|pos op|posoperatorio)\b/) &&
    tem(new RegExp(`\\b(febre|pus|inchad[oa]|inchaco|dor (muito )?forte|muita dor|${NAO_CONSEGUE} (engolir|respirar|beber))\\b`))
  ) {
    return 'pos_operatorio'
  }

  // Mal-estar forte. "Durmo muito mal" e queixa de ronco: o "mal" so conta
  // com quem esta mal agora.
  //
  // (O pos-operatorio sem sinal de alarme tambem vai para a equipe, mas como
  // recado: ver falouDePosOperatorio.)
  if (
    tem(/\b(passando mal|desmai\w*|convuls\w*|inconsciente|desacordad[oa])\b/) ||
    tem(/\b(to|estou|esta|ta|fiquei|ficou|me sinto|sentindo) (muito |mto |bem )?mal\b/)
  ) {
    return 'mal_estar'
  }
  return null
}

/**
 * Paciente operado escrevendo (16/10/2026, painel de pacientes simulados).
 *
 * "Oi bom dia, operei o septo com o dr fabio semana passada" recebeu a
 * propaganda do consultorio ("Respirar bem e viver melhor", casou "septo"):
 * quem acabou de operar e esta escrevendo quer falar do pos-operatorio, e
 * quem acompanha e a equipe. So o passado: "vou operar o septo, quanto custa?"
 * e pergunta de quem ainda nao operou.
 */
export function falouDePosOperatorio(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  // "To operado do septo" (rodada 3 do painel) tambem.
  return /\b(operei|operou|fui operad[oa]|foi operad[oa]|(to|tou|estou|ta|esta|sou|recem|ja) operad[oa]|operad[oa] (do|da|de|ha|faz)|fiz a cirurgia|fez a cirurgia|fiz cirurgia|fez cirurgia|depois da cirurgia|desde a cirurgia|pos operatorio|pos op|posoperatorio|pos cirurgia|pos cirurgico)\b/.test(t)
}

/**
 * Idade em anos completos, pela data do cadastro (AAAA-MM-DD) ou pelo que a
 * pessoa escreveu na ficha. Null quando nao da para saber.
 */
function idadeEmAnos(nascimento: string | null | undefined, agora: Date): number | null {
  const bruto = String(nascimento ?? '').trim()
  if (!bruto) return null
  const iso = /^\d{4}-\d{2}-\d{2}/.test(bruto) ? bruto.slice(0, 10) : dataDeNascimentoIso(bruto, agora, { adulto: true })
  if (!iso) return null
  const [ano, mes, dia] = iso.split('-').map(Number)
  // O dia de hoje em Brasilia, e nao no fuso da maquina.
  const hoje = new Date(agora.getTime() - 3 * 3600 * 1000)
  const fezAniversario = hoje.getUTCMonth() + 1 > mes || (hoje.getUTCMonth() + 1 === mes && hoje.getUTCDate() >= dia)
  return hoje.getUTCFullYear() - ano - (fezAniversario ? 0 : 1)
}

function desistiu(texto: string) {
  const t = normalizar(texto)
  return t === 'cancelar' || t === 'sair' || t === 'parar' || t === 'desistir'
}

/**
 * Le uma hora escrita por extenso: "10h", "09:20", "as 9 h".
 *
 * So conta como hora quando ha marca explicita (`h` ou `:`). Numero solto
 * continua sendo indice da lista, que e o que a mensagem pede.
 *
 * Existe por causa de um erro silencioso: num dia com 15 horarios, quem
 * digitava "10h" era entendido como "opcao 10" e saia marcado as 14:00,
 * convencido de que tinha marcado as 10:00. Errar calado e pior do que nao
 * entender.
 */
const HORA_POR_EXTENSO: Record<string, number> = {
  uma: 1, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
}
const MINUTO_POR_EXTENSO: Record<string, number> = { dez: 10, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 }

export function horaEscrita(texto: string): { hora: number; minuto: number | null } | null {
  let t = normalizar(texto)
  // Por extenso e com o periodo (16/10/2026, painel de pacientes simulados): o
  // senhor de 70 anos escreveu "as duas horas da tarde" e "2 da tarde" e ouviu
  // dois "Nao entendi"; "nove e vinte", "4 da tarde" e "2pm", o mesmo. O
  // numero solto continua sendo item da lista: so vira hora com "horas",
  // "da tarde", "e vinte" ou "em ponto" junto.
  t = t.replace(/\bmeio[ -]?dia e meia\b/g, '12:30').replace(/\bmeio[ -]?dia\b/g, '12h')
  t = t.replace(
    /\b(uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\b(?=\s+(e\s+(dez|quinze|vinte|trinta|quarenta|cinquenta|meia)\b|horas?\b|hrs?\b|hs?\b|da (manha|tarde|noite)\b|em ponto\b))/g,
    (n) => String(HORA_POR_EXTENSO[n]),
  )
  t = t.replace(/\b(\d{1,2})\s+e\s+(dez|quinze|vinte|trinta|quarenta|cinquenta)\b/g, (_, h: string, m: string) => `${h}:${MINUTO_POR_EXTENSO[m]}`)
  // "As oito", "pode ser as 8" (rodada 2 do painel): com o "as" na frente e
  // nada depois, e hora. "As duas unidades" e "as 2 primeiras" nao sao.
  const fimDaHora = String.raw`(?=\s*($|[,.!?;]|entao\b|mesmo\b|pode\b|por favor\b|serve\b|fica\b|ta\b|ok\b|beleza\b|blz\b|tem\b|tambem\b|de (segunda|terca|quarta|quinta|sexta)\b|da (segunda|terca|quarta|quinta|sexta)\b))`
  // "Qual das duas tem horario antes?" (rodada 3 do painel) e "das duas
  // unidades", e nao as 14h.
  t = t.replace(/\b(qual|quais|uma|nenhuma|alguma|entre|cada) (d?as) (uma|duas|tres)\b/g, '$1 $2 _$3')
  t = t.replace(
    new RegExp(String.raw`\b(d?as) (uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\b${fimDaHora}`, 'g'),
    (_, as: string, n: string) => `${as} ${HORA_POR_EXTENSO[n]}h`,
  )
  t = t.replace(new RegExp(String.raw`\b(d?as) (\d{1,2})\b(?!\s*[:h/])${fimDaHora}`, 'g'), '$1 $2h')
  const daTarde = /\b(da tarde|a tarde|de tarde|da noite|a noite|de noite)\b|\d\s*pm\b/.test(t)
  const daManha = /\b(da manha|de manha|pela manha|manha|madrugada)\b|\d\s*am\b/.test(t)
  const noPeriodo = (r: { hora: number; minuto: number | null } | null) => {
    if (!r) return r
    if (daTarde && r.hora >= 1 && r.hora <= 11) return { ...r, hora: r.hora + 12 }
    // "As duas", "4h" (rodada 2): no consultorio, de tarde. Ninguem marca
    // consulta as 4 da madrugada.
    if (!daManha && r.hora >= 1 && r.hora <= 6) return { ...r, hora: r.hora + 12 }
    return r
  }

  // "9 e 20", "10 e meia", "8 em ponto" (painel, 14/10/2026): sem "h" nem ":"
  // nada disso era lido como hora.
  const falada = t.match(/\b(\d{1,2})\s+e\s+(\d{2}|meia)\b/)
  if (falada) {
    const hora = Number(falada[1])
    const minuto = falada[2] === 'meia' ? 30 : Number(falada[2])
    return hora <= 23 && minuto <= 59 ? noPeriodo({ hora, minuto }) : null
  }
  const emPonto = t.match(/\b(\d{1,2})\s*(?:h|hs|hrs?|horas)?\s+em ponto\b/)
  if (emPonto && Number(emPonto[1]) <= 23) return noPeriodo({ hora: Number(emPonto[1]), minuto: 0 })
  // "Dia 20 de manha" e o dia 20 (rodada 3 do painel), e nao as 20h: numero
  // maior que 12, sem "h", junto do periodo, e dia do mes.
  const comPeriodo = t.match(/\b(?<!dia )(\d{1,2})\s*(h|hs|hrs?|horas?)?\s*(da manha|da tarde|da noite|de manha|de tarde|pm|am)\b/)
  if (comPeriodo && Number(comPeriodo[1]) <= 23 && (comPeriodo[2] || Number(comPeriodo[1]) <= 12)) {
    return noPeriodo({ hora: Number(comPeriodo[1]), minuto: null })
  }
  if (!/[h:]/.test(t)) return null
  // O "h" da hora nao e o comeco de outra palavra (rodada 2 do painel): "tomo
  // 1 hj e pronto?" era lido como 13h, e a pergunta do remedio virou agenda.
  // "8 hrs" (rodada 3 do painel) tambem.
  const m = t.match(/(\d{1,2})\s*(?::\s*(\d{2})|h(?:rs?|s|oras?)?(?![a-z])\s*(\d{2})?)/)
  if (!m) return null
  const hora = Number(m[1])
  const minutos = m[2] ?? m[3]
  const minuto = minutos === undefined ? null : Number(minutos)
  if (hora > 23) return null
  if (minuto !== null && minuto > 59) return null
  return noPeriodo({ hora, minuto })
}

/** "De manha", "a tarde" (16/10/2026). "Boa tarde" e cumprimento, nao periodo. */
function periodoEscrito(texto: string): 'manha' | 'tarde' | null {
  // "Ja ta tarde ne" (rodada 3 do painel) e a hora, e nao o periodo.
  const t = normalizar(texto).replace(/\b(bom dia|boa tarde|boa noite)\b|\b(ja|ta|esta|muito|meio|bem|tao|ficou|ficando) tarde\b|\btarde demais\b/g, ' ')
  if (/\b(de manha|da manha|pela manha|manha|cedinho|bem cedo)\b/.test(t)) return 'manha'
  if (/\b(a tarde|de tarde|da tarde|pela tarde|tarde|tardinha)\b/.test(t)) return 'tarde'
  return null
}

/**
 * Pergunta sobre a data, e nao escolha (16/10/2026, painel): "So dia 20? Nao
 * tem nada antes?" abria os horarios do dia 20; "hj nao da? to mto mal" e
 * "qual tem pra hj?" recebiam "Nao entendi".
 */
function perguntouMaisCedo(texto: string): 'hoje' | 'antes' | null {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  if (/\b(hoje|hj)\b/.test(t) && !/\b(amanha|amnh)\b/.test(t)) return 'hoje'
  // "Antes" so com o que vem antes de uma data: "antes de marcar, quanto
  // custa?" nao e pedido de horario mais cedo.
  // Sem "mais perto": "a mais perto de casa" e lugar, e nao data.
  if (
    // "E urgente" na agenda e pressa (ver urgenciaDeAgenda): com sintoma, a
    // mensagem ja foi para a equipe antes de chegar aqui.
    /\b((nada|algo|nenhum|nenhuma|tem|teria|algum|alguma|mais) antes|antes (disso|desse|dessa|do dia|de (segunda|terca|quarta|quinta|sexta)|da (segunda|terca|quarta|quinta|sexta))|mais cedo|quanto antes|mais rapido|primeiro horario|primeira vaga|primeiro dia|primeiro disponivel|primeira data|urgente|com urgencia|(horario|data|vaga|dia) mais proxim[oa]|(horario|vaga|data) antes)\b/.test(t)
  ) {
    return 'antes'
  }
  return null
}

/**
 * Pressa explicita no pedido de marcar (16/10/2026): "o quanto antes", "pra
 * hoje", "tanto faz a unidade". Mais estreita que perguntouMaisCedo: no
 * primeiro pedido, um "hoje" solto ("hoje acordei com o nariz entupido") e
 * historia, e nao pedido de horario.
 */
function comPressa(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  return /\b(pra hoje|para hoje|hoje mesmo|ainda hoje|quanto antes|mais cedo|mais rapido|primeiro horario|primeira vaga|primeiro disponivel|qualquer unidade|tanto faz|urgente|com urgencia|(horario|data|vaga|dia) mais proxim[oa])\b/.test(t)
}

/**
 * "Qualquer dia", "o mais cedo que tiver", "tanto faz" (14/10/2026): o pai com
 * pressa do painel recebeu quatro "Nao entendi" seguidos dizendo isso. Numa
 * lista de dias ou de horarios, e o primeiro.
 */
export function qualquerUm(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return /\b(qualquer|qlq|qq|tanto faz|o mais cedo|a mais cedo|mais cedo possivel|o primeiro|a primeira|o mais proximo|a mais proxima|o que tiver|a que tiver|o que der|primeiro que tiver|primeira que tiver|o mais rapido|mais rapido possivel)\b/.test(t)
}

/** Le "31/08" e devolve dia e mes, para quem responde a data em vez do numero. */
function dataEscrita(texto: string): { dia: number; mes: number } | null {
  const m = normalizar(texto).match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})/)
  if (!m) return null
  const dia = Number(m[1])
  const mes = Number(m[2])
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null
  return { dia, mes }
}

/**
 * Le "2", "2.", "*2*" ou "opcao 2" e devolve o indice na lista mostrada.
 *
 * O NUMERO PRECISA SER A MENSAGEM, e nao um numero dentro dela. Antes daqui a
 * funcao raspava tudo que nao fosse digito e lia o que sobrava, entao qualquer
 * frase com um algarismo virava escolha de menu - e isso acontecia ANTES de o
 * robo tentar responder a pergunta ou reconhecer assunto clinico:
 *
 *   "meu filho de 2 anos esta com sangue nas fezes"  ->  abria o agendamento
 *   "ele tem 5 anos, o que devo levar?"              ->  abria a 2a via
 *   "prefiro Santos, fica a 2 quadras"               ->  escolhia a unidade 2
 *
 * A pergunta nunca era respondida, e no primeiro caso um sintoma de alarme
 * entrava como "quero marcar". Numero de idade e o mais comum numa clinica
 * pediatrica: quase toda mae diz a idade do filho na primeira frase.
 *
 * O que continua valendo e o jeito real de responder: o numero sozinho, com
 * pontuacao, com os asteriscos que o proprio robo usa no menu, ou precedido
 * de "opcao"/"numero". Tudo o mais e frase, e frase vai para quem sabe ler
 * frase.
 */
function escolha(texto: string, total: number): number | null {
  const limpo = normalizar(texto)
    .replace(/\*/g, '')
    .replace(/^(a\s+)?(op(c|ç)(a|ã)o|numero|n(u|ú)mero|item|alternativa)\s+/, '')
    .replace(/[.)\]º°,;:!]+$/, '')
    .trim()
  if (!/^\d{1,2}$/.test(limpo)) return null
  const numero = Number.parseInt(limpo, 10)
  if (!Number.isFinite(numero) || numero < 1 || numero > total) return null
  return numero - 1
}

/**
 * "segunda, 14/09".
 *
 * Por extenso, e nao "seg.": ninguem le uma lista de abreviacoes de olhada, e o
 * dia da semana e justamente o que a pessoa esta procurando ao escolher.
 *
 * O "-feira" sai porque nao acrescenta nada e rouba nove caracteres do titulo
 * da lista tocavel, que a Meta corta em 24.
 */
function formatarDia(iso: string, timezone: string) {
  const texto = new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  })
  return texto.replace('-feira', '')
}

function formatarHora(iso: string, timezone: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatarData(iso: string, timezone: string) {
  return `${formatarDia(iso, timezone)} às ${formatarHora(iso, timezone)}`
}

/** Chave estavel do dia no fuso da clinica, no formato AAAA-MM-DD. */
function chaveDoDia(iso: string, timezone: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone })
}

/**
 * A promessa do lembrete da vespera, so quando ele vai chegar (17/10/2026 no
 * sistema do Dr. Marcello, trazido em 25/10/2026).
 *
 * La, consulta marcada para hoje as 15:00 saia com "Um dia antes da consulta
 * enviamos uma mensagem para voce confirmar" - em nove conversas do painel. O
 * lembrete daqui roda aos :20, das 9h20 as 19h20 (appointment-reminders), e
 * avisa a consulta de amanha: marcada para hoje, ou para amanha depois da
 * ultima rodada, nao ha vespera. Ai a frase sai, em vez de prometer o que nao
 * vem.
 */
const ULTIMA_RODADA_DO_LEMBRETE_MIN = 19 * 60 + 20
export function avisoDoLembrete(inicio: string, timezone: string, agora: Date): string {
  const hoje = chaveDoDia(agora.toISOString(), timezone)
  const amanha = chaveDoDia(new Date(agora.getTime() + 24 * 3600_000).toISOString(), timezone)
  const dia = chaveDoDia(inicio, timezone)
  const [hora, minuto] = agora
    .toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false })
    .split(':')
    .map(Number)
  if (dia === hoje || (dia === amanha && hora * 60 + minuto >= ULTIMA_RODADA_DO_LEMBRETE_MIN)) return ''
  return '*Um dia antes da consulta enviamos uma mensagem aqui pelo WhatsApp para você confirmar sua presença.*'
}

/**
 * Agrupa os horarios livres por dia, preservando a ordem cronologica.
 *
 * O paciente pensa em dia antes de pensar em hora. Uma lista corrida de 42
 * horarios so mostrava os 8 primeiros - dois dias - e dava a impressao de que a
 * agenda acabava ali, escondendo os outros cinco dias abertos.
 */
function agruparPorDia(horarios: Horario[], timezone: string) {
  const porDia = new Map<string, Horario[]>()
  for (const h of horarios) {
    const chave = chaveDoDia(h.inicio, timezone)
    const lista = porDia.get(chave)
    if (lista) lista.push(h)
    else porDia.set(chave, [h])
  }
  return [...porDia.entries()].map(([chave, lista]) => ({ chave, horarios: lista }))
}

/**
 * O menu como o pai le no celular.
 *
 * O emoji nao e enfeite: quem abre esta conversa costuma estar com uma crianca
 * no colo e pressa, e o icone diz do que se trata antes da leitura. Um por
 * linha, sempre o mesmo - variar so atrapalharia o reconhecimento.
 *
 * O numero vai em negrito porque e o que a pessoa precisa digitar. O verbo vem
 * na frente ("Marcar", "Falar", "Ver") para a linha responder a pergunta "o que
 * eu quero fazer" em vez de nomear uma funcao do sistema.
 */
const OPCOES = [
  '*1* 💬 Dúvidas sobre a consulta',
  // 🗓️ e nao 📅: o calendario cheio desenha uma data fixa dentro do icone, e um
  // "24 de fevereiro" ao lado de uma consulta de setembro confunde quem le.
  // "ou retorno" escrito na linha porque quem volta em 30 dias nao tinha como
  // saber que este era o caminho dele: "marcar uma consulta" soa como comecar
  // do zero, e o paciente de retorno ia para o *3* pedir gente. A lista abaixo
  // nao cabe essa frase (24 caracteres por linha, limite da Meta), entao ali a
  // palavra vai na descricao.
  '*2* 🗓️ Marcar uma consulta ou retorno',
  // 🗣️ e nao 👩‍⚕️: o emoji de profissional de saude e composto por dois
  // caracteres colados por um invisivel, e em Android antigo a cola falha e
  // aparecem dois desenhos soltos - justamente no aparelho mais simples.
  '*3* 🗣️ Falar com alguém da equipe',
  // 🔄 e nao 🔎: a opcao faz tres coisas, e a lupa sugere apenas olhar.
  '*4* 🔄 Ver, remarcar ou cancelar',
  // "2a via" vem na frente do nome tecnico porque e assim que a familia chega:
  // "perdi a receita", "a farmacia nao aceitou". Ninguem escreve "solicitacao
  // de documento medico". O 📄 repete a ideia de papel na mao.
  '*5* 📄 2ª via de receita ou pedido de exame',
].join('\n')

// O "0" sempre funcionou - pediuMenu o aceita desde o inicio, e ele nunca
// colide com a lista porque indice de opcao comeca em 1. So nao estava escrito
// em lugar nenhum, e o que nao se anuncia nao existe para quem le.
const VOLTA = 'Digite *0* a qualquer momento para voltar ao início.'

/**
 * Quando o robo nao entende, ele pergunta em vez de adivinhar (16/10/2026,
 * pedido do Edu depois do painel de pacientes simulados): a regra de texto nao
 * le todo jeito de escrever uma urgencia ("chiadinho no peito", "to operado"),
 * e um toque em Urgencia chega ao pronto-socorro e ao celular da equipe do
 * mesmo jeito. Duvida deixa a mensagem com a equipe, sem alarme. O "URGENCIA"
 * chega como texto e cai em pediuUrgencia; o "E_DUVIDA" tem o bloco proprio.
 */
const BOTOES_URGENCIA_OU_DUVIDA = [
  { id: 'URGENCIA', titulo: '🚨 Urgência' },
  { id: 'E_DUVIDA', titulo: '💬 Dúvida' },
]
const PERGUNTA_URGENCIA_OU_DUVIDA = 'É uma *urgência* ou uma *dúvida*? Toque abaixo.'
const SAIDAS = 'Digite *9* para falar com a nossa equipe, ou *0* para voltar ao início.'

/**
 * Acrescenta as duas saidas na propria lista tocavel.
 *
 * Quem toca nao deveria precisar digitar nada. As duas linhas ocupam duas das
 * dez, entao o conteudo e cortado em oito - o mesmo oito de MAX_DIAS, para que
 * o numero mostrado e o numero tocado nunca discordem.
 */
/**
 * Encurta um titulo de linha respeitando o limite da Meta.
 *
 * Corta no separador quando existe, porque "Livance Ibirapuera - Sao Paulo"
 * vira "Livance Ibirapuera" e nao "Livance Ibirapuera - Sa". A cidade nao se
 * perde: ela continua na descricao e no texto da mensagem.
 */
function tituloCurto(texto: string): string {
  const limpo = texto.trim()
  if (limpo.length <= LIMITE_TITULO) return limpo

  for (const separador of [' - ', ' · ', ' — ', ', ']) {
    const corte = limpo.split(separador)[0].trim()
    if (corte.length > 0 && corte.length <= LIMITE_TITULO) return corte
  }
  return `${limpo.slice(0, LIMITE_TITULO - 1).trimEnd()}…`
}

/**
 * Acrescenta as duas saidas e faz caber no que a Meta aceita.
 *
 * O corte acontece AQUI, e nao em cada tela, porque foi assim que a lista de
 * unidades quebrou: "Livance Ibirapuera - São Paulo" tem 30 caracteres, a Meta
 * recusou a mensagem interativa inteira, e ela chegou como texto puro sem botao
 * nenhum. Nada avisa quando isso acontece - a mensagem simplesmente perde o
 * toque. Centralizando, uma tela nova nao pode reintroduzir o defeito.
 */
function comVoltar(linhas: Toque[]): Toque[] {
  const cabem = linhas.slice(0, MAX_TOQUES - 2).map((linha) => ({
    ...linha,
    titulo: tituloCurto(linha.titulo),
    ...(linha.descricao ? { descricao: linha.descricao.slice(0, LIMITE_DESCRICAO) } : {}),
  }))

  return [
    ...cabem,
    { id: '9', titulo: 'Falar com a equipe' },
    { id: '0', titulo: 'Voltar ao menu' },
  ]
}

/**
 * Colunas que nasceram depois de alguma versao da funcao ja estar no ar.
 *
 * A funcao, o frontend e as migrations sobem por caminhos diferentes, e a
 * funcao costuma chegar primeiro. Quando ela grava uma coluna que o banco
 * ainda nao tem, o Postgres NAO ignora o campo desconhecido: ele recusa o
 * UPDATE inteiro.
 *
 * Em 19/09/2026 isso derrubou o atendimento de um jeito que nao parecia erro.
 * O estado da conversa deixou de ser gravado, entao o robo nunca saia do
 * menu: o paciente digitava 1, recebia o menu, digitava 1 de novo, recebia o
 * menu. Tres vezes, sem nenhuma mensagem de erro em lugar nenhum.
 *
 * Perder o campo novo e um arranhao; perder o estado da conversa trava o
 * atendimento. Entao o campo novo e o que cede.
 */
const COLUNAS_RECENTES = ['booking_insurance']

async function salvarEstado(
  admin: Admin,
  conversationId: string,
  campos: Record<string, unknown>,
) {
  const tudo = { booking_updated_at: new Date().toISOString(), ...campos }
  const { error } = await admin
    .from('whatsapp_conversations')
    .update(tudo)
    .eq('id', conversationId)
  if (!error) return

  const semAsNovas: Record<string, unknown> = { ...tudo }
  let tirouAlguma = false
  for (const coluna of COLUNAS_RECENTES) {
    if (coluna in semAsNovas) {
      delete semAsNovas[coluna]
      tirouAlguma = true
    }
  }
  if (!tirouAlguma) {
    console.error('Falha ao salvar o estado da conversa', error)
    return
  }

  console.warn('Coluna recente ausente no banco; salvando o estado sem ela', error)
  const { error: aindaFalha } = await admin
    .from('whatsapp_conversations')
    .update(semAsNovas)
    .eq('id', conversationId)
  if (aindaFalha) console.error('Falha ao salvar o estado da conversa', aindaFalha)
}

/**
 * Encerra a etapa mas deixa o menu no ar.
 *
 * Serve para toda mensagem que termina oferecendo um numero ("digite 2 para
 * ..."). Com o estado zerado, esse numero caia na regra de silencio quando a
 * conversa estava marcada para a equipe - foi o que aconteceu depois de um
 * cancelamento em 30/08/2026: o robo prometeu "digite 2" e emudeceu.
 */
async function voltarAoMenuAtivo(admin: Admin, conversationId: string) {
  await salvarEstado(admin, conversationId, {
    booking_state: 'menu',
    booking_options: null,
    booking_unit_id: null,
    booking_modality: null,
    booking_patient_id: null,
    booking_replaces_id: null,
    booking_intake_id: null,
    booking_insurance: null,
  })
}

async function limparEstado(admin: Admin, conversationId: string) {
  await salvarEstado(admin, conversationId, {
    booking_state: null,
    booking_options: null,
    booking_unit_id: null,
    booking_modality: null,
    booking_patient_id: null,
    booking_replaces_id: null,
    booking_intake_id: null,
    booking_insurance: null,
  })
}

/** Se a clinica oferece telemedicina pelo robo, e o texto de informacoes dela. */
async function telemedicinaDaClinica(
  admin: Admin,
  clinicId: string,
): Promise<{ ativa: boolean; informacoes: string }> {
  const { data } = await admin
    .from('clinic_settings')
    .select('telemedicine_enabled,telemedicine_info_text')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  return {
    ativa: Boolean(data?.telemedicine_enabled),
    informacoes: (data?.telemedicine_info_text ?? '').trim(),
  }
}

/** Quantos dias a frente a agenda abre (clinic_settings.schedule_horizon_days). */
async function horizonteDaAgenda(admin: Admin, clinicId: string): Promise<number> {
  try {
    const { data, error } = await admin
      .from('clinic_settings')
      .select('schedule_horizon_days')
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (error) throw error
    const dias = Number((data as { schedule_horizon_days?: number } | null)?.schedule_horizon_days)
    return Number.isFinite(dias) && dias > 0 ? dias : 15
  } catch (erro) {
    console.warn('Nao consegui ler o horizonte da agenda; usando 15 dias', erro)
    return 15
  }
}

// ---------------------------------------------------------------
// Retorno incluido (26/10/2026, vindo do sistema do Dr. Marcello no mesmo dia)
// ---------------------------------------------------------------

/**
 * Onde o paciente esta no retorno incluido: aberto ate tal dia, usado, vencido.
 *
 * A regra: toda consulta da direito a UM retorno, no prazo que o medico
 * define no prontuario. Ate aqui o robo mostrava a agenda inteira para todo
 * mundo, e quem vinha para o retorno escolhia uma data depois do prazo sem
 * saber (no Dr. Marcello, uma familia marcou 25/11 e a equipe teve de
 * explicar depois). A conta mora em prazo-do-retorno.ts, a mesma da tela.
 *
 * Falha na leitura devolve nulo: o paciente ve a agenda de sempre, como antes,
 * e o log diz por que.
 */
async function retornoDoPaciente(admin: Admin, clinicId: string, patientId: string, agora: Date): Promise<SituacaoDoRetorno | null> {
  try {
    const { data: agenda, error } = await admin
      .from('appointments')
      .select('starts_at,status')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .not('status', 'in', '(cancelled,no_show)')
      .lt('starts_at', agora.toISOString())
      .order('starts_at', { ascending: false })
      .limit(60)
    if (error) throw error
    const fichas = await fichasDoRetorno(admin, clinicId, patientId)
    return situacaoDoRetorno(
      visitasDoBanco(fichas, (agenda ?? []) as { starts_at: string }[]),
      agora.toLocaleDateString('en-CA', { timeZone: EXPEDIENTE.fuso }),
    )
  } catch (erro) {
    console.warn('Nao consegui ver o retorno do paciente; mostrando a agenda de sempre', { patientId, erro })
    return null
  }
}

/**
 * Os atendimentos do prontuario. Sem as colunas de 26/10/2026 o Postgres
 * recusa o SELECT inteiro; aqui isso basta, porque sem marcacao no prontuario
 * o robo nao afirma retorno nenhum: o erro sobe, retornoDoPaciente avisa no
 * log e o paciente ve a agenda de sempre.
 */
async function fichasDoRetorno(admin: Admin, clinicId: string, patientId: string): Promise<FichaDoBanco[]> {
  const { data, error } = await admin
    .from('consultations')
    .select('consultation_date,visita,retorno_ate')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .is('archived_at', null)
  if (error) throw error
  return (data ?? []) as unknown as FichaDoBanco[]
}

type RetornoAberto = {
  /** Ultimo dia do retorno (AAAA-MM-DD). */
  ate: string
  /** Dia da consulta que deu direito a ele. */
  consulta: string
  /** Primeiro nome do paciente, para a mensagem. */
  nome: string
}

/**
 * O retorno do paciente desta marcacao: em aberto (para as datas) ou, ja usado
 * ou vencido, a frase que diz que e consulta. Os dois vazios: paciente novo,
 * nada confirmado no prontuario, ou leitura que falhou.
 */
async function retornoDaConversa(
  admin: Admin,
  clinicId: string,
  conversationId: string,
): Promise<{ aberto: RetornoAberto | null; fechado: string }> {
  try {
    const { data, error } = await admin
      .from('whatsapp_conversations')
      .select('booking_patient_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (error) throw error
    const patientId = (data as { booking_patient_id?: string | null } | null)?.booking_patient_id ?? null
    if (!patientId || patientId === OUTRA_CRIANCA) return { aberto: null, fechado: '' }
    const situacao = await retornoDoPaciente(admin, clinicId, patientId, relogioEmFoco ?? new Date())
    return {
      aberto: await retornoAbertoDaSituacao(admin, patientId, situacao),
      fechado: retornoFechadoEmTexto(situacao),
    }
  } catch (erro) {
    console.warn('Nao consegui ler o paciente da marcacao; mostrando a agenda de sempre', erro)
    return { aberto: null, fechado: '' }
  }
}

/** O paciente desta marcacao tem retorno em aberto? Nulo: nao (ou paciente novo). */
async function retornoEmAberto(admin: Admin, clinicId: string, conversationId: string): Promise<RetornoAberto | null> {
  return (await retornoDaConversa(admin, clinicId, conversationId)).aberto
}

/**
 * O retorno ja usado, vencido ou dispensado, confirmado no prontuario, em uma
 * frase para o paciente. Vazio no resto: o deduzido nao vira frase.
 */
function retornoFechadoEmTexto(situacao: SituacaoDoRetorno | null): string {
  if (!situacao?.confirmado) return ''
  if (situacao.tipo === 'usado') {
    return `O retorno da consulta de ${diaCurto(situacao.consulta)} já foi feito em ${diaCurto(situacao.usadoEm)}, então esta marcação é uma *consulta*.`
  }
  if (situacao.tipo === 'vencido') {
    return `O prazo do retorno da consulta de ${diaCurto(situacao.consulta)} terminou em ${diaCurto(situacao.ate)}, então esta marcação é uma *consulta*.`
  }
  if (situacao.tipo === 'sem') return 'Pelo prontuário, esta marcação é uma *consulta*.'
  return ''
}

async function retornoAbertoDoPaciente(admin: Admin, clinicId: string, patientId: string, agora: Date): Promise<RetornoAberto | null> {
  return await retornoAbertoDaSituacao(admin, patientId, await retornoDoPaciente(admin, clinicId, patientId, agora))
}

async function retornoAbertoDaSituacao(admin: Admin, patientId: string, situacao: SituacaoDoRetorno | null): Promise<RetornoAberto | null> {
  // So o confirmado no prontuario: o deduzido pode estar errado, e o robo
  // prometeria retorno incluido a quem deve consulta (ver situacaoDoRetorno).
  if (situacao?.tipo !== 'aberto' || !situacao.confirmado) return null
  let nome = ''
  try {
    const { data } = await admin.from('patients').select('name').eq('id', patientId).maybeSingle()
    nome = String((data as { name?: string | null } | null)?.name ?? '').trim().split(/\s+/)[0] ?? ''
  } catch (erro) {
    console.warn('Retorno em aberto, mas sem o nome do paciente', erro)
  }
  return { ate: situacao.ate, consulta: situacao.consulta, nome }
}

/** "16/10" */
function diaCurto(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/** " de Maria", ou nada sem nome. Sem asterisco: vai dentro de titulo em negrito. */
function doRetornoDe(retorno: RetornoAberto): string {
  return retorno.nome ? ` de ${retorno.nome}` : ''
}

/**
 * Data pedida depois do prazo do retorno (escrita por extenso). A lista so
 * mostra o que cabe no prazo; pedir outra data e excecao, e excecao e da
 * equipe (o medico decide, como no retorno que espera exame).
 */
function foraDoPrazoDoRetorno(retorno: RetornoAberto): Resultado {
  return {
    resposta:
      `Essa data passa do prazo do retorno${doRetornoDe(retorno)}, que vai até *${diaCurto(retorno.ate)}*.\n\n` +
      'Escolha uma das datas da lista acima, ou digite *9* que a nossa equipe vê com você uma data depois do prazo.',
    botoes: [
      { id: '9', titulo: 'Falar com a equipe' },
      { id: '0', titulo: 'Voltar ao menu' },
    ],
  }
}

/**
 * O dia escrito ("28/10", "dia 28"), como AAAA-MM-DD, no proximo que ainda
 * vem (26/10/2026). Serve para comparar com o prazo do retorno: o robo daqui
 * le a data escrita contra a lista, e a lista do retorno so vai ate o prazo.
 * Nulo quando o texto nao tem data. "Dia 9h" e hora, e fica de fora.
 */
function diaEscritoAdiante(texto: string, agora: Date): string | null {
  const hoje = agora.toLocaleDateString('en-CA', { timeZone: EXPEDIENTE.fuso })
  const [ano, mesDeHoje, diaDeHoje] = hoje.split('-').map(Number)
  const escrita = dataEscrita(texto)
  const soDia = escrita ? null : normalizar(texto).match(/\bdia\s+(\d{1,2})\b(?!\s*(?:h\b|hs\b|horas|:))/)
  if (!escrita && !soDia) return null
  const dia = escrita ? escrita.dia : Number(soDia![1])
  if (dia < 1 || dia > 31) return null
  let mes = escrita ? escrita.mes : dia >= diaDeHoje ? mesDeHoje : mesDeHoje + 1
  let anoDoDia = ano
  if (mes > 12) {
    mes = 1
    anoDoDia++
  }
  const chave = (a: number) => `${a}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  return chave(anoDoDia) < hoje ? chave(anoDoDia + 1) : chave(anoDoDia)
}

/**
 * A data escrita passa do prazo do retorno em aberto? Devolve a explicacao (ou
 * a equipe, na insistencia); nulo quando nao passa, nao tem data ou nao ha
 * retorno em aberto.
 */
async function dataDepoisDoPrazo(admin: Admin, clinicId: string, conversationId: string, texto: string, agora: Date): Promise<Resultado | null> {
  const escrito = diaEscritoAdiante(texto, agora)
  if (!escrito) return null
  const retorno = await retornoEmAberto(admin, clinicId, conversationId)
  if (!retorno || escrito <= retorno.ate) return null
  return await explicarOuPassarORetorno(admin, clinicId, conversationId, foraDoPrazoDoRetorno(retorno))
}

/** Trechos das explicacoes do prazo do retorno: e por eles que se contam. */
const EXPLICACOES_DO_RETORNO = ['passa do prazo do retorno', 'marcação é uma *consulta*']

/** Quantas vezes o robo explicou o prazo do retorno nesta conversa, em 24 horas. */
async function vezesQueExplicouORetorno(admin: Admin, conversationId: string): Promise<number> {
  try {
    const desde = new Date((relogioEmFoco ?? new Date()).getTime() - 24 * 3600 * 1000).toISOString()
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select('body')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) throw error
    return ((data ?? []) as { body?: string | null }[]).filter((m) =>
      EXPLICACOES_DO_RETORNO.some((trecho) => String(m.body ?? '').includes(trecho)),
    ).length
  } catch (erro) {
    console.warn('Nao consegui contar as explicacoes do retorno', erro)
    return 0
  }
}

/**
 * Explica o prazo do retorno, ou passa para a equipe (26/10/2026).
 *
 * Pedido do Edu: "quando cliente insistir no retorno, para nao ficar chato",
 * depois de o robo explicar duas vezes, ele diz que a equipe vai avaliar, e a
 * conversa ganha a etiqueta laranja "Retorno". Retorno fora da regra e
 * excecao, e excecao quem decide e o medico - repetir a mesma recusa uma
 * terceira vez so irrita quem ja entendeu e discorda.
 */
async function explicarOuPassarORetorno(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  explicacao: Resultado,
): Promise<Resultado> {
  if ((await vezesQueExplicouORetorno(admin, conversationId)) < 2) return explicacao
  registrar('retorno_para_equipe')
  await chamarEquipe(admin, conversationId)
  return {
    resposta:
      `Entendi. Vou passar o seu pedido de retorno para a nossa equipe avaliar com ${quemAtende(clinicId).o}, e ela responde por aqui. 💙\n\n` +
      avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' + VOLTA,
    atencao: 'retorno',
  }
}

/**
 * Pediu retorno (26/10/2026)? "aguardo retorno" e "retorno sua mensagem" nao
 * contam: e resposta, nao pedido de consulta.
 */
export function pediuRetorno(texto: string | null | undefined): boolean {
  const t = normalizar(String(texto ?? ''))
  if (!/\bretorno\b/.test(t)) return false
  return !/\b(aguardo|aguardando|espero|esperando|sem|tenho|tive|deem|der|dar) (o |um |seu |algum |uma )?retorno\b|\bretorno (sua|seu|a|o) (mensagem|contato|ligacao)\b|\bretorno (depois|mais tarde|em breve|assim que)\b/.test(t)
}

/** A mensagem de agora, ou uma das ultimas do paciente, pede retorno? */
async function falouEmRetorno(admin: Admin, conversationId: string): Promise<boolean> {
  if (textoEmFoco?.conversa === conversationId && pediuRetorno(textoEmFoco.texto)) return true
  try {
    const desde = new Date((relogioEmFoco ?? new Date()).getTime() - 2 * 3600 * 1000).toISOString()
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select('body,direction')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) throw error
    return ((data ?? []) as { body?: string | null; direction?: string }[]).some(
      (m) => m.direction === 'inbound' && pediuRetorno(m.body),
    )
  } catch (erro) {
    console.warn('Nao consegui ler as ultimas mensagens para saber se e retorno', erro)
    return false
  }
}

/**
 * A clinica ja marca consulta e retorno no prontuario? (26/10/2026)
 *
 * Diferenca do Dr. Fabio para o Dr. Marcello: aqui os pacientes de antes do
 * sistema estao no ISA, e nao no banco. Ate o medico comecar a marcar consulta
 * e retorno, nenhum cadastro tem prazo confirmado, e perguntar nome e
 * nascimento a quem pede retorno so faria a pessoa ouvir "Nao achei esse
 * cadastro" duas vezes antes das datas. Falha na leitura: nao pergunta.
 */
async function clinicaMarcaORetorno(admin: Admin, clinicId: string): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from('consultations')
      .select('id')
      .eq('clinic_id', clinicId)
      .not('visita', 'is', null)
      .limit(1)
    if (error) throw error
    return (data ?? []).length > 0
  } catch (erro) {
    console.warn('Nao consegui ver se a clinica marca o retorno; seguindo sem procurar o cadastro', erro)
    return false
  }
}

const BOTOES_DO_CADASTRO_DO_RETORNO = [
  { id: 'NOVA', titulo: 'Consulta nova' },
  { id: '0', titulo: 'Voltar ao menu' },
]

/** "do paciente" no perfil geral, "da criança" na pediatria. */
function doPacienteDoRetorno(): string {
  return geral() ? 'do paciente' : 'da criança'
}

/** O exemplo de nome e nascimento: de adulto no perfil geral. */
function exemploDeCadastro(): string {
  return geral() ? 'Maria Clara Souza, 12/03/1985' : 'Maria Clara Souza, 12/03/2019'
}

/**
 * Retorno pedido de um telefone que nao tem o paciente (26/10/2026).
 *
 * Pedido do Edu: quem cadastrou foi outra pessoa (o filho marca para a mae, a
 * esposa para o marido) ou o paciente trocou de numero. Sem achar o paciente o
 * robo nao sabe o prazo do retorno, e mostraria a agenda inteira como para
 * uma consulta nova. Nome e nascimento e o que o cadastro automatico ja usa
 * para reconhecer a mesma pessoa (ver mesmaCrianca); o CPF, quando preferir.
 */
async function perguntarPacienteDoRetorno(admin: Admin, conversationId: string, outraPessoa: boolean): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'aguardando_crianca_do_retorno',
    booking_options: null,
    booking_unit_id: null,
    booking_patient_id: outraPessoa ? OUTRA_CRIANCA : null,
  })
  return {
    resposta:
      `🔎 Para achar o cadastro e ver o prazo do retorno, me mande o *nome completo* e a *data de nascimento* ${doPacienteDoRetorno()} (ou o *CPF*).\n\n` +
      `Exemplo: ${exemploDeCadastro()}\n\n` +
      'Se for uma consulta nova, toque em *Consulta nova*.',
    botoes: BOTOES_DO_CADASTRO_DO_RETORNO,
  }
}

/**
 * O paciente pelo CPF, ou pelo nome com a data de nascimento. 'sem_dados'
 * quando a mensagem nao traz nem um nem outro; nulo quando nao acha (ou acha
 * mais de um: adivinhar entre dois e pior do que perguntar).
 */
async function acharPacienteDoRetorno(
  admin: Admin,
  clinicId: string,
  texto: string,
): Promise<{ id: string; name: string } | null | 'sem_dados'> {
  const cpf = (texto.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/)?.[0] ?? '').replace(/\D/g, '')
  if (cpf.length === 11) {
    const { data, error } = await admin
      .from('patients')
      .select('id,name')
      .eq('clinic_id', clinicId)
      .eq('cpf', cpf)
      .is('archived_at', null)
      .limit(2)
    if (error) throw error
    const achados = (data ?? []) as { id: string; name: string }[]
    return achados.length === 1 ? achados[0] : null
  }
  const dataNoTexto = texto.match(/\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\b/)?.[0] ?? ''
  const nascimento = dataNoTexto
    ? dataDeNascimentoIso(dataNoTexto.replace(/\s/g, ''), relogioEmFoco ?? new Date(), { adulto: geral() })
    : null
  const nome = texto
    .replace(dataNoTexto, ' ')
    .replace(/\b(nascid[ao]|nasceu|nascimento|data de nascimento|nome|dia|em)\b/gi, ' ')
    .replace(/[^A-Za-zÀ-ÿ\s]/g, ' ')
    .trim()
  if (!nascimento || nome.length < 2) return 'sem_dados'
  const { data, error } = await admin
    .from('patients')
    .select('id,name')
    .eq('clinic_id', clinicId)
    .eq('birth_date', nascimento)
    .is('archived_at', null)
    .limit(20)
  if (error) throw error
  const achados = ((data ?? []) as { id: string; name: string }[]).filter((p) => mesmaCrianca(p.name, nome))
  return achados.length === 1 ? achados[0] : null
}

/** O paciente achado por nome e nascimento: nao e deste telefone, vem do banco. */
async function pacientePorId(admin: Admin, clinicId: string, id: string): Promise<Paciente | null> {
  try {
    const { data, error } = await admin
      .from('patients')
      .select('id,name,birth_date,guardian_name,cpf,email')
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .is('archived_at', null)
      .maybeSingle()
    if (error) throw error
    const p = data as Record<string, string | null> | null
    if (!p?.id) return null
    return {
      id: p.id,
      name: p.name ?? '',
      nascimento: p.birth_date ?? null,
      responsavel: p.guardian_name ?? null,
      cpf: p.cpf ?? null,
      email: p.email ?? null,
    }
  } catch (erro) {
    console.warn('Nao consegui ler o paciente escolhido para a consulta', erro)
    return null
  }
}

const NUMERO_POR_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
}

/**
 * Pedido de retorno para alem do que a agenda mostra (05/10/2026).
 *
 * O Igor respondeu ao acompanhamento "Dr. pediu para agendar retorno em 3
 * meses. Gostaria de deixar agendado". O robo abriu a agenda - que so mostra
 * 15 dias - e ele desistiu sem marcar e sem ninguem saber.
 *
 * So conta com marca de prazo ("em 3 meses", "daqui a 2 meses", "dentro de 6
 * semanas"): "meu filho tem 6 meses, quero marcar" fala da idade, nao do
 * retorno, e precisa da agenda de sempre.
 */
export function retornoAlemDaAgenda(
  texto: string,
  horizonteDias: number,
  agora = new Date(),
): { dias: number; mes: string } | null {
  const t = normalizar(texto)
  // "inclui retorno em 30 dias ne? nao vou pagar de novo?" (14/10/2026, segunda
  // rodada do painel): "em 30 dias" ali e a regra do retorno, nao uma data
  // pedida. O robo anotou "retorno para novembro" duas vezes para a mae que so
  // queria saber se pagava, e a pergunta dela ficou sem resposta. Quem fala de
  // preco ou de direito ao retorno pergunta; nao pede data.
  if (/\b(inclu\w*|cobr\w*|pag(a|ar|o|ou|amos|ando|amento)|gratis|gratuito|custa\w*|preco|direito)\b/.test(t)) return null
  // "daqui uns 40 dias", "em cerca de 2 meses" (14/10/2026): no painel, "voltar
  // daqui uns 40 dias, mais ou menos no fim de novembro" abriu a agenda de 15
  // dias - o "uns" e os "dias" nao eram lidos.
  const m = t.match(
    /(?:\bem|\bdaqui a|\bdaqui|\bdentro de|\bapos|\bdepois de|\bpara daqui a)\s+(?:uns |umas |cerca de |mais ou menos |aproximadamente |uns? )?(\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+(dias|mes|meses|semana|semanas|ano|anos)\b/,
  )
  let dias = 0
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMERO_POR_EXTENSO[m[1]]
    const porUnidade = m[2] === 'dias' ? 1 : m[2].startsWith('mes') ? 30 : m[2].startsWith('semana') ? 7 : 365
    dias = n * porUnidade
  } else {
    // O mes pelo nome: "dia 25 de novembro", "fim de novembro", "em dezembro".
    const nomes = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
    const doMes = new RegExp(`(?:\\b(\\d{1,2})\\s+de\\s+|\\b(fim|final|inicio|comeco|meio|meados)\\s+de\\s+|\\b(?:em|pra|para|no mes de)\\s+)(${nomes.join('|')})\\b`).exec(t)
    if (!doMes) return null
    const mesAlvo = nomes.indexOf(doMes[3])
    const dia = doMes[1] ? Number(doMes[1]) : doMes[2] ? ({ fim: 25, final: 25, inicio: 5, comeco: 5, meio: 15, meados: 15 } as Record<string, number>)[doMes[2]] : 15
    const hoje = new Date(agora.getTime() - 3 * 3600 * 1000)
    let ano = hoje.getUTCFullYear()
    if (mesAlvo < hoje.getUTCMonth()) ano += 1
    const alvoData = Date.UTC(ano, mesAlvo, Math.min(Math.max(dia, 1), 28))
    dias = Math.round((alvoData - Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())) / 86400000)
  }
  if (!dias || dias <= horizonteDias) return null
  const alvo = new Date(agora.getTime() + dias * 86400000)
  const mes = alvo.toLocaleDateString('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' })
  return { dias, mes }
}

/** Resposta ao retorno distante: explica a agenda e passa o pedido para a equipe. */
async function pedirRetornoDistante(
  admin: Admin,
  conversationId: string,
  pedido: { dias: number; mes: string },
  horizonteDias: number,
  jaNaFila: boolean,
): Promise<Resultado> {
  registrar('retorno_distante', String(pedido.dias))
  const texto =
    `🗓️ Anotei seu pedido de retorno para *${pedido.mes}*.\n\n` +
    `Nossa agenda abre só ${horizonteDias} dias à frente, então esse horário a nossa equipe ` +
    'reserva para você e confirma a data por aqui.\n\n' +
    avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' + VOLTA
  // Na fila da equipe ja: so responde, sem mexer no estado.
  if (jaNaFila) return { resposta: texto, atencao: 'atendente' }
  const chamada = await chamarEquipe(admin, conversationId)
  return { ...chamada, resposta: texto }
}

/**
 * A unidade pelo id, incluindo a virtual da telemedicina.
 *
 * Todo lugar que precisava reler a unidade do banco passa por aqui, para a
 * telemedicina nao virar "unidade nao encontrada" no meio do fluxo.
 */
/**
 * As colunas da unidade, e o plano B quando uma delas ainda nao existe.
 *
 * A funcao, o frontend e as migrations sobem por caminhos diferentes, e a
 * funcao costuma chegar primeiro. Quando ela pede uma coluna que o banco ainda
 * nao tem, o Postgres NAO ignora a coluna desconhecida: recusa a consulta
 * INTEIRA e devolve nulo.
 *
 * Em 19/09/2026 isso derrubou o atendimento sem parecer erro: sem unidades, a
 * opcao 1 nao tinha o que mostrar e devolvia o menu. O paciente digitava 1,
 * recebia o menu, digitava 1 de novo, recebia o menu.
 *
 * Entao toda coluna nova entra com um plano B: tenta com ela, e se falhar
 * refaz sem. A unidade volta sem convenio - que e o mesmo que "so particular",
 * o estado anterior do mundo - e o atendimento segue de pe.
 */
const COLUNAS_DA_UNIDADE = 'id,name,address,info_text,accepts_insurance'
const COLUNAS_ANTIGAS_DA_UNIDADE = 'id,name,address,info_text'

async function unidadePorId(admin: Admin, id: string): Promise<Unidade | null> {
  if (id === TELE_ID) return UNIDADE_TELE
  const { data, error } = await admin
    .from('clinic_units')
    .select(COLUNAS_DA_UNIDADE)
    .eq('id', id)
    .maybeSingle()
  if (!error && data) return data as Unidade

  const { data: basico } = await admin
    .from('clinic_units')
    .select(COLUNAS_ANTIGAS_DA_UNIDADE)
    .eq('id', id)
    .maybeSingle()
  return (basico as Unidade | null) ?? null
}

/**
 * A agenda propria da telemedicina (03/10/2026), quando a clinica tem uma.
 *
 * Ate esta data a telemedicina usava os horarios das unidades fisicas e a
 * consulta ficava gravada numa delas - na Agenda, misturada com as presenciais,
 * e ninguem achava. Agora e uma unidade marcada com telemedicina = true.
 *
 * Coluna nova, entao consulta propria e try/catch: sem ela, o robo segue como
 * antes (horarios das fisicas), em vez de perder a lista de unidades inteira.
 * O filtro e feito aqui, e nao no banco, pelo mesmo motivo.
 */
async function agendaDaTelemedicina(admin: Admin, clinicId: string): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from('clinic_units')
      .select('id,telemedicina')
      .eq('clinic_id', clinicId)
      .is('archived_at', null)
    if (error) throw error
    const tele = ((data ?? []) as { id: string; telemedicina?: boolean | null }[]).find((u) => u.telemedicina === true)
    return tele?.id ?? null
  } catch (erro) {
    console.warn('Sem a coluna clinic_units.telemedicina; telemedicina segue nos horarios das unidades fisicas', erro)
    return null
  }
}

/**
 * A agenda da telemedicina ja tem horarios cadastrados?
 *
 * Sem horario nenhum (a clinica ainda nao configurou), o robo continua
 * oferecendo os horarios das unidades fisicas - o que ja fazia - mas grava na
 * agenda da telemedicina. Com horarios, so eles valem. Na duvida (falha ao
 * ler), vale a agenda propria: oferecer um horario fora do combinado com o
 * medico e pior do que dizer que nao ha vaga e chamar a equipe.
 */
async function telemedicinaTemHorarios(admin: Admin, teleId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from('availability_rules').select('id').eq('unit_id', teleId).limit(1)
    if (error) throw error
    return (data ?? []).length > 0
  } catch (erro) {
    console.warn('Nao consegui ler os horarios da agenda de telemedicina; usando so ela', erro)
    return true
  }
}

async function unidadesAtivas(admin: Admin, clinicId: string) {
  // A agenda da telemedicina e uma unidade no banco, mas nao e lugar: nao
  // aparece em "Em qual unidade?" nem nas informacoes por unidade. A
  // telemedicina entra como opcao propria (UNIDADE_TELE), como sempre entrou.
  const teleId = await agendaDaTelemedicina(admin, clinicId)
  const semTele = (lista: Unidade[]) => lista.filter((u) => u.id !== teleId)

  const { data, error } = await admin
    .from('clinic_units')
    .select(COLUNAS_DA_UNIDADE)
    .eq('clinic_id', clinicId)
    .is('archived_at', null)
    .order('name')
  if (!error && data) return semTele(data as Unidade[])

  console.warn('clinic_units sem accepts_insurance; seguindo so com particular', error)
  const { data: basico } = await admin
    .from('clinic_units')
    .select(COLUNAS_ANTIGAS_DA_UNIDADE)
    .eq('clinic_id', clinicId)
    .is('archived_at', null)
    .order('name')
  return semTele((basico ?? []) as Unidade[])
}

/** As unidades fisicas e, quando a clinica oferece, a telemedicina no fim. */
async function opcoesDeAtendimento(admin: Admin, clinicId: string): Promise<Unidade[]> {
  const unidades = await unidadesAtivas(admin, clinicId)
  const tele = await telemedicinaDaClinica(admin, clinicId)
  return tele.ativa && unidades.length > 0 ? [...unidades, UNIDADE_TELE] : unidades
}

/**
 * Valor da consulta de cada unidade (coluna nova, 14/10/2026).
 *
 * Consulta propria e try/catch, como toda coluna recente: sem ela, quem perde
 * e so o {valor} (a linha cai e o painel acusa), e nao a lista de unidades -
 * que e o que derrubou a opcao 1 em 19/09.
 */
async function valoresDasUnidades(admin: Admin, clinicId: string): Promise<Map<string, number>> {
  try {
    const { data, error } = await admin.from('clinic_units').select('id,price_cents').eq('clinic_id', clinicId)
    if (error) throw error
    const valores = new Map<string, number>()
    for (const u of (data ?? []) as { id: string; price_cents?: number | null }[]) {
      if (u.price_cents) valores.set(u.id, u.price_cents)
    }
    return valores
  } catch (erro) {
    console.warn('Sem clinic_units.price_cents; os campos {valor} ficam sem preencher', erro)
    return new Map()
  }
}

async function valorDaTelemedicina(admin: Admin, clinicId: string): Promise<number | null> {
  try {
    const { data, error } = await admin
      .from('clinic_settings')
      .select('telemedicine_price_cents')
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (error) throw error
    return (data as { telemedicine_price_cents?: number | null } | null)?.telemedicine_price_cents || null
  } catch (erro) {
    console.warn('Sem clinic_settings.telemedicine_price_cents; o {valor} da telemedicina fica sem preencher', erro)
    return null
  }
}

/** Os atendimentos que o robo oferece, com valor e endereco, para os campos. */
async function lugaresComValor(admin: Admin, clinicId: string): Promise<Lugar[]> {
  const [lugares, valores, tele] = await Promise.all([
    opcoesDeAtendimento(admin, clinicId),
    valoresDasUnidades(admin, clinicId),
    valorDaTelemedicina(admin, clinicId),
  ])
  return lugares.map((u) =>
    u.id === TELE_ID
      ? { id: u.id, nome: u.name, endereco: '', valorCentavos: tele, telemedicina: true }
      : { id: u.id, nome: u.name, endereco: u.address ?? '', valorCentavos: valores.get(u.id) ?? null },
  )
}

/**
 * Troca {valor}, {endereco}, {valores}... pelos dados de agora.
 *
 * So le o banco quando o texto tem campo: os textos antigos, com o valor
 * escrito a mao, passam direto e custam o mesmo de antes.
 *
 * Campo que nao deu para preencher NAO sai cru (a linha cai, ver
 * preencherCampos) e GRITA: aviso no log e evento 'campo_sem_valor', que
 * aparece em Numeros do WhatsApp. O lembrete parado tres semanas em silencio
 * ensinou que erro que ninguem ve e o pior que existe.
 */
async function comCampos(admin: Admin, clinicId: string, texto: string, lugarId: string | null): Promise<string> {
  if (!temCampo(texto)) return texto
  const lugares = await lugaresComValor(admin, clinicId)
  const lugar = lugarId ? (lugares.find((l) => l.id === lugarId) ?? null) : null
  const pronto = preencherCampos(texto, lugar, lugares)
  if (pronto.faltando.length > 0) {
    const detalhe = pronto.faltando.join('; ')
    console.warn(`Campo sem dado no texto do robo (${clinicId}): ${detalhe}`)
    registrar('campo_sem_valor', detalhe.slice(0, 120))
  }
  return pronto.texto
}

async function fusoDaClinica(admin: Admin, clinicId: string) {
  const { data } = await admin
    .from('clinics')
    .select('timezone')
    .eq('id', clinicId)
    .maybeSingle()
  return data?.timezone || 'America/Sao_Paulo'
}

/**
 * Horarios livres de uma unidade.
 *
 * Devolve `falhou` separado de "lista vazia" de proposito. Ate 30/08/2026 os
 * dois casos se confundiam e o paciente ouvia "nao temos horarios" quando na
 * verdade a consulta ao banco tinha sido recusada por permissao. Dizer que a
 * agenda esta vazia quando ela esta cheia e pior do que admitir a falha.
 */
/**
 * Dias de um pedido de horarios (AAAA-MM-DD). Nulo = a ponta de sempre: hoje
 * no inicio, a janela da clinica no fim. Ver available_slots_periodo.
 */
export type Periodo = { de: string | null; ate: string | null }

async function horariosLivres(
  admin: Admin,
  clinicId: string,
  unitId: string,
  /**
   * So quando a equipe manda horarios de uma data combinada (14/10/2026), ou
   * quando o dia escolhido esta alem da agenda aberta. Sem periodo, a agenda
   * aberta de sempre.
   */
  periodo?: Periodo,
): Promise<{ horarios: Horario[]; falhou: boolean }> {
  // Telemedicina. Cada horario lembra em que agenda a consulta vai ser gravada.
  if (unitId === TELE_ID) {
    const teleId = await agendaDaTelemedicina(admin, clinicId)

    // Agenda propria com horarios (03/10/2026): so ela vale.
    if (teleId && (await telemedicinaTemHorarios(admin, teleId))) {
      const propria = await horariosLivres(admin, clinicId, teleId, periodo)
      return { ...propria, horarios: propria.horarios.map((h) => ({ ...h, unitId: teleId })) }
    }

    // Sem horarios proprios: os das unidades fisicas, juntos e em ordem, como
    // era antes. O banco ja tira deles os horarios ocupados por video
    // (available_slots cruza as agendas). Havendo agenda da telemedicina, a
    // consulta vai para ela; sem, para a unidade que cedeu o horario.
    const fisicas = await unidadesAtivas(admin, clinicId)
    const partes = await Promise.all(fisicas.map((u) => horariosLivres(admin, clinicId, u.id, periodo)))
    if (partes.length > 0 && partes.every((p) => p.falhou)) return { horarios: [], falhou: true }
    const juntos = partes
      .flatMap((p, i) => p.horarios.map((h) => ({ ...h, unitId: teleId ?? fisicas[i].id })))
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
    // Duas fisicas no mesmo horario viram um horario so de video.
    const semRepetir = juntos.filter((h, i) => i === 0 || h.inicio !== juntos[i - 1].inicio)
    return { horarios: teleId ? semRepetir : juntos, falhou: false }
  }

  // Libera reservas vencidas antes de listar: sem isso o horario aparece livre
  // aqui e a marcacao falha depois, no indice unico.
  const { error: erroFaxina } = await admin.rpc('liberar_reservas_vencidas')
  if (erroFaxina) console.error('liberar_reservas_vencidas falhou', erroFaxina)

  let { data, error } = periodo
    ? await admin.rpc('available_slots_periodo', { p_unit_id: unitId, p_de: periodo.de, p_ate: periodo.ate })
    : await admin.rpc('available_slots', { p_unit_id: unitId })
  // Funcao nova (14/10/2026) que o banco ainda nao tem: cai na agenda aberta
  // e corta o periodo aqui. Perde-se so o que passa da janela da clinica, e o
  // log diz por que.
  if (periodo && error && /available_slots_periodo|PGRST202|42883/.test(`${error.code ?? ''} ${error.message ?? ''}`)) {
    console.warn('Sem available_slots_periodo no banco; usando a agenda aberta', error)
    const timezone = await fusoDaClinica(admin, clinicId)
    const aberta = await admin.rpc('available_slots', { p_unit_id: unitId })
    error = aberta.error
    data = ((aberta.data ?? []) as { slot_start: string; slot_end: string }[]).filter((h) => {
      const dia = chaveDoDia(h.slot_start, timezone)
      return (!periodo.de || dia >= periodo.de) && (!periodo.ate || dia <= periodo.ate)
    })
  }
  if (error) {
    console.error('available_slots falhou', { unitId, periodo, error })
    return { horarios: [], falhou: true }
  }

  // Sem corte aqui: quem decide quanto mostrar e a etapa (dias ou horarios do
  // dia). Cortar na origem foi o que escondeu cinco dias de agenda.
  const lista = ((data ?? []) as { slot_start: string; slot_end: string }[]).map((h) => ({
    inicio: h.slot_start,
    fim: h.slot_end,
  }))
  return { horarios: lista, falhou: false }
}

const AVISO_FALHA =
  'Tive um problema para consultar a agenda agora. Já avisei a nossa equipe, ' +
  'que retorna por aqui para marcar com você.\n\n' + VOLTA

// ---------------------------------------------------------------
// Menu principal
// ---------------------------------------------------------------

export async function mostrarMenu(
  admin: Admin,
  conversationId: string,
  saudacao: string,
  aviso = '',
): Promise<Resultado> {
  // Foca aqui tambem, e nao so em tratarConversa, porque o webhook chama o
  // menu por fora em alguns caminhos (primeira mensagem, destravar).
  focar(conversationId)
  registrar('menu_enviado')
  await salvarEstado(admin, conversationId, {
    booking_state: 'menu',
    booking_options: null,
    booking_unit_id: null,
    menu_sent_at: new Date().toISOString(),
  })

  // Com aviso, o aviso ja e a instrucao. Repetir "Como podemos ajudar?" logo
  // depois de "Nao entendi, responda com o numero" dava duas ordens seguidas.
  // Com uma crianca so no telefone, o nome dela, sem artigo (o robo nao sabe
  // se e menina ou menino): "cuidar do seu filho" saia ate para a Helena.
  const crianca = criancaEmFoco?.conversa === conversationId ? criancaEmFoco.nome : ''
  // No perfil 'geral' (Dr. Fabio) quem le e o proprio paciente, e a frase e a
  // da Dayane, que ja abria assim as conversas dela (15/10/2026).
  const convite = geral()
    ? 'Estamos à disposição para ajudar com informações, agendamentos e dúvidas. Como podemos ajudar hoje?'
    : `Estamos aqui para cuidar ${crianca ? `de ${crianca}` : 'do seu filho'}. Como podemos ajudar hoje?`
  const cabecalho = aviso || `${saudacao}\n\n${convite}`
  // A instrucao vai DEPOIS das opcoes de proposito: quem ja sabe o que quer
  // responde na hora, e quem hesitou tem a saida logo abaixo do que leu.
  const instrucao = aviso ? '' : '\n\nResponda com o número ou toque em "Ver opções".'
  return {
    resposta: `${cabecalho}\n\n${OPCOES}${instrucao}`,
    lista: {
      rotulo: 'Ver opções',
      linhas: [
        { id: '1', titulo: 'Dúvidas sobre a consulta', descricao: 'Valores, contatos e orientações' },
        { id: '2', titulo: 'Marcar uma consulta', descricao: 'Consulta nova ou retorno · unidade, dia e horário' },
        { id: '3', titulo: 'Falar com a equipe', descricao: 'Alguém do consultório responde' },
        { id: '4', titulo: 'Minha consulta', descricao: 'Ver, remarcar ou cancelar' },
        // 24 caracteres e o teto do titulo; "2ª via ou exame" cabe e diz o
        // essencial, com o resto na descricao.
        { id: '5', titulo: '2ª via ou exame', descricao: 'Receita ou pedido de exame já feito' },
      ],
    },
  }
}

/**
 * Responder uma pergunta escrita, quando a clinica tem resposta pronta para ela.
 *
 * Vem antes do menu: quem escreveu "quanto custa a consulta?" fez uma pergunta,
 * e devolver uma lista de opcoes e fingir que a pergunta nao existiu. Se nenhum
 * assunto cadastrado bate - ou se a mensagem e clinica - devolve nulo e o menu
 * segue como sempre.
 *
 * Termina em 'menu' para os numeros continuarem valendo: quem acabou de ler o
 * valor da consulta e exatamente quem pode responder "2" para marcar.
 */
/**
 * A mesma resposta pronta ja saiu nesta conversa ha pouco? (14/10/2026)
 *
 * A Viviane recebeu o texto de convenios duas vezes em dois minutos: na
 * pergunta e, de novo, na despedida ("ok obrigada, vou tentar achar pelo
 * convenio, se nao conseguir volto pra marcar"), que tambem dizia "convenio".
 * O texto repetido logo abaixo do primeiro parece que o robo nao leu nada.
 *
 * Compara o comeco do texto pronto (sem as linhas com campo, que saem
 * preenchidas) com o que o robo mandou na ultima meia hora. Falha ao ler
 * vale como "nao saiu": melhor repetir do que calar.
 */
const JANELA_SEM_REPETIR_MS = 30 * 60 * 1000

async function jaMandada(admin: Admin, conversationId: string, resposta: string): Promise<boolean> {
  const trecho = resposta
    .split('\n')
    .filter((linha) => !linha.includes('{'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  if (trecho.length < 20) return false
  try {
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select('body')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .eq('automatic', true)
      .gte('created_at', new Date((relogioEmFoco ?? new Date()).getTime() - JANELA_SEM_REPETIR_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) throw error
    return ((data ?? []) as { body?: string | null }[]).some((m) =>
      String(m.body ?? '').replace(/\s+/g, ' ').includes(trecho),
    )
  } catch (erro) {
    console.warn('Nao consegui conferir se a resposta pronta ja saiu; respondendo assim mesmo', erro)
    return false
  }
}

/**
 * Despedida com "volto depois" (14/10/2026): "Ok obrigada, vou tentar achar
 * pelo convenio, se nao conseguir volto pra marcar". Nao e pergunta nem
 * pedido de marcar agora - e a pessoa encerrando. Antes caia no "convenio" e
 * no "marcar" da frase e recebia convenios de novo e o botao da agenda.
 */
export function despedida(texto: string): boolean {
  // O "quando" de "fica pra quando eu for pra SP" nao faz da frase uma
  // pergunta (rodada 2 do painel): a despedida ficava sem resposta, na fila.
  if (parecePergunta(texto.replace(/\b(pra|para) quando\b.*$/i, ''))) return false
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const agradece = /\b(ok|okay|obrigad[oa]|obg|valeu|grat[oa]|beleza|blz|combinado|certo|entendi|agradeco)\b/.test(t)
  // "Fica pra quando eu for pra SP", "deixa pra depois" (16/10/2026, rodada 2
  // do painel): recebiam "Nao consegui entender" e iam para a fila.
  const depois =
    /\b(vou (tentar|ver|pensar|verificar|conversar|falar|olhar|analisar|decidir|avaliar|procurar|aguardar|esperar)|nao vai dar( pra mim)?|nao da pra mim|nao serve pra mim|nao vai rolar|volto (a falar|depois|mais tarde|pra|para|aqui|a entrar|a chamar)|retorno (depois|mais tarde|em breve)|(entro|entramos) em contato|qualquer coisa (eu )?(volto|chamo|falo|aviso|entro)|depois (eu )?(volto|chamo|falo|marco|vejo|aviso)|fica (pra|para) (depois|quando|outra|outro|a proxima)|(deixa|deixo|vou deixar) (pra|para) (depois|outra|outro|quando|a proxima)|quando eu (for|puder|voltar|tiver|estiver))\b/.test(t) ||
    // "nao quero marcar agora nao, so queria saber msm. obg" (25/10/2026,
    // rodada 5 do painel) recebeu duas vezes "Responda com o numero do convenio".
    /\b(nao (quero|vou|preciso) marcar (agora|ainda|por enquanto|hoje|nao)|so queria (saber|tirar|perguntar)|era so (pra|para) (saber|perguntar)|era so (uma )?duvida|so (uma )?duvida mesmo)\b/.test(t)
  return agradece && depois
}

const RESPOSTA_A_DESPEDIDA = '💙 Combinado! Quando quiser, é só escrever por aqui.'

/** Quantos "Nao entendi" o robo acabou de mandar, um atras do outro (30 min). */
async function naoEntendiSeguidos(admin: Admin, conversationId: string): Promise<number> {
  try {
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select('body')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .eq('automatic', true)
      .gte('created_at', new Date((relogioEmFoco ?? new Date()).getTime() - JANELA_SEM_REPETIR_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(3)
    if (error) throw error
    let seguidos = 0
    for (const m of (data ?? []) as { body?: string | null }[]) {
      if (!String(m.body ?? '').startsWith('Não entendi')) break
      seguidos += 1
    }
    return seguidos
  } catch (erro) {
    console.warn('Nao consegui contar os "Nao entendi" seguidos', erro)
    return 0
  }
}

/**
 * A duvida que veio junto do pedido de marcar (16/10/2026, painel de pacientes
 * simulados).
 *
 * "Oi precisa de encaminhamento do clinico pra passar ai pela unimed santos?
 * queria marcar tbm" abriu a agenda, e a pergunta do encaminhamento ficou sem
 * resposta; "o Dr. atende bebe? queria marcar mas nao sei se e cedo demais",
 * o mesmo. A resposta pronta vem em cima da agenda. Se ela e de assunto que a
 * equipe confirma, a conversa acende para a equipe sem sair do agendamento:
 * a pessoa continua marcando, e alguem responde a duvida.
 */
async function respostaJunto(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  texto: string,
): Promise<{ texto: string; chamarEquipe: boolean } | null> {
  if (!parecePergunta(texto) || assuntoClinico(texto)) return null
  // "Qualquer unidade, pode ser?" e "na unidade de Higienopolis, teria
  // terca?" (rodada 2 do painel) nao sao pergunta de endereco: traziam a lista
  // de enderecos em cima da agenda. A unidade ja vai na agenda.
  let duvida = texto.replace(/\b(em |na |de )?(qualquer|tanto faz( a)?) (unidade|uma|lugar)\b/gi, ' ')
  duvida = normalizar(duvida).replace(/\b(na |da |em |a )?unidades?( de| do| da)?\b/g, ' ')
  for (const u of await opcoesDeAtendimento(admin, clinicId)) {
    for (const palavra of normalizar(u.name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4)) {
      duvida = duvida.replace(new RegExp(`\\b${palavra}\\b`, 'g'), ' ')
    }
  }
  const achadas = respostasDaMensagem(duvida, await carregarRespostas(admin, clinicId))
  const novas: typeof achadas = []
  for (const a of achadas) if (!(await jaMandada(admin, conversationId, a.resposta))) novas.push(a)
  if (novas.length === 0) return null
  const chamarEquipe = novas.some((a) => a.chamarEquipe)
  return {
    texto:
      novas.map((a) => semConviteDoDois(a.resposta)).join('\n\n') +
      (chamarEquipe ? '\n\n🙋 Sobre a sua dúvida, a nossa equipe confirma por aqui. Enquanto isso, já dá para escolher o horário:' : ''),
    chamarEquipe,
  }
}

/**
 * A resposta pronta sem o convite do "digite 2" (16/10/2026, rodada 2 do
 * painel): no meio do agendamento, "Digite 2 para ver os horarios" saiu logo
 * acima da lista de unidades, em que o 2 e Santos. Ali a pessoa ja esta
 * marcando, e o convite so confunde.
 */
function semConviteDoDois(texto: string): string {
  return texto
    .replace(/\s*Para [^.\n]*,\s*digite \*2\*[^.\n]*\./g, '')
    .replace(/[:,]\s*digite \*2\*[^.\n]*\./gi, '.')
    .replace(/(^|\s)Digite \*2\*[^.\n]*\./g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A frase pede alguma coisa: pergunta, ou "me passa o endereco". */
function pareceDuvida(frase: string): boolean {
  return parecePergunta(frase) || /\b(me passa|me manda|manda|passa|quero saber|gostaria de saber|queria saber|me diz|me fala|me informa)\b/.test(normalizar(frase))
}

/**
 * As respostas prontas da mensagem: uma, ou duas quando ela traz duas duvidas
 * (16/10/2026, painel de pacientes simulados).
 *
 * "Quanto tempo dura a consulta? E o retorno e cobrado a parte?" recebia so
 * "Como e a consulta", e "da pra parar o carro no predio? me passa o endereco"
 * so os enderecos. A mensagem e lida frase por frase: duas frases que sao
 * duvida, cada uma com a sua resposta, recebem as duas. "Quanto custa em
 * Santos?" e uma pergunta so, e os enderecos embaixo do valor seriam ruido;
 * "Tenho Unimed. Preciso de guia?" tambem, porque a primeira frase conta, e
 * nao pergunta.
 */
function respostasDaMensagem(texto: string, prontas: RespostaPronta[]): RespostaPronta[] {
  const inteira = acharRespostas(texto, prontas, 1, 1)
  if (inteira.length === 0) return []
  const frases = (texto.replace(/\b(dr|dra|sr|sra)\./gi, '$1').match(/[^?!.\n]+[?!.\n]*/g) ?? [])
    .map((f) => f.trim())
    .filter((f) => f.split(/\s+/).length >= 2 && (f.endsWith('?') || pareceDuvida(f)))
  const porFrase: RespostaPronta[] = []
  for (const frase of frases) {
    // Empate com a resposta que outra frase ja trouxe (rodada 3 do painel):
    // "Qual e o endereco de Santos? E tem estacionamento no local?" casava
    // "local" com Enderecos, e o estacionamento ficava sem resposta. A
    // segunda candidata da frase entra no lugar.
    const candidatas = acharRespostas(frase, prontas, 1, 2)
    const daFrase = candidatas.find((r) => !porFrase.some((p) => p.id === r.id))
    if (daFrase) porFrase.push(daFrase)
  }
  if (porFrase.length >= 2) return porFrase.slice(0, 2)
  // Uma pergunta so, no meio de frases que contam a historia (rodada 2 do
  // painel): "Tenho desvio de septo. Meu plano e Porto Saude. A cirurgia de
  // septo e coberta pelo convenio?" recebeu Convenios, que somava mais
  // palavras na mensagem inteira. A pergunta manda: Cirurgia.
  if (frases.length === 1 && porFrase.length === 1) return porFrase
  return inteira
}

async function responderPergunta(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  texto: string,
  textoGeral: string,
): Promise<Resultado | null> {
  const prontas = await carregarRespostas(admin, clinicId)
  const [primeira, segunda] = respostasDaMensagem(texto, prontas)
  if (!primeira) return null
  // A segunda que acabou de sair nao volta; a primeira segue as regras de baixo.
  const outra = segunda && !(await jaMandada(admin, conversationId, segunda.resposta)) ? segunda : null
  const achada = outra
    ? {
        ...primeira,
        resposta: `${primeira.resposta}\n\n${outra.resposta}`,
        chamarEquipe: Boolean(primeira.chamarEquipe || outra.chamarEquipe),
        // Duas respostas juntas nao perguntam a unidade: a pergunta seria de uma so.
        perguntarUnidade: false,
      }
    : primeira

  // "A Amil nao" em cima do texto da clinica. Ver avisoDoPlano.
  const aviso = await avisoDoPlano(admin, clinicId, texto)
  const lista = {
    rotulo: 'Ver opções',
    linhas: [
      { id: '2', titulo: 'Marcar uma consulta', descricao: 'Consulta nova ou retorno · unidade, dia e horário' },
      { id: '9', titulo: 'Falar com a equipe', descricao: 'Alguém do consultório responde' },
      { id: '0', titulo: 'Voltar ao menu' },
    ],
  }

  // A mesma resposta pedida de novo vai para a equipe (16/10/2026, painel de
  // pacientes simulados). Ate aqui o robo apontava "Essa informacao esta logo
  // acima" - e quem pergunta de novo e quem nao achou a resposta ali. "Entao o
  // Porto cobre a cirurgia, e isso?" recebeu "esta logo acima", apontando para
  // os convenios da CONSULTA: soou como um sim. "Nao tem nada sobre
  // estacionamento ai em cima" recebeu o mesmo "logo acima", duas vezes.
  // A excecao e o plano que nao e atendido: "mas a Amil nao cobre?" depois dos
  // convenios ouve o "nao" que faltava, e nao a fila.
  if (await jaMandada(admin, conversationId, achada.resposta)) {
    if (aviso && !(await jaMandada(admin, conversationId, aviso))) {
      await salvarEstado(admin, conversationId, { booking_state: 'menu', booking_options: null, booking_unit_id: null })
      return { resposta: `${aviso}\n\n${SAIDAS}`, lista }
    }
    registrar('duvida_para_equipe')
    const chamada = await chamarEquipe(admin, conversationId)
    return {
      ...chamada,
      resposta:
        '🙋 Para não repetir a mesma resposta, passei sua pergunta para a nossa equipe, que responde por aqui.\n\n' +
        avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' + VOLTA,
    }
  }
  const resposta = aviso ? `${aviso}\n\n${achada.resposta}` : achada.resposta

  // Assunto que a equipe confirma (16/10/2026): responde e acende a conversa
  // para a equipe. Vem antes da pergunta da unidade: a equipe responde do
  // lugar certo. A conversa NAO vai para a fila: quem perguntou o valor e logo
  // depois escreveu "queria marcar em Higienopolis terca a tarde" ficava preso
  // na fila, com o robo calado, ate alguem da equipe aparecer. Acesa, a equipe
  // ve a pergunta; no menu, a pessoa continua marcando se quiser.
  if (achada.chamarEquipe) {
    registrar('duvida_para_equipe')
    await salvarEstado(admin, conversationId, {
      booking_state: 'menu',
      booking_options: null,
      booking_unit_id: null,
      menu_sent_at: new Date().toISOString(),
    })
    return {
      resposta:
        `${resposta}\n\n🙋 Já passei sua pergunta para a nossa equipe, que responde por aqui. ` +
        `${avisoDeHorario(relogioEmFoco ?? new Date())}\n\n` +
        'Enquanto isso, se quiser marcar, digite *2*.',
      atencao: 'atendente',
      lista,
    }
  }

  // "Quanto custa?" nao tem resposta unica: depende de onde. O assunto marcado
  // para perguntar a unidade cai na mesma pergunta da opcao 1 do menu, e a
  // resposta e o texto de informacoes do lugar escolhido. Com um lugar so, a
  // pergunta nao existe e vale o texto da propria resposta.
  if (achada.perguntarUnidade) {
    const lugares = await opcoesDeAtendimento(admin, clinicId)
    if (lugares.length > 1) {
      // A resposta vem junto da pergunta (09/10/2026). A Bianca perguntou o
      // valor duas vezes, recebeu duas vezes "para qual atendimento?" e foi
      // embora sem o preco. A resposta cadastrada ja traz o valor de cada
      // lugar; a escolha da unidade fica para quem quer o endereco e o resto.
      return await perguntarLocalDasInformacoes(admin, clinicId, conversationId, textoGeral, resposta)
    }
  }

  await salvarEstado(admin, conversationId, {
    booking_state: 'menu',
    booking_options: null,
    booking_unit_id: null,
    menu_sent_at: new Date().toISOString(),
  })

  return { resposta: `${resposta}\n\n${SAIDAS}`, lista }
}

/**
 * Informacoes da consulta: primeiro onde, depois o texto.
 *
 * O valor nao e um so - Santos e Sao Paulo cobram diferente, e a telemedicina
 * tem regra propria de retorno. Responder tudo de uma vez virava um paragrafo
 * com tres precos, e a pessoa tinha que achar o dela no meio. Perguntar antes
 * custa um toque e entrega a resposta certa, curta, com o endereco certo.
 *
 * Com uma unidade so e sem telemedicina, nao ha o que perguntar: responde.
 */
/**
 * O que dizer quando a resposta nao foi o numero esperado.
 *
 * Antes era sempre "Nao entendi, responda com o numero". Mas quem escreve
 * "Convenio" no meio da escolha da unidade nao errou: mudou de assunto, e o
 * robo sabia responder aquilo. Insistir no numero era defender o proprio fluxo
 * em vez de atender - a pessoa perguntava e ouvia que nao tinha sido entendida.
 *
 * Agora: se a mensagem casa com uma resposta pronta, ela vem primeiro e a
 * pergunta da etapa e repetida logo abaixo, para a conversa continuar de onde
 * parou. Sem casar com nada, o "Nao entendi" de sempre.
 *
 * A etapa nao muda em nenhum dos dois casos: responder uma duvida no meio do
 * caminho nao pode tirar a pessoa do lugar onde ela estava.
 *
 * SINTOMA TEM TRATAMENTO PROPRIO, e vem antes de tudo.
 *
 * A frase que explica por que o robo nao orienta sobre sintoma existia so no
 * caminho de quem escrevia sem etapa aberta. Depois de ver o menu, ou no meio
 * do agendamento, "meu filho esta vomitando sangue desde ontem" recebia
 * "Nao entendi. Responda com o numero da opcao" - a mae corrigida sobre a
 * forma de responder, e ninguem avisado. E gastropediatria: hematemese chega
 * escrita assim, e pediuUrgencia (/urgen/) nao pega nada disso.
 *
 * Estando aqui, vale para TODAS as etapas de uma vez, que e onde o defeito
 * estava. A etapa continua de pe: a pergunta e repetida logo abaixo, e quem
 * quiser gente digita 3 ou 9, como o robo diz.
 */
/**
 * O que o robo diz quando a mensagem fala de sintoma, exame ou remedio.
 *
 * Reescrita em 07/10/2026. O Andre perguntou, na opcao de informacoes, "o Dr.
 * Marcello costuma solicitar exames para investigar dor abdominal cronica?" -
 * uma pergunta sobre o atendimento, e nao um pedido de conduta - e recebeu
 * "Sobre sintomas, remedios e o que fazer... nao posso orientar" seguido de
 * "responda com o numero da unidade". Soou como fora de assunto. Agora a frase
 * diz o que acontece de fato (o medico avalia na consulta e decide o que
 * investigar) e aponta o caminho: marcar ou falar com a equipe.
 */
// A saida de urgencia entrou em 07/10/2026. "Meu filho esta com dor de barriga
// ha 3 dias, posso dar dipirona?" recebia "nao posso orientar" e o menu, sem
// dizer o que fazer se a crianca piorasse. A palavra URGENCIA ja funcionava de
// qualquer etapa; so ninguem contava isso a quem descrevia um sintoma.
function fraseClinica(clinicId: string) {
  // Perfil 'geral' (Dr. Fabio, 15/10/2026): quem le e o proprio paciente, e o
  // pronto-socorro vem com a redacao da clinica, que cita os convenios.
  const q = quemAtende(clinicId)
  if (q.publico === 'geral') {
    const fraseGeral =
      `Essa é uma avaliação para a consulta: é lá que ${q.o} examina e decide o que precisa investigar. ` +
      'Por aqui eu não posso orientar sobre sintomas, exames ou remédios. Se for urgente, digite *URGÊNCIA*.'
    if (dentroDoExpediente(relogioEmFoco ?? new Date())) return fraseGeral
    return (
      fraseGeral +
      `\n\n*O consultório está fechado agora: não espere a nossa resposta. ${q.prontoSocorro ?? 'Procure o pronto-socorro mais próximo ou ligue 192.'}*`
    )
  }
  const frase =
    `Essa é uma avaliação para a consulta: é lá que ${quemAtende(clinicId).o} examina a criança e decide ` +
    'o que precisa investigar. Por aqui eu não posso orientar sobre sintomas, exames ou remédios. ' +
    'Se for urgente, digite *URGÊNCIA*.'
  // Fora do expediente o pronto-socorro vem junto, sem depender da palavra
  // URGENCIA (14/10/2026). No painel, a mae com o filho vomitando e com febre
  // as 22h40 so ouviu "se for urgente, digite URGENCIA" - a frase do
  // pronto-socorro existia, mas so para quem digitava a palavra.
  if (dentroDoExpediente(relogioEmFoco ?? new Date())) return frase
  return (
    frase +
    '\n\n*O consultório está fechado agora. Se a criança está mal, não espere a nossa resposta: ' +
    'procure o pronto-socorro mais próximo ou ligue 192.*'
  )
}

/**
 * Sintoma ou remedio fora de etapa: a frase clinica com o menu, ou uma curta,
 * quando ela acabou de sair (16/10/2026, painel de pacientes simulados).
 *
 * "Entendo, mas e so pra hoje. Uma capsula de 500 nao faz mal, ne?" recebia a
 * mesma frase e o menu inteiro de novo, logo abaixo do primeiro. Quem insiste
 * ja leu o menu: precisa ouvir, curto, por que nao e o robo quem responde, e
 * o que fazer.
 */
async function responderAssuntoClinico(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  saudacao: string,
): Promise<Resultado> {
  const frase = fraseClinica(clinicId)
  if (await jaMandada(admin, conversationId, frase)) {
    await salvarEstado(admin, conversationId, { booking_state: 'menu', booking_options: null, booking_unit_id: null })
    return {
      resposta:
        `🙏 Entendo a pressa, mas remédio e sintoma só ${perfil().o} pode orientar, depois de examinar. ` +
        'Se piorar ou for urgente, digite *URGÊNCIA*.\n\n' + SAIDAS,
      lista: {
        rotulo: 'Ver opções',
        linhas: [
          { id: '2', titulo: 'Marcar uma consulta', descricao: 'Consulta nova ou retorno · unidade, dia e horário' },
          { id: '9', titulo: 'Falar com a equipe', descricao: 'Alguém do consultório responde' },
          { id: '0', titulo: 'Voltar ao menu' },
        ],
      },
    }
  }
  return await mostrarMenu(
    admin,
    conversationId,
    saudacao,
    frase + ' Digite *2* para marcar uma consulta ou *3* para falar com a equipe, ou escolha:',
  )
}

async function naoEntendi(
  admin: Admin,
  clinicId: string,
  texto: string,
  pergunta: string,
): Promise<string> {
  // Este numero e o alarme mais util do painel: quando sobe, gente esta
  // perguntando coisa que o menu nao cobre, e falta uma opcao.
  registrar('nao_entendi')
  if (assuntoClinico(texto)) {
    return (
      fraseClinica(clinicId) + ' Digite *9* para falar com a equipe.\n\n' +
      pergunta
    )
  }
  // "Nao, perguntei se tem alguem atendendo agora" no meio da agenda (16/10/2026,
  // rodada 2 do painel) recebia "Nao entendi qual unidade".
  if (perguntouSeTemAlguem(texto)) return `${presenca(relogioEmFoco ?? new Date())}\n\n${pergunta}`
  // "E o ultimo da tarde e que horas?" na lista de unidades (rodada 2): a
  // agenda responde, e a pergunta da etapa continua embaixo.
  const agenda = await respostaDaAgenda(admin, clinicId, texto)
  if (agenda) return `${agenda}\n\n${pergunta}`
  const achada = acharResposta(texto, await carregarRespostas(admin, clinicId))
  // Assunto que a equipe confirma, no meio do agendamento (rodada 2 do painel):
  // "antes de escolher, quanto custa a consulta?" ouvia que a equipe passa o
  // valor, e ninguem era chamado - a conversa fechava como resolvida. O evento
  // faz tratarConversa acender a conversa, e o agendamento segue de pe.
  if (achada?.chamarEquipe) registrar('chamar_equipe_junto')
  // O texto curto da propria resposta, e nao a pergunta "Santos, SP ou
  // telemedicina?" dos assuntos marcados: fazer outra pergunta a quem ja esta
  // respondendo uma seria trocar uma confusao por outra. Sem o "digite 2": ver
  // semConviteDoDois.
  return achada
    ? `${semConviteDoDois(achada.resposta)}${achada.chamarEquipe ? '\n\n🙋 Sobre isso, a nossa equipe confirma por aqui.' : ''}\n\n${pergunta}`
    : `Não entendi. ${pergunta}`
}

/**
 * "Tem alguem ai?", "alguem online?", "perguntei se tem alguem atendendo" no
 * meio da frase (16/10/2026, rodada 2 do painel). Ver chamandoAlguem, que e a
 * mensagem que so pergunta isso.
 */
export function perguntouSeTemAlguem(texto: string): boolean {
  const f = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')
  return (
    chamandoAlguem(texto) ||
    /\b(tem|ha) (alguem|gente|uma pessoa) (ai|online|on line|atendendo|ai agora|por ai|acordad[oa]|pra (me )?(atender|responder))\b/.test(f) ||
    /\balguem (ai|online|on line|atendendo|ta ai|esta ai)\b/.test(f) ||
    // "Vcs tao respondendo agora ou e robo?" (rodada 3 do painel).
    /\b(e|eh|e um|eh um|voce e|vc e|vc eh|falando com|isso e um) (robo|bot|maquina)\b|\b(robo|bot)\b.{0,3}$|\b(tao|estao|ta|esta) (respondendo|atendendo)( agora| ainda)?\b/.test(f) ||
    /\bperguntei se tem alguem\b/.test(f)
  )
}

/** "Estou aqui", com a hora da equipe quando ela nao esta. */
function presenca(agora: Date): string {
  return (
    '👋 Estou aqui! Sou o atendimento automático do consultório: já posso ajudar por aqui, ' +
    'e para falar com alguém da nossa equipe é só digitar *9*.' +
    (dentroDoExpediente(agora) ? '' : `\n\n${avisoDeHorario(agora)}`)
  )
}

async function perguntarLocalDasInformacoes(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  textoGeral: string,
  /** Resposta pronta que vai em cima da pergunta (ver responderPergunta). */
  antes = '',
): Promise<Resultado> {
  const lugares = await opcoesDeAtendimento(admin, clinicId)

  if (lugares.length <= 1) {
    return await responderInformacoes(admin, clinicId, conversationId, lugares[0]?.id ?? '', textoGeral)
  }

  const linhas = lugares.map((u, i) => `*${i + 1}* ${u.name}`).join('\n')
  await salvarEstado(admin, conversationId, {
    booking_state: 'informacoes_unidade',
    booking_options: lugares.map((u) => u.id),
    booking_unit_id: null,
  })
  return {
    resposta:
      (antes
        ? `${antes}\n\n📍 Quer ver endereço e o que levar? Escolha o atendimento:\n\n${linhas}\n\n`
        : `💬 Para qual atendimento você quer informações?\n\n${linhas}\n\n`) +
      `Responda com o número. ${SAIDAS}`,
    lista: {
      rotulo: 'Escolher',
      linhas: comVoltar(lugares.map((u, i) => ({ id: String(i + 1), titulo: u.name }))),
    },
  }
}

async function responderInformacoes(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  lugarId: string,
  textoGeral: string,
): Promise<Resultado> {
  // Os OUTROS lugares, para a linha "Outra unidade" dizer para onde ela leva.
  //
  // Antes ela mostrava o lugar que a pessoa acabou de ler ("Você viu: Santos"),
  // que e a unica informacao que ela ja tem. Quem toca ali quer saber de outro
  // lugar, entao e o nome do outro lugar que precisa aparecer.
  const outros = (await opcoesDeAtendimento(admin, clinicId)).filter((l) => l.id !== lugarId)
  // 72 caracteres e o limite da descricao na lista do WhatsApp. Passou disso, a
  // Meta recusa a mensagem inteira - melhor uma frase generica do que nenhuma
  // resposta.
  const nomesDosOutros = outros.map((l) => l.name).join(' ou ')
  const descricaoOutros =
    nomesDosOutros && nomesDosOutros.length <= 72 ? nomesDosOutros : 'Ver os outros atendimentos'

  let informacoes = ''
  if (lugarId === TELE_ID) {
    const tele = await telemedicinaDaClinica(admin, clinicId)
    informacoes = tele.informacoes
  } else if (lugarId) {
    const unidade = await unidadePorId(admin, lugarId)
    informacoes = (unidade?.info_text ?? '').trim()
  }
  // O fecho comum vai no fim de qualquer lugar: como agendar, como falar com
  // a equipe, telefones, horario. E o mesmo para todos, editado uma vez so.
  // Sem texto da unidade nem fecho, volta ao menu em vez de mandar vazio.
  const fecho = textoGeral.trim()
  // Uma linha fina entre as duas partes. O que vem antes e daquele lugar
  // (valor, endereco, o que levar); o que vem depois vale para todos. Sem a
  // separacao, a mensagem parecia uma lista so, e o olho lia "estacionamento"
  // e "telefones" com o mesmo peso. Traco leve de proposito: o pesado (━) ja e
  // usado no comprovante da consulta, e dois riscos iguais em mensagens
  // diferentes tiram o significado do primeiro.
  // Os campos ({valor}, {endereco}...) sao trocados aqui, onde se sabe de que
  // lugar se fala; o fecho vai junto porque e colado no texto deste lugar.
  const corpo = await comCampos(
    admin,
    clinicId,
    informacoes && fecho
      ? `${informacoes}\n\n──────────────\n\n${fecho}`
      : [informacoes, fecho].filter(Boolean).join('\n\n'),
    lugarId || null,
  )
  if (!corpo) {
    return await mostrarMenu(admin, conversationId, 'Olá!')
  }

  // Segue em 'menu': assim a pessoa le os valores e responde 2 na hora.
  await salvarEstado(admin, conversationId, {
    booking_state: 'menu',
    booking_options: null,
    booking_unit_id: null,
  })
  // Quem le sobre telemedicina pode estar com pressa: a saida de urgencia
  // aparece aqui mesmo, e nao so depois de entrar no agendamento.
  const tele = lugarId === TELE_ID
  // Sem outro lugar, nao se oferece "outra unidade".
  //
  // Com um atendimento so, o *1* levava de volta a mesmissima mensagem, que
  // convidava de novo a ver "outra unidade" - digita 1, le o mesmo texto,
  // digita 1, le o mesmo texto. E o laco que custou o atendimento de
  // 19/09/2026, na versao de quem tem uma unidade cadastrada.
  const temOutros = outros.length > 0
  return {
    resposta:
      `${corpo}\n\n` +
      // Curta de proposito: o fecho ja explica o 2 e o 3 com contexto.
      (temOutros
        ? 'Digite *1* para ver outra unidade ou *0* para ver todas as opções.'
        : 'Digite *0* para voltar ao início.') +
      (tele ? '\n\n🚨 Se for *urgência*, digite URGÊNCIA: a equipe entra em contato o mais rápido possível.' : ''),
    // Quem acabou de ler o preco e exatamente quem esta pronto para marcar.
    lista: {
      rotulo: 'Ver opções',
      linhas: [
        { id: '2', titulo: 'Marcar uma consulta', descricao: 'Consulta nova ou retorno · unidade, dia e horário' },
        ...(tele ? [{ id: 'URGENCIA', titulo: '🚨 É urgência', descricao: 'Falar com a equipe agora' }] : []),
        ...(temOutros ? [{ id: '1', titulo: 'Outra unidade', descricao: descricaoOutros }] : []),
        { id: '9', titulo: 'Falar com a equipe', descricao: 'Alguém do consultório responde' },
        { id: '0', titulo: 'Voltar ao menu' },
      ],
    },
  }
}

/** Quantas respostas prontas o robo da enquanto a equipe nao assume. */
const LIMITE_NA_ESPERA = 3

async function chamarEquipe(admin: Admin, conversationId: string): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'atendente',
    booking_options: null,
    booking_unit_id: null,
    // Cada espera comeca com o contador limpo: quem entrou na fila hoje nao
    // paga pelas perguntas que fez semana passada.
    auto_replies_while_waiting: 0,
  })
  // O primeiro paragrafo diz o que esta acontecendo agora; o segundo da uma
  // tarefa util para o tempo de espera; o terceiro diz quando esperar resposta.
  // Sem os tres, "vou te transferir" vira promessa vaga.
  return {
    resposta:
      // "Da equipe", como no menu e no resto das mensagens; "atendente da
      // clinica" era a unica frase que chamava o consultorio de clinica.
      'Estou direcionando você para alguém da nossa equipe.\n\n' +
      'Pode já escrever sua dúvida por aqui: a pessoa que assumir o atendimento ' +
      'vai ler tudo antes de responder.\n\n' +
      avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' + VOLTA,
    atencao: 'atendente',
  }
}

/**
 * Quem diz que a consulta nao aconteceu (ver negouConsulta): desculpas e a
 * equipe, nunca a agenda. Sem o texto longo da fila: a pessoa nao pediu nada,
 * e quem precisa agir e a equipe, no cadastro.
 */
async function consultaQueNaoHouve(admin: Admin, conversationId: string): Promise<Resultado> {
  registrar('negou_consulta')
  const chamada = await chamarEquipe(admin, conversationId)
  return {
    ...chamada,
    resposta:
      'Desculpe pela mensagem! 🙏 Passei para a nossa equipe conferir o cadastro, ' +
      'e ela corrige por aqui. Se quiser marcar uma consulta, é só me dizer.',
  }
}

/** O operado vai para a equipe, com o pronto-socorro a mao. Ver falouDePosOperatorio. */
async function recadoDoPosOperatorio(admin: Admin, conversationId: string): Promise<Resultado> {
  registrar('pos_operatorio')
  const chamada = await chamarEquipe(admin, conversationId)
  return {
    ...chamada,
    resposta:
      `💙 Obrigado por escrever! Já passei sua mensagem para a equipe ${perfil().o.replace(/^o /, 'do ')}, ` +
      'que acompanha o pós-operatório e responde por aqui. Pode já contar o que está acontecendo.\n\n' +
      `*${prontoSocorro()}*\n\n` +
      avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' + VOLTA,
  }
}

/**
 * Pedido de nota fiscal ou recibo de consulta ja feita.
 *
 * Existe desde 22/09/2026. Uma mae escreveu "estive com meu filho em consulta
 * e foi solicitada a NF" e recebeu o menu inteiro, como se nao tivesse dito
 * nada; depois apertou "falar com a equipe" e escreveu tudo de novo. E pedido
 * administrativo que so a equipe resolve - o robo so precisa entender o que e,
 * pedir o que falta e chamar alguem.
 *
 * "Recibo" so conta com verbo de pedido ou "da consulta": "voces emitem
 * recibo?" e pergunta sobre a clinica, e a resposta pronta de valores ja cobre.
 */
/**
 * "Perdi a receita", "preciso da segunda via" (14/10/2026).
 *
 * No painel, "Perdi a receita do omeprazol da Helena, tem como mandar segunda
 * via?" recebeu a frase de assunto clinico ("nao posso orientar sobre
 * remedios") - a palavra "receita" a punha na conta do sintoma. Pedido de 2a
 * via e a opcao 5 do menu: vai direto para ela.
 */
export function pediuSegundaVia(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  return (
    /\b(segunda|2|2a|outra|nova) via\b/.test(t) ||
    /\bperd(i|eu|emos|ido)\b.{0,25}\b(receita|pedido de exame|pedido do exame|guia)\b/.test(t) ||
    /\b(receita|pedido de exame) (de novo|novamente|nova)\b/.test(t)
  )
}

/**
 * Receita E exame no mesmo pedido (15/10/2026, painel de familias).
 *
 * "Preciso dos dois, a receita e tbm o pedido do exame de sangue": o robo
 * perguntava o remedio, registrava a receita e esquecia o exame. A mae
 * escreveu de novo e ficou sem resposta - a equipe so via a receita.
 */
export function pediuOsDoisDocumentos(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  if (/\b(os dois|as duas|ambos|ambas|1 e 2|um e outro)\b/.test(t)) return true
  return /\b(receita|remedio|medicamento)\b/.test(t) && /\b(exame|exames|laboratorio|ultrassom|endoscopia)\b/.test(t)
}

export function pediuNotaFiscal(texto: string): boolean {
  const t = normalizar(texto)
  // Pergunta sobre o consultorio, e nao pedido (16/10/2026, painel): "Tenho
  // Bradesco. Consigo pedir reembolso? Voces dao recibo ou nota fiscal?" ouviu
  // "Anotei o pedido de nota fiscal... escreva o nome do paciente e a data da
  // consulta" - e ele nunca tinha consultado. Com consulta feita na frase
  // ("da consulta de ontem", "que fiz"), continua sendo pedido.
  // "Meu plano e Bradesco" nao e consulta feita (rodada 2): so o que fala da
  // consulta que ja aconteceu desfaz a pergunta.
  if (
    parecePergunta(texto) &&
    // "Da nota fiscal? quero pedir reembolso no bradesco" (rodada 3 do painel),
    // sem o "voces" na frente, e a mesma pergunta.
    (/\b(voces|vcs|vc|voce|consultorio|clinica|dr|doutor)\s+(da|dao|emite|emitem|fornece|fornecem|faz|fazem|tem|manda|mandam)\b/.test(t) ||
      /^(e |mas |ai )?(da|dao|emite|emitem|fornece|fornecem|faz|fazem|tem|aceita)\s+(nota|nf|recibo)\b/.test(t) ||
      /\breembols\w*\b/.test(t)) &&
    !/\b(minha consulta|da consulta (de|do|que)|ultima consulta|ontem|semana passada|mes passado|que fiz|que tive|ja fiz|estive|esteve|fomos|fui)\b/.test(t)
  ) {
    return false
  }
  if (/(^|[^a-z])(nf|nfe|nfs|nfse|nfs-e|nota fiscal|notinha)([^a-z]|$)/.test(t)) return true
  return (
    /(preciso|precisava|gostaria|quero|queria|mandar|manda|enviar|envia|solicitar|pedir|nao recebi)[^.?!]{0,30}recibo/.test(t) ||
    /recibo d[aeo] (consulta|atendimento)/.test(t)
  )
}

async function registrarPedidoDeNota(admin: Admin, conversationId: string): Promise<Resultado> {
  registrar('nota_fiscal_pedida')
  // Mesma fila do "falar com a equipe": o robo para de oferecer menu enquanto
  // alguem nao responde, e a conversa acende com o motivo "documento".
  await salvarEstado(admin, conversationId, {
    booking_state: 'atendente',
    booking_options: null,
    booking_unit_id: null,
    auto_replies_while_waiting: 0,
  })
  return {
    resposta:
      '🧾 Anotei o pedido de *nota fiscal / recibo*.\n\n' +
      'Para a equipe já localizar, escreva aqui o *nome do paciente* e a *data da consulta*, ' +
      'se ainda não mandou.\n\n' +
      avisoDeHorario(relogioEmFoco ?? new Date()),
    atencao: 'documento',
  }
}

// ---------------------------------------------------------------
// Opcao 4: minha consulta
// ---------------------------------------------------------------

function descreverConsulta(c: ConsultaMarcada, timezone: string) {
  const linhas = [formatarData(c.inicio, timezone), c.unidade]
  if (c.endereco) linhas.push(c.endereco)
  if (c.paciente) linhas.unshift(c.paciente)
  if (!c.confirmada) linhas.push('(aguardando confirmação da equipe)')
  return linhas.join('\n')
}

async function mostrarMinhaConsulta(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  consultas: ConsultaMarcada[],
): Promise<Resultado> {
  const timezone = await fusoDaClinica(admin, clinicId)

  if (consultas.length === 0) {
    await salvarEstado(admin, conversationId, { booking_state: 'menu' })
    return {
      resposta:
        'Não encontrei nenhuma consulta marcada para este número.\n\n' +
        'Digite *2* para agendar, ou *0* para ver as opções.',
      lista: {
        rotulo: 'Ver opções',
        linhas: [
          { id: '2', titulo: 'Marcar uma consulta', descricao: 'Consulta nova ou retorno · unidade, dia e horário' },
          { id: '9', titulo: 'Falar com a equipe' },
          { id: '0', titulo: 'Voltar ao menu' },
        ],
      },
    }
  }

  await salvarEstado(admin, conversationId, {
    booking_state: 'minha_consulta',
    booking_options: consultas.map((c) => c.id),
  })

  if (consultas.length === 1) {
    return {
      resposta:
        `Sua consulta:\n\n${descreverConsulta(consultas[0], timezone)}\n\n` +
        'Digite CANCELAR para desmarcar, REMARCAR para trocar a data, ou 0 para voltar.',
      botoes: [
        { id: 'REMARCAR', titulo: 'Remarcar' },
        { id: 'CANCELAR', titulo: 'Cancelar consulta' },
        { id: 'MENU', titulo: 'Voltar ao menu' },
      ],
    }
  }

  const linhas = consultas
    .map((c, i) => `*${i + 1}* ${formatarData(c.inicio, timezone)} · ${c.unidade}`)
    .join('\n')
  return {
    resposta:
      `Você tem ${consultas.length} consultas marcadas:\n\n${linhas}\n\n` +
      'Responda com o número da que quer cancelar ou remarcar, ou *0* para voltar.',
    lista: {
      rotulo: 'Escolher consulta',
      linhas: comVoltar(
        consultas.map((c, i) => ({
          id: String(i + 1),
          titulo: formatarData(c.inicio, timezone).slice(0, 24),
          descricao: c.unidade.slice(0, 72),
        })),
      ),
    },
  }
}

/**
 * A remarcacao na mesma unidade, com o mesmo convenio (16/10/2026, painel de
 * pacientes simulados).
 *
 * Quem remarcava respondia SIM e recebia de novo "em qual unidade?" e
 * "convenio ou particular?", que a consulta antiga ja dizia: onze mensagens
 * para trocar a data. Agora vao direto os dias da mesma unidade, e VOLTAR
 * troca a unidade. Telemedicina, unidade fora do ar ou sem horario: o caminho
 * de sempre (null).
 */
async function remarcarNaMesmaUnidade(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  appointmentId: string,
  /**
   * A frase da pessoa, quando ja diz o dia (16/10/2026, rodada 3 do painel):
   * "sim, pode ser sexta dia 23 de manha" aceitava o sim e mostrava a lista
   * inteira, e ele teve de escrever o dia de novo. Ver diasOuHorario.
   */
  pedido = '',
): Promise<Resultado | null> {
  const { data } = await admin.from('appointments').select('unit_id,patient_id,modality').eq('id', appointmentId).maybeSingle()
  const antiga = data as { unit_id?: string | null; patient_id?: string | null; modality?: string | null } | null
  if (!antiga?.unit_id || antiga.modality === 'telemedicina') return null
  const unidade = (await opcoesDeAtendimento(admin, clinicId)).find((u) => u.id === antiga.unit_id)
  if (!unidade || (await horariosLivres(admin, clinicId, unidade.id)).horarios.length === 0) return null
  // O convenio vem num pedido proprio: coluna nova, ver COLUNAS_RECENTES_DA_CONSULTA.
  let convenio = ''
  try {
    const extra = await admin.from('appointments').select('insurance').eq('id', appointmentId).maybeSingle()
    if (!extra.error) convenio = String((extra.data as { insurance?: string | null } | null)?.insurance ?? '')
  } catch (erro) {
    console.warn('Nao consegui ler o convenio da consulta a remarcar', erro)
  }
  // O plano antigo que a unidade nao atende mais nao vai junto.
  if (convenio && !planosDaUnidade(unidade).includes(convenio)) convenio = ''
  await salvarEstado(admin, conversationId, {
    booking_patient_id: antiga.patient_id ?? null,
    booking_insurance: convenio,
    booking_modality: 'presencial',
  })
  const dias = await diasOuHorario(admin, clinicId, conversationId, unidade, pedido)
  return {
    ...dias,
    resposta:
      `🔄 Vamos achar outra data em *${unidade.name}*${convenio ? `, pela *${convenio}*` : ''}. Para outra unidade, digite VOLTAR.\n\n` +
      (dias?.resposta ?? ''),
  }
}

/** Cancelamento e destrutivo: nunca acontece sem um sim explicito. */
async function pedirConfirmacaoCancelamento(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  consulta: ConsultaMarcada,
  remarcar: boolean,
): Promise<Resultado> {
  const timezone = await fusoDaClinica(admin, clinicId)
  await salvarEstado(admin, conversationId, {
    booking_state: 'confirmar_cancelamento',
    booking_options: [consulta.id],
    booking_replaces_id: remarcar ? consulta.id : null,
  })
  return {
    resposta:
      (remarcar
        ? 'Vamos remarcar esta consulta:\n\n'
        : 'Confirma o cancelamento desta consulta?\n\n') +
      `${descreverConsulta(consulta, timezone)}\n\n` +
      (remarcar
        ? 'Responda SIM para escolher a nova data. A consulta atual só será cancelada depois que a nova estiver marcada.'
        : 'Responda SIM para cancelar, ou 0 para deixar como está.'),
    botoes: [
      { id: 'SIM', titulo: remarcar ? 'Sim, escolher data' : 'Sim, cancelar' },
      { id: 'MENU', titulo: 'Não, manter' },
    ],
  }
}

async function cancelarConsulta(admin: Admin, appointmentId: string) {
  const { error } = await admin
    .from('appointments')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('status', 'scheduled')
  if (error) console.error('Falha ao cancelar consulta', { appointmentId, error })
  return !error
}

// ---------------------------------------------------------------
// Opcao 2: agendar
// ---------------------------------------------------------------

/**
 * Primeira etapa quando o telefone atende a mais de um paciente.
 *
 * Numa gastropediatria e o caso comum: a mae cadastra os dois filhos com o
 * proprio celular. Sem esta pergunta o sistema escolhia sozinho e marcava a
 * consulta no nome do irmao errado.
 */
/**
 * "Outra crianca", ainda sem cadastro (14/10/2026).
 *
 * Guardado em booking_patient_id no lugar de um paciente: e o que impede o
 * robo de cair no "unico paciente do telefone". No painel de familias, a mae
 * tocou em "Marcar mais uma" para o irmao de 16 anos, que nao tinha ficha, e
 * a consulta foi gravada no nome da Helena - a unica cadastrada. Com este
 * marcador a consulta nasce sem paciente e a ficha pergunta o nome, como para
 * qualquer crianca nova. A coluna e uuid sem chave estrangeira; o uuid nulo
 * nunca e id de paciente.
 */
const OUTRA_CRIANCA = '00000000-0000-0000-0000-000000000000'

async function perguntarPaciente(
  admin: Admin,
  conversationId: string,
  pacientes: Paciente[],
  /** Oferece "Outra criança" - nao na remarcacao, que e sempre da mesma. */
  comOutra = false,
): Promise<Resultado> {
  const opcoesDeQuem = [
    ...pacientes.map((p) => ({ id: p.id, nome: p.name })),
    ...(comOutra ? [{ id: OUTRA_CRIANCA, nome: geral() ? 'Outra pessoa' : 'Outra criança' }] : []),
  ]
  const linhas = opcoesDeQuem.map((p, i) => `*${i + 1}* ${p.nome}`).join('\n')

  await salvarEstado(admin, conversationId, {
    booking_state: 'aguardando_paciente',
    booking_options: opcoesDeQuem.map((p) => p.id),
    booking_unit_id: null,
    booking_patient_id: null,
  })

  return {
    resposta:
      `${iconeDoPaciente()} *Vamos agendar!* Para quem é a consulta?\n\n${linhas}\n\n` +
      `Responda com o número ou o nome. ${SAIDAS}`,
    // Era a unica etapa sem lista tocavel: quem chegava aqui tinha de digitar,
    // enquanto nas telas seguintes bastava tocar. A troca de gesto no meio do
    // caminho e o tipo de coisa que faz a pessoa achar que travou.
    lista: {
      rotulo: 'Escolher paciente',
      linhas: comVoltar(
        opcoesDeQuem.map((p, i) => ({ id: String(i + 1), titulo: p.nome.slice(0, 24) })),
      ),
    },
  }
}

/**
 * O primeiro nome como se fala (16/10/2026, painel de pacientes simulados):
 * "teo" e o Theo, "elena" e a Helena. Sem acento, sem h mudo, sem letra
 * dobrada, y como i.
 */
function nomeFalado(nome: string): string {
  return normalizar(nome)
    .replace(/[^a-z]/g, '')
    .replace(/^h/, '')
    .replace(/th/g, 't')
    .replace(/ph/g, 'f')
    .replace(/y/g, 'i')
    .replace(/w/g, 'v')
    .replace(/(.)\1+/g, '$1')
}

/** O paciente do telefone citado pelo primeiro nome na frase, quando ha um so. */
function pacienteCitado(pacientes: Paciente[], texto: string): Paciente | null {
  const palavras = new Set(normalizar(texto).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((p) => p.length >= 2).map(nomeFalado))
  const citados = pacientes.filter((p) => {
    const primeiro = nomeFalado(p.name.trim().split(/\s+/)[0] ?? '')
    return primeiro.length >= 2 && palavras.has(primeiro)
  })
  return citados.length === 1 ? citados[0] : null
}

/**
 * A unidade e o convenio que o pedido de marcar ja diz (16/10/2026, painel de
 * pacientes simulados).
 *
 * "Bom dia! Meu nome e Ana Paula, tenho Unimed Santos. Queria marcar uma
 * consulta" recebeu a lista das tres unidades - com as duas de Sao Paulo, so
 * particular, em cima - e depois "convenio ou particular?", com a Unimed que
 * ela ja tinha dito. O plano diz a unidade (a Unimed Santos so vale em
 * Santos); a unidade citada pula a lista; o plano que nao e atendido, ou que
 * nao vale na unidade pedida, e dito antes de qualquer lista. Na duvida, a
 * lista de sempre: "VOLTAR" troca a unidade em qualquer caso.
 */
async function unidadeDoPedido(admin: Admin, clinicId: string, conversationId: string, pedido: string): Promise<Resultado> {
  // "Sabado de manha": o dia sem horario em nenhuma unidade e dito antes de
  // qualquer lista (ver semDiaDaSemana).
  const semODia = await semDiaDaSemana(admin, clinicId, pedido)
  const resultado = await unidadeDoPedidoSemAviso(admin, clinicId, conversationId, pedido)
  return semODia && resultado ? { ...resultado, resposta: `${semODia}\n\n${resultado.resposta}` } : resultado
}

/**
 * Os dias da unidade, ou ja os horarios do dia que o pedido diz ("terca a
 * tarde", "sexta dia 23"), quando ele esta na agenda (16/10/2026).
 */
async function diasOuHorario(admin: Admin, clinicId: string, conversationId: string, unidade: Unidade, pedido: string): Promise<Resultado> {
  const t = normalizar(pedido)
  const citaDia = /\bdia\s+\d{1,2}\b/.test(t) || /\bamanha\b/.test(t) || DIAS_DA_SEMANA.some((d) => new RegExp(`\\b${d}\\b`).test(t))
  if (citaDia && !/\bsegunda via\b/.test(t)) {
    const fuso = await fusoDaClinica(admin, clinicId)
    const { horarios } = await horariosLivres(admin, clinicId, unidade.id)
    const dias = agruparPorDia(horarios, fuso).map((d) => d.chave)
    const qual = diaPeloNome(pedido, dias, relogioEmFoco ?? new Date())
    if (qual >= 0) return await perguntarHorario(admin, clinicId, conversationId, unidade.id, dias[qual], periodoEscrito(pedido))
  }
  const lista = await perguntarDia(admin, clinicId, conversationId, unidade)
  const semana = await avisoDaSemana(admin, clinicId, unidade, pedido)
  return semana && lista ? { ...lista, resposta: `${semana}\n\n${lista.resposta}` } : lista
}

/**
 * "Semana que vem de manha" no pedido (16/10/2026, rodada 2 do painel): a
 * lista de dias vinha inteira, e a paciente escolheu sozinha entre oito. A
 * linha de cima diz quais dias da lista sao da semana que vem, e do turno
 * pedido. Vazio quando o pedido nao fala da semana que vem.
 */
async function avisoDaSemana(admin: Admin, clinicId: string, unidade: Unidade, pedido: string): Promise<string> {
  if (!/\b(semana (que|q) vem|proxima semana|semana seguinte)\b/.test(normalizar(pedido))) return ''
  const timezone = await fusoDaClinica(admin, clinicId)
  const { horarios } = await horariosLivres(admin, clinicId, unidade.id)
  // Os mesmos dias, na mesma ordem, da lista de perguntarDia.
  const dias = agruparPorDia(horarios, timezone).slice(0, unidade.id === TELE_ID ? MAX_DIAS - 1 : MAX_DIAS)
  const hoje = new Date(`${(relogioEmFoco ?? new Date()).toLocaleDateString('en-CA', { timeZone: timezone })}T12:00:00Z`)
  const inicio = new Date(hoje)
  inicio.setUTCDate(hoje.getUTCDate() + ((8 - hoje.getUTCDay()) % 7 || 7))
  const fim = new Date(inicio)
  fim.setUTCDate(inicio.getUTCDate() + 6)
  const [de, ate] = [inicio, fim].map((d) => d.toISOString().slice(0, 10))
  const turno = periodoEscrito(pedido)
  const servem = dias
    .map((dia, i) => ({ dia, i }))
    .filter(({ dia }) =>
      dia.chave >= de && dia.chave <= ate &&
      (!turno || dia.horarios.some((h) => (formatarHora(h.inicio, timezone) < '12:00') === (turno === 'manha'))),
    )
  const quando = `Na semana que vem${turno === 'manha' ? ', de manhã' : turno === 'tarde' ? ', à tarde' : ''}`
  if (servem.length === 0) return `${quando} não há horário livre nesta unidade. Os próximos dias estão abaixo.`
  return `${quando}: ${emLista(servem.map(({ dia, i }) => `*${i + 1}* ${formatarDia(dia.horarios[0].inicio, timezone)}`))}.`
}

async function unidadeDoPedidoSemAviso(admin: Admin, clinicId: string, conversationId: string, pedido: string): Promise<Resultado> {
  const unidades = await opcoesDeAtendimento(admin, clinicId)
  if (unidades.length <= 1) return await perguntarUnidade(admin, clinicId, conversationId)
  const citada = unidadeCitada(unidades, pedido)
  const comPlano = unidades.filter((u) => planosDaUnidade(u).length > 0)
  const aceitos = [...new Set(comPlano.flatMap((u) => planosDaUnidade(u)))]
  const fora = aceitos.length > 0 ? planoNaoAceito(pedido, aceitos) : null
  const comAviso = async (aviso: string, resultado: Resultado | Promise<Resultado>) => {
    const r = await resultado
    return r ? { ...r, resposta: `${aviso}\n\n${r.resposta}` } : r
  }

  if (fora) {
    // A Unimed de outra cidade ouve o porque (rodada 5 do painel): "unimed e
    // unimed, a minha pega em todo lugar".
    const unimedDaqui = /^Unimed /.test(fora) ? aceitos.find((p) => /\bunimed\b/i.test(p)) : undefined
    const aviso =
      (unimedDaqui ? `Cada Unimed é uma cooperativa diferente, com rede própria: aqui é atendida a *${unimedDaqui}*. ` : '') +
      `O plano *${fora}* não está entre os convênios atendidos ${perfil().o.replace(/^o /, 'pelo ')}. ` +
      'A consulta pode ser particular, com recibo para você pedir reembolso ao seu plano.'
    return await comAviso(aviso, citada ? perguntarConvenioOuDia(admin, clinicId, conversationId, citada) : perguntarUnidade(admin, clinicId, conversationId))
  }

  // O plano citado, e onde ele vale. O nome das unidades ("santos") nao
  // identifica plano aqui: e a cidade (ver o ignorar de planoEscolhido).
  const daCidade = unidades.flatMap((u) => normalizar(u.name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)).filter((w) => w.length >= 3)
  let plano: { nome: string; unidade: Unidade } | null = null
  for (const u of comPlano) {
    const planos = planosDaUnidade(u)
    const qual = planoEscolhido(pedido, planos, daCidade)
    if (qual !== null && qual < planos.length) {
      plano = { nome: planos[qual], unidade: u }
      break
    }
  }
  const particular = /\b(particular|sem convenio|sem plano)\b/.test(normalizar(pedido))
  // So segue direto se a unidade tem horario: sem, a lista de sempre diz isso.
  const comHorario = async (u: Unidade) => (await horariosLivres(admin, clinicId, u.id)).horarios.length > 0

  if (plano && citada && citada.id !== plano.unidade.id) {
    // "Mas Unimed nao e tudo a mesma coisa?" (rodada 3 do painel) recebeu o
    // mesmo aviso, palavra por palavra. A pergunta tem resposta.
    const tudoIgual = /\b(tudo igual|mesma coisa|tudo a mesma|nao e tudo|qualquer unimed|todas as unimed)\b/.test(normalizar(pedido)) && /unimed/i.test(plano.nome)
    const aviso =
      (tudoIgual ? 'Cada Unimed é uma cooperativa diferente, com rede própria. ' : '') +
      `Em *${citada.name}* a consulta é particular, com recibo para você pedir reembolso ao seu plano. ` +
      `A *${plano.nome}* é atendida em *${plano.unidade.name}*.`
    return await comAviso(aviso, perguntarUnidade(admin, clinicId, conversationId))
  }
  if (plano && (await comHorario(plano.unidade))) {
    await salvarEstado(admin, conversationId, { booking_insurance: plano.nome, booking_modality: 'presencial' })
    const aviso = citada
      ? `📍 *${plano.unidade.name}*, pela *${plano.nome}* 👇`
      : `Pela *${plano.nome}*, ${perfil().o} atende em *${plano.unidade.name}*. Separei a agenda de lá 👇`
    return await comAviso(aviso, diasOuHorario(admin, clinicId, conversationId, plano.unidade, pedido))
  }
  if (citada && particular && (await comHorario(citada))) {
    await salvarEstado(admin, conversationId, { booking_insurance: '', booking_modality: 'presencial' })
    return await comAviso(`📍 *${citada.name}*, particular 👇`, diasOuHorario(admin, clinicId, conversationId, citada, pedido))
  }
  if (citada && (await comHorario(citada))) {
    // Unidade so particular: nao ha convenio a perguntar, e o dia do pedido vale.
    if (planosDaUnidade(citada).length === 0) {
      await salvarEstado(admin, conversationId, { booking_insurance: '', booking_modality: 'presencial' })
      return await diasOuHorario(admin, clinicId, conversationId, citada, pedido)
    }
    return await perguntarConvenioOuDia(admin, clinicId, conversationId, citada)
  }
  // "Preciso de uma consulta o quanto antes": a unidade do primeiro horario.
  const cedo = await unidadeMaisCedo(admin, clinicId, conversationId, pedido, relogioEmFoco ?? new Date(), 'pedido')
  if (cedo) return cedo
  return await perguntarUnidade(admin, clinicId, conversationId)
}

/**
 * Entrada do agendamento. Pergunta o paciente antes de tudo quando ha mais de
 * um no mesmo telefone; caso contrario segue direto para a unidade.
 */
async function iniciarAgendamento(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  pacientes: Paciente[],
  consultas: ConsultaMarcada[] = [],
  jaAvisouDaOutra = false,
  /** "Marcar mais uma": pergunta para quem, com "Outra criança" (ver OUTRA_CRIANCA). */
  maisUma = false,
  /**
   * A frase do pedido, quando ele veio escrito (16/10/2026): o paciente, a
   * unidade e o convenio que ela ja diz nao sao perguntados de novo. Ver
   * pacienteCitado e unidadeDoPedido.
   */
  pedido = '',
): Promise<Resultado> {
  // Ja existe consulta futura para este telefone. Seguir direto para as datas
  // produziria uma segunda consulta em silencio - e na maioria das vezes a
  // pessoa queria justamente trocar a data da que ja tem.
  if (consultas.length > 0 && !jaAvisouDaOutra) {
    const timezone = await fusoDaClinica(admin, clinicId)
    await salvarEstado(admin, conversationId, {
      booking_state: 'ja_tem_consulta',
      booking_options: [consultas[0].id],
      booking_replaces_id: null,
    })
    // Consulta recem-marcada com o cadastro pela metade: quem toca em "Marcar
    // uma consulta" logo depois quase sempre esta tentando terminar o que
    // comecou, e nao marcar outra (24/09/2026). A saida vira o terceiro botao.
    const pendente = await fichaPendente(admin, consultas)
    return {
      resposta:
        `Você já tem uma consulta marcada:\n\n${descreverConsulta(consultas[0], timezone)}\n\n` +
        (pendente ? '📋 O cadastro dessa consulta ainda está incompleto.\n\n' : '') +
        'O que você prefere?\n\n' +
        '1 - Remarcar (trocar por outra data)\n' +
        '2 - Marcar mais uma consulta, além dessa\n' +
        (pendente ? 'Ou toque em *Completar cadastro*.\n\n' : '\n') +
        VOLTA,
      botoes: [
        { id: '1', titulo: 'Remarcar essa' },
        { id: '2', titulo: 'Marcar mais uma' },
        pendente
          ? { id: 'FICHA', titulo: 'Completar cadastro' }
          : { id: 'MENU', titulo: 'Voltar ao menu' },
      ],
    }
  }

  // Telefone sem paciente pedindo retorno (26/10/2026): antes das datas, achar
  // o paciente para saber o prazo (ver perguntarPacienteDoRetorno). So quando
  // a clinica ja marca consulta e retorno no prontuario: antes disso nenhum
  // cadastro tem prazo confirmado, e a busca so atrasaria a marcacao.
  if (pacientes.length === 0 && (await falouEmRetorno(admin, conversationId)) && (await clinicaMarcaORetorno(admin, clinicId))) {
    return await perguntarPacienteDoRetorno(admin, conversationId, false)
  }

  // "Marcar mais uma" pergunta para quem, mesmo com um paciente so: a outra
  // consulta quase sempre e de outro filho (ver OUTRA_CRIANCA). Quem ja disse
  // o nome no pedido ("queria marcar pro teo") nao e perguntado.
  if (pacientes.length > 1 || (maisUma && pacientes.length === 1)) {
    const citado = pedido ? pacienteCitado(pacientes, pedido) : null
    if (!citado) return await perguntarPaciente(admin, conversationId, pacientes, maisUma)
    await salvarEstado(admin, conversationId, { booking_patient_id: citado.id })
  } else {
    await salvarEstado(admin, conversationId, {
      booking_patient_id: pacientes[0]?.id ?? null,
    })
  }
  return pedido ? await unidadeDoPedido(admin, clinicId, conversationId, pedido) : await perguntarUnidade(admin, clinicId, conversationId)
}

/**
 * A unidade pelo nome escrito ou tocado (06/10/2026).
 *
 * Toque em lista ANTIGA chega como o titulo do item (ver oQueFoiEscolhido).
 * A Patricia estava nas datas da telemedicina, rolou a conversa, tocou
 * "Telemedicina (por video)" na lista de unidades de cima e recebeu "Nao
 * entendi. Responda com o numero do dia". Quem toca o nome de uma unidade
 * quer aquela unidade.
 */
const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

/** "Sesta feira", "tersa" (rodada 3 do painel): o dia como se escreve. */
function semErroNosDias(t: string): string {
  return t
    .replace(/\bsesta\b/g, 'sexta')
    .replace(/\btersa\b/g, 'terca')
    .replace(/\bqinta\b/g, 'quinta')
    .replace(/\bsabdo\b/g, 'sabado')
    .replace(/\bsegunda feira\b/g, 'segunda')
}

/**
 * O dia pelo nome: "sexta pela manha", "quarta", "amanha", "dia 14"
 * (09/10/2026).
 *
 * A Tatiane escreveu "Sexta pela manha" com a lista de datas na tela e ouviu
 * "Nao entendi"; a secretaria teve de entrar. Com mais de uma sexta na lista,
 * vale a mais proxima - a tela seguinte mostra a data por extenso, e VOLTAR
 * continua ali. Devolve o indice na lista, ou -1.
 */
export function diaPeloNome(texto: string, dias: string[], agora = new Date()): number {
  const t = semErroNosDias(normalizar(texto))
  const semana = (chave: string) => new Date(`${chave}T12:00:00Z`).getUTCDay()
  const citados = DIAS_DA_SEMANA.filter((d) => new RegExp(`\\b${d}\\b`).test(t))
  // O dia do mes vence o da semana (16/10/2026, painel): "sexta dia 23" abria
  // a primeira sexta da lista, a 16, e um toque remarcaria para o dia errado.
  // "Quinta 22" (sem o "dia") vale igual; "quinta 14h" e hora, e fica de fora.
  // Dia da semana e do mes que nao batem ("sexta dia 22", numa quinta): nenhum,
  // e a lista volta - chutar um dos dois erraria metade das vezes.
  const doMes =
    t.match(/\bdia\s+(\d{1,2})\b/) ??
    t.match(new RegExp(`\\b(?:${DIAS_DA_SEMANA.join('|')})\\b(?:\\s*feira)?[\\s,]+(?:dia\\s+)?(\\d{1,2})\\b(?!\\s*(?:h\\b|hs\\b|horas|:|\\/))`))
  if (doMes) {
    const doDia = dias.filter((chave) => Number(chave.slice(8, 10)) === Number(doMes[1]))
    if (doDia.length !== 1) return -1
    if (citados.length === 1 && semana(doDia[0]) !== DIAS_DA_SEMANA.indexOf(citados[0])) return -1
    return dias.indexOf(doDia[0])
  }
  if (citados.length === 1) {
    const alvo = DIAS_DA_SEMANA.indexOf(citados[0])
    return dias.findIndex((chave) => semana(chave) === alvo)
  }
  if (citados.length > 1) return -1
  const hoje = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  if (/\bhoje\b/.test(t)) return dias.indexOf(hoje)
  if (/\bamanha\b/.test(t) && !/\bdepois de amanha\b/.test(t)) {
    const d = new Date(`${hoje}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return dias.indexOf(d.toISOString().slice(0, 10))
  }
  const m = t.match(/\bdia\s+(\d{1,2})\b/)
  if (m) {
    const doDia = dias.filter((chave) => Number(chave.slice(8, 10)) === Number(m[1]))
    return doDia.length === 1 ? dias.indexOf(doDia[0]) : -1
  }
  return -1
}

async function unidadePeloNome(admin: Admin, clinicId: string, texto: string): Promise<Unidade | null> {
  const t = normalizar(texto)
  if (!t || /^\d+$/.test(t)) return null
  const unidades = await opcoesDeAtendimento(admin, clinicId)
  const exata = unidades.find((u) => normalizar(u.name) === t || normalizar(tituloCurto(u.name)) === t)
  if (exata) return exata
  // "Santos", "sao paulo", "telemedicina" (09/10/2026): parte do nome tambem
  // vale, desde que aponte uma unidade so. Palavras de 3 letras ou mais, para
  // "de" e "a" nao casarem com tudo.
  const palavras = t.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((p) => p.length >= 3)
  if (palavras.length === 0 || palavras.length > 4) return null
  const candidatas = unidades.filter((u) => {
    const nome = normalizar(u.name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    return palavras.every((p) => nome.includes(p))
  })
  return candidatas.length === 1 ? candidatas[0] : null
}

/**
 * A unidade escrita do jeito que a pessoa fala, SO na pergunta "Em qual
 * unidade?" (14/10/2026).
 *
 * O painel de familias simuladas travou 7 de 16 conversas aqui: "santos",
 * "pode ser em santos", "sao paulo", "sp" recebiam "Nao entendi. Responda com o
 * numero". unidadePeloNome exige que TODA palavra do texto esteja no nome da
 * unidade - certo nas outras etapas, onde um "santos" solto no meio de uma
 * frase nao pode trocar a unidade de quem esta escolhendo o horario. Aqui a
 * pergunta e justamente qual unidade, entao basta a frase citar uma palavra
 * que so uma unidade tem ("santos", "paulo", "ibirapuera"), ou um apelido
 * ("sp", "online", "video"). Duas unidades citadas: nenhuma, e a lista volta.
 */
const PALAVRAS_GENERICAS_DE_UNIDADE = new Set(['livance', 'liferty', 'unidade', 'clinica', 'consultorio', 'por', 'sao'])

function unidadeCitada(unidades: Unidade[], texto: string): Unidade | null {
  const t = ` ${normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `
  if (!t.trim() || /^\s*\d+\s*$/.test(t)) return null
  const palavrasDe = (u: Unidade) =>
    normalizar(u.name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((p) => p.length >= 3 && !PALAVRAS_GENERICAS_DE_UNIDADE.has(p))
  const quantas = new Map<string, number>()
  for (const u of unidades) for (const p of new Set(palavrasDe(u))) quantas.set(p, (quantas.get(p) ?? 0) + 1)
  const apelido = (u: Unidade) =>
    (/ (sp|sampa) /.test(t) && /\bpaulo\b/.test(normalizar(u.name))) ||
    (/ (online|on line|video|videochamada|chamada de video|tele|remota|a distancia) /.test(t) && u.id === TELE_ID)
  // "nao quero santos", "santos nao da" (segunda rodada do painel): a unidade
  // negada nao e escolhida. Sem isso, "nao precisa ser em santos" abria as
  // datas de Santos. Basta um "nao" ate quatro palavras antes, ou logo depois.
  // So as palavras de quem recusa podem ficar entre o "nao" e a unidade
  // (rodada 3 do painel): "nao aceita no Tatuape mesmo?" e pergunta, e o
  // "nao" de "aceita" tirava o Tatuape da frase.
  const negada = (p: string) => {
    const palavras = t.trim().split(' ')
    return palavras.some((w, i) => {
      if (w !== p) return false
      if (palavras[i + 1] === 'nao') return true
      const antes = palavras.slice(Math.max(0, i - 4), i)
      const j = antes.lastIndexOf('nao')
      // O "nao" de outra unidade nao nega esta (25/10/2026, rodada 5 do
      // painel): em "santos nao, tatuape" o "nao" e do Santos, e o Tatuape
      // tambem saia, com "Nao entendi qual unidade".
      if (j > 0 && quantas.has(antes[j - 1])) return false
      return j >= 0 && antes.slice(j + 1).every((x) => PODE_FICAR_NA_RECUSA.has(x))
    })
  }
  const citadas = unidades.filter((u) => palavrasDe(u).some((p) => quantas.get(p) === 1 && t.includes(` ${p} `) && !negada(p)) || apelido(u))
  if (citadas.length > 0) return citadas.length === 1 ? citadas[0] : null

  // Erro de digitacao no nome (16/10/2026, painel): "higienopoli" mandava os
  // enderecos e tirava a lista. Uma ou duas letras de diferenca no fim, ou uma
  // letra trocada em palavra comprida, ainda e a mesma unidade. So quando
  // nenhum nome exato apareceu: "santos" e Santos, e nao Santo Andre.
  const daMensagem = t.trim().split(' ')
  const parecida = (p: string) =>
    daMensagem.some(
      (w) =>
        w !== p &&
        w.length >= 5 &&
        !negada(w) &&
        ((p.startsWith(w) && p.length - w.length <= 2) || (w.startsWith(p) && w.length - p.length <= 2) || (w.length >= 6 && umaLetraDeDiferenca(w, p))),
    )
  const parecidas = unidades.filter((u) => palavrasDe(u).some((p) => quantas.get(p) === 1 && parecida(p)))
  return parecidas.length === 1 ? parecidas[0] : null
}

/** Entre o "nao" e a unidade recusada ("nao quero ir em Santos"). Ver unidadeCitada. */
const PODE_FICAR_NA_RECUSA = new Set([
  'quero', 'queria', 'prefiro', 'vou', 'precisa', 'preciso', 'ser', 'ir', 'em', 'no', 'na', 'pra', 'para', 'o', 'a',
  'la', 'de', 'do', 'da', 'e', 'eh', 'mais', 'mesmo', 'marcar', 'consulta', 'posso', 'consigo',
])

/**
 * A unidade em andamento recusada ("nao quero em Santos, e longe", "Santos nao
 * da") (16/10/2026, rodada 3 do painel). Ver unidadeCitada.
 */
function negouAUnidade(texto: string, unidade: Unidade): boolean {
  const t = ` ${normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `
  const palavras = t.trim().split(' ')
  const daUnidade = normalizar(unidade.name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((p) => p.length >= 4 && !PALAVRAS_GENERICAS_DE_UNIDADE.has(p))
  return palavras.some((w, i) => {
    // "Unimed Santos" e o plano, e nao a unidade.
    if (!daUnidade.includes(w) || palavras[i - 1] === 'unimed') return false
    if (palavras[i + 1] === 'nao') return true
    const antes = palavras.slice(Math.max(0, i - 4), i)
    const j = antes.lastIndexOf('nao')
    return j >= 0 && antes.slice(j + 1).every((x) => PODE_FICAR_NA_RECUSA.has(x))
  })
}

/** As duas palavras diferem em uma letra so (trocada, a mais ou a menos). */
function umaLetraDeDiferenca(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/**
 * Troca de unidade no meio dos dias ou dos horarios (16/10/2026, painel): "nao,
 * higienopolis", com a lista de Santos na tela, recebia os enderecos. O nome
 * exato continua valendo (ver unidadePeloNome); o "nao" do comeco e correcao,
 * e nao negacao da unidade que vem depois.
 */
async function trocaDeUnidade(admin: Admin, clinicId: string, texto: string): Promise<Unidade | null> {
  const exata = await unidadePeloNome(admin, clinicId, texto)
  if (exata) return exata
  const resto = normalizar(texto)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(nao|errei|opa|ops)\s+/, '')
    .replace(/^(eu )?(quero|queria|prefiro|melhor|pode ser|seria|era)\s+/, '')
    .replace(/^(em|no|na|pra|para|a|o|unidade|unidade de|de)\s+/, '')
  if (!resto || resto.split(' ').length > 3) return null
  return unidadeCitada(await opcoesDeAtendimento(admin, clinicId), resto)
}

/**
 * "Deixa a que ja esta marcada", "esquece", "desisti" (14/10/2026).
 *
 * No painel, a mae que ia remarcar mudou de ideia no meio dos horarios e ouviu
 * "Nao entendi. Responda com o numero do horario" duas vezes; outra agradeceu
 * ("ta bom, obrigada!") com a lista de unidades na tela e recebeu o mesmo. Nas
 * etapas do agendamento, isso e sair - e quem estava remarcando precisa ouvir
 * que a consulta dela continua de pe.
 */
export function desistiuDoAgendamento(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/\b(deixa|deixe|pode deixar)\b.{0,30}\b(marcada|como (esta|ta)|assim|pra la|quieto|mesma|original)\b/.test(t)) return true
  if (/\b(desisti|desisto|esquece|esqueca|deixa pra la|deixa quieto|pensando bem)\b/.test(t)) return true
  if (/\bnao (precisa|quero|vou) (mais|remarcar|marcar|mudar)\b/.test(t)) return true
  // "nao agora nao precisa... obrigada" (segunda rodada do painel): a mae que
  // acabara de cancelar ouviu "Nao entendi qual unidade". So no fim da frase:
  // "nao precisa ser em Santos" e escolha, nao desistencia.
  if (/\b(agora nao|nao agora)\b/.test(t) && !/\b(marcar|agendar|horario)\b/.test(t)) return true
  if (/\bnao precisa( nao)?( mais)?( agora)?( obrigad[oa]s?)?$/.test(t)) return true
  if (/\b(mant(er|em|enha|enho)|fica com|fico com)\b.{0,20}\b(consulta|que (ja|esta|ta)|original|mesma|data)\b/.test(t)) return true
  // Agradecimento de despedida: "ok" sozinho nao, que no meio da lista pode
  // ser so "li". Precisa de um obrigado de verdade.
  return soAgradecimento(texto) && /\b(obrigad|valeu|agradec)/.test(t)
}

/**
 * Desistencia que nao deixa duvida: vale mesmo quando a frase tambem tem dia ou
 * hora (14/10/2026, segunda rodada do painel).
 *
 * "deixa quieto, vou manter a de quarta dia 21 mesmo", com a lista de dias da
 * remarcacao na tela, abriu os horarios do dia 21: o "21" era lido antes da
 * desistencia. Um toque a mais e a consulta das 08:00 seria cancelada e trocada
 * por outra no mesmo dia - o contrario do que ela escreveu.
 *
 * So as formas que nao servem para trocar de escolha. "Pensando bem, prefiro
 * quinta" e "esquece, quero as 10" sao troca, e continuam com
 * desistiuDoAgendamento, que so vale quando nada mais foi entendido.
 */
export function desistiuComCerteza(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return (
    /\b(deixa|deixe) (quieto|pra la|como (esta|ta))\b/.test(t) ||
    /\b(desisti|desisto)\b/.test(t) ||
    /\b(vou|quero|prefiro|melhor|pode) mant(er|enho)\b/.test(t) ||
    /\bnao (vou|quero|precisa) mais (remarcar|marcar|mudar|trocar)\b/.test(t)
  )
}

/**
 * Recusa do horario ou do dia citado (16/10/2026, painel de pacientes
 * simulados): "17:20 nao da pra mim, deixa. vlw" saiu marcado as 17:20. A hora
 * estava na frase, e o "nao da" nao era lido.
 *
 * Devolve o que vem depois da recusa, a partir da virgula ou do "so", "mas",
 * "prefiro": em "14h nao posso, so 16h" o pedido e as 16h. Sem nada depois, a
 * pessoa so recusou. Pergunta nao e recusa: "as 14h nao da?" pede as 14h.
 */
export function recusaDeEscolha(texto: string): { depois: string } | null {
  if (texto.includes('?')) return null
  const t = normalizar(texto)
  const m = t.match(/\b(nao|nem)\s+(da|serve|posso|consigo|rola|vai dar|fica bom|e bom|me serve|da certo|tenho como|vou conseguir|vou poder|funciona)\b/)
  if (!m) return null
  const resto = t.slice((m.index ?? 0) + m[0].length)
  const separador = resto.search(/[,;.!]|\s(mas|so|somente|apenas|prefiro|pode ser|melhor|quero|queria|entao|tem)\s/)
  return { depois: separador >= 0 ? resto.slice(separador) : '' }
}

/**
 * "Nao quero marcar, cancela isso" no meio da ficha (16/10/2026, painel): a
 * pessoa desistiu da consulta que acabou de marcar. Estreita de proposito: na
 * ficha, "nao sei" e "deixa pra la" sao pular a pergunta, e nao desmarcar.
 */
function desistiuDaConsultaNaFicha(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return (
    /\b(cancela|cancele|cancelar|desmarca|desmarque|desmarcar)( (isso|tudo|essa|esta|a|o|consulta|agendamento|marcacao|horario|por favor|pf|pfv))*$/.test(t) ||
    /\bnao (quero|vou|preciso) (mais )?(marcar|agendar|a consulta|essa consulta|consulta)\b/.test(t) ||
    /\b(desisti|desisto)\b/.test(t)
  )
}

/** "deixa", "vlw", "obrigada" junto da recusa: a pessoa encerrou. */
function encerrouComARecusa(texto: string): boolean {
  return desistiuDoAgendamento(texto) || /\b(deixa|deixe|esquece|vlw|valeu|obrigad|agradec)/.test(normalizar(texto))
}

async function sairDoAgendamento(
  admin: Admin,
  conversationId: string,
  clinicId: string,
  consultaASubstituir: string | null,
  consultas: ConsultaMarcada[],
): Promise<Resultado> {
  await limparEstado(admin, conversationId)
  const mantida = consultaASubstituir ? consultas.find((c) => c.id === consultaASubstituir) : null
  if (mantida) {
    const timezone = await fusoDaClinica(admin, clinicId)
    return {
      resposta:
        `Tudo bem! Não mudei nada: sua consulta continua marcada.\n\n${descreverConsulta(mantida, timezone)}\n\n` +
        'Se precisar, é só escrever por aqui. ' + VOLTA,
      concluida: true,
    }
  }
  return { resposta: 'Tudo bem, não marquei nada. Quando quiser, é só escrever por aqui. 💙', concluida: true }
}

/** O primeiro horario livre de cada unidade fisica, do mais cedo para o mais tarde. */
async function primeirosHorarios(admin: Admin, clinicId: string): Promise<{ unidade: Unidade; horarios: Horario[] }[]> {
  const unidades = (await opcoesDeAtendimento(admin, clinicId)).filter((u) => u.id !== TELE_ID)
  const com = await Promise.all(unidades.map(async (u) => ({ unidade: u, horarios: (await horariosLivres(admin, clinicId, u.id)).horarios })))
  return com.filter((c) => c.horarios.length > 0).sort((a, b) => a.horarios[0].inicio.localeCompare(b.horarios[0].inicio))
}

/** "a, b e c". */
function emLista(itens: string[]): string {
  return itens.length > 1 ? `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}` : (itens[0] ?? '')
}

/** "8h" ou "08:20", como a pessoa pediu. */
function horaFalada(pedida: { hora: number; minuto: number | null }): string {
  return pedida.minuto === null ? `${pedida.hora}h` : `${String(pedida.hora).padStart(2, '0')}:${String(pedida.minuto).padStart(2, '0')}`
}

/** Os horarios na hora pedida; sem os minutos, a hora inteira (8h = 08:00 e 08:40). */
function naHoraPedida(horarios: Horario[], pedida: { hora: number; minuto: number | null }, timezone: string): Horario[] {
  return horarios.filter((h) => {
    const [hh, mm] = formatarHora(h.inicio, timezone).split(':').map(Number)
    return hh === pedida.hora && (pedida.minuto === null || mm === pedida.minuto)
  })
}

/**
 * O primeiro horario livre na hora pedida, em cada unidade, do mais cedo para
 * o mais tarde (16/10/2026, rodada 2 do painel). "E as 8 da manha tem?" foi
 * para a equipe como "nao entendi", e "qualquer uma que tenha as 8h" abriu a
 * unidade que so atende a tarde, porque era a de horario mais cedo.
 */
async function ondeTemNaHora(
  admin: Admin,
  clinicId: string,
  pedida: { hora: number; minuto: number | null },
): Promise<{ unidade: Unidade; horario: Horario }[]> {
  const timezone = await fusoDaClinica(admin, clinicId)
  return (await primeirosHorarios(admin, clinicId))
    .map((c) => ({ unidade: c.unidade, horario: naHoraPedida(c.horarios, pedida, timezone)[0] }))
    .filter((c): c is { unidade: Unidade; horario: Horario } => Boolean(c.horario))
    .sort((a, b) => a.horario.inicio.localeCompare(b.horario.inicio))
}

/**
 * Hora ou turno pedido no passo do dia, sem o dia (16/10/2026, rodada 2 do
 * painel): "nao, quero de manha as 8h" no Tatuape, que so atende a tarde,
 * ouviu "Nao entendi". Diz os dias da lista que tem; sem nenhum, as unidades
 * que tem.
 */
async function diasComAHora(
  admin: Admin,
  clinicId: string,
  unidadeId: string,
  dias: string[],
  pedida: { hora: number; minuto: number | null } | null,
  turno: 'manha' | 'tarde' | null,
): Promise<Resultado | null> {
  // Entendeu so metade (a hora, e nao o dia): com a equipe conversando, cala
  // como um nao entendi (ver tratarConversa). A hora pode ser para a secretaria.
  registrar('nao_entendi', 'hora_sem_dia')
  const timezone = await fusoDaClinica(admin, clinicId)
  const serve = (h: Horario) =>
    pedida ? naHoraPedida([h], pedida, timezone).length > 0 : (formatarHora(h.inicio, timezone) < '12:00') === (turno === 'manha')
  const { horarios } = await horariosLivres(admin, clinicId, unidadeId)
  const doPedido = horarios.filter(serve)
  const nome = pedida ? `Às ${horaFalada(pedida)}` : turno === 'manha' ? 'De manhã' : 'À tarde'
  const naLista = dias
    .map((chave, i) => ({ chave, i }))
    .filter(({ chave }) => doPedido.some((h) => chaveDoDia(h.inicio, timezone) === chave))
  if (naLista.length === dias.length && dias.length > 0) {
    return { resposta: `${nome} há horário em todos os dias da lista acima. Responda com o número do dia.` }
  }
  if (naLista.length > 0) {
    const rotulos = naLista.map(({ chave, i }) => `*${i + 1}* ${formatarDia(`${chave}T12:00:00Z`, 'UTC')}`)
    return { resposta: `${nome}, nesta unidade, há horário nestes dias: ${emLista(rotulos)}.\n\nResponda com o número do dia.` }
  }
  const unidade = (await opcoesDeAtendimento(admin, clinicId)).find((u) => u.id === unidadeId)
  const outras = (await primeirosHorarios(admin, clinicId))
    .filter((c) => c.unidade.id !== unidadeId)
    .map((c) => ({ unidade: c.unidade, horario: c.horarios.find(serve) }))
    .filter((c): c is { unidade: Unidade; horario: Horario } => Boolean(c.horario))
    .sort((a, b) => a.horario.inicio.localeCompare(b.horario.inicio))
  const aqui = `Em *${unidade?.name ?? 'esta unidade'}* não há horário livre ${pedida ? `às ${horaFalada(pedida)}` : turno === 'manha' ? 'de manhã' : 'à tarde'}.`
  return {
    resposta: outras.length
      ? `${aqui} ${nome} há em ${descreverOndeTem(outras, timezone)}.\n\n` +
        'Digite VOLTAR para escolher outra unidade, ou responda com o número de um dia da lista acima.'
      : `${aqui} Nas outras unidades também não há.\n\n` +
        'Responda com o número de um dia da lista acima, ou digite *9* para falar com a nossa equipe.',
    botoes: [
      { id: 'VOLTAR', titulo: 'Outra unidade' },
      { id: '9', titulo: 'Falar com a equipe' },
      { id: '0', titulo: 'Voltar ao menu' },
    ],
  }
}

/** "*Santos · Boqueirao* (sexta, 16/10 as 08:00) e *Higienopolis* (terca, 20/10 as 08:00)". */
function descreverOndeTem(lista: { unidade: Unidade; horario: Horario }[], timezone: string): string {
  return emLista(lista.map((c) => `*${c.unidade.name}* (${formatarData(c.horario.inicio, timezone)})`))
}

/**
 * Os dias e horarios de cada unidade, lidos dos horarios livres (16/10/2026,
 * rodada 2 do painel). "E qual o ultimo horario do dia? So saio do trabalho as
 * 18h", "ate que horas o doutor atende?" e "e em SP ele atende que dia?"
 * ouviram "nao entendi" ou o texto geral "de segunda a sexta, conforme a
 * unidade". Vem da agenda aberta, entao diz o que da para marcar, e nao o que
 * um texto fixo prometeu. Vazio sem horario livre nenhum.
 */
async function resumoDaAgenda(admin: Admin, clinicId: string): Promise<string> {
  const timezone = await fusoDaClinica(admin, clinicId)
  const todas = await primeirosHorarios(admin, clinicId)
  if (todas.length === 0) return ''
  const NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
  const diaDaSemana = (h: Horario) => new Date(`${chaveDoDia(h.inicio, timezone)}T12:00:00Z`).getUTCDay()
  let ultimo = ''
  const linhas = todas.map(({ unidade, horarios }) => {
    const porDia = new Map<number, string[]>()
    for (const h of horarios) porDia.set(diaDaSemana(h), [...(porDia.get(diaDaSemana(h)) ?? []), formatarHora(h.inicio, timezone)])
    const partes = [...porDia.entries()]
      // Segunda primeiro: a semana do consultorio.
      .sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7))
      .map(([dia, horas]) => {
        const ordem = [...new Set(horas)].sort()
        const primeiro = ordem[0]
        const fim = ordem[ordem.length - 1]
        if (fim > ultimo) ultimo = fim
        const turno = fim < '12:00' ? 'de manhã' : primeiro >= '12:00' ? 'à tarde' : 'de manhã e à tarde'
        return `${NOMES[dia]} ${turno}, das ${primeiro} às ${fim}`
      })
    return `• *${unidade.name}*: ${emLista(partes)}`
  })
  const fimDeSemana = todas.some((c) => c.horarios.some((h) => [0, 6].includes(diaDaSemana(h))))
  return (
    '🕐 *Dias e horários com vaga*\n\n' +
    `${linhas.join('\n')}\n\n` +
    `O horário é o começo da consulta: a última do dia começa às ${ultimo}.` +
    (ultimo <= '18:00' ? (fimDeSemana ? ' Não há atendimento à noite.' : ' Não há atendimento à noite nem aos fins de semana.') : '') +
    // O horario da equipe tambem (rodada 3 do painel): quem perguntou do
    // atendimento nao soube quando alguem responde por aqui.
    `\n\nA nossa equipe responde por aqui de ${EXPEDIENTE.texto}.`
  )
}

/**
 * Pergunta sobre a agenda, e nao pedido de marcar (16/10/2026, rodada 2): "qual
 * o ultimo horario do dia?", "ate que horas o doutor atende?", "em sp ele
 * atende que dia?", "voces abrem sabado?". "Qual o primeiro horario" fica com
 * perguntouMaisCedo: ali a resposta e a vaga, e nao o resumo.
 */
function perguntouDaAgenda(texto: string): boolean {
  // "Ate q horas" (rodada 3 do painel): o "q" e "que".
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\bq\b/g, 'que').replace(/\s+/g, ' ')
  return (
    /\b(ultimo|ultima) (horario|consulta|vaga|atendimento)\b/.test(t) ||
    /\bultimo da (tarde|manha)\b/.test(t) ||
    /\bate que (horas|hora|horario)\b/.test(t) ||
    // "Qual o horario de atendimento?" (26/10/2026, sondagem das etapas para
    // o Jev): no menu ia para a equipe como "nao entendi", e no meio do
    // agendamento recebia "responda com o numero do dia".
    /\bhorarios? de (atendimento|funcionamento)\b/.test(t) ||
    /\b(que|quais|qual|em que) (dia|dias)\b( \w+){0,5} (atende|atendem|tem|ha|abre|abrem|funciona|funcionam|fica)\b/.test(t) ||
    /\b(atende|atendem|abre|abrem|funciona|funcionam)\b( \w+){0,4} (que|quais|qual) (dia|dias|horario|horarios)\b/.test(t) ||
    /\b(que|qual) (horas|horario) (ele |o dr |o doutor |o medico |voces |vcs )?(atende|atendem|comeca|abre|abrem|fecha|fecham|termina)\b/.test(t) ||
    /\b(abre|abrem|atende|atendem|funciona|funcionam)\b( \w+){0,3} (sabado|sabados|domingo|fim de semana|final de semana|a noite|de noite)\b/.test(t)
  )
}

/**
 * A resposta a pergunta de agenda, ou vazio quando nao e pergunta de agenda:
 * a hora pedida ("tem as 8h?") ou o resumo dos dias. Ver resumoDaAgenda.
 */
async function respostaDaAgenda(
  admin: Admin,
  clinicId: string,
  texto: string,
  /** O resumo ja saiu ha pouco: nao vai de novo, logo abaixo do primeiro. */
  jaTemResumo = false,
): Promise<string> {
  // Remedio e sintoma ficam com a trava clinica, mesmo com hora na frase.
  if (assuntoClinico(texto)) return ''
  const t = normalizar(texto).replace(/\bq\b/g, 'que')
  // "E aqui no whats voces respondem ate que horas?" (rodada 3 do painel): e o
  // horario da equipe, e nao o da agenda. Recebeu a saudacao e o menu.
  if (/\b(respond\w*|whats\w*|zap|por aqui|conversa|chat)\b/.test(t) && /\b(ate que horas?|que horas?|horario)\b/.test(t) && !/\b(consulta|doutor|dr|medico|atende)\b/.test(t)) {
    return `A nossa equipe responde por aqui de ${EXPEDIENTE.texto}. Fora desse horário, o atendimento automático marca consultas e tira dúvidas.`
  }
  const resumo = async () => (jaTemResumo ? '' : await resumoDaAgenda(admin, clinicId))
  const comResumo = async (frase: string) => {
    const r = await resumo()
    return r ? `${frase}\n\n${r}` : frase
  }
  const pedida = horaEscrita(texto)
  // "E qual o ultimo horario do dia? So saio do trabalho as 18h" (rodada 2):
  // a pergunta e o ultimo horario, e o 18h e contexto.
  if (perguntouDaAgenda(texto) && /\b(ultimo|ultima)\b|\bate que horas?\b/.test(t)) {
    const timezone = await fusoDaClinica(admin, clinicId)
    const horas = (await primeirosHorarios(admin, clinicId)).flatMap((c) => c.horarios.map((h) => formatarHora(h.inicio, timezone))).sort()
    const ultimo = horas[horas.length - 1]
    if (ultimo) {
      const [hh, mm] = ultimo.split(':').map(Number)
      const depoisDoUltimo = pedida && pedida.hora * 60 + (pedida.minuto ?? 0) > hh * 60 + mm
      const aviso = depoisDoUltimo ? `Às ${horaFalada(pedida)} já não há horário. ` : ''
      const r = await resumo()
      // O resumo ja diz a ultima do dia; sem ele, a frase diz.
      if (r) return aviso ? `${aviso.trim()}\n\n${r}` : r
      return `${aviso}A última consulta do dia começa às ${ultimo}. Os dias de cada unidade estão logo acima 👆`
    }
  }
  if (pedida && (parecePergunta(texto) || /\b(tem|teria|ha|existe)\b/.test(t)) && !pediuParaMarcar(texto)) {
    const timezone = await fusoDaClinica(admin, clinicId)
    const onde = await ondeTemNaHora(admin, clinicId, pedida)
    if (onde.length > 0) return `Tem, sim 🙂 Às ${horaFalada(pedida)}, o primeiro horário livre de cada unidade é: ${descreverOndeTem(onde, timezone)}.`
    return await comResumo(`Às ${horaFalada(pedida)} não há horário em nenhuma unidade.`)
  }
  // "Mas e sabado? Tem ou nao?" (rodada 2 do painel): sim ou nao, e nao o
  // texto geral de novo.
  if (/\b(sabados?|domingos?|fim de semana|final de semana)\b/.test(t) && parecePergunta(texto)) {
    const timezone = await fusoDaClinica(admin, clinicId)
    const noFim = (await primeirosHorarios(admin, clinicId)).flatMap((c) => {
      const h = c.horarios.find((x) => [0, 6].includes(new Date(`${chaveDoDia(x.inicio, timezone)}T12:00:00Z`).getUTCDay()))
      return h ? [{ unidade: c.unidade, horario: h }] : []
    })
    if (noFim.length > 0) return `Tem, sim 🙂 No fim de semana, o primeiro horário livre é: ${descreverOndeTem(noFim, timezone)}.`
    return await comResumo('Não. Aos sábados e domingos não há atendimento em nenhuma unidade.')
  }
  if (!perguntouDaAgenda(texto)) return ''
  const r = await resumo()
  if (r) return r
  return 'Os dias e horários estão logo acima 👆'
}

/**
 * "Nao tem antes?", "hj nao da?" no meio da agenda (16/10/2026, painel de
 * pacientes simulados). "So dia 20? Nao tem nada antes? Li que perda de
 * audicao repentina precisa ser vista logo" abriu os horarios do dia 20, e o
 * Tatuape tinha horario na quinta. A resposta diz o primeiro horario desta
 * unidade e, quando outra tem antes, qual e quando. Vazio quando nao ha nada a
 * dizer.
 */
async function informarMaisCedo(
  admin: Admin,
  clinicId: string,
  unidadeId: string,
  quando: 'hoje' | 'antes',
  agora: Date,
): Promise<string> {
  const timezone = await fusoDaClinica(admin, clinicId)
  const todas = await primeirosHorarios(admin, clinicId)
  const desta = todas.find((c) => c.unidade.id === unidadeId)
  const hoje = agora.toLocaleDateString('en-CA', { timeZone: timezone })
  const partes: string[] = []
  if (quando === 'hoje') {
    const comHoje = todas.filter((c) => c.horarios.some((h) => chaveDoDia(h.inicio, timezone) === hoje))
    partes.push(comHoje.length === 0 ? 'Hoje não temos horário livre em nenhuma unidade.' : `Hoje há horário em *${comHoje.map((c) => c.unidade.name).join('* e *')}*.`)
  }
  if (desta) partes.push(`O primeiro horário em *${desta.unidade.name}* é ${formatarData(desta.horarios[0].inicio, timezone)}.`)
  const antes = todas.find((c) => c.unidade.id !== unidadeId && (!desta || c.horarios[0].inicio < desta.horarios[0].inicio))
  if (antes) {
    partes.push(
      `Em *${antes.unidade.name}* há antes: ${formatarData(antes.horarios[0].inicio, timezone)}` +
        `${planosDaUnidade(antes.unidade).length ? '' : ' (particular)'}. Para ir para lá, digite VOLTAR e escolha a unidade.`,
    )
  }
  return partes.join(' ')
}

/**
 * "Qual tem horario mais cedo?", "tanto faz, a q tiver mais cedo", "o
 * primeiro horario disponivel", "a q tiver amanha" (16/10/2026, painel): na
 * escolha da unidade, isso recebia "Nao entendi qual unidade". Escolhe a
 * unidade do primeiro horario (de amanha, se a pessoa disse amanha) e diz qual
 * e quando. Null quando a frase nao e isso, ou quando nao ha horario.
 */
async function unidadeMaisCedo(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  texto: string,
  agora: Date,
  /** 'pedido' = a primeira mensagem, que so conta com pressa explicita (ver comPressa). */
  onde: 'unidade' | 'pedido' = 'unidade',
): Promise<Resultado | null> {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  // Na lista de unidades, "a primeira" pode ser a unidade 1: so conta
  // "primeiro horario", "a que tiver", "qual tem pra hoje".
  const pressa =
    onde === 'pedido'
      ? comPressa(texto)
      : perguntouMaisCedo(texto) !== null ||
        /\b(qualquer|qlq|tanto faz|o que tiver|a que tiver|a q tiver|o que der|primeiro que tiver|primeira que tiver|o mais rapido|primeiro horario|primeira vaga|primeiro disponivel)\b/.test(t) ||
        /\bqual tem\b.*\b(horario|vaga|pra|para|hoje|hj|amanha|antes|cedo)\b/.test(t)
  if (!pressa) return null
  const timezone = await fusoDaClinica(admin, clinicId)
  // "Qual o horario mais proximo, Higienopolis ou Tatuape?" (rodada 3 do
  // painel) recebeu a lista das tres: so as citadas, quando sao duas ou mais.
  const citadas = (await opcoesDeAtendimento(admin, clinicId)).filter((u) => u.id !== TELE_ID && unidadeCitada([u], texto))
  const todas = (await primeirosHorarios(admin, clinicId)).filter((c) => citadas.length < 2 || citadas.some((u) => u.id === c.unidade.id))
  if (todas.length === 0) return null
  const hoje = agora.toLocaleDateString('en-CA', { timeZone: timezone })
  const amanha = (() => {
    const d = new Date(`${hoje}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  })()
  const pedido = /\bamanha\b/.test(t) ? amanha : perguntouMaisCedo(texto) === 'hoje' ? hoje : null
  // "Qualquer uma que tenha as 8h" (rodada 2 do painel): a hora pedida manda.
  // Sem ela, abria o Tatuape, que so atende a tarde, por ter o horario mais
  // cedo de todos.
  const hora = horaEscrita(texto)
  // O primeiro horario de cada unidade no dia pedido (ou o primeiro de todos).
  const candidatas = todas
    .map((c) => {
      const lista = hora ? naHoraPedida(c.horarios, hora, timezone) : c.horarios
      return { ...c, primeiro: pedido ? lista.find((h) => chaveDoDia(h.inicio, timezone) === pedido) : lista[0] }
    })
    .filter((c): c is typeof c & { primeiro: Horario } => Boolean(c.primeiro))
    .sort((a, b) => a.primeiro.inicio.localeCompare(b.primeiro.inicio))
  const quando = pedido ? (pedido === hoje ? 'hoje' : 'amanhã') : ''
  const aviso =
    candidatas.length > 0 ? ''
      : hora ? `Às ${horaFalada(hora)}${quando ? ` de ${quando}` : ''} não temos horário livre em nenhuma unidade. `
        : pedido ? `${quando === 'hoje' ? 'Hoje' : 'Amanhã'} não temos horário livre em nenhuma unidade. `
          : ''
  const escolhida = candidatas[0] ?? { ...todas[0], primeiro: todas[0].horarios[0] }
  const resultado = await perguntarConvenioOuDia(admin, clinicId, conversationId, escolhida.unidade)
  return {
    ...resultado,
    resposta:
      `${aviso}${hora && candidatas.length > 0 ? `O primeiro horário às ${horaFalada(hora)} é` : 'O horário mais cedo é'} ` +
      `em *${escolhida.unidade.name}*: ${formatarData(escolhida.primeiro.inicio, timezone)}. ` +
      `Para outra unidade, digite VOLTAR.\n\n${resultado?.resposta ?? ''}`,
  }
}

async function perguntarUnidade(
  admin: Admin,
  clinicId: string,
  conversationId: string,
): Promise<Resultado> {
  const unidades = await opcoesDeAtendimento(admin, clinicId)

  if (unidades.length === 0) {
    return {
      resposta:
        'Ainda não temos unidades publicadas para agendamento por aqui.\n\n' + SAIDAS,
      atencao: 'atendente',
    }
  }

  // Uma unidade so: nao faz sentido perguntar qual, mas o convenio continua
  // valendo - e ele e justamente o caso de uma clinica com unidade unica.
  if (unidades.length === 1) {
    const plano = (unidades[0].accepts_insurance ?? '').trim()
    if (plano) return await perguntarConvenioOuDia(admin, clinicId, conversationId, unidades[0])
    return await perguntarDia(admin, clinicId, conversationId, unidades[0], false)
  }

  // Retorno em aberto (26/10/2026): a contagem e a do prazo, e nao a da
  // agenda inteira - "51 horarios livres" para quem so pode usar tres. Ja
  // usado ou vencido, e o paciente pediu retorno: ele le que e consulta ANTES
  // de escolher a data.
  const { aberto: retorno, fechado } = await retornoDaConversa(admin, clinicId, conversationId)
  const avisoDeConsulta = !retorno && fechado && (await falouEmRetorno(admin, conversationId)) ? `${fechado}\n\n` : ''
  const noPrazo: Periodo | undefined = retorno ? { de: null, ate: retorno.ate } : undefined

  // Consulta a agenda de cada unidade antes de listar. Custa uma chamada por
  // unidade, mas evita o pior roteiro possivel: a pessoa escolhe, espera, e
  // descobre que ali nao tinha nada.
  const comAgenda = await Promise.all(
    unidades.map(async (u) => ({ unidade: u, ...(await horariosLivres(admin, clinicId, u.id, noPrazo)) })),
  )

  if (comAgenda.every((u) => u.falhou)) {
    await limparEstado(admin, conversationId)
    return { resposta: AVISO_FALHA, atencao: 'falha' }
  }

  const abertas = comAgenda.filter((u) => u.horarios.length > 0)

  if (abertas.length === 0) {
    await limparEstado(admin, conversationId)
    return {
      resposta: retorno
        ? `Não temos horário livre até *${diaCurto(retorno.ate)}*, o prazo do retorno${doRetornoDe(retorno)}. ` +
          'A nossa equipe vê um encaixe com você por aqui.\n\n' + SAIDAS
        : 'No momento não temos horários abertos para agendamento pelo WhatsApp.\n\n' + SAIDAS,
      atencao: 'atendente',
    }
  }

  // "Sem horários" e "não consegui ver a agenda" são coisas diferentes, e
  // dizer a primeira quando foi a segunda é mentira com consequência: a agenda
  // de Santos pode estar cheia de vagas, o RPC ter falhado, e a família ler que
  // Santos não tem nada - escolhe São Paulo, ou desiste. horariosLivres separa
  // os dois casos justamente para isso; era aqui que a distinção se perdia.
  const rotuloDaAgenda = (u: { horarios: Horario[]; falhou?: boolean }) =>
    u.horarios.length > 0
      ? `${u.horarios.length} horário${u.horarios.length === 1 ? '' : 's'} livre${u.horarios.length === 1 ? '' : 's'}`
      : u.falhou
        ? 'não consegui ver a agenda agora'
        : 'sem horários no momento'

  // Convenio numa unidade e particular na outra (perfil 'geral', 15/10/2026):
  // no Dr. Fabio, Santos atende tres planos e Sao Paulo e particular. Dizer na
  // propria lista evita a pessoa com Unimed escolher Higienopolis e so
  // descobrir na recepcao. Com todas iguais, nada muda.
  const temPlano = (u: Unidade) => planosDaUnidade(u).length > 0
  const misturado = geral() && unidades.some(temPlano) && !unidades.every(temPlano)
  const pagamento = (u: Unidade) => (misturado && u.id !== TELE_ID ? (temPlano(u) ? ' · convênio ou particular' : ' · particular') : '')

  const linhas = comAgenda
    .map((u, i) => `*${i + 1}* ${u.unidade.name} (${rotuloDaAgenda(u)}${pagamento(u.unidade)})`)
    .join('\n')

  await salvarEstado(admin, conversationId, {
    booking_state: 'aguardando_unidade',
    booking_options: unidades.map((u) => u.id),
    booking_unit_id: null,
    // A modalidade cai junto com a unidade.
    //
    // A unidade em andamento e DERIVADA da modalidade: com 'telemedicina'
    // gravada, o resto do fluxo ignora booking_unit_id e trata tudo como
    // video. Quem escolheu telemedicina, voltou ao menu e escolheu Santos
    // saia com uma consulta por video marcada numa unidade fisica - a familia
    // indo ao endereco e o Dr. Marcello esperando na tela.
    //
    // Reaparecer a pergunta "em qual unidade?" e o momento certo de esquecer:
    // ninguem escolheu nada ainda.
    booking_modality: null,
    // O convenio tambem (16/10/2026): ele vale numa unidade e nao na outra.
    // Quem escolhia Santos pela Unimed, dava VOLTAR e escolhia o Tatuape, so
    // particular, saia com a consulta do Tatuape gravada pela Unimed.
    booking_insurance: null,
  })

  // O titulo diz que e retorno: e o paciente vendo que o robo o reconheceu,
  // antes de estranhar a lista curta.
  return {
    resposta:
      (retorno
        ? `📍 *Vamos marcar o retorno${doRetornoDe(retorno)}!* Ele está incluído até *${diaCurto(retorno.ate)}*. Em qual unidade?\n\n${linhas}\n\n`
        : `${avisoDeConsulta}📍 *Vamos agendar!* Em qual unidade você prefere ser atendido?\n\n${linhas}\n\n`) +
      `Responda com o número da unidade. ${SAIDAS}`,
    lista: {
      rotulo: 'Escolher unidade',
      linhas: comVoltar(comAgenda.map((u, i) => ({
        id: String(i + 1),
        titulo: u.unidade.name,
        descricao: `${rotuloDaAgenda(u)}${pagamento(u.unidade)}`,
      }))),
    },
  }
}

/**
 * Os convenios de uma unidade, pelo texto que a equipe escreveu (15/10/2026).
 *
 * O campo nasceu para um plano so ("Trasmontano"), e o robo oferecia dois
 * botoes: o plano e Particular. Em Santos o Dr. Fabio atende tres - Porto
 * Saude, Unimed Santos e Santa Saude -, e a equipe escreve do jeito natural,
 * com virgula. Separa por virgula, ponto e virgula, barra ou " e ".
 */
function planosDaUnidade(unidade: Unidade): string[] {
  const texto = (unidade.accepts_insurance ?? '').trim()
  if (!texto) return []
  return [...new Set(texto.split(/\s*[,;/]\s*|\s+e\s+/i).map((p) => p.trim()).filter(Boolean))]
}

/** A pergunta do convenio quando a unidade aceita mais de um plano. */
function perguntaDosPlanos(planos: string[], aviso = ''): Resultado {
  const opcoes = [...planos, 'Particular']
  const linhas = opcoes.map((p, i) => `*${i + 1}* ${p}`).join('\n')
  const cabeBotao = opcoes.length <= 3
  return {
    resposta:
      (aviso ? `${aviso}\n\n` : '') +
      `💳 Esta consulta vai ser por *convênio* ou *particular*?\n\n${linhas}\n\n` +
      (cabeBotao ? 'Responda com o número, ou toque no botão.' : 'Responda com o número, ou toque em *Escolher*.'),
    ...(cabeBotao
      ? { botoes: opcoes.map((p, i) => ({ id: String(i + 1), titulo: p.slice(0, 20) })) }
      : { lista: { rotulo: 'Escolher', linhas: comVoltar(opcoes.map((p, i) => ({ id: String(i + 1), titulo: p }))) } }),
  }
}

/** Palavra que nao distingue um plano do outro: "Porto Saude" e "Santa Saude". */
const PALAVRAS_GENERICAS_DE_PLANO = new Set(['saude', 'plano', 'planos', 'convenio', 'seguro', 'seguros', 'assistencia', 'medica', 'medico', 'odonto'])

/**
 * Qual opcao a pessoa escolheu: o indice do plano, planos.length para
 * particular, ou null. Vale o numero, o nome inteiro, ou uma palavra que so
 * um plano tem ("unimed", "porto", "santa"). Plano e particular citados na
 * mesma frase nao escolhem nada: perguntar de novo e melhor do que chutar.
 */
/**
 * A Unimed de outra cidade (16/10/2026, painel de pacientes simulados).
 *
 * A Unimed e uma cooperativa por cidade, e o Dr. Fabio atende a Unimed Santos.
 * "Tenho Unimed Paulistana" casava com "unimed" e escolhia a Unimed Santos: a
 * consulta saia gravada num convenio que a pessoa nao tem, e a recepcao so
 * descobriria na chegada. Devolve o nome da outra Unimed ("Unimed
 * Paulistana"), ou null quando a frase nao cita outra cidade ("unimed e tudo
 * igual?", "aceita unimed?").
 */
const NAO_E_CIDADE = new Set([
  'e', 'eh', 'ou', 'aceita', 'aceitam', 'vale', 'cobre', 'cobrem', 'tem', 'da', 'de', 'do', 'das', 'dos', 'nao',
  'sim', 'mesmo', 'msm', 'ai', 'aqui', 'pode', 'serve', 'funciona', 'tambem', 'tb', 'tbm', 'so', 'atende',
  'atendem', 'plano', 'convenio', 'saude', 'tudo', 'igual', 'ne', 'que', 'pra', 'para', 'por', 'pelo', 'pela',
  'com', 'agora', 'hoje', 'consulta', 'isso', 'esse', 'essa', 'qualquer', 'vcs', 'voces', 'ja', 'normal',
])

// As cooperativas e cidades que aparecem depois de "Unimed" (rodada 2 do
// painel): so a lista de palavras que nao sao cidade deixava passar "Unimed
// Em" ("pela Unimed, em Santos") e "Unimed Precisa" ("pela unimed precisa de
// pedido?"). Fora desta lista, so vale o nome escrito com maiuscula.
const CIDADES_DA_UNIMED = new Set([
  'paulistana', 'nacional', 'seguros', 'fesp', 'central', 'campinas', 'abc', 'rio', 'bh', 'guarulhos', 'sorocaba',
  'jundiai', 'ribeirao', 'osasco', 'mogi', 'piracicaba', 'bauru', 'franca', 'araraquara', 'litoral', 'intercambio',
  'federacao', 'sjc', 'curitiba', 'vitoria', 'fortaleza', 'recife', 'salvador', 'goiania', 'brasilia', 'cuiaba',
  'londrina', 'maringa', 'joinville', 'blumenau', 'florianopolis', 'belem', 'manaus', 'natal', 'maceio', 'teresina',
  'aracaju', 'uberlandia', 'contagem', 'santista', 'baixada', 'grande', 'vale', 'norte', 'sul', 'leste', 'oeste',
])
const CIDADES_DE_DUAS = [/\bunimed (sao paulo|sao jose|santo andre|porto alegre|belo horizonte|volta redonda|juiz de fora|rio preto)\b/]

function outraUnimed(texto: string, planos: string[]): string | null {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  const aceita = planos.find((p) => /\bunimed\b/.test(normalizar(p)))
  const daAceita = aceita ? normalizar(aceita).split(/\s+/) : []
  const titulo = (s: string) => s.split(' ').map((p) => `${p.charAt(0).toUpperCase()}${p.slice(1)}`).join(' ')
  for (const padrao of CIDADES_DE_DUAS) {
    const duas = t.match(padrao)
    if (duas) return `Unimed ${titulo(duas[1])}`
  }
  // A cidade depois de "de" (25/10/2026, rodada 5 do painel): "A minha e a
  // Unimed daqui de Sao Paulo" virou "Pela Unimed Santos" e a agenda de
  // Santos, com a paciente morando no Tatuape. E "a minha pega em todo lugar"
  // tambem nao e a Unimed Santos, a menos que diga Santos.
  const daCidade = t.match(/\bunimed( [a-z]+){0,2} (de|do|da|em) (sao paulo|sp|sampa|capital|guarulhos|osasco|campinas|santo andre|sao bernardo|sao caetano|abc|jundiai|sorocaba|rio de janeiro|rio|belo horizonte|bh|curitiba)\b/)
  if (daCidade && !daAceita.some((w) => w.length >= 3 && daCidade[3].split(' ').includes(w))) {
    const nome = /^(sp|sampa|capital|sao paulo)$/.test(daCidade[3]) ? 'São Paulo' : titulo(daCidade[3])
    return `Unimed de ${nome}`
  }
  // So o plano que "vale em todo lugar": "pode ser em qualquer lugar" e a
  // unidade, e nao o plano.
  if (
    /\bunimed\b/.test(t) && !/\b(santos|santista)\b/.test(t) &&
    /\b(pega|pegam|vale|valia|cobre|cobria|aceita|aceitam|serve|servia|funciona)( em| no| na)? (todo lugar|qualquer lugar|todo o brasil|todo brasil)\b/.test(t)
  ) {
    return 'Unimed de outra cidade'
  }
  const m = t.match(/\bunimed\s+([a-z]+)/)
  if (!m || NAO_E_CIDADE.has(m[1]) || daAceita.includes(m[1])) return null
  if (CIDADES_DA_UNIMED.has(m[1])) return `Unimed ${titulo(m[1])}`
  // Nome proprio escrito com maiuscula ("Unimed Taubate"), que a lista nao tem.
  const original = texto.match(/\bUnimed\s+(\p{Lu}\p{Ll}+)/u)
  return original && normalizar(original[1]) === m[1] ? `Unimed ${original[1]}` : null
}

function planoEscolhido(
  texto: string,
  planos: string[],
  /**
   * Palavras que nao identificam plano nesta frase (16/10/2026): no pedido de
   * marcar, o nome da cidade. "Pelo porto em santos" citava a Unimed Santos
   * pelo "santos" e empatava com a Porto Saude. O nome inteiro ("unimed
   * santos") continua valendo.
   */
  ignorar: string[] = [],
): number | null {
  const indice = escolha(texto, planos.length + 1)
  if (indice !== null) return indice
  // Outra Unimed nao escolhe a Unimed daqui. Ver outraUnimed.
  if (outraUnimed(texto, planos)) return null
  const t = ` ${normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `
  const palavrasDe = (p: string) =>
    normalizar(p).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !PALAVRAS_GENERICAS_DE_PLANO.has(w) && !ignorar.includes(w))
  const quantas = new Map<string, number>()
  for (const p of planos) for (const w of new Set(palavrasDe(p))) quantas.set(w, (quantas.get(w) ?? 0) + 1)
  const citados = planos
    .map((p, i) => ({ i, citado: t.includes(` ${normalizar(p)} `) || palavrasDe(p).some((w) => quantas.get(w) === 1 && t.includes(` ${w} `)) }))
    .filter((c) => c.citado)
  const particular = /\b(particular|sem convenio|sem plano|nao tenho|nao uso)\b/.test(t)
  if (citados.length === 1 && !particular) return citados[0].i
  if (citados.length === 0 && particular) return planos.length
  return null
}

/** Planos de saude comuns, para reconhecer o que a unidade NAO atende. */
const PLANOS_CONHECIDOS: [RegExp, string][] = [
  [/\bamil\b/, 'Amil'],
  [/\bbradesco\b/, 'Bradesco Saúde'],
  [/\bsul ?america\b/, 'SulAmérica'],
  [/\bnotre ?dame\b|\bintermedica\b|\bgndi\b/, 'NotreDame Intermédica'],
  [/\bhapvida\b/, 'Hapvida'],
  [/\bcassi\b/, 'Cassi'],
  [/\bgolden cross\b/, 'Golden Cross'],
  [/\bprevent senior\b/, 'Prevent Senior'],
  [/\bcare ?plus\b/, 'Care Plus'],
  [/\bomint\b/, 'Omint'],
  [/\ballianz\b/, 'Allianz'],
  [/\bmediservice\b/, 'Mediservice'],
  [/\bcabesp\b/, 'Cabesp'],
  [/\bgeap\b/, 'Geap'],
  [/\btrasmontano\b/, 'Trasmontano'],
  [/\bporto\b/, 'Porto Saúde'],
  [/\bunimed\b/, 'Unimed'],
  [/\bsanta saude\b/, 'Santa Saúde'],
]

/**
 * O plano que a pessoa citou e que esta unidade nao atende, ou null
 * (15/10/2026). "Tenho Amil" na pergunta do convenio recebia "Nao entendi" -
 * a pessoa foi entendida, so que a resposta e outra: aqui nao atende esse
 * plano, e da para ser particular. E o caso que a Dayane mais explica.
 */
function planoNaoAceito(texto: string, planos: string[]): string | null {
  const outra = outraUnimed(texto, planos)
  if (outra) return outra
  const t = ` ${normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `
  const aceitos = planos.map((p) => normalizar(p))
  for (const [padrao, nome] of PLANOS_CONHECIDOS) {
    if (!padrao.test(t)) continue
    const chave = normalizar(nome).split(' ')[0]
    if (aceitos.some((a) => a.includes(chave))) continue
    return nome
  }
  return null
}

/**
 * O plano citado que o consultorio nao atende, numa pergunta (16/10/2026,
 * painel de pacientes simulados).
 *
 * "Aceita amil?" recebia o texto geral de convenios, sem um "a Amil nao"; a
 * paciente perguntou de novo e ouviu "esta logo acima". O texto da clinica
 * lista o que ela atende; o robo diz o que nao atende, com o nome que a pessoa
 * escreveu. Vazio quando nao ha plano citado, ou quando ele e atendido.
 */
async function avisoDoPlano(admin: Admin, clinicId: string, texto: string): Promise<string> {
  const t = ` ${normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `
  if (!PLANOS_CONHECIDOS.some(([padrao]) => padrao.test(t))) return ''
  const unidades = await opcoesDeAtendimento(admin, clinicId)
  const aceitos = [...new Set(unidades.flatMap((u) => planosDaUnidade(u)))]
  if (aceitos.length === 0) return ''
  const fora = planoNaoAceito(texto, aceitos)
  if (!fora) return ''
  return (
    `O plano *${fora}* não está entre os convênios atendidos ${perfil().o.replace(/^o /, 'pelo ')}. ` +
    'A consulta pode ser particular, com recibo para você pedir reembolso ao seu plano.'
  )
}

/** Primeira etapa da agenda: em que dia. */
/**
 * Pergunta o convenio antes das datas, quando a unidade aceita algum.
 *
 * Vem ANTES de escolher dia e horario de proposito. Perguntar depois seria
 * perguntar a quem ja escolheu, e quem tem o plano pode preferir outro dia
 * para usar o convenio; e perguntar antes da unidade nao faz sentido, porque
 * o plano vale numa unidade e nao na outra.
 *
 * Unidade sem convenio cadastrado pula direto. E a telemedicina tambem, por
 * construcao: ela nao tem linha em clinic_units, entao nunca tem o campo.
 */
async function perguntarConvenioOuDia(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  unidade: Unidade,
): Promise<Resultado> {
  const plano = (unidade.accepts_insurance ?? '').trim()
  if (!plano) {
    // Unidade so particular: nenhum convenio de antes pode ir junto (ver o
    // booking_insurance de perguntarUnidade).
    await salvarEstado(admin, conversationId, { booking_insurance: '' })
    return await perguntarDia(admin, clinicId, conversationId, unidade)
  }

  await salvarEstado(admin, conversationId, {
    booking_state: 'aguardando_convenio',
    booking_unit_id: unidade.id,
    booking_options: null,
    // Unidade com convenio e unidade fisica - a telemedicina nem tem linha em
    // clinic_units. Gravar a modalidade aqui fecha o caminho de volta: quem
    // passou pela telemedicina antes nao carrega o 'telemedicina' para dentro
    // de uma consulta presencial.
    booking_modality: 'presencial',
  })

  const planos = planosDaUnidade(unidade)
  if (planos.length > 1) return perguntaDosPlanos(planos)

  return {
    resposta:
      `💳 Esta consulta vai ser pelo convênio *${plano}* ou *particular*?\n\n` +
      `*1* ${plano}\n` +
      '*2* Particular\n\n' +
      'Responda com o número, ou toque no botão.',
    botoes: [
      { id: '1', titulo: plano.slice(0, 20) },
      { id: '2', titulo: 'Particular' },
    ],
  }
}

async function perguntarDia(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  unidade: Unidade,
  /** Falso quando a clinica so tem uma unidade: nao existe "outra" para trocar. */
  podeTrocarUnidade = true,
  /** Dias pedidos pela equipe (ver oferecerHorarios). */
  periodo?: Periodo,
): Promise<Resultado> {
  const timezone = await fusoDaClinica(admin, clinicId)
  // Retorno em aberto (26/10/2026): so as datas ate o prazo que o medico
  // definiu. Periodo pedido pela equipe passa na frente: ela ja escolheu.
  const retorno = periodo ? null : await retornoEmAberto(admin, clinicId, conversationId)
  const { horarios, falhou } = await horariosLivres(
    admin,
    clinicId,
    unidade.id,
    periodo ?? (retorno ? { de: null, ate: retorno.ate } : undefined),
  )
  const tele = unidade.id === TELE_ID

  if (falhou) {
    await limparEstado(admin, conversationId)
    return { resposta: AVISO_FALHA, atencao: 'falha' }
  }

  if (horarios.length === 0) {
    const semVaga = retorno
      ? `Não temos horário livre em ${unidade.name} até *${diaCurto(retorno.ate)}*, o prazo do retorno${doRetornoDe(retorno)}.`
      : `No momento não temos horários abertos em ${unidade.name}.`
    if (!podeTrocarUnidade) {
      await limparEstado(admin, conversationId)
      return {
        resposta: `${semVaga}\n\n` + (retorno ? 'A nossa equipe vê um encaixe com você por aqui.\n\n' : '') + SAIDAS,
        atencao: 'atendente',
      }
    }
    // Continua em aguardando_unidade: assim o proximo numero ja escolhe outra
    // unidade, sem obrigar a recomecar.
    return {
      resposta:
        `${semVaga}\n\n` +
        'Você pode responder com o número de outra unidade da lista acima.\n' + SAIDAS,
    }
  }

  const dias = agruparPorDia(horarios, timezone)
  // Na telemedicina uma das oito linhas e a urgencia, entao cabem sete dias.
  const mostrados = dias.slice(0, tele ? MAX_DIAS - 1 : MAX_DIAS)

  // Manha ou tarde em cada dia (16/10/2026, painel de pacientes simulados): a
  // paciente que queria "semana que vem de manha" escolheu a segunda de Santos,
  // que so tem tarde, e so descobriu na lista de horarios.
  const periodoDoDia = (d: { horarios: Horario[] }) => {
    const horas = d.horarios.map((h) => Number(formatarHora(h.inicio, timezone).slice(0, 2)))
    const manha = horas.some((h) => h < 12)
    const tarde = horas.some((h) => h >= 12)
    return manha && tarde ? 'manhã e tarde' : manha ? 'manhã' : 'tarde'
  }

  const linhas = mostrados
    .map((d, i) => {
      const quantos = d.horarios.length
      return `*${i + 1}* ${formatarDia(d.horarios[0].inicio, timezone)} (${periodoDoDia(d)} · ${quantos} ${
        quantos === 1 ? 'horário' : 'horários'
      })`
    })
    .join('\n')

  // A telemedicina nao tem unidade no banco: a modalidade e que guarda a
  // escolha, e o horario, quando vier, diz de qual unidade fisica saiu.
  await salvarEstado(admin, conversationId, {
    booking_state: 'aguardando_dia',
    booking_options: mostrados.map((d) => d.chave),
    booking_unit_id: tele ? null : unidade.id,
    booking_modality: tele ? 'telemedicina' : 'presencial',
  })

  // Sem agenda alem da quinzena nao adianta prometer: quem precisa de data
  // distante fala com a equipe, que enxerga o calendario inteiro.
  // O 9 da lista para tocar e "Falar com a equipe" (rodada 3 do painel): o
  // texto diz o mesmo, e a data distante e um dos motivos.
  const distante = retorno ? 'uma data depois do prazo do retorno' : 'uma data mais distante'
  const nove = geral() ? `*9* para falar com a nossa equipe (para ${distante}, por exemplo)` : `*9* se precisar de ${distante}`
  const rodape = podeTrocarUnidade
    ? `Digite VOLTAR para escolher outra unidade, ${nove}, ou *0* para o início.`
    : `Digite ${nove}, ou *0* para o início.`

  // Na telemedicina existe a saida de urgencia: quem nao pode esperar um
  // horario da lista fala com a equipe agora, e a conversa sobe na fila.
  const urgencia = tele
    ? '\n\n🚨 Se for *urgência*, digite URGÊNCIA: a nossa equipe entra em contato o mais rápido possível.'
    : ''

  const linhasDaLista = mostrados.map((d, i) => ({
    id: String(i + 1),
    titulo: formatarDia(d.horarios[0].inicio, timezone),
    descricao: `${periodoDoDia(d)} · ${d.horarios.length} horário${d.horarios.length === 1 ? '' : 's'}`,
  }))

  return {
    resposta:
      (retorno
        ? `🗓️ *Datas para o retorno${doRetornoDe(retorno)}${tele ? ' por telemedicina' : ` em ${unidade.name}`}:*\n` +
          `(incluído no valor da consulta de ${diaCurto(retorno.consulta)})\n\n${linhas}\n\n`
        : `🗓️ *Datas disponíveis${tele ? ' para telemedicina' : ` em ${unidade.name}`}:*\n\n${linhas}\n\n`) +
      `Responda com o número do dia.\n${rodape}${urgencia}`,
    lista: {
      rotulo: 'Escolher o dia',
      linhas: comVoltar(
        tele
          ? [...linhasDaLista, { id: 'URGENCIA', titulo: '🚨 É urgência', descricao: 'Falar com a equipe agora' }]
          : linhasDaLista,
      ),
    },
  }
}

/**
 * A equipe manda os horarios livres pela conversa (14/10/2026).
 *
 * A secretaria digitava a lista a mao ("Tenho esses horarios na sexta,
 * 23/10: 08:00 / 08:40 / ...") e, quando a familia escolhia, marcava na
 * Agenda - as vezes na manha seguinte, com o horario podendo ter sido pego no
 * meio. Foram tres casos entre 13 e 14/10 (Gustavo, Giovana, Cecilia). Agora
 * ela escolhe a unidade e, se quiser, o periodo ("ate 25/10", "dia 27/11");
 * o robo manda a lista tocavel e segue o agendamento de sempre a partir do
 * dia: horario, cadastro, confirmacao.
 *
 * Nada e enviado quando nao ha horario no periodo: a equipe le o motivo na
 * tela em vez de a familia receber uma lista vazia.
 */
export type PedidoDeHorarios = {
  /** Id da unidade, ou 'telemedicina'. */
  unidade: string
  /** Primeiro e ultimo dia (AAAA-MM-DD). Sem eles, a agenda aberta. */
  de?: string | null
  ate?: string | null
  /** Paciente da consulta, quando ha mais de um no telefone (irmaos). */
  pacienteId?: string | null
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function oferecerHorarios(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  pedido: PedidoDeHorarios,
): Promise<{ resultado: Resultado } | { erro: string }> {
  focar(conversationId)
  perfilEmFoco = quemAtende(clinicId)
  const de = pedido.de?.trim() || null
  const ate = pedido.ate?.trim() || null
  if ((de && !DATA_ISO.test(de)) || (ate && !DATA_ISO.test(ate))) return { erro: 'Data inválida.' }
  if (de && ate && ate < de) return { erro: 'A data final vem antes da inicial.' }

  const unidade = pedido.unidade === TELE_ID ? UNIDADE_TELE : await unidadePorId(admin, pedido.unidade)
  if (!unidade) return { erro: 'Unidade não encontrada.' }

  const periodo = de || ate ? { de, ate } : undefined
  const { horarios, falhou } = await horariosLivres(admin, clinicId, unidade.id, periodo)
  if (falhou) return { erro: 'Não consegui consultar a agenda agora. Nada foi enviado.' }
  if (horarios.length === 0) {
    const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
    const quando = de && ate ? (de === ate ? ` em ${br(de)}` : ` entre ${br(de)} e ${br(ate)}`) : de ? ` a partir de ${br(de)}` : ate ? ` até ${br(ate)}` : ''
    return { erro: `Não há horário livre em ${unidade.name}${quando}. Nada foi enviado.` }
  }

  // Comeco de agendamento limpo: sem consulta a substituir nem cadastro
  // pela metade de outra conversa, e com o paciente que a equipe indicou.
  await salvarEstado(admin, conversationId, {
    booking_patient_id: pedido.pacienteId ?? null,
    booking_replaces_id: null,
    booking_intake_id: null,
    booking_insurance: null,
  })

  const umDia = Boolean(de && ate && de === ate)
  const resultado = umDia
    ? await perguntarHorario(admin, clinicId, conversationId, unidade.id, de as string)
    : await perguntarDia(admin, clinicId, conversationId, unidade, true, periodo)
  return {
    resultado: {
      ...resultado,
      resposta:
        (umDia
          ? 'Separei os horários livres para você 👇 Toque no horário que preferir: a consulta fica marcada na hora.\n\n'
          : 'Separei os horários livres para você 👇 Toque no dia e depois no horário: a consulta fica marcada na hora.\n\n') +
        resultado.resposta,
    },
  }
}

/**
 * Urgencia na telemedicina: o robo para de marcar e chama gente.
 *
 * Nao e a mesma coisa que "falar com a equipe". Quem pediu urgencia esta com
 * uma crianca passando mal e precisa ouvir que alguem vai ligar agora - e a
 * conversa precisa saltar na lista da recepcao com uma bandeira propria.
 */
async function transferirUrgencia(admin: Admin, conversationId: string, agora: Date): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'atendente',
    booking_options: null,
    booking_unit_id: null,
    booking_modality: null,
  })
  if (!dentroDoExpediente(agora)) {
    return { resposta: urgenciaForaDoExpediente(agora), atencao: 'urgencia' }
  }
  // A primeira frase diz o que fazer (16/10/2026, rodada 2 do painel): "estou
  // transferindo, a equipe entra em contato com urgencia" deixava a mae do
  // bebe com a respiracao estranha esperando a mensagem da equipe.
  if (geral()) {
    return {
      resposta:
        '🚨 *Entendi que é urgência. Se alguém está passando mal agora, procure atendimento sem esperar a nossa resposta.* ' +
        'Já avisei a nossa equipe, que fala com você por aqui o mais rápido possível.\n\n' +
        'Se puder, escreva o que está acontecendo: quem atender lê tudo antes de responder.\n\n' +
        `*${prontoSocorro()}*`,
      atencao: 'urgencia',
    }
  }
  return {
    resposta:
      '🚨 Entendi que é urgência. Estou transferindo você para um atendente do ' +
      'consultório, e a nossa equipe vai entrar em contato com urgência por aqui.\n\n' +
      'Se puder, já escreva o que está acontecendo com a criança: a pessoa que ' +
      'assumir o atendimento lê tudo antes de responder.\n\n' +
      'Se for uma emergência com risco de vida, procure o pronto-socorro mais próximo ou ligue 192.',
    atencao: 'urgencia',
  }
}

/**
 * Urgencia fora do expediente (07/10/2026).
 *
 * Ate aqui a resposta era a mesma a qualquer hora: "a nossa equipe vai entrar
 * em contato com urgencia por aqui". Numa sexta as 23h isso e uma promessa que
 * ninguem cumpre ate segunda as 8h - e uma mae com a crianca passando mal fica
 * esperando o WhatsApp tocar. Fora do horario o robo diz a verdade (quando a
 * equipe volta) e poe o pronto-socorro em primeiro plano, em vez de rodape.
 * A conversa continua marcada como urgencia, para saltar na lista de manha.
 */
function urgenciaForaDoExpediente(agora: Date): string {
  if (geral()) {
    return (
      '🚨 Entendi que é urgência, e já deixei avisado para a nossa equipe.\n\n' +
      avisoDeHorario(agora) + '\n\n' +
      `*Não espere a nossa resposta. ${prontoSocorro()}*\n\n` +
      'Se quiser, já escreva o que está acontecendo: quem assumir o atendimento lê tudo antes de responder.'
    )
  }
  return (
    '🚨 Entendi que é urgência, e já deixei avisado para a nossa equipe.\n\n' +
    avisoDeHorario(agora) + '\n\n' +
    '*Se a criança está mal agora, não espere a nossa resposta: procure o ' +
    'pronto-socorro mais próximo ou ligue 192.*\n\n' +
    'Se quiser, já escreva o que está acontecendo: quem assumir o atendimento lê tudo antes de responder.'
  )
}

/**
 * O que o paciente le quando fala em sangramento (15/10/2026).
 *
 * O alerta sai pelo webhook, que manda a notificacao assim que a conversa
 * acende com 'sangramento' (ver aviso-da-equipe.ts). Aqui o robo diz que
 * avisou e poe o pronto-socorro em primeiro plano. Nenhuma orientacao de
 * cuidado ("incline a cabeca", "aperte o nariz"): o robo nao orienta sobre
 * sintoma, nem neste caso - quem orienta e o medico que recebeu o alerta.
 *
 * Fora do expediente o aviso diz a verdade sobre a demora, como na urgencia.
 */
function avisoDeSangramento(
  agora: Date,
  repetido: boolean,
  /**
   * Convidar a contar o que esta acontecendo. Nao no meio da ficha ou do
   * agendamento: ali a proxima mensagem e a resposta da etapa, e o relato
   * cairia na pergunta do CPF como "CPF que nao confere".
   */
  convidaAContar = true,
  /** Sangramento que nao parou, forte ou de pos-operatorio. Ver sangramentoAtivo. */
  ativo = false,
  /** A mensagem, para o lembrete dizer o que falta (ver complementoDaUrgencia). */
  texto = '',
): string {
  const quem = perfil().alertaDeSangramento ?? 'a nossa equipe'
  // "Nao espere" tambem na repeticao (16/10/2026): quem escreve de novo e quem
  // esta em duvida entre esperar a ligacao e ir (ver lembreteDeUrgencia).
  if (repetido) return lembreteDeUrgencia('sangramento', texto)
  if (ativo) {
    return (
      `🚨 *Pelo que você contou, procure o pronto-socorro agora, sem esperar a nossa resposta.* Já avisei ${quem} no celular.\n\n` +
      (dentroDoExpediente(agora) ? '' : avisoDeHorario(agora) + '\n\n') +
      `*${prontoSocorro()}*`
    )
  }
  if (!dentroDoExpediente(agora)) {
    return (
      `🚨 *Já avisei ${quem} no celular.*\n\n` +
      avisoDeHorario(agora) + '\n\n' +
      `*Não espere a nossa resposta. ${prontoSocorro()}*`
    )
  }
  // A regra de decisao vem antes do texto do consultorio (rodada 2 do painel):
  // so "em caso de urgencia" deixava a pessoa em duvida se o caso dela era.
  return (
    `🚨 *Já avisei ${quem} no celular.* Alguém da equipe fala com você por aqui o mais rápido possível.\n\n` +
    `*Se o sangramento não parou ou é forte, não espere a nossa resposta. ${prontoSocorro()}*` +
    (convidaAContar ? '\n\nSe puder, escreva aqui o que está acontecendo: quem atender lê tudo antes de responder.' : '')
  )
}

/**
 * O que o paciente le quando a mensagem traz um sinal de alarme (16/10/2026).
 * Ver sinalDeAlarme.
 *
 * A primeira frase diz o que fazer, sem condicional: no painel, a orientacao
 * so com "em caso de urgencia" e "alguem fala com voce o mais rapido
 * possivel" deixou a paciente em duvida entre esperar e ir. Nenhuma
 * orientacao de cuidado ("tente tirar", "incline a cabeca"), pelo mesmo
 * motivo do sangramento: quem orienta e o medico. O 192 so entra para quem
 * diz que nao tem como ir (ver complementoDaUrgencia).
 */
function avisoDeAlarme(tipo: SinalDeAlarme, agora: Date, repetido: boolean, texto = ''): string {
  // Quem nao consegue ir ("como vou sozinho?") recebe o 192 pelo complemento,
  // na resposta ao que disse (ver complementoDaUrgencia e LEIA-ME).
  void tipo
  // A repeticao e o lembrete da fila de urgencia (ver lembreteDeUrgencia).
  if (repetido) return lembreteDeUrgencia('urgencia', texto)
  const primeira = '🚨 *Pelo que você contou, procure atendimento agora, sem esperar pela consulta.*'
  if (!dentroDoExpediente(agora)) {
    return (
      `${primeira} Já deixei avisado para a nossa equipe.\n\n` +
      avisoDeHorario(agora) + '\n\n' +
      `*Não espere a nossa resposta. ${prontoSocorro()}*`
    )
  }
  return `${primeira} Já avisei a nossa equipe, que também fala com você por aqui.\n\n*${prontoSocorro()}*`
}

/**
 * Sangramento ou sinal de alarme, em qualquer etapa (15/10/2026; o alarme
 * entrou em 16/10/2026). Ver falouDeSangramento e sinalDeAlarme.
 *
 * A conversa acende toda vez, com 'sangramento' ou 'urgencia': e isso que manda
 * a notificacao para o celular do Dr. Fabio e da Dayane, inclusive na segunda
 * mensagem, que reavisa com o texto novo. O texto para o paciente e que
 * encurta na repeticao: o pronto-socorro inteiro de novo, logo abaixo do
 * primeiro, pareceria que o robo nao leu nada.
 *
 * O que muda e a etapa. Sem fluxo aberto, a conversa vai para a equipe. No
 * meio do agendamento ou da ficha, a etapa continua de pe, como no anexo: quem
 * conta "tenho sangramento no nariz quase todo dia" enquanto marca a consulta
 * continua marcando. E na pergunta do motivo da consulta a frase E a
 * resposta: fica guardada, e a ficha segue dali.
 */
async function alertar(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  estadoAtual: Estado | null,
  opcoesAtuais: unknown,
  consultaEmCadastro: string | null,
  pacienteDaConsulta: Paciente | null,
  texto: string,
  agora: Date,
  /** Null = sangramento. */
  alarme: SinalDeAlarme | null = null,
): Promise<Resultado> {
  registrar(alarme ? 'sinal_de_alarme' : 'alerta_sangramento', alarme ?? undefined)
  const atencao = alarme ? 'urgencia' : 'sangramento'
  const emFluxo = Boolean(estadoAtual) && estadoAtual !== 'menu' && estadoAtual !== 'atendente'
  const ativo = !alarme && sangramentoAtivo(texto)
  const completo = alarme ? avisoDeAlarme(alarme, agora, false) : avisoDeSangramento(agora, false, !emFluxo, ativo)
  // As duas formas do aviso de sangramento contam: "esta sangrando" e depois
  // "nao para" recebe o lembrete curto, e nao um segundo aviso inteiro.
  const jaAvisou =
    (await jaMandada(admin, conversationId, completo)) ||
    (!alarme && (await jaMandada(admin, conversationId, avisoDeSangramento(agora, false, !emFluxo, !ativo))))
  const aviso = jaAvisou
    ? alarme ? avisoDeAlarme(alarme, agora, true, texto) : avisoDeSangramento(agora, true, true, false, texto)
    : completo

  const pergunta = perguntas().find((p) => p.estado === estadoAtual)
  if (pergunta?.chave === 'motivo' && (consultaEmCadastro || pacienteDaConsulta) && !ativo) {
    const valor = pergunta.ler(texto)
    if (valor) await guardarDado(admin, consultaEmCadastro, pergunta, valor, pacienteDaConsulta)
    const { faltam, manual } = filaDaFicha(opcoesAtuais)
    const restantes = faltam.slice(1)
    const seguinte = restantes.length
      ? await perguntarDados(admin, conversationId, consultaEmCadastro, restantes, `${aviso}\n\nEnquanto isso, para terminar a ficha da consulta:`, manual)
      : await terminarDados(admin, conversationId, clinicId, consultaEmCadastro, manual)
    return {
      ...seguinte,
      resposta: restantes.length ? (seguinte?.resposta ?? aviso) : `${aviso}\n\n${seguinte?.resposta ?? ''}`.trim(),
      atencao,
      // A ficha pode ter terminado aqui, mas a conversa nao: o alerta espera gente.
      concluida: false,
    }
  }

  // Sangramento que nao para, contado no meio da marcacao (rodada 3 do
  // painel): "para continuar de onde paramos, responda a pergunta acima" ia
  // embaixo do "procure o pronto-socorro agora", duas vezes. Quem precisa ir
  // agora sai da etapa e fica com a equipe; quem conta um sangramento antigo
  // continua marcando.
  if (emFluxo && !ativo) {
    return {
      resposta:
        `${aviso}\n\n` +
        // No alarme, a consulta e para depois: "continuar de onde paramos"
        // soaria como "termine de marcar antes de ir".
        (alarme
          ? 'Se ainda quiser marcar uma consulta para depois, é só responder a pergunta acima 👆'
          : 'Para continuar de onde paramos, é só responder a pergunta acima 👆'),
      atencao,
    }
  }

  await salvarEstado(admin, conversationId, {
    booking_state: 'atendente',
    booking_options: null,
    booking_unit_id: null,
    auto_replies_while_waiting: 0,
  })
  return { resposta: aviso, atencao }
}

/**
 * Nova mensagem numa conversa que ja esta na fila por sangramento ou
 * urgencia (16/10/2026, painel de pacientes simulados).
 *
 * "Vou para o pronto-socorro ou espero o Dr. Fabio me ligar?" ficava sem
 * resposta (a fila so respondia resposta pronta), e "Vou para o pronto-socorro
 * do hospital onde operei?" recebeu os enderecos do consultorio ("onde") com
 * "sua conversa continua na fila". Numa conversa assim a resposta e uma so, e
 * sem condicional: nao espere.
 */
function lembreteDeUrgencia(motivo: 'sangramento' | 'urgencia', texto = ''): string {
  const quem = motivo === 'sangramento' ? (perfil().alertaDeSangramento ?? 'a nossa equipe') : 'a nossa equipe'
  // Na urgencia, o que fazer de novo, sem condicional (rodada 2 do painel): a
  // mae do menino com o objeto no nariz escreveu "ele ta respirando normal,
  // precisa ir agora msm? nao da pra marcar pra amanha?", leu "em caso de
  // urgencia" e concluiu que o caso dela nao era.
  const naoEspere =
    motivo === 'urgencia'
      ? 'Pelo que você contou, não espere pela consulta nem pela nossa resposta: procure atendimento agora.'
      // "Nao esta jorrando, sai aos poucos" (rodada 3 do painel) leu o "em caso
      // de sangramento intenso" do texto do consultorio e concluiu que podia
      // esperar. A regra vem antes, sem condicional.
      : 'Não espere a nossa resposta: se ainda está saindo sangue, procure o pronto-socorro agora.'
  return `🚨 O alerta já está com ${quem}.\n\n*${naoEspere} ${prontoSocorro()}*${complementoDaUrgencia(texto)}`
}

/**
 * O que a pessoa disse muda o que falta dizer (16/10/2026, rodada 2 do
 * painel). Sozinho e sem conseguir levantar, o pronto-socorro repetido tres
 * vezes nao serve: e o 192, que vai ate ela. Sem plano, o texto do
 * consultorio (plano ou particular) deixava a mae sem caminho: e a UPA. Vazio
 * quando nao ha nada a acrescentar.
 */
/**
 * Quem nao tem como ir ao pronto-socorro, ou pede ambulancia: o caminho e o 192.
 * "Minha mulher ta no trabalho, nao tenho como i" e "vcs pode chama uma
 * ambulancia?" (rodada 3 do painel); "como vo se nem consigo levanta" e "nao
 * consigo anda" (25/10/2026, rodada 5).
 */
function precisaDo192(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')
  return /\b(sozinh[oa]|(nao|nem) (consigo|consegue|tenho como|tem como|da pra) (ir|i|levantar|levanta|dirigir|andar|anda|sair|sai)|como (eu )?(vou|vo)|sem carro|sem ninguem|nao tenho quem|ninguem (pra|para) (me )?levar|(ta|esta) no trabalho|ambulancia|samu|resgate)\b/.test(t)
}

function complementoDaUrgencia(texto: string): string {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')
  const partes: string[] = []
  // "Minha mulher ta no trabalho, nao tenho como i" e "vcs pode chama uma
  // ambulancia?" (rodada 3 do painel) ficaram sem o 192.
  if (precisaDo192(texto)) partes.push('Se não tiver como ir, ligue *192* (SAMU): eles vão até você.')
  if (/\b(nao tenho|nao tem|sem) (plano|convenio)\b|\b(sus|upa|publico|publica)\b/.test(t)) {
    partes.push('Sem plano de saúde, a UPA ou o pronto-socorro público mais próximo atendem.')
  }
  // "Nao da pra eu tentar tirar com uma pinca? ou fazer ele assoar forte?"
  // (rodada 2): a pergunta ficava sem resposta. O robo nao orienta cuidado,
  // mas diz que nao orienta, e quem orienta.
  // "Posso ir direto no consultorio do Dr. Fabio?" (rodada 2): o consultorio
  // nao faz atendimento de urgencia.
  if (/\bconsultorio\b/.test(t) && /\b(ir|vou|vo|posso|levo|passar)\b/.test(t)) {
    partes.push('O consultório não faz atendimento de urgência: o certo é o pronto-socorro.')
  }
  // "Sozinho em casa" nao e pergunta de cuidado: so o que fazer, tirar, tomar.
  if (/\b(tirar|tira|tiro|assoar|assoa|pinca|cotonete|pingar|pingo|tomar|tomo|remedio|compressa|gelo|inclino|inclinar|apertar|aperto)\b|\b(fazer|faco|tentar|resolver|tratar) (isso |algo )?em casa\b|\bo que (eu )?(faco|fazer)\b|\boq (eu )?(faco|fazer)\b/.test(t)) {
    partes.push(`Por aqui não dá para orientar o que fazer em casa: quem orienta é o médico que atender você.`)
  }
  return partes.length ? `\n\n${partes.join('\n\n')}` : ''
}

/**
 * "Vou agora pro PS", "ja estou no hospital" numa conversa de urgencia
 * (16/10/2026, rodada 2): recebia o pronto-socorro inteiro de novo e mais uma
 * notificacao no celular da equipe. A pessoa ja esta indo.
 */
function vaiAoProntoSocorro(texto: string): boolean {
  // "Vou para o pronto-socorro ou espero o Dr. Fabio me ligar?" e a duvida, e
  // nao a decisao: recebe o "nao espere" (ver lembreteDeUrgencia).
  if (/\bou (espero|aguardo|fico)\b/.test(normalizar(texto))) return false
  // A frase que afirma, e nao a que pergunta: "ok to indo pro PS. depois vou
  // precisar marcar?" esta indo; "eu vou para o pronto-socorro agora?" pergunta.
  const frases = texto.match(/[^?!.\n]+[?!.\n]*/g) ?? []
  return frases.some((f) => {
    if (f.trim().endsWith('?')) return false
    const t = normalizar(f).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')
    // "Vou levar ele na upa agora" (rodada 2): levar tambem e ir.
    return /\b((vou|vamos|to indo|estou indo|estamos indo|ja estou|ja estamos|cheguei|chegamos|vou levar|vamos levar|to levando|estou levando|estamos levando|levando)( ele| ela| o bebe| a bebe| o nenem)?( agora| ja)? (pro|pra|para o|para a|ao|a|no|na) (ps|pronto socorro|hospital|upa|emergencia))\b|\b(estou|to|estamos) (no|na) (ps|pronto socorro|hospital|upa)\b/.test(t)
  })
}

/**
 * "Ta bom, to indo", numa conversa de urgencia (16/10/2026, rodada 3 do
 * painel): sem dizer para onde, mas indo. Ver vaiAoProntoSocorro.
 */
function indoAgora(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')
  return !parecePergunta(texto) && /\b(to indo|tou indo|estou indo|ja estou indo|ja to indo|ja vou|vou agora|indo agora|saindo agora|estamos indo|vamos agora)\b/.test(t)
}

/**
 * "Qual ps voces indicam?", "pra qual pronto-socorro eu vou?" (16/10/2026,
 * rodada 3 do painel). A resposta e o texto do consultorio: o pronto-socorro
 * mais proximo que atenda ao plano.
 */
function perguntouDoProntoSocorro(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')
  return (
    /\b(qual|quais|que|onde|pra qual|para qual|em qual|indica\w*|recomenda\w*)\b( \w+){0,4} (ps|pronto socorro|hospital|hospitais|upa|emergencia)\b/.test(t) ||
    /\b(ps|pronto socorro|hospital|upa)\b( \w+){0,3} (indica\w*|recomenda\w*|mais perto|mais proximo|proximo)\b/.test(t)
  )
}

/** Segunda etapa: a que horas, dentro do dia escolhido. */
async function perguntarHorario(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  unitId: string,
  diaEscolhido: string,
  /**
   * Manha ou tarde, quando a pessoa ja disse ("segunda de manha") ou escolheu
   * no passo do periodo (16/10/2026). Ver abaixo.
   */
  periodo: 'manha' | 'tarde' | null = null,
): Promise<Resultado> {
  const timezone = await fusoDaClinica(admin, clinicId)
  const { horarios, falhou } = await horariosLivres(admin, clinicId, unitId)
  const tele = unitId === TELE_ID

  if (falhou) {
    await limparEstado(admin, conversationId)
    return { resposta: AVISO_FALHA, atencao: 'falha' }
  }

  let todosDoDia = horarios.filter((h) => chaveDoDia(h.inicio, timezone) === diaEscolhido)

  // Dia alem da agenda aberta (14/10/2026): so chega aqui quando a equipe
  // mandou horarios de uma data combinada ("dia 27/11"). A agenda aberta nao
  // enxerga esse dia; o pedido do dia exato enxerga.
  if (todosDoDia.length === 0) {
    const doPedido = await horariosLivres(admin, clinicId, unitId, { de: diaEscolhido, ate: diaEscolhido })
    if (!doPedido.falhou) {
      todosDoDia = doPedido.horarios.filter((h) => chaveDoDia(h.inicio, timezone) === diaEscolhido)
    }
  }

  // Manha e tarde (16/10/2026, painel de pacientes simulados). A lista cortava
  // o dia em oito horarios: em Higienopolis, terca de manha e de tarde, a
  // tarde sumia, e "tem as 16h?" ouvia "esse horario nao esta entre os
  // livres" com 16:00 livre. Agora o dia que nao cabe numa lista mostra um
  // periodo (o pedido, ou a manha), cita os horarios do outro e oferece "Ver a
  // tarde" na propria lista; a hora escrita vale para o dia inteiro (ver a
  // etapa aguardando_horario). Quem disse o periodo ("segunda de manha") vai
  // direto para ele, e o dia que nao tem esse periodo diz isso.
  const horaDe = (h: Horario) => Number(formatarHora(h.inicio, timezone).slice(0, 2))
  const daManha = todosDoDia.filter((h) => horaDe(h) < 12)
  const daTarde = todosDoDia.filter((h) => horaDe(h) >= 12)
  const nomeDoDia = todosDoDia[0] ? formatarDia(todosDoDia[0].inicio, timezone) : ''
  const naoCabe = todosDoDia.length > MAX_HORARIOS_DIA && daManha.length > 0 && daTarde.length > 0
  let aviso = ''
  let mostrado: 'manha' | 'tarde' | null = null
  let doDia = todosDoDia
  if (periodo || naoCabe) {
    const pedido = periodo ?? 'manha'
    const pedidos = pedido === 'manha' ? daManha : daTarde
    if (pedidos.length > 0) {
      doDia = pedidos
      if (pedidos.length < todosDoDia.length) mostrado = pedido
    } else if (todosDoDia.length > 0) {
      // O periodo pedido nao existe nesse dia: diz, mostra o outro, e cita os
      // dias que tem o pedido.
      const outrosDias = agruparPorDia(horarios, timezone)
        .filter((d) => d.chave !== diaEscolhido && d.horarios.some((h) => (horaDe(h) < 12) === (pedido === 'manha')))
        .slice(0, 3)
        .map((d) => formatarDia(d.horarios[0].inicio, timezone))
      aviso =
        `Em ${nomeDoDia} só há horário ${pedido === 'manha' ? 'à tarde' : 'de manhã'}.` +
        (outrosDias.length
          ? ` ${pedido === 'manha' ? 'De manhã' : 'À tarde'}, os próximos dias são: ${outrosDias.join(', ')} (digite VOLTAR para ver os dias).`
          : '') +
        '\n\n'
    }
  }
  // O outro periodo do dia, quando a lista mostra so um.
  const outro = mostrado === 'manha' ? daTarde : mostrado === 'tarde' ? daManha : []
  const nomeDoOutro = mostrado === 'manha' ? 'tarde' : 'manhã'
  doDia = doDia.slice(0, outro.length > 0 ? MAX_HORARIOS_DIA - 1 : MAX_HORARIOS_DIA)
  const linhaDoOutro = outro.length > 0
    ? `\n\n${mostrado === 'manha' ? '🌇 À tarde' : '☀️ De manhã'} também há: ${outro.map((h) => formatarHora(h.inicio, timezone)).join(', ')}. ` +
      `Toque em *Ver a ${nomeDoOutro}* ou escreva o horário.`
    : ''

  if (doDia.length === 0) {
    // Alguem ocupou o dia inteiro entre a listagem e a escolha. Volta um passo
    // em vez de encerrar.
    const unidade = await unidadePorId(admin, unitId)
    if (!unidade) {
      await limparEstado(admin, conversationId)
      return { resposta: AVISO_FALHA, atencao: 'falha' }
    }
    return await perguntarDia(admin, clinicId, conversationId, unidade)
  }

  const linhas = doDia.map((h, i) => `*${i + 1}* ${formatarHora(h.inicio, timezone)}`).join('\n')

  await salvarEstado(admin, conversationId, {
    booking_state: 'aguardando_horario',
    booking_options: doDia,
    booking_unit_id: tele ? null : unitId,
    booking_modality: tele ? 'telemedicina' : 'presencial',
  })

  return {
    // Acima de dez a lista tocavel nao cabe, e a mensagem numerada continua
    // valendo sozinha - por isso o `lista` sai condicional, e nao truncado.
    // Uma das dez linhas fica para a volta, entao o dia so vira lista quando
    // couberem nove horarios. Acima disso a mensagem numerada resolve sozinha.
    ...(doDia.length <= MAX_TOQUES - 1
      ? {
          lista: {
            rotulo: 'Escolher horário',
            linhas: comVoltar([
              ...doDia.map((h, i) => ({
                id: String(i + 1),
                titulo: formatarHora(h.inicio, timezone),
              })),
              ...(outro.length > 0 ? [{ id: mostrado === 'manha' ? 'TARDE' : 'MANHA', titulo: `${mostrado === 'manha' ? '🌇' : '☀️'} Ver a ${nomeDoOutro}` }] : []),
            ]),
          },
        }
      : {}),
    resposta:
      aviso +
      `⏰ *Horários de ${formatarDia(doDia[0].inicio, timezone)}${mostrado ? ` (${mostrado === 'manha' ? 'manhã' : 'tarde'})` : ''}:*\n\n${linhas}` +
      linhaDoOutro +
      '\n\nResponda com o número do horário.\n' +
      'Digite VOLTAR para escolher outro dia, *9* para falar com a nossa equipe, ou *0* para o início.',
  }
}

/**
 * A queixa que a pessoa ja contou nesta conversa (16/10/2026, painel de
 * pacientes simulados).
 *
 * "Oi tenho unimed santos, sinusite toda hora, qro marcar" e "por causa de uma
 * sinusite que nao passa" ouviam, no fim da ficha, "qual e o motivo da
 * consulta?" - e a paciente respondia "como falei no comeco". A mensagem da
 * conversa que fala de queixa (das ultimas seis horas) vira o motivo, inteira,
 * do jeito que ela escreveu: o medico le melhor a frase dela do que um resumo.
 * Vazio quando nada fala de queixa, e a pergunta continua.
 */
// Rinoplastia e motivo de consulta (rodada 3 do painel): a ficha perguntou o
// motivo a quem ja tinha dito que queria a avaliacao da rinoplastia.
const QUEIXA_DO_OTORRINO =
  /\b(rinoplastia|plastica no nariz|sinusite|rinite|renite|ronc\w*|apneia|nariz|entupid\w*|entupimento|desvio|septo|ouvidos?|orelha|zumbido|audicao|surd\w*|escuto|tontura|labirintite|vertigem|garganta|amigdal\w*|adenoide|voz|rouquidao|rouc[oa]|olfato|cheiro|paladar|respira\w*|otite|dor|doendo|doi|febre|sangr\w*|secrecao|pus|catarro|alergia|coriza|espirr\w*|polipos?|cornetos?)\b/

/** "Posso pingar umas gotas?", "tomo o que?": pedido de orientacao, e nao queixa. */
function perguntaDeRemedio(frase: string): boolean {
  const t = normalizar(frase)
  return /\?/.test(frase) && /\b(posso|pode|devo|da pra|dá pra|tomo|uso|pingo|passo)\b/.test(t) &&
    /\b(tomar|toma|pingar|pinga|usar|usa|passar|passa|dar|gotas?|remedio|spray|pomada|antibiotico|xarope)\b/.test(t)
}

/**
 * A frase conta uma queixa do otorrino. "Medico do ouvido" e a especialidade,
 * e nao a queixa (rodada 3 do painel).
 */
function ehQueixa(frase: string): boolean {
  return QUEIXA_DO_OTORRINO.test(
    normalizar(frase).replace(/\b(medico|doutor|dr|especialista|consulta|clinica|otorrino)\s+(do|de|da|dos|das|para|pro|pra|no|na)\s+(ouvidos?|nariz|garganta)\b/g, ' '),
  )
}

/** As mensagens do paciente nas ultimas horas, da mais antiga para a mais nova. */
async function mensagensDoPaciente(admin: Admin, conversationId: string, horas: number): Promise<string[]> {
  try {
    const desde = new Date((relogioEmFoco ?? new Date()).getTime() - horas * 3600 * 1000).toISOString()
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select('body,created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) throw error
    return ((data ?? []) as { body?: string | null }[])
      .map((m) => String(m.body ?? '').trim())
      .filter(Boolean)
      .reverse()
  } catch (erro) {
    console.warn('Nao consegui ler as mensagens da conversa; sigo so com a de agora', erro)
    return []
  }
}

/** A frase cita convenio (aceito ou nao) ou particular. Numero solto nao conta. */
function falouDePlano(texto: string, unidades: Unidade[]): boolean {
  if (!texto.trim() || /^\s*\d+\s*$/.test(texto)) return false
  const aceitos = [...new Set(unidades.flatMap((u) => planosDaUnidade(u)))]
  const daCidade = unidades.flatMap((u) => normalizar(u.name).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)).filter((w) => w.length >= 3)
  const plano = aceitos.length > 0 ? planoEscolhido(texto, aceitos, daCidade) : null
  return (
    /\b(particular|sem convenio|sem plano)\b/.test(normalizar(texto)) ||
    (plano !== null && plano < aceitos.length) ||
    (aceitos.length > 0 && planoNaoAceito(texto, aceitos) !== null)
  )
}

/**
 * A unidade e o convenio ditos antes, quando o pedido de agora nao diz
 * (16/10/2026, rodada 2 do painel). "Preciso marcar pro meu filho pela porto
 * em santos" perguntava para quem e, depois, a unidade e o convenio de novo; e
 * "queria passar com o dr pela unimed santos", seguido de "quero marcar",
 * abria a lista de unidades. Vale a ultima hora de conversa, e o pedido de
 * agora vem na frente: o que ele diz vence o que veio antes.
 */
async function contextoDoPedido(admin: Admin, clinicId: string, conversationId: string, texto: string): Promise<string> {
  if (!geral()) return texto
  const unidades = await opcoesDeAtendimento(admin, clinicId)
  // O que o pedido de agora ja diz nao e buscado antes; o que falta, sim
  // (rodada 3 do painel): "entao ja quero marcar, pode ser em Santos mesmo",
  // de quem abriu a conversa com "tenho Unimed Santos", ouviu a pergunta do
  // convenio de novo.
  const temUnidade = Boolean(unidadeCitada(unidades, texto))
  const temPlano = falouDePlano(texto, unidades)
  if (temUnidade && temPlano) return texto
  const antes = (await mensagensDoPaciente(admin, conversationId, 1))
    .filter((m) => m !== texto.trim() && ((!temPlano && falouDePlano(m, unidades)) || (!temUnidade && Boolean(unidadeCitada(unidades, m)))))
    .slice(-2)
    .reverse()
  return [texto.trim(), ...antes].filter(Boolean).join('. ')
}

/**
 * O nome que a pessoa ja disse na conversa (16/10/2026, rodada 2 do painel):
 * "Meu nome e Ana Paula Ferreira, tenho 34 anos e gostaria de marcar" ouviu,
 * depois de marcar, "Qual e o nome completo do paciente?". So nome de duas
 * palavras ou mais, dito com "meu nome e", "me chamo" ou "aqui e". A ficha
 * oferece o nome para confirmar com SIM, porque quem escreve pode estar
 * marcando para outra pessoa.
 */
export function nomeDito(texto: string): string | null {
  // Ou o nome seguido da idade, numa frase so dele: "ana paula ferreira, 34 anos".
  const m =
    texto.match(/\b(?:meu nome [eé]|me chamo|aqui [eé](?: o| a)?|eu sou(?: o| a)?)\s+([^,.;:!?\n]+)/i) ??
    texto.match(/(?:^|[.!?\n]\s*)([\p{L}' ]+?),?\s+\d{1,3}\s+anos\b/u)
  if (!m) return null
  const PARA = new Set([
    'e', 'tenho', 'gostaria', 'quero', 'queria', 'preciso', 'precisava', 'estou', 'to', 'moro', 'sou', 'com', 'para', 'pra',
    'pro', 'paciente', 'mae', 'pai', 'filho', 'filha', 'do', 'da', 'de', 'dos', 'das', 'dr', 'dra', 'doutor', 'tudo', 'bem',
    'meu', 'minha', 'meus', 'minhas', 'um', 'uma', 'oi', 'ola', 'bom', 'boa', 'tem', 'idade', 'crianca', 'bebe', 'nenem',
  ])
  const nomes: string[] = []
  for (const palavra of m[1].trim().split(/\s+/)) {
    const n = normalizar(palavra)
    // "da", "de", "do" no meio do nome continuam ("Ana da Silva"); no fim, nao.
    if (PARA.has(n) && !(['da', 'de', 'do', 'dos', 'das'].includes(n) && nomes.length > 0)) break
    if (!/^\p{L}[\p{L}'-]*$/u.test(palavra)) break
    nomes.push(palavra)
  }
  while (nomes.length && ['da', 'de', 'do', 'dos', 'das'].includes(normalizar(nomes[nomes.length - 1]))) nomes.pop()
  if (nomes.length < 2) return null
  return nomeDaFicha(nomes.join(' '))
}

/** O nome dito na ultima hora de conversa. Ver nomeDito. */
async function nomeDaConversa(admin: Admin, conversationId: string): Promise<string | null> {
  for (const m of (await mensagensDoPaciente(admin, conversationId, 1)).reverse()) {
    const nome = nomeDito(m)
    if (nome) return nome
  }
  return null
}

async function queixaDaConversa(admin: Admin, conversationId: string): Promise<string> {
  try {
    const desde = new Date((relogioEmFoco ?? new Date()).getTime() - 6 * 3600 * 1000).toISOString()
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select('body,created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .gte('created_at', desde)
      .order('created_at', { ascending: true })
      .limit(20)
    if (error) throw error
    // So a frase da queixa (rodada 2 do painel): "quero marcar semana q vem.
    // sinusite de repeticao. unimed santos. ana paula, 34 anos" foi gravado
    // inteiro como motivo da consulta.
    const queixas = ((data ?? []) as { body?: string | null }[])
      .flatMap((m) => String(m.body ?? '').split(/(?<=[.!?\n])\s+/))
      .map((frase) => frase.trim().replace(/[.!]+$/, ''))
      // "Quero marca o medico do ouvido" (rodada 3 do painel) nao e queixa: e a
      // especialidade, e a ficha precisa perguntar o motivo.
      // A pergunta de remedio nao e a queixa (25/10/2026, rodada 5 do painel):
      // "posso pinga umas gota no ouvido? ta saindo pus e doendo mt" gravou a
      // pergunta e deixou de fora o pus e a dor.
      .filter((frase) => frase.length >= 6 && ehQueixa(frase) && !perguntaDeRemedio(frase))
      // Sem o "bom dia" e sem o pedido de marcar (rodada 3 do painel): "bom dia,
      // to com sinusite de novo, queria uma consulta semana q vem pela unimed
      // santos" foi gravado inteiro. Fica o pedaco que conta a queixa.
      .map((frase) => {
        const sem = frase.replace(/^(oi|ola|olá|bom dia|boa tarde|boa noite)[,!.\s]*/i, '')
        const partes = sem.split(/\b(?:queria|quero|gostaria|preciso|precisava)\s+(?:de\s+)?(?:uma\s+|um\s+)?(?:consulta|marcar|agendar|horario|horário|passar)\b/i)
        const certa = partes.find((parte) => parte.trim().length >= 6 && ehQueixa(parte))
        return (certa ?? sem).replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').trim()
      })
      .filter((frase) => frase.length >= 3)
    return [...new Set(queixas)].join(' / ').slice(0, 300)
  } catch (erro) {
    console.warn('Nao consegui ler a queixa da conversa; a ficha pergunta', erro)
    return ''
  }
}

async function marcar(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  unitId: string,
  paciente: Paciente | null,
  telefone: string,
  nomeDoPerfil: string,
  slot: Horario,
  /** Consulta antiga a cancelar assim que a nova entrar (remarcacao). */
  substitui: string | null = null,
  /** Convenio escolhido na conversa. Vazio = particular. */
  convenio = '',
): Promise<Resultado> {
  // Telemedicina: a consulta vai para a agenda que o horario trouxe - a da
  // telemedicina, desde 03/10/2026 (ver horariosLivres). Clinica sem essa
  // agenda continua gravando na unidade fisica que cedeu o horario.
  const tele = unitId === TELE_ID
  const unidadeDoHorario = tele ? slot.unitId ?? null : unitId
  if (!unidadeDoHorario) {
    await voltarAoMenuAtivo(admin, conversationId)
    return {
      resposta:
        'Não consegui identificar a unidade desse horário. Digite *2* para ver os horários de novo, ou *0* para o início.',
    }
  }
  const unidade = await unidadePorId(admin, unidadeDoHorario)
  const timezone = await fusoDaClinica(admin, clinicId)


  // Lido antes de inserir, porque a antiga so e cancelada la embaixo - e depois
  // de cancelada continuaria legivel, mas depender disso seria contar com uma
  // ordem que pode mudar. A contagem da nova e a da antiga mais um.
  let vezesRemarcada = 0
  if (substitui) {
    const { data: anterior } = await admin
      .from('appointments')
      .select('reschedule_count')
      .eq('id', substitui)
      .maybeSingle()
    vezesRemarcada = (anterior?.reschedule_count ?? 0) + 1
  }

  const linhaDaConsulta: Record<string, unknown> = {
    clinic_id: clinicId,
    unit_id: unidadeDoHorario,
    modality: tele ? 'telemedicina' : 'presencial',
    patient_id: paciente?.id ?? null,
    starts_at: slot.inicio,
    ends_at: slot.fim,
    status: 'scheduled',
    source: 'whatsapp',
    // Sem cadastro, o nome do WhatsApp e tudo que a recepcao tem para saber
    // quem esta esperando confirmacao. Melhor do que so um numero de telefone.
    contact_name: paciente?.name || nomeDoPerfil || '',
    contact_phone: telefone,
    // Todo mundo sai daqui com consulta marcada, com ou sem cadastro.
    //
    // Antes quem nao tinha cadastro saia com uma reserva de 24h "aguardando
    // confirmacao". Na pratica isso trocava a certeza de quem acabou de marcar
    // por uma tarefa para a recepcao - e quem chegou pelo WhatsApp e
    // exatamente quem ainda nao conhece a clinica e mais precisa sair seguro.
    // O lembrete da vespera continua sendo a checagem de que a pessoa vem.
    confirmed_by_clinic: true,
    hold_expires_at: null,
    // Vazio quando e particular, que e o caso da maioria. A recepcao le isto na
    // Agenda e ja sabe se prepara a guia ou a maquininha.
    insurance: convenio,
    reschedule_count: vezesRemarcada,
    rescheduled_from: substitui,
    // De qual conversa saiu esta consulta (21/09/2026). E o que permite medir
    // o tempo entre o primeiro "oi" e o horario escolhido - contar quantas o
    // robo marcou ja dava pelo source, mas quanto demorou, nao.
    conversation_id: conversationId,
  }

  /**
   * Colunas de appointments que nasceram depois de alguma versao desta funcao.
   *
   * Mesmo problema de COLUNAS_RECENTES, e mesma solucao - so que aqui o preco
   * de nao ter a defesa e maior. A funcao sobe antes das migrations; se o
   * banco ainda nao tem 'insurance', o Postgres recusa o INSERT INTEIRO e
   * TODO agendamento pelo WhatsApp passa a responder "nao consegui concluir o
   * agendamento agora", ate a migration chegar.
   *
   * Perder o convenio de uma consulta e um arranhao que a recepcao conserta na
   * chegada. Perder o agendamento e a familia sem horario.
   */
  const COLUNAS_RECENTES_DA_CONSULTA = [
    'insurance',
    'rescheduled_from',
    'reschedule_count',
    'conversation_id',
  ]

  let { data: criada, error } = await admin
    .from('appointments').insert(linhaDaConsulta).select('id').maybeSingle()

  if (error && (error as { code?: string }).code === '42703') {
    const semAsNovas = { ...linhaDaConsulta }
    for (const coluna of COLUNAS_RECENTES_DA_CONSULTA) delete semAsNovas[coluna]
    console.warn('appointments sem alguma coluna recente; gravando sem ela', error)
    const segunda = await admin
      .from('appointments').insert(semAsNovas).select('id').maybeSingle()
    criada = segunda.data
    error = segunda.error
  }

  // Tambem termina oferecendo numero quando da errado, entao o menu fica ativo.
  if (error) await voltarAoMenuAtivo(admin, conversationId)
  else await limparEstado(admin, conversationId)

  // So depois do INSERT dar certo. Registrar antes contaria como agendamento
  // um horario que outra pessoa pegou primeiro, e o painel diria que o robo
  // marcou mais consultas do que existem na agenda.
  if (!error) registrar(substitui ? 'remarcou' : 'agendou')

  if (error) {
    // 23505 = alguem pegou o mesmo horario entre a listagem e a escolha.
    if ((error as { code?: string }).code === '23505') {
      return {
        resposta:
          'Esse horário acabou de ser ocupado por outra pessoa.\n\n' +
          'Digite *2* para ver os horários atualizados, ou *0* para voltar ao início.',
        lista: {
          rotulo: 'Ver opções',
          linhas: [
            { id: '2', titulo: 'Ver horários atualizados' },
            { id: '9', titulo: 'Falar com a equipe' },
            { id: '0', titulo: 'Voltar ao menu' },
          ],
        },
      }
    }
    console.error('Falha ao marcar consulta', error)
    return {
      resposta:
        'Não consegui concluir o agendamento agora. Já avisei a nossa equipe, ' +
        'que entra em contato por aqui.\n\n' + VOLTA,
      atencao: 'falha',
    }
  }

  // A nova esta garantida: so agora a antiga cai. Fazer o contrario deixaria a
  // pessoa sem consulta nenhuma se ela desistisse no meio do caminho.
  let remarcou = false
  if (substitui) remarcou = await cancelarConsulta(admin, substitui)

  const quando = formatarData(slot.inicio, timezone)
  // Na telemedicina o endereco nao interessa; o que a pessoa precisa saber e
  // que a consulta e por video e que o link chega por aqui.
  const onde = tele
    ? 'Telemedicina, por vídeo. O link da consulta chega aqui pelo WhatsApp antes do horário.'
    : `${unidade?.name ?? 'nossa unidade'}${unidade?.address ? `\n${unidade.address}` : ''}`
  // Retorno no prazo (26/10/2026, vindo do sistema do Dr. Marcello): o
  // comprovante diz que e retorno. "Incluido no valor" so no particular: com
  // convenio, a linha do plano logo abaixo ja diz como e, e "valor" nao cabe.
  const retorno = paciente ? await retornoAbertoDoPaciente(admin, clinicId, paciente.id, relogioEmFoco ?? new Date()) : null
  const ehRetorno = Boolean(retorno && chaveDoDia(slot.inicio, timezone) <= retorno.ate)
  const aviso = ehRetorno && retorno
    ? `${remarcou ? '*Retorno remarcado!*' : '*Retorno marcado!*'} ${convenio ? `Retorno da consulta de ${diaCurto(retorno.consulta)}.` : `Incluído no valor da consulta de ${diaCurto(retorno.consulta)}.`}`
    : remarcou ? '*Consulta remarcada!*' : '*Consulta marcada!*'

  // Esta mensagem e um comprovante, e nao uma etapa: e ela que a pessoa vai
  // rolar a conversa para reencontrar semanas depois, atras do endereco. Por
  // isso nao leva botao - rodape com botao faz parecer que ainda falta algo -
  // e os tres dados ganham icone, para saltarem numa olhada rapida.
  //
  // Asterisco simples e o negrito do WhatsApp. O aviso da vespera vem destacado
  // porque e a unica coisa que ainda se espera da pessoa.
  // Vaga garantida. So agora vem a ficha - e ela e opcional do primeiro ao
  // ultimo campo. Perguntar antes de marcar transformaria cinco perguntas em
  // cinco chances de perder o horario para outra pessoa.
  //
  // Pergunta o que falta, inclusive na remarcacao.
  //
  // Ate 16/09/2026 a remarcacao pulava a ficha inteira, com o comentario "os
  // dados ja vieram na primeira vez". Nao vieram: quem toca em "Voltar ao menu"
  // no meio das perguntas fica com a consulta marcada e a ficha vazia, e a
  // remarcacao virava a porta dos fundos para nunca mais responder nada. Foi o
  // caso do Marcos em 16/09: escolheu o horario, saiu na primeira pergunta,
  // remarcou em seguida e recebeu "Consulta remarcada!" sem cadastro nenhum.
  //
  // Paciente completo continua sem ser interrogado: camposQueFaltam devolve
  // lista vazia para quem ja tem tudo, remarcando ou nao.
  // Na remarcacao o motivo (perfil 'geral') ja veio com a consulta original.
  let faltam = camposQueFaltam(paciente).filter((c) => !(substitui && c === 'motivo'))
  // A ficha da consulta antiga vem junto na remarcacao (16/10/2026, rodada 3
  // do painel): a paciente que trocou o dia logo depois de marcar ficou com a
  // consulta nova sem a queixa (sinusite), e a ficha nao perguntou de novo. O
  // que a antiga tinha e copiado, e so o resto e perguntado.
  if (geral() && substitui && criada?.id) {
    const COLUNA: Record<string, string> = {
      nome: 'intake_patient_name', nascimento: 'intake_birth_date', responsavel: 'intake_guardian',
      cpf: 'intake_cpf', email: 'intake_email', motivo: 'intake_complaint',
    }
    try {
      const { data: antiga } = await admin.from('appointments').select(Object.values(COLUNA).join(',')).eq('id', substitui).maybeSingle()
      const copiar = Object.fromEntries(
        Object.entries((antiga ?? {}) as Record<string, unknown>).filter(
          ([coluna, v]) => Object.values(COLUNA).includes(coluna) && v !== null && v !== undefined && String(v).trim() !== '',
        ),
      )
      if (Object.keys(copiar).length > 0) {
        const { error: erroDaCopia } = await admin.from('appointments').update(copiar).eq('id', criada.id)
        if (erroDaCopia) throw erroDaCopia
        faltam = camposQueFaltam(paciente).filter((c) => !copiar[COLUNA[c]])
        if (copiar.intake_birth_date) faltam = filaSemResponsavelDeAdulto(faltam, String(copiar.intake_birth_date), relogioEmFoco ?? new Date())
      }
    } catch (erro) {
      console.warn('Nao consegui copiar a ficha da consulta remarcada; a ficha pergunta de novo', erro)
    }
  }
  // A queixa ja contada na conversa nao e perguntada de novo. Ver queixaDaConversa.
  if (geral() && faltam.includes('motivo') && criada?.id) {
    const queixa = await queixaDaConversa(admin, conversationId)
    if (queixa) {
      const { error: erroDaQueixa } = await admin.from('appointments').update({ intake_complaint: queixa }).eq('id', criada.id)
      if (!erroDaQueixa) faltam = faltam.filter((c) => c !== 'motivo')
      else console.warn('Nao consegui guardar a queixa da conversa; a ficha pergunta', erroDaQueixa)
    }
  }
  // O nome da crianca no comprovante (14/10/2026): com irmaos no mesmo
  // telefone, "Consulta marcada!" sem nome deixou a mae achando que tinha
  // marcado os dois, quando so a Helena entrou.
  const deQuem = paciente?.name ? `${iconeDoPaciente()} ${paciente.name}\n` : ''
  // Convenio ou particular no comprovante (16/10/2026, painel): quem marcou no
  // Tatuape pensando na Unimed so soube que era particular porque perguntou.
  const pagamento = geral() && !tele ? `💳 ${convenio || 'Particular'}\n` : ''
  // A promessa do lembrete so quando ele vem (ver avisoDoLembrete).
  const lembrete = avisoDoLembrete(slot.inicio, timezone, relogioEmFoco ?? new Date())
  const comprovante =
    `✅ ${aviso}\n\n${deQuem}🗓️ ${quando}\n${tele ? "💻" : "📍"} ${onde}\n${pagamento}`.replace(/\n$/, '') +
    (lembrete ? `\n\n${lembrete}` : '')

  if (faltam.length > 0 && criada?.id) {
    const abertura = await perguntarDados(admin, conversationId, criada.id, faltam)
    // Anuncia e ja pergunta, em vez de pedir licenca: "posso fazer algumas
    // perguntas?" convida a responder "nao" e deixa a conversa parada
    // esperando uma resposta que nao leva a lugar nenhum.
    // Perfil 'geral' sem cadastro: o responsavel so entra para menor de idade,
    // e isso a data de nascimento ainda vai dizer. Contar com ele prometeria
    // a um adulto uma pergunta que nao vem.
    const contadas = geral() && !paciente ? faltam.filter((c) => c !== 'responsavel') : faltam
    const quantas =
      contadas.length === 1 ? 'uma pergunta rápida' : `${contadas.length} perguntas rápidas`
    // Nada de confirmacao aqui: a conversa abre com as perguntas e fecha com o
    // comprovante. Uma confirmacao no comeco e outra no fim soariam como duas
    // consultas, e e o comprovante do fim que a pessoa vai rolar para
    // reencontrar semanas depois, atras do endereco.
    return {
      ...abertura,
      resposta:
        `📋 Seu ${ehRetorno ? '*retorno*' : 'horário'} de *${quando}* está guardado.\n\n` +
        // No perfil 'geral' a ficha tem o motivo da consulta, que nao e
        // cadastro: quem ja e paciente responde so ele.
        `Para completar ${geral() ? 'a ficha da consulta' : 'o cadastro'}, ${quantas}.\n\n` +
        (abertura?.resposta ?? ''),
    }
  }

  return { resposta: `${comprovante}\n\n` + VOLTA }
}

/**
 * O que ainda falta perguntar.
 *
 * Sem cadastro, tudo: a consulta chegaria so com o nome do perfil do WhatsApp
 * e um telefone. Com cadastro, so os buracos - perguntar o nome de quem a
 * clinica atende ha dois anos soaria como se ninguem o conhecesse. Mas o CPF
 * costuma faltar mesmo em paciente antigo, e sem ele nao sai receita.
 */
function camposQueFaltam(paciente: Paciente | null): string[] {
  const lista = perguntas()
  if (!paciente) return lista.map((p) => p.chave)
  const vazio = (valor?: string | null) => !String(valor ?? '').trim()
  const faltam = lista.filter((p) => {
    if (p.chave === 'nome') return false
    if (p.chave === 'nascimento') return vazio(paciente.nascimento)
    if (p.chave === 'responsavel') return vazio(paciente.responsavel)
    if (p.chave === 'cpf') return vazio(paciente.cpf)
    // O motivo (perfil 'geral') e da consulta, e nao do cadastro: quem ja e
    // paciente responde de novo a cada consulta nova.
    if (p.chave === 'motivo') return true
    return vazio(paciente.email)
  }).map((p) => p.chave)
  // Com a data no cadastro ja se sabe se o paciente e adulto (ver perguntasGerais).
  return paciente.nascimento ? filaSemResponsavelDeAdulto(faltam, paciente.nascimento, relogioEmFoco ?? new Date()) : faltam
}


// ---------------------------------------------------------------
// Dados do paciente, perguntados DEPOIS de marcar
// ---------------------------------------------------------------

/**
 * As cinco perguntas, na ordem em que sao feitas.
 *
 * A ordem nao e a da ficha, e a da conversa: nome e nascimento saem de cabeca,
 * responsavel e quase sempre quem esta digitando, e o CPF - o unico que faz a
 * pessoa levantar da cadeira - vem no fim, quando a consulta ja esta marcada e
 * desistir da pergunta nao custa a vaga.
 */
const PERGUNTAS: {
  estado: Estado
  chave: 'nome' | 'nascimento' | 'responsavel' | 'motivo' | 'cpf' | 'email'
  coluna: string
  /** Coluna equivalente no cadastro do paciente, quando existe. */
  colunaDoCadastro?: string
  texto: string
  /** Devolve o valor a guardar, ou null quando a resposta nao serve. */
  ler: (texto: string) => string | null
  /** Mensagem de quando nao serve. Na segunda tentativa a pergunta e pulada. */
  erro: string
  /**
   * Sem PULAR anunciado.
   *
   * Nome, nascimento e responsavel a familia sabe de cabeca, e sem eles o
   * cadastro nao serve para nada. CPF e e-mail sao os que fazem a pessoa
   * levantar da cadeira - esses continuam com a saida escrita na tela.
   *
   * "Obrigatoria" e sobre o que se pede, e nao sobre travar: 0 e 9 continuam
   * valendo, e depois de duas respostas que nao dao para usar o robo segue
   * adiante sozinho em vez de repetir a mesma pergunta para sempre.
   */
  obrigatoria?: boolean
  /** O proprio texto ja diz como pular, entao a linha generica nao entra. */
  jaExplicaOPular?: boolean
}[] = [
  {
    estado: 'dados_nome',
    chave: 'nome',
    obrigatoria: true,
    coluna: 'intake_patient_name',
    texto: '👶 Qual é o *nome completo do paciente* (a criança)?',
    ler: (t) => nomeDaFicha(t),
    erro: 'Não consegui ler o nome. Pode escrever de novo?',
  },
  {
    estado: 'dados_nascimento',
    chave: 'nascimento',
    obrigatoria: true,
    coluna: 'intake_birth_date',
    colunaDoCadastro: 'birth_date',
    // "da crianca" e nao "dele(a)": o parentese de formulario no meio de uma
    // conversa soava como cadastro de reparticao.
    texto: '🎂 Qual é a *data de nascimento* da criança? (dia/mês/ano)',
    // Guarda o que a pessoa escreveu quando nao e uma data redonda: "março de
    // 2019" diz muito mais para o medico do que um campo vazio.
    ler: (t) => (t.trim().length >= 3 ? t.trim().slice(0, 60) : null),
    erro: 'Não consegui ler a data. Pode escrever assim: 12/03/2019?',
  },
  {
    estado: 'dados_responsavel',
    chave: 'responsavel',
    obrigatoria: true,
    coluna: 'intake_guardian',
    colunaDoCadastro: 'guardian_name',
    texto: '👤 Qual é o *nome do responsável* (mãe, pai ou tutor)?',
    ler: (t) => nomeDaFicha(t),
    erro: 'Não consegui ler o nome. Pode escrever de novo?',
  },
  {
    estado: 'dados_cpf',
    chave: 'cpf',
    coluna: 'intake_cpf',
    colunaDoCadastro: 'cpf',
    // Sem a linha generica de PULAR embaixo: este texto ja explica o pular, e
    // com contexto ("nao tem CPF, nao sabe agora"). Duas instrucoes coladas
    // dizendo a mesma coisa e o tipo de ruido que faz a pessoa parar de ler.
    texto:
      '🪪 Qual é o *CPF do paciente*?\n\n' +
      '_Ele é exigido por lei na receita digital. Se a criança não tiver CPF, ' +
      'ou você não souber agora, responda PULAR._',
    jaExplicaOPular: true,
    ler: (t) => (cpfValido(t) ? soDigitos(t) : null),
    erro: 'Esse CPF não confere. Pode conferir e mandar de novo, ou responder PULAR.',
  },
  {
    estado: 'dados_email',
    chave: 'email',
    coluna: 'intake_email',
    colunaDoCadastro: 'email',
    texto:
      '✉️ Por fim, qual é o *e-mail* para enviarmos receitas e documentos?',
    // O e-mail dentro da frase vale ("o meu é ana@x.com"): so a frase inteira
    // valer fazia o robo recusar uma resposta certa (14/10/2026).
    ler: (t) => emailNaFrase(t),
    erro: 'Esse e-mail parece incompleto. Pode mandar de novo, ou responder PULAR.',
  },
]

/**
 * A ficha do perfil 'geral' (Dr. Fabio, otorrino, 15/10/2026).
 *
 * As mesmas perguntas, faladas com o proprio paciente, e duas diferencas:
 *  - o responsavel so e perguntado para menor de idade (ver
 *    filaSemResponsavelDeAdulto). Quem tem 40 anos e marca a propria
 *    consulta nao tem "mae, pai ou tutor" para informar, e a pergunta soaria
 *    como se o robo nao tivesse lido a data de nascimento;
 *  - o motivo da consulta, que a Dayane ja pedia na mensagem dela ("o motivo
 *    da consulta ou sua principal queixa"). Opcional, e o robo nao orienta
 *    nada a partir dele: so deixa anotado para o medico chegar preparado.
 *    Sangramento escrito aqui dispara o alerta, e a ficha segue (ver
 *    alertarSangramento).
 */
function perguntasGerais(q: QuemAtende): typeof PERGUNTAS {
  const [nome, nascimento, responsavel, cpf, email] = PERGUNTAS
  return [
    { ...nome, texto: '👤 Qual é o *nome completo do paciente*?' },
    { ...nascimento, texto: '🎂 Qual é a *data de nascimento* do paciente? (dia/mês/ano)' },
    {
      ...responsavel,
      texto: '👤 Como o paciente é menor de idade, qual é o *nome do responsável* (mãe, pai ou tutor)?',
    },
    {
      estado: 'dados_motivo',
      chave: 'motivo',
      coluna: 'intake_complaint',
      texto:
        '🩺 Qual é o *motivo da consulta* ou a *principal queixa*? Pode ser em poucas palavras, como ' +
        '"nariz entupido", "ronco" ou "sinusite".\n\n' +
        `_Isso ajuda ${q.o} a já chegar preparado. Se preferir contar só na consulta, responda PULAR._`,
      jaExplicaOPular: true,
      // Data ou numero nao e motivo (rodada 3 do painel): "22/4/1979",
      // respondido fora de ordem, foi gravado como a queixa.
      ler: (t) => (t.trim().length >= 3 && !/^[\d\s/.,:-]+$/.test(t.trim()) ? t.trim().slice(0, 300) : null),
      erro: 'Pode escrever o motivo da consulta em poucas palavras? Ou responda PULAR.',
    },
    {
      ...cpf,
      texto:
        '🪪 Qual é o *CPF do paciente*?\n\n' +
        '_Ele é exigido por lei na receita digital. Se não souber agora, responda PULAR._',
    },
    email,
  ]
}

/** As perguntas da ficha no perfil da conversa. */
function perguntas(): typeof PERGUNTAS {
  return geral() ? perguntasGerais(perfil()) : PERGUNTAS
}

/**
 * No perfil 'geral', o responsavel so fica na fila de menor de idade.
 *
 * Decide pela data de nascimento: menor de 18, pergunta; adulto, ou data que
 * nao deu para ler, nao pergunta - a equipe confere na chegada, e perguntar
 * "mae, pai ou tutor" a um adulto e pior do que deixar o campo para depois.
 * No perfil pediatrico a fila passa intacta.
 */
function filaSemResponsavelDeAdulto(chaves: string[], nascimento: string | null | undefined, agora: Date): string[] {
  if (!geral() || !chaves.includes('responsavel')) return chaves
  const idade = idadeEmAnos(nascimento, agora)
  return idade !== null && idade < 18 ? chaves : chaves.filter((c) => c !== 'responsavel')
}

function soDigitos(texto: string) {
  return texto.replace(/\D/g, '')
}

/**
 * O nome que a familia escreveu, sem o resto da frase (14/10/2026).
 *
 * No painel, "Lucas Ferreira Campos, nasceu 03/05/2022" foi gravado inteiro
 * como nome da crianca, e "Fernanda Oliveira Prado, sou a mae" como nome do
 * responsavel - e e esse texto que vai para o cadastro e para a receita. O
 * nome acaba na primeira virgula, parentese ou data; "o nome dela e" e "sou
 * a" na frente saem. Tudo minusculo ou tudo maiusculo ganha iniciais
 * maiusculas ("ANA CLARA DOS SANTOS" vira "Ana Clara dos Santos"); quem
 * escreveu com maiusculas do jeito dele fica como escreveu.
 */
function nomeDaFicha(texto: string): string | null {
  // Toque num botao velho no meio da ficha nao e nome (ver pareceBotao). So
  // texto curto, que e como chega o titulo de um botao: "Daniela Mendes
  // Carvalho. E o valor? Voce nao me respondeu" tem "nao" e nao e toque. O
  // "nao sei" segue como a regra de baixo o trata.
  if (pareceBotao(texto.replace(/^\s*(nao|não)\s+sei\b.*$/i, '')) && texto.trim().split(/\s+/).length <= 4) return null
  let t = texto.trim()
  // Hora ou data respondida fora de ordem (rodada 3 do painel): "17:20 entao"
  // foi gravado como o nome "17:20 Entao", e "as 8 da manha", como "As".
  if (/^\s*\d/.test(t) || /^\s*(as|a partir das|umas)\s+\d/i.test(t)) return null
  // Frase que nao e nome (16/10/2026, painel de pacientes simulados): "nao!!
  // eu queria 16h nao 14h" foi gravado como o nome "Nao!! Eu Queria", e a
  // reclamacao seguinte virou data de nascimento. Nome nao tem interrogacao,
  // nem as palavras de quem esta reclamando ou pedindo outra coisa.
  if (/[?]|!!/.test(t)) return null
  if (/\b(nao|não|queria|quero|errado|errada|horario|horário|marcar|consulta|atendente|pessoa|ajuda|trocar|mudar)\b/i.test(t.replace(/^(nao|não)\s+sei\b.*$/i, ''))) return null
  // Cortesia e pedido de outra coisa (26/10/2026, sondagem das etapas para o
  // Jev): "obrigado" e "preciso da 2a via da receita" foram gravados como o
  // nome do paciente, e na rodada 4 do painel a confirmacao saiu com o nome
  // "Certo". A pergunta do nome volta.
  const semAcento = normalizar(t)
  if (
    /^(ok|okay|obrigad[oa]s?|brigad[oa]|valeu|vlw|beleza|blz|certo|ta bom|ta|perfeito|show|combinado)\b/.test(semAcento) ||
    /\b(obrigad[oa]s?|preciso|precisava|receita|exames?|pedido|quanto|valor|convenio|endereco|cancel\w*|desmarc\w*)\b/.test(semAcento) ||
    /\b(2a|2ª|segunda) via\b/.test(semAcento)
  ) {
    return null
  }
  // Muleta antes do nome (16/10/2026, painel): "ja falei, ana paula ribeiro"
  // foi gravado como "Ja Falei", e "eu, renata andrade", como "Eu".
  t = t.replace(/^((ja|já)\s+(falei|disse|informei|mandei|escrevi)|como\s+(eu\s+)?(falei|disse)|eu\s+mesm[oa]|sou\s+eu(\s+mesm[oa])?|eu)\s*[,:.!-]\s*/i, '')
  // "Eu mesma", "a mae": quem e, mas nao o nome. A pergunta volta.
  if (/^(eu|eu mesm[oa]|sou eu( mesm[oa])?|a m[aã]e|o pai|m[aã]e|pai|ele|ela|o mesmo|a mesma)[.!]*$/i.test(t)) return null
  // "eu renata, mae dele" (rodada 2): o "eu" sem virgula tambem sai. Nome
  // nenhum comeca com a palavra "eu" solta ("Eunice" e uma palavra so).
  t = t.replace(/^(eu|aqui e|aqui é)\s+(?!mesm)/i, '')
  t = t.replace(/^(o\s+)?(nome\s+(completo\s+)?(dela|dele|do paciente|da paciente|e|é)?\s*(e|é|:)?|ela se chama|ele se chama|se chama|meu nome (e|é)|eu sou (a|o)|sou (a|o))\s+/i, '')
  // "É o Davi Oliveira Costa" (25/10/2026, rodada 5 do painel) foi gravado
  // com o "É o" no nome e saiu assim na confirmacao.
  t = t.replace(/^(e|é|eh)\s+(o|a|so|só)\s+(?=\p{L})/iu, '')
  t = t.split(/[,;(]|\s-\s|\s+\d/)[0]
  t = t.replace(/\s+(nascid[oa]|nasceu|tem\s|sou\s|mae|mãe|pai|avo|avó)\b.*$/i, '')
  t = t.replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim()
  if (t.length < 2 || !/\p{L}/u.test(t)) return null
  const tudoIgual = t === t.toLowerCase() || t === t.toUpperCase()
  if (tudoIgual) {
    const minusculas = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])
    t = t
      .toLowerCase()
      .split(' ')
      .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join(' ')
  }
  return t.slice(0, 160)
}

function emailNaFrase(texto: string): string | null {
  const m = texto.trim().match(/[^\s@,;:<>()]+@[^\s@,;:<>()]+\.[a-z]{2,}/i)
  return m ? m[0].replace(/[.]+$/, '').slice(0, 160) : null
}

/**
 * CPF pelo digito verificador, e nao so pelo tamanho.
 *
 * Onze digitos quaisquer passariam - inclusive um telefone digitado por engano
 * no campo errado - e o erro so apareceria meses depois, na hora de emitir a
 * receita, com a familia longe.
 */
function cpfValido(texto: string) {
  const cpf = soDigitos(texto)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  for (const [ate, posicao] of [[9, 10], [10, 11]] as const) {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (posicao - i)
    const resto = (soma * 10) % 11 % 10
    if (resto !== Number(cpf[ate])) return false
  }
  return true
}

/**
 * CPF mandado depois da ficha (15/10/2026, painel de familias).
 *
 * A mae pulou o CPF ("mando depois") e mandou no dia seguinte. O robo nao sabia
 * onde guardar, respondia "nao consegui entender" e passava para a equipe - e a
 * secretaria tinha de copiar o numero da conversa para o cadastro, a mao. Se
 * ninguem copiasse, a receita digital do medico ficava sem CPF.
 *
 * So CPF que confere pelo digito (um telefone nao passa) e so em mensagem curta:
 * numa frase longa o numero pode ser outra coisa, e quem le e a equipe.
 */
export function cpfMandadoDepois(texto: string): string | null {
  const achado = texto.match(/\d{3}[.\s]?\d{3}[.\s]?\d{3}\s?[-.\s]?\s?\d{2}/)
  if (!achado || !cpfValido(achado[0])) return null
  const resto = normalizar(texto.replace(achado[0], ' ')).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  return resto.length <= 12 ? soDigitos(achado[0]) : null
}

/** "pular", "nao sei", "nao tenho": tudo que significa "segue sem isso". */
function pulou(texto: string) {
  const t = normalizar(texto)
  if (
    t === 'pular' || t === 'pula' || t === '-' || t === 'x' ||
    t === 'nao sei' || t === 'não sei' || t === 'nao tenho' || t === 'não tenho' ||
    t === 'nao lembro' || t === 'sem cpf' || t === 'nao possui' || t === 'depois'
  ) return true
  // Frase inteira (14/10/2026): "nao sei o CPF dela de cabeca, posso mandar
  // depois?" recebia "Esse CPF nao confere"; "NAO TENHO EMAIL", "e-mail
  // parece incompleto". Quem diz que nao sabe ou que manda depois esta pulando.
  const f = t.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return (
    /\b(pular|pula|pulo)\b/.test(f) ||
    /\bnao (sei|lembro|tenho|tem|possui|uso|usamos|sabemos|tenho agora|sei agora)\b/.test(f) ||
    /\b(mando|envio|passo|informo|vejo|mandamos) (isso |o cpf |o email |ele )?depois\b/.test(f) ||
    /\bdepois (eu |a gente )?(mando|envio|passo|informo|vejo)\b/.test(f) ||
    /\bsem (cpf|email|e mail)\b/.test(f)
  )
}

/** A fila guardada na conversa: o que falta e quantas tentativas ja houve. */
function filaDaFicha(opcoes: unknown): { tentativas: number; faltam: string[]; manual: boolean; sugestao: string | null } {
  const bruto = opcoes as { tentativas?: number; faltam?: unknown; manual?: boolean; sugestao?: unknown } | null
  return {
    tentativas: Number(bruto?.tentativas ?? 0),
    faltam: Array.isArray(bruto?.faltam) ? (bruto?.faltam as string[]) : [],
    // Questionario disparado pela equipe, e nao pelo fim de um agendamento.
    manual: bruto?.manual === true,
    // O nome que a pessoa ja disse, oferecido na pergunta do nome (ver nomeDito).
    sugestao: typeof bruto?.sugestao === 'string' && bruto.sugestao ? bruto.sugestao : null,
  }
}

/**
 * O agradecimento final. Fecha a etapa e devolve o menu ativo.
 *
 * Diz o que fica pendente sem cobrar: quem nao soube o CPF ja ouviu uma vez que
 * pode responder depois, e repetir viraria pressao sobre quem justamente nao
 * podia resolver aquilo naquele momento.
 */
async function terminarDados(
  admin: Admin,
  conversationId: string,
  clinicId?: string,
  appointmentId?: string | null,
  /** Questionario disparado pela equipe: fecha sem comprovante. */
  manual = false,
): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'menu',
    booking_options: null,
    booking_intake_id: null,
  })

  // O cadastro nasce agora, com o que a familia acabou de digitar, e nao
  // depois que alguem da equipe clicar num botao. Se falhar, a vespera tenta
  // de novo: a consulta ja esta marcada de qualquer jeito.
  let virouCadastro = false
  if (clinicId && appointmentId) {
    try {
      const { data: consulta } = await admin
        .from('appointments')
        .select(
          'id,patient_id,starts_at,contact_name,contact_phone,' +
            'intake_patient_name,intake_birth_date,intake_guardian,intake_cpf,intake_email,' +
            'clinic_units(name)',
        )
        .eq('id', appointmentId)
        .maybeSingle()
      // O cliente do Deno nao consegue tipar select com tabela aninhada
      // (clinic_units(name)) e devolve um tipo de erro no lugar da linha. O
      // formato e o que ConsultaParaCadastro descreve, e e o proprio select
      // acima que garante isso.
      const ficha = consulta as unknown as ConsultaParaCadastro | null
      if (ficha && !ficha.patient_id) {
        virouCadastro = Boolean(await cadastrarDaFicha(admin, clinicId, ficha))
      }
    } catch (causa) {
      console.error('Nao consegui criar o cadastro a partir da ficha', causa)
    }
  }

  // O comprovante fecha a conversa. Remontado aqui, e nao guardado la atras,
  // porque entre a reserva e esta mensagem a familia respondeu varias vezes -
  // e o que vale e o estado da consulta agora.
  //
  // NUNCA no questionario manual. Ali a consulta usada e so o lugar onde as
  // respostas ficam penduradas, e pode ser uma que ja passou: em 16/09/2026 o
  // robo terminou o questionario anunciando "✅ Consulta marcada! segunda,
  // 14/09" - uma consulta de dois dias ANTES, que ninguem tinha acabado de
  // marcar. Comprovante e coisa de quem acabou de marcar.
  let comprovante = ''
  if (clinicId && appointmentId && !manual) {
    try {
      // patients(name) entrou em 15/10/2026 (Dr. Fabio): no perfil 'geral' quem
      // ja e paciente responde a ficha (o motivo da consulta), e o nome dele nao
      // e perguntado - sem o cadastro aqui, o comprovante saia sem nome, e com
      // irmaos no mesmo celular a mae nao sabia de quem era a consulta.
      const { data: consulta } = await admin
        .from('appointments')
        .select('starts_at,modality,intake_patient_name,patient_id,patients(name),clinic_units(name,address)')
        .eq('id', appointmentId)
        .maybeSingle()
      // Consulta que ja passou nao vira comprovante, venha de onde vier.
      if (consulta && new Date(consulta.starts_at).getTime() > (relogioEmFoco ?? new Date()).getTime()) {
        const unidade = (Array.isArray(consulta.clinic_units)
          ? consulta.clinic_units[0]
          : consulta.clinic_units) as { name?: string; address?: string } | null
        const timezone = await fusoDaClinica(admin, clinicId)
        const tele = consulta.modality === 'telemedicina'
        const onde = tele
          ? 'Telemedicina, por vídeo. O link da consulta chega aqui pelo WhatsApp antes do horário.'
          : `${unidade?.name ?? 'nossa unidade'}${unidade?.address ? `\n${unidade.address}` : ''}`
        const doCadastro = (consulta as { patients?: { name?: string | null } | { name?: string | null }[] | null }).patients
        const nomeCadastrado = (Array.isArray(doCadastro) ? doCadastro[0]?.name : doCadastro?.name) ?? ''
        const nomeDaCrianca =
          String((consulta as { intake_patient_name?: string | null }).intake_patient_name ?? '').trim() || String(nomeCadastrado).trim()
        // Convenio ou particular (16/10/2026), como no comprovante de marcar. A
        // coluna vem num pedido proprio: sem ela, o comprovante sai sem a linha.
        let pagamento = ''
        let convenioDaConsulta = ''
        if (geral() && !tele) {
          try {
            const { data: plano, error: erroDoPlano } = await admin.from('appointments').select('insurance').eq('id', appointmentId).maybeSingle()
            convenioDaConsulta = String((plano as { insurance?: string | null } | null)?.insurance ?? '').trim()
            if (!erroDoPlano) pagamento = `💳 ${convenioDaConsulta || 'Particular'}\n`
          } catch (erro) {
            console.warn('Nao consegui ler o convenio para o comprovante', erro)
          }
        }
        const lembrete = avisoDoLembrete(consulta.starts_at, timezone, relogioEmFoco ?? new Date())
        // Retorno no prazo (26/10/2026): o comprovante diz, como o de marcar().
        const doPaciente = (consulta as { patient_id?: string | null }).patient_id ?? null
        const retorno = doPaciente ? await retornoAbertoDoPaciente(admin, clinicId, doPaciente, relogioEmFoco ?? new Date()) : null
        const ehRetorno = Boolean(retorno && chaveDoDia(consulta.starts_at, timezone) <= retorno.ate)
        const titulo = ehRetorno && retorno
          ? `*Retorno marcado!* ${convenioDaConsulta ? `Retorno da consulta de ${diaCurto(retorno.consulta)}.` : `Incluído no valor da consulta de ${diaCurto(retorno.consulta)}.`}`
          : '*Consulta marcada!*'
        comprovante =
          `✅ ${titulo}\n\n${nomeDaCrianca ? `${iconeDoPaciente()} ${nomeDaCrianca}\n` : ''}🗓️ ${formatarData(consulta.starts_at, timezone)}\n${tele ? '💻' : '📍'} ${onde}\n${pagamento}\n` +
          (lembrete ? `${lembrete}\n\n` : '')
      }
    } catch (causa) {
      console.error('Nao consegui remontar o comprovante', causa)
    }
  }

  return {
    resposta:
      '✅ *Tudo certo, obrigado!* Já anotamos os dados' +
      // "Na sua consulta" so quando a pessoa acabou de marcar uma. No
      // questionario manual a consulta e detalhe interno - quem leu "anotamos
      // na sua consulta" sem ter marcado nada sai procurando qual.
      (virouCadastro
        ? ' e seu cadastro está feito'
        : appointmentId && !manual
          ? ' na sua consulta'
          : ' no seu cadastro') +
      '.\n\n' +
      (comprovante ? `━━━━━━━━━━━━━━\n${comprovante}` : '') +
      VOLTA,
    // Fim da ficha: o robo perguntou tudo o que tinha para perguntar e a
    // familia respondeu. Vale tambem para o questionario que a equipe disparou,
    // que termina aqui do mesmo jeito - e cuja pendencia era justamente esta.
    concluida: true,
  }
}

// ---------------------------------------------------------------
// Cadastro que ficou pela metade
// ---------------------------------------------------------------

/**
 * A consulta marcada pelo robo cujo cadastro ficou pela metade (24/09/2026).
 *
 * Caso real: a mae marcou, recebeu "Qual e o nome completo do paciente?",
 * tocou em "Voltar ao menu", e depois escreveu o nome da crianca. Com o menu
 * na tela, o nome virava "Nao entendi. Responda com o numero da opcao", e a
 * recepcao teve de disparar o questionario a mao.
 *
 * Pendente = consulta futura deste telefone, sem ficha ligada, com alguma das
 * tres perguntas obrigatorias sem resposta. Nunca lanca: sem a informacao, o
 * robo segue como antes.
 */
async function fichaPendente(
  admin: Admin,
  consultas: ConsultaMarcada[],
): Promise<{ id: string; inicio: string; faltam: string[] } | null> {
  if (consultas.length === 0) return null
  try {
    // O motivo (intake_complaint) so existe no perfil 'geral'. Coluna que o
    // banco nao tiver derruba a leitura e a ficha pendente apenas nao aparece,
    // que e o comportamento de antes - nunca o atendimento.
    const { data } = await admin
      .from('appointments')
      .select(
        'id,starts_at,patient_id,intake_patient_name,intake_birth_date,intake_guardian,intake_cpf,intake_email' +
          (geral() ? ',intake_complaint' : ''),
      )
      .in('id', consultas.map((c) => c.id))
    const linhas = ((data ?? []) as Record<string, unknown>[])
      .filter((l) => !l.patient_id)
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    for (const linha of linhas) {
      // A mesma regra do lembrete, inclusive o responsavel so de menor de idade.
      const { faltam, faltaObrigatoria } = faltamNaFicha(linha)
      if (!faltaObrigatoria) continue
      return {
        id: String(linha.id),
        inicio: String(linha.starts_at),
        faltam,
      }
    }
  } catch (causa) {
    console.warn('Nao consegui conferir cadastro pendente', causa)
  }
  return null
}

/**
 * O texto parece um nome de gente: so letras, duas palavras ou mais, sem
 * pergunta. "Joao Pedro Silva" passa; "qual o endereco?", "ok obrigado" e
 * "12/03/2019" nao.
 */
/**
 * Texto de botao ou de comando, que ninguem tem no nome (15/10/2026 no sistema
 * do Dr. Marcello, trazido em 25/10/2026).
 *
 * La, a familia tocou "Escolher outra data" na mensagem de confirmacao com o
 * cadastro pela metade. Tres palavras, so letras: passou por nome. O robo
 * gravou "Escolher outra data" como o nome do paciente, marcou a consulta com
 * ele e mandou "Ola, Escolher! Precisamos cancelar sua consulta". A
 * secretaria desfez na mao.
 */
const PALAVRAS_DE_BOTAO = new Set([
  'escolher', 'outra', 'data', 'datas', 'horario', 'horarios', 'marcar', 'remarcar', 'desmarcar', 'cancelar',
  'confirmar', 'confirmo', 'voltar', 'inicio', 'menu', 'opcoes', 'equipe', 'falar', 'consulta', 'agendar',
  'duvidas', 'cadastro', 'completar', 'unidade', 'atendimento', 'quero', 'nao',
])
export function pareceBotao(texto: string): boolean {
  return normalizar(texto)
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .some((p) => PALAVRAS_DE_BOTAO.has(p))
}

function pareceNome(texto: string) {
  const t = texto.trim()
  if (t.length < 5 || t.length > 80 || /[?0-9@]/.test(t)) return false
  if (!/^[\p{L}' .-]+$/u.test(t)) return false
  if (pareceBotao(t)) return false
  const palavras = t.split(/\s+/).filter((p) => p.length >= 2)
  if (palavras.length < 2) return false
  const comuns = new Set(['ok', 'obrigado', 'obrigada', 'bom', 'boa', 'dia', 'tarde', 'noite', 'oi', 'ola', 'tudo', 'bem', 'sim', 'nao', 'quero', 'queria', 'gostaria', 'por', 'favor'])
  return !palavras.every((p) => comuns.has(normalizar(p)))
}

/**
 * Texto solto de quem tem cadastro pela metade (24/09/2026). Se o que falta
 * primeiro e o nome e o texto tem cara de nome, e a resposta atrasada: anota e
 * segue. Senao, oferece retomar em um toque. Null quando nao ha pendencia.
 *
 * Vale no menu e na pergunta "voce ja tem uma consulta marcada": foi ali que a
 * familia de 24/09 escreveu o nome da crianca e recebeu "Nao entendi".
 */
async function tentarFichaPendente(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  texto: string,
  consultas: ConsultaMarcada[],
): Promise<Resultado | null> {
  const pendente = await fichaPendente(admin, consultas)
  if (!pendente) return null

  if (['ficha', 'completar cadastro', 'completar'].includes(normalizar(texto))) {
    registrar('ficha_retomada', 'botao')
    return await retomarFicha(admin, conversationId, pendente, '📋 Vamos completar o cadastro da consulta.')
  }

  const primeira = perguntas().find((p) => p.chave === pendente.faltam[0])
  if (primeira?.chave === 'nome' && pareceNome(texto)) {
    const nome = texto.trim().slice(0, 160)
    await guardarDado(admin, pendente.id, primeira, nome, null)
    registrar('ficha_retomada', 'nome')
    return await retomarFicha(
      admin,
      conversationId,
      { id: pendente.id, faltam: pendente.faltam.slice(1) },
      `Anotei o nome: *${nome}*. Vamos completar o cadastro da consulta.`,
    )
  }

  registrar('ficha_oferecida')
  const quando = formatarData(pendente.inicio, await fusoDaClinica(admin, clinicId))
  return {
    resposta:
      `📋 O cadastro da sua consulta de *${quando}* ficou pela metade. ` +
      `São poucas perguntas, e ajudam ${quemAtende(clinicId).o} a já ter os dados na hora.\n\n` +
      'Quer completar agora?',
    botoes: [
      { id: 'FICHA', titulo: 'Completar cadastro' },
      { id: '0', titulo: 'Ver o menu' },
    ],
  }
}

/**
 * Para o lembrete de reserva sem cadastro (01/10/2026, ver
 * _shared/ficha-pendente.ts e a funcao ficha-pendente).
 *
 * O que falta na ficha de uma consulta, na ordem das perguntas, e se falta
 * alguma obrigatoria. Mesmo criterio de fichaPendente: consulta ja ligada a
 * um paciente nao tem ficha a cobrar.
 */
export function faltamNaFicha(
  linha: Record<string, unknown>,
  /** A clinica da consulta (15/10/2026). Sem ela, o perfil da conversa em foco. */
  clinicId?: string | null,
): { faltam: string[]; faltaObrigatoria: boolean } {
  if (linha.patient_id) return { faltam: [], faltaObrigatoria: false }
  const q = clinicId ? quemAtende(clinicId) : perfil()
  const vazia = (coluna: string) => !String(linha[coluna] ?? '').trim()
  let lista = q.publico === 'geral' ? perguntasGerais(q) : PERGUNTAS
  // Perfil 'geral': com a data ja respondida, adulto nao deve responsavel (ver
  // filaSemResponsavelDeAdulto). Sem data, a pergunta da data vem antes e
  // decide na hora.
  const data = String(linha.intake_birth_date ?? '').trim()
  if (q.publico === 'geral' && data) {
    const idade = idadeEmAnos(data, relogioEmFoco ?? new Date())
    if (idade === null || idade >= 18) lista = lista.filter((p) => p.chave !== 'responsavel')
  }
  return {
    faltam: lista.filter((p) => vazia(p.coluna)).map((p) => p.chave),
    faltaObrigatoria: lista.some((p) => p.obrigatoria && vazia(p.coluna)),
  }
}

/** As colunas da ficha na consulta, para quem precisa ler faltamNaFicha. */
export const COLUNAS_DA_FICHA = PERGUNTAS.map((p) => p.coluna)

/**
 * Abre a ficha na conversa, como se o robo tivesse acabado de perguntar: a
 * proxima mensagem da familia cai como resposta da primeira pergunta que
 * falta. E o mesmo caminho de logo depois de marcar - nada de fluxo novo.
 */
export async function abrirFichaPeloLembrete(
  admin: Admin,
  conversationId: string,
  appointmentId: string,
  faltam: string[],
  aviso: string,
  /** A clinica da consulta (15/10/2026): escolhe o perfil das perguntas. */
  clinicId?: string,
): Promise<Resultado> {
  if (clinicId) perfilEmFoco = quemAtende(clinicId)
  return await perguntarDados(admin, conversationId, appointmentId, faltam, aviso)
}

/** Fecha a etapa em andamento da conversa (reserva cancelada). */
export async function encerrarEtapa(admin: Admin, conversationId: string) {
  await limparEstado(admin, conversationId)
}

/** Retoma o cadastro pendente a partir da primeira pergunta sem resposta. */
async function retomarFicha(
  admin: Admin,
  conversationId: string,
  pendente: { id: string; faltam: string[] },
  aviso: string,
): Promise<Resultado> {
  return await perguntarDados(admin, conversationId, pendente.id, pendente.faltam, aviso)
}

/**
 * Recomeça o questionário do cadastro, a pedido da equipe.
 *
 * O caminho normal é o robô perguntar logo depois de marcar. Mas quem toca em
 * "Voltar ao menu" no meio, ou some, fica com a consulta marcada e a ficha
 * vazia - e aí só a recepção percebe, olhando a agenda na véspera. O botão
 * "Questionário" na tela de Respostas serve para essa hora: manda as perguntas
 * de novo, na conversa que já existe, sem ninguém ter de ligar.
 *
 * Devolve null quando não há o que perguntar, isto é, quando o cadastro já
 * está completo. Quem chamou avisa a equipe na tela, em vez de mandar mensagem
 * à toa para a família.
 */
export async function iniciarQuestionario(
  admin: Admin,
  conversationId: string,
  /**
   * A consulta onde pendurar as respostas, quando existe.
   *
   * Aceita null desde 16/09/2026. Antes exigia consulta FUTURA, e isso deixava
   * de fora justamente quem a equipe mais quer alcançar: o paciente antigo sem
   * CPF na ficha, que não tem nada marcado. Sem consulta, as respostas vão
   * direto para o cadastro.
   */
  consultaId: string | null,
  paciente: Paciente | null,
  /** A clinica da conversa (15/10/2026): escolhe o perfil das perguntas. */
  clinicId?: string,
): Promise<{ resultado: Resultado; faltam: string[] } | null> {
  if (clinicId) perfilEmFoco = quemAtende(clinicId)
  // Sem consulta, o motivo (perfil 'geral') nao teria onde ficar.
  const faltam = camposQueFaltam(paciente).filter((c) => consultaId || c !== 'motivo')
  if (faltam.length === 0) return null

  // Deixa escrito de quem são as respostas. Sem consulta, é só isto que liga o
  // que a família vai digitar a uma ficha - e num telefone com dois irmãos
  // cadastrados, é o que impede o CPF de um cair no cadastro do outro.
  if (paciente) {
    await salvarEstado(admin, conversationId, { booking_patient_id: paciente.id })
  }

  const resultado = await perguntarDados(admin, conversationId, consultaId, faltam, '', true)
  return { resultado, faltam }
}

/**
 * Guarda a resposta e faz a proxima pergunta.
 *
 * Uma pergunta por mensagem, e nao um formulario de cinco linhas: no WhatsApp
 * um bloco com cinco campos volta pela metade, fora de ordem, e ninguem sabe
 * qual resposta e de qual campo.
 */
async function perguntarDados(
  admin: Admin,
  conversationId: string,
  /**
   * A consulta onde as respostas ficam penduradas, quando ha uma.
   *
   * Null quando a equipe disparou o questionario para alguem que ja tem ficha
   * mas nao tem consulta marcada: ai as respostas vao direto para o cadastro.
   */
  appointmentId: string | null,
  /** A fila do que falta, comecando pela pergunta a fazer agora. */
  faltam: string[],
  aviso = '',
  /**
   * Questionario disparado pela equipe, e nao pelo fim de um agendamento.
   *
   * Ja nao muda os botoes (25/09/2026): a ficha nunca mostra "Voltar ao
   * menu", nem a que vem depois do agendamento. Em 24/09 duas familias
   * tocaram nele logo na pergunta do nome da crianca - o horario ja estava
   * guardado, o botao parecia o proximo passo, e a consulta ficou no nome da
   * mae, com o lembrete chegando para "Larissa" e nao para a crianca. Quem
   * quiser sair mesmo assim digita MENU ou 0, como em qualquer etapa.
   */
  manual = false,
): Promise<Resultado> {
  const pergunta = perguntas().find((p) => p.chave === faltam[0])
  if (!pergunta) return await terminarDados(admin, conversationId, undefined, null, manual)

  // O nome ja dito na conversa vai junto da pergunta (ver nomeDito).
  const sugestao = pergunta.chave === 'nome' && geral() ? await nomeDaConversa(admin, conversationId) : null
  await salvarEstado(admin, conversationId, {
    booking_state: pergunta.estado,
    booking_intake_id: appointmentId,
    // A fila do que ainda falta, e as tentativas na pergunta atual. Na segunda
    // falha o robo segue em frente sozinho, em vez de prender quem nao tem
    // como responder.
    booking_options: { tentativas: 0, faltam, manual, ...(sugestao ? { sugestao } : {}) },
  })
  return {
    resposta:
      (aviso ? `${aviso}\n\n` : '') +
      pergunta.texto +
      (sugestao ? `\n\nSe for *${sugestao}*, responda *SIM*.` : '') +
      (pergunta.obrigatoria || pergunta.jaExplicaOPular
        ? ''
        : '\n\n_Se preferir não responder agora, digite PULAR._'),
    botoes: pergunta.obrigatoria ? undefined : [{ id: 'PULAR', titulo: 'Pular' }],
  }
}

/**
 * Grava uma resposta na consulta.
 *
 * Falha de escrita nao interrompe a conversa: a consulta ja esta marcada, e o
 * dado que nao entrou o medico pergunta no consultorio. Prender a pessoa numa
 * pergunta por causa de um erro nosso seria o pior dos dois mundos.
 */
async function guardarDado(
  admin: Admin,
  /** Null quando o questionario foi disparado sem consulta: so ficha. */
  appointmentId: string | null,
  pergunta: (typeof PERGUNTAS)[number],
  valor: string,
  paciente: Paciente | null,
) {
  if (appointmentId) {
    const { error } = await admin
      .from('appointments')
      .update({ [pergunta.coluna]: valor })
      .eq('id', appointmentId)
    if (error) console.error('Falha ao guardar dado do agendamento', { coluna: pergunta.coluna, error })
  }

  // Paciente ja cadastrado: o dado vai tambem para a ficha dele, que e de onde
  // a receita e o prontuario leem. So preenche buraco - nunca sobrescreve o que
  // a equipe digitou, porque isto aqui veio por mensagem e ninguem conferiu.
  if (!paciente || !pergunta.colunaDoCadastro) return
  const jaTem = String(
    (paciente as unknown as Record<string, unknown>)[pergunta.chave] ?? '',
  ).trim()
  if (jaTem) return

  // Data so quando e data: "marco de 2019" fica no agendamento, para alguem ler.
  let paraOCadastro: string = valor
  if (pergunta.chave === 'nascimento') {
    // Mesma leitura do cadastro criado na vespera (ver _shared/datas.ts).
    const iso = dataDeNascimentoIso(valor, relogioEmFoco ?? new Date(), { adulto: geral() })
    if (!iso) return
    paraOCadastro = iso
  }

  const { error: erroDoCadastro } = await admin
    .from('patients')
    .update({ [pergunta.colunaDoCadastro]: paraOCadastro })
    .eq('id', paciente.id)
  if (erroDoCadastro) {
    console.error('Falha ao completar o cadastro', { campo: pergunta.chave, erroDoCadastro })
  }
}

// ---------------------------------------------------------------
// Opcao 5: 2a via de receita e pedido de exame
// ---------------------------------------------------------------

/**
 * O pedido sendo montado, guardado em booking_options entre uma pergunta e a
 * seguinte. O nome do paciente vai junto do id porque o comprovante precisa
 * escrever o nome, e reler o cadastro a cada passo seria consulta a toa.
 */
type PedidoDeDocumento = {
  pacienteId?: string | null
  paciente?: string
  tipo?: 'receita' | 'exame'
  item?: string
  /** Pediu os dois (ver pediuOsDoisDocumentos): o que ainda falta perguntar. */
  depois?: 'receita' | 'exame'
  /** Os itens ja anotados antes do atual, quando sao dois. */
  feitos?: { tipo: 'receita' | 'exame'; item: string }[]
}

function pedidoEmAndamento(opcoes: unknown): PedidoDeDocumento {
  const bruto = opcoes as { pedido?: PedidoDeDocumento } | null
  return bruto?.pedido ?? {}
}

/** O nome do tipo como a pessoa leu no botao, para repetir igual no comprovante. */
const NOME_DO_TIPO = {
  receita: '💊 2ª via de receita',
  exame: '🔬 Pedido de exame',
} as const

/**
 * A pergunta de abertura, depois da portaria.
 *
 * Com mais de um paciente no telefone, perguntar de quem e o pedido vem antes
 * de tudo: a mae que cadastrou dois filhos nao pode receber "qual medicamento?"
 * sem que ninguem tenha dito de qual crianca se trata - e adivinhar a crianca
 * errada numa receita e pior do que uma pergunta a mais.
 */
async function perguntarDeQuemEOPedido(
  admin: Admin,
  conversationId: string,
  pacientes: Paciente[],
  inicio: PedidoDeDocumento = {},
): Promise<Resultado> {
  if (pacientes.length === 1) {
    return await perguntarTipoDoDocumento(admin, conversationId, {
      ...inicio,
      pacienteId: pacientes[0].id,
      paciente: pacientes[0].name,
    })
  }

  const cabem = pacientes.slice(0, MAX_TOQUES - 2)
  await salvarEstado(admin, conversationId, {
    booking_state: 'documento_paciente',
    booking_options: { pedido: inicio, pacientes: cabem.map((p) => p.id) },
  })
  return {
    resposta:
      'Para qual paciente é o pedido?\n\n' +
      cabem.map((p, i) => `*${i + 1}* ${p.name}`).join('\n') +
      `\n\n${SAIDAS}`,
    lista: {
      rotulo: 'Escolher paciente',
      linhas: comVoltar(cabem.map((p, i) => ({ id: String(i + 1), titulo: p.name }))),
    },
  }
}

async function perguntarTipoDoDocumento(
  admin: Admin,
  conversationId: string,
  pedido: PedidoDeDocumento,
): Promise<Resultado> {
  // Ja disse que sao os dois: perguntar "receita ou exame?" seria fazer a
  // pessoa escolher um e perder o outro.
  if (pedido.depois) return await perguntarItem(admin, conversationId, { ...pedido, tipo: 'receita', depois: 'exame' })
  await salvarEstado(admin, conversationId, {
    booking_state: 'documento_tipo',
    booking_options: { pedido },
  })
  const dePara = pedido.paciente ? ` para *${pedido.paciente}*` : ''
  return {
    resposta:
      `O que você precisa${dePara}?\n\n` +
      '*1* 💊 2ª via de receita\n' +
      '*2* 🔬 Pedido de exame\n\n' +
      SAIDAS,
    botoes: [
      { id: '1', titulo: '2ª via de receita' },
      { id: '2', titulo: 'Pedido de exame' },
    ],
  }
}

/** Qual medicamento ou exame. Com dois pedidos, avisa que anota os dois. */
async function perguntarItem(
  admin: Admin,
  conversationId: string,
  pedido: PedidoDeDocumento,
): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'documento_item',
    booking_options: { pedido },
  })
  const pergunta =
    pedido.tipo === 'receita'
      ? 'Qual medicamento? Pode escrever como está na receita.'
      : 'Qual exame? Pode escrever como está no pedido.'
  const ultimo = pedido.feitos?.at(-1)
  if (ultimo) return { resposta: `Anotei: *${ultimo.item}*.\n\nAgora o ${pedido.tipo === 'exame' ? 'pedido de exame' : 'medicamento'}. ${pergunta}` }
  if (pedido.depois) return { resposta: `Anoto os dois: a 2ª via da receita e o pedido de exame.\n\nPrimeiro: ${pergunta.charAt(0).toLowerCase()}${pergunta.slice(1)}` }
  return { resposta: pergunta }
}

/**
 * O passo da exigencia, e por que ele nao e burocracia.
 *
 * Foi o caso que o Dr. Marcello descreveu: o laboratorio devolve o pedido
 * porque o CID nao confere, a farmacia recusa a receita porque a validade
 * venceu. Sem essa linha ele recebe "preciso da receita da domperidona", refaz
 * exatamente igual, e a farmacia recusa de novo - ninguem falou o que estava
 * errado. A pergunta existe para o documento voltar certo na primeira vez.
 *
 * A foto vale mais que a explicacao: quem esta no balcao da farmacia costuma
 * repetir errado o que o atendente disse, e a imagem do que foi recusado mostra
 * sozinha. Por isso a mensagem convida, mas nao exige nenhum dos dois.
 */
async function perguntarExigencia(
  admin: Admin,
  conversationId: string,
  pedido: PedidoDeDocumento,
): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'documento_exigencia',
    booking_options: { pedido },
  })
  // Quem devolveu o documento muda com o tipo, e a pergunta precisa nomear a
  // pessoa certa: "a farmácia pediu correção no seu ultrassom?" faz a mae parar
  // para entender uma pergunta que nao era para ela.
  const quemRecusou = pedido.feitos?.length
    ? 'A farmácia ou o laboratório'
    : pedido.tipo === 'exame' ? 'O laboratório ou a clínica de exames' : 'A farmácia'
  return {
    resposta:
      `${quemRecusou} pediu alguma correção?\n\n` +
      'Se pediram, escreva o que foi. Se não, responda *não*.\n\n' +
      '📎 Se tiver foto do documento que não foi aceito, pode mandar aqui.',
    botoes: [{ id: 'não', titulo: 'Não pediram nada' }],
  }
}

/**
 * O comprovante, e o fim do caminho automatico.
 *
 * Ele repete o pedido inteiro de proposito. Para a familia, e a prova de que
 * foi entendido - sem isso a duvida "sera que registrou o medicamento certo?"
 * so se resolve esperando. Para a clinica, esta mensagem E o pedido: ela fica
 * como ultima mensagem da conversa, aparece na previa da lista, e poupa quem
 * abrir de subir a conversa inteira para descobrir o que foi pedido.
 *
 * Prazo com nome: "em breve" e o que a clinica sente, "1 dia util" e o que a
 * familia consegue esperar sem cobrar. Quem nao ganha prazo cobra em duas
 * horas, e a cobranca cai na mesma equipe que ainda nao teve tempo.
 */
async function registrarPedido(
  admin: Admin,
  clinicId: string,
  conversationId: string,
  pedido: PedidoDeDocumento,
  exigencia: string,
): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'atendente',
    booking_options: null,
    auto_replies_while_waiting: 0,
  })
  const titulo = pedido.tipo ? NOME_DO_TIPO[pedido.tipo] : '📄 Documento'
  const dePaciente = pedido.paciente ? ` · ${pedido.paciente}` : ''
  // Os dois itens no mesmo comprovante: para a equipe, esta mensagem E o pedido.
  const linhas = (pedido.feitos ?? []).flatMap((f) => [`${NOME_DO_TIPO[f.tipo]}${dePaciente}`, f.item, ''])
  linhas.push(`${titulo}${dePaciente}`)
  if (pedido.item) linhas.push(pedido.item)
  if (exigencia) linhas.push(`_Pediram correção:_ ${exigencia}`)

  return {
    resposta:
      '✅ Pedido registrado.\n\n' +
      linhas.join('\n') +
      // "revisar e responder", e nao "revisar e enviar".
      //
      // A portaria reconhece quem tem CADASTRO, e o cadastro nasce quando a
      // familia termina a ficha do agendamento - antes da consulta acontecer.
      // Quem marcou ontem passa por aqui e pediria 2a via de uma receita que
      // nunca existiu. Prometer o envio seria mandar essa pessoa esperar um
      // documento que nao ha; prometer a resposta e verdade nos dois casos, e
      // no caso comum - o que motivou tudo isto - a resposta E o documento.
      `\n\n${quemAtende(clinicId).O} vai revisar e responder por aqui, em até *1 dia útil*.\n\n` +
      VOLTA,
    atencao: 'documento',
  }
}

/**
 * A portaria: quem nunca consultou aqui.
 *
 * Nao e um beco. O numero desconhecido pode ser o pai usando o celular do
 * trabalho - e pode ser a farmacia ligando por causa da receita, que foi
 * justamente o caso que motivou tudo isto. As duas coisas precisam de caminho,
 * e caminhos diferentes.
 *
 * O que o robo NAO faz aqui, em nenhum dos dois: confirmar que fulano se trata
 * nesta clinica, mostrar cadastro, ou mandar documento. Isso e dado de saude, e
 * quem escreve de um numero que a clinica nunca viu nao provou ser ninguem.
 * Confirmar a pedido seria entregar prontuario para quem souber um nome.
 */
async function perguntarQuemPede(admin: Admin, conversationId: string): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'documento_quem',
    booking_options: null,
  })
  return {
    resposta:
      'A 2ª via é de documento emitido em consulta, e não localizei atendimento neste número.\n\n' +
      '*1* 👨‍👩‍👦 Sou o paciente ou responsável\n' +
      '*2* 🏥 Sou de farmácia ou laboratório\n\n' +
      SAIDAS,
    botoes: [
      { id: '1', titulo: 'Paciente/responsável' },
      { id: '2', titulo: 'Farmácia/laboratório' },
    ],
  }
}

/**
 * Farmacia escrevendo direto (15/10/2026, painel de familias).
 *
 * "Boa tarde, sou da Drogaria Sao Paulo, estou com uma receita do Dr. Marcello"
 * recebia o aviso de sintoma ("nao posso orientar sobre remedios") e o menu que
 * fala em "cuidar do seu filho". O caminho da farmacia ja existia, escondido
 * dentro da opcao 5. So vale para numero sem paciente: a mae que escreve "estou
 * na farmacia" continua sendo a mae.
 */
export function falaDeFarmacia(texto: string): boolean {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return (
    /\b(sou|somos|aqui e|falo|falando|escrevo|e) (a |o )?(d[ao]s? )?(farmacia|drogaria)\b/.test(t) ||
    /\b(farmaceutic[oa]|balconista)\b/.test(t) ||
    /^((bom dia|boa tarde|boa noite|oi|ola) )?(farmacia|drogaria)\b/.test(t)
  )
}

/** O recado da farmacia, registrado para a equipe. */
async function registrarRecadoDaFarmacia(
  admin: Admin,
  clinicId: string,
  conversationId: string,
): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'atendente',
    booking_options: null,
    auto_replies_while_waiting: 0,
  })
  return {
    resposta:
      `✅ Registrado. Vou passar para ${quemAtende(clinicId).o}.\n\n` +
      'O documento corrigido é enviado ao paciente, não por este canal.\n\n' +
      avisoDeHorario(relogioEmFoco ?? new Date()),
    atencao: 'farmacia',
  }
}

async function perguntarPedidoDaFarmacia(
  admin: Admin,
  conversationId: string,
): Promise<Resultado> {
  await salvarEstado(admin, conversationId, {
    booking_state: 'documento_farmacia',
    booking_options: null,
  })
  return {
    resposta:
      'Certo. Me diga o *nome do paciente* e o que precisa ser corrigido no documento.\n\n' +
      '📎 Se puder, mande a foto do que foi recusado.',
  }
}

/**
 * Entrada da opcao 5.
 *
 * A portaria vem antes de qualquer pergunta: sem atendimento neste numero, o
 * fluxo do paciente nem comeca.
 */
async function iniciarDocumento(
  admin: Admin,
  conversationId: string,
  pacientes: Paciente[],
  /** O texto que abriu o pedido, quando ja diz que sao os dois. */
  texto = '',
): Promise<Resultado> {
  if (pacientes.length === 0) return await perguntarQuemPede(admin, conversationId)
  const inicio: PedidoDeDocumento = texto && pediuOsDoisDocumentos(texto) ? { depois: 'exame' } : {}
  return await perguntarDeQuemEOPedido(admin, conversationId, pacientes, inicio)
}

// ---------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------

/**
 * Decide a resposta automatica. Devolve null quando o robo deve ficar calado -
 * porque a equipe assumiu, porque a mensagem e resposta a um acompanhamento,
 * ou porque o menu ja foi mostrado ha pouco.
 */
/**
 * Com a equipe conversando, "nao entendi" vira silencio (09/10/2026).
 *
 * A Tatiane estava escolhendo o dia; a secretaria entrou na conversa ("nessa
 * sexta temos 8h ou 10:40, qual fica melhor?"), a mae respondeu "10:40h" - para
 * a secretaria - e o robo, ainda na etapa do dia, mandou "Nao entendi. Responda
 * com o numero do dia". Resposta que o robo entende continua valendo (a
 * familia pode muito bem tocar no dia da lista); a que ele NAO entende, com
 * gente conversando, era para a gente. O silencio acende a conversa na tela.
 */
export async function tratarConversa(
  opcoes: Parameters<typeof tratarConversaPorDentro>[0],
): Promise<Resultado | null> {
  const antes = (eventosEmCurso.get(opcoes.conversationId) ?? []).length
  const resultado = await tratarConversaPorDentro(opcoes)
  const novos = (eventosEmCurso.get(opcoes.conversationId) ?? []).slice(antes)
  // Resposta pronta que chama a equipe, dada no meio de uma etapa (ver
  // naoEntendi): a conversa acende sem sair da etapa, e nao fecha como resolvida.
  if (resultado && !resultado.atencao && novos.some((e) => e.evento === 'chamar_equipe_junto')) {
    resultado.atencao = 'atendente'
    resultado.concluida = false
  }
  const naoEntendeu = novos.some((e) => e.evento === 'nao_entendi')
  if (resultado && naoEntendeu && opcoes.estadoAtual && !opcoes.podeIniciarMenu) {
    registrar('calou_com_equipe')
    return null
  }
  // Terceiro "Nao entendi" seguido (14/10/2026): o pai com pressa do painel
  // recebeu quatro iguais e so saiu porque digitou um numero; um pai de
  // verdade teria desistido. Na terceira vez, gente.
  if (resultado && !resultado.atencao && resultado.resposta.startsWith('Não entendi')) {
    const seguidos = await naoEntendiSeguidos(opcoes.admin, opcoes.conversationId)
    if (seguidos >= 2) {
      registrar('nao_entendi_repetido')
      const chamada = await chamarEquipe(opcoes.admin, opcoes.conversationId)
      return {
        ...chamada,
        resposta:
          'Desculpe, não estou conseguindo entender por aqui. 🙏 Já chamei alguém da nossa equipe, ' +
          'que continua a conversa com você.\n\n' +
          (geral() ? `${PERGUNTA_URGENCIA_OU_DUVIDA}\n\n` : '') +
          avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' + VOLTA,
        ...(geral() ? { botoes: BOTOES_URGENCIA_OU_DUVIDA } : {}),
      }
    }
  }
  // Ultima porta antes da familia (14/10/2026). Resposta pronta e fecho podem
  // trazer {valores} e {enderecos}, e saem por muitos caminhos (duvida no meio
  // do agendamento, fila da equipe, "nao entendi"). Em vez de lembrar de cada
  // um, tudo passa aqui. O que ja foi preenchido com o lugar certo (texto da
  // unidade) chega sem campo e passa direto.
  // Consulta marcada numa conversa com sinal de alarme (rodada 3 do painel):
  // "doi mto qdo engulo mas da pra aguentar" seguiu marcando, e o comprovante
  // saiu como o de uma consulta comum. O lembrete vai embaixo.
  if (
    resultado && opcoes.motivoDaAtencao === 'urgencia' && perfil().sinaisDeAlarme &&
    /está guardado|Consulta marcada!/.test(resultado.resposta)
  ) {
    resultado.resposta += '\n\n🚨 Lembrando: pelo que você contou, procure atendimento hoje mesmo, sem esperar por esta consulta.'
  }
  if (resultado && temCampo(resultado.resposta)) {
    resultado.resposta = await comCampos(opcoes.admin, opcoes.clinicId, resultado.resposta, null)
  }
  return resultado
}

async function tratarConversaPorDentro(opcoes: {
  admin: Admin
  clinicId: string
  conversationId: string
  estadoAtual: Estado | null
  opcoesAtuais: unknown
  unidadeEmAndamento: string | null
  /** 'telemedicina' quando a pessoa escolheu atendimento por video. */
  modalidadeEmAndamento?: Modalidade | null
  /**
   * Falso quando o robo nao deve puxar assunto: a pessoa esta respondendo um
   * acompanhamento, ou alguem da equipe escreveu ha pouco e a conversa e
   * humana. Quem calcula e o webhook, que tem o historico em maos.
   */
  podeIniciarMenu: boolean
  /**
   * A familia recebeu o acompanhamento pos-consulta ha menos de 48h, e
   * ninguem da equipe esta conversando. Ver depoisDoAcompanhamento em
   * lembrete.ts. Ausente vale falso.
   */
  posAcompanhamento?: boolean
  /**
   * A mensagem e um anexo: foto, documento, audio ou video.
   *
   * Quem manda a foto de um exame quer que alguem OLHE. Responder o menu a isso
   * e o robo dizendo "nao vi o que voce mandou, escolha uma opcao".
   */
  anexo?: boolean
  /**
   * O robo ja mostrou o menu nesta conversa.
   *
   * Falso na primeira mensagem de alguem. Enquanto for falso, atalho nenhum
   * pula a apresentacao: a pessoa precisa ver o que existe antes de ser levada
   * para dentro de um fluxo.
   */
  jaViuOMenu?: boolean
  /**
   * Quantas respostas prontas o robo ja deu nesta espera pela equipe.
   *
   * Passando de LIMITE_NA_ESPERA, ele para de responder ate alguem assumir a
   * conversa. Ausente vale zero: quem chama sem informar esta comecando a
   * contagem, e nao pulando o limite.
   */
  respostasNaEspera?: number
  texto: string
  telefone: string
  /**
   * Todos os pacientes cadastrados com este telefone, em ordem de nome. Vazio
   * quando ninguem foi reconhecido. Mais de um e o caso da mae com dois filhos.
   */
  pacientes: Paciente[]
  /** Paciente ja escolhido nesta conversa, quando a pergunta ja foi feita. */
  pacienteEmAndamento: string | null
  /** Consultas futuras ja marcadas para este telefone, da mais proxima em diante. */
  consultas: ConsultaMarcada[]
  /** Consulta a cancelar assim que a nova entrar, num fluxo de remarcacao. */
  consultaASubstituir: string | null
  /** Consulta recem-marcada cujos dados estao sendo perguntados. */
  consultaEmCadastro: string | null
  /** Convenio ja respondido neste agendamento. Vazio ou ausente = particular. */
  convenioEmAndamento?: string | null
  /** Nome que a pessoa usa no WhatsApp. Vazio quando o evento nao trouxe. */
  nomeDoPerfil: string
  textos: { saudacao: string; saudacaoConhecida: string; informacoes: string }
  /**
   * O relogio da conversa. Ausente vale agora; os testes passam um horario
   * fixo, porque a resposta de urgencia muda fora do expediente.
   */
  agora?: Date
  /**
   * Ha consulta deste telefone hoje (marcada ou ja atendida). E o que faz
   * "vou atrasar" virar aviso para a equipe. Ausente vale falso.
   */
  consultaHoje?: boolean
  /**
   * Por que a conversa esta acesa para a equipe (attention_reason), quando
   * esta. Numa conversa de sangramento ou urgencia, a mensagem nova na fila
   * recebe o lembrete do pronto-socorro (ver lembreteDeUrgencia).
   */
  motivoDaAtencao?: string | null
}): Promise<Resultado> {
  const { admin, clinicId, conversationId, estadoAtual, texto } = opcoes
  const agora = opcoes.agora ?? new Date()
  relogioEmFoco = agora
  perfilEmFoco = quemAtende(clinicId)

  // De quem sao os eventos daqui para baixo. Ver EventoDoRobo, la em cima.
  focar(conversationId)

  // A telemedicina nao tem id de unidade no banco; a modalidade e que diz que
  // a pessoa esta nesse caminho. Daqui para baixo as etapas so olham para
  // esta variavel, e nunca para a coluna crua.
  const unidadeEmAndamento =
    opcoes.modalidadeEmAndamento === 'telemedicina' ? TELE_ID : opcoes.unidadeEmAndamento

  // Chamar pelo nome so quando ha um paciente neste telefone. Com dois irmaos
  // cadastrados, usar o nome de um deles seria adivinhar - e adivinhar errado
  // metade das vezes.
  const unico = opcoes.pacientes.length === 1 ? opcoes.pacientes[0] : null
  const primeiroNome = (unico?.name ?? '').trim().split(/\s+/)[0] ?? ''
  // Perfil 'geral' (15/10/2026): paciente adulto costuma escrever do proprio
  // celular, e "Ola, Ricardo!" e para ele mesmo. Crianca, ou idade que nao da
  // para saber, segue a regra da pediatria: quem escreve e a mae, e o
  // vocativo sai (ver saudacaoParaQuemEscreve).
  const adulto = Boolean(unico && geral() && (idadeEmAnos(unico.nascimento, agora) ?? 0) >= 18)
  const saudacao = (
    unico && opcoes.textos.saudacaoConhecida.trim()
      ? adulto
        ? opcoes.textos.saudacaoConhecida.replace(/\{nome\}/g, primeiroNome)
        : saudacaoParaQuemEscreve(opcoes.textos.saudacaoConhecida, primeiroNome)
      : opcoes.textos.saudacao
  ).trim() || quemAtende(clinicId).saudacaoPadrao
  criancaEmFoco = unico && primeiroNome ? { conversa: conversationId, nome: primeiroNome } : null
  textoEmFoco = { conversa: conversationId, texto }

  // Paciente achado por nome e nascimento (26/10/2026, ver
  // perguntarPacienteDoRetorno): nao e deste telefone, entao vem do banco.
  const deOutroTelefone =
    opcoes.pacienteEmAndamento &&
    opcoes.pacienteEmAndamento !== OUTRA_CRIANCA &&
    !opcoes.pacientes.some((p) => p.id === opcoes.pacienteEmAndamento)
      ? await pacientePorId(admin, clinicId, opcoes.pacienteEmAndamento)
      : null
  /** Quem vai no prontuario da consulta: o escolhido, ou o unico que existe. */
  const pacienteDaConsulta =
    opcoes.pacienteEmAndamento === OUTRA_CRIANCA
      ? null
      : (deOutroTelefone ?? opcoes.pacientes.find((p) => p.id === opcoes.pacienteEmAndamento) ?? unico ?? null)

  // MENU vem antes de tudo, ate de "a equipe assumiu": e a saida de emergencia
  // que prometemos em toda mensagem, e promessa que falha uma vez nao vale.
  if (pediuMenu(texto)) {
    return await mostrarMenu(admin, conversationId, saudacao)
  }

  // O toque em "Duvida" (ver BOTOES_URGENCIA_OU_DUVIDA), ou a palavra escrita
  // logo depois deles, na fila: a mensagem fica com a equipe, sem alarme.
  if (
    geral() &&
    (normalizar(texto) === 'e_duvida' ||
      (estadoAtual === 'atendente' && /^(e )?(uma )?duvida[.!\s]*$/.test(normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim())))
  ) {
    const chamada = estadoAtual === 'atendente' ? null : await chamarEquipe(admin, conversationId)
    return {
      ...(chamada ?? {}),
      resposta: `💬 Combinado: a sua dúvida já está com a nossa equipe, que responde por aqui. Se quiser, escreva mais detalhes.\n\n${avisoDeHorario(agora)}`,
      atencao: 'atendente',
    }
  }

  // Sangramento (Dr. Fabio, 15/10/2026), logo depois do MENU e antes de tudo
  // o mais: em qualquer etapa, com a equipe conversando ou nao, respondendo
  // lembrete ou nao. O alerta no celular do medico nao pode depender de onde
  // a conversa estava. So no perfil que tem o modulo. Ver alertarSangramento.
  if (perfil().alertaDeSangramento && falouDeSangramento(texto)) {
    return await alertar(
      admin, clinicId, conversationId, estadoAtual, opcoes.opcoesAtuais,
      opcoes.consultaEmCadastro, pacienteDaConsulta, texto, agora,
    )
  }

  // Sinal de alarme do otorrino (16/10/2026), no mesmo lugar e pelo mesmo
  // motivo do sangramento: antes da resposta pronta, que respondia "feijao no
  // nariz" com a propaganda do consultorio. Ver sinalDeAlarme.
  {
    const alarme = perfil().sinaisDeAlarme ? sinalDeAlarme(texto) : null
    if (alarme) {
      return await alertar(
        admin, clinicId, conversationId, estadoAtual, opcoes.opcoesAtuais,
        opcoes.consultaEmCadastro, pacienteDaConsulta, texto, agora, alarme,
      )
    }
  }

  // Conversa de sangramento ou urgencia que seguiu numa etapa (16/10/2026,
  // rodada 3 do painel): "qual ps vcs indicam aqui em santos? tenho porto
  // saude" foi lido como unidade e convenio, e abriu as datas de Santos; "ta
  // bom to indo" ouviu "Nao entendi. Responda com o numero do dia". Na fila
  // da equipe, o bloco do estado 'atendente' cuida disso.
  {
    const motivo = opcoes.motivoDaAtencao === 'sangramento' || opcoes.motivoDaAtencao === 'urgencia' ? opcoes.motivoDaAtencao : null
    if (motivo && perfil().sinaisDeAlarme && estadoAtual && estadoAtual !== 'atendente' && opcoes.podeIniciarMenu) {
      if (vaiAoProntoSocorro(texto) || indoAgora(texto)) {
        await salvarEstado(admin, conversationId, { booking_state: 'atendente', booking_options: null, booking_unit_id: null })
        return { resposta: '💙 Isso. A nossa equipe já sabe e acompanha por aqui.' }
      }
      // "Tem problema esperar ate sexta? Ou e melhor ir num pronto-socorro?"
      // (rodada 3) recebia o texto geral da urgencia, com "se alguem esta
      // passando mal agora". Nesta conversa, a resposta e sem condicional.
      const duvidaDeEsperar =
        parecePergunta(texto) &&
        /\b(posso|da pra|tem problema|e grave|precisa mesmo|preciso mesmo|devo|melhor|espero)\b.{0,40}\b(esperar|aguardar|ir|procurar|pronto socorro|ps|consulta)\b/.test(normalizar(texto).replace(/[^a-z\s]/g, ' '))
      if (perguntouDoProntoSocorro(texto) || pediuUrgencia(texto) || duvidaDeEsperar) {
        return { resposta: lembreteDeUrgencia(motivo, texto), atencao: motivo }
      }
    }
  }

  // Mensagem para a pessoa errada (06/10/2026). Ver numeroErrado. Vale em
  // qualquer etapa e ate respondendo lembrete: e o caso tipico.
  if (numeroErrado(texto)) {
    registrar('numero_errado')
    await salvarEstado(admin, conversationId, {
      booking_state: 'atendente',
      booking_options: null,
      booking_unit_id: null,
      auto_replies_while_waiting: 0,
    })
    return {
      resposta:
        'Obrigado por avisar, e desculpe o engano! 🙏 Vamos corrigir o cadastro. ' +
        'Se este número não é de um paciente do consultório, pode desconsiderar a mensagem.',
      atencao: 'numero_errado',
    }
  }

  // O WhatsApp Business da familia respondendo sozinho: nada a dizer, e nada
  // para a equipe ver. Ver respostaAutomaticaDaFamilia.
  if (respostaAutomaticaDaFamilia(texto)) {
    registrar('resposta_automatica_da_familia')
    return { resposta: '' }
  }

  // Atraso ou chegada no dia da consulta. Ver avisoDoDiaDaConsulta.
  {
    const aviso = avisoDoDiaDaConsulta(texto)
    const noMeioDaFicha = Boolean(estadoAtual?.startsWith('dados_') || estadoAtual?.startsWith('documento_'))
    if (aviso && (aviso === 'chegada' || opcoes.consultaHoje) && !noMeioDaFicha && !assuntoClinico(texto)) {
      registrar('aviso_do_dia', aviso)
      // Com a equipe conversando, quem responde e ela: o silencio acende a conversa.
      if (!opcoes.podeIniciarMenu) return null
      await salvarEstado(admin, conversationId, {
        booking_state: 'atendente',
        booking_options: null,
        booking_unit_id: null,
        auto_replies_while_waiting: 0,
      })
      return {
        resposta:
          (aviso === 'chegada' ? 'Obrigado por avisar que chegaram! 🙏 ' : 'Obrigado por avisar! 🙏 ') +
          `Já passei o recado para a nossa equipe, que avisa ${quemAtende(clinicId).o}.`,
        atencao: 'atendente',
      }
    }
  }

  // Anexo: foto, documento, audio ou video.
  //
  // O robo nao le nada disso, e fingir que leu seria pior. Quem manda a foto de
  // um exame, uma receita antiga ou um audio contando o caso quer que uma
  // pessoa olhe. Ate 15/09/2026 a mensagem virava "[image]" e a resposta era o
  // menu inteiro: "como podemos ajudar hoje?" para quem acabou de mandar o
  // ultrassom do filho.
  //
  // Entrega para a equipe e diz que entregou. Se a conversa ja estava com a
  // equipe, silencio: a segunda foto nao precisa de outro "vou entregar".
  //
  // Vem antes do bloco da equipe para que o anexo de quem NAO estava na fila
  // entre nela, e depois do MENU para nao tirar a saida de emergencia de
  // ninguem.
  // Dentro do pedido de documento, a foto nunca cai na regra geral.
  //
  // A regra geral entrega o anexo a equipe e zera booking_options - o pedido
  // montado ate ali evapora. Em "o que foi recusado?" a foto E a resposta; nas
  // etapas anteriores ela e natural do mesmo jeito (a mae fotografa a receita
  // quando o robo pergunta o nome do remedio) e precisa ser recebida sem
  // derrubar o que ja foi respondido. Cada etapa trata a sua, mais abaixo.
  const noPedidoDeDocumento = Boolean(estadoAtual?.startsWith('documento_'))

  // Arquivo no meio de um fluxo (25/09/2026): a etapa continua de pe. A mae
  // que manda a foto da carteirinha enquanto o robo pergunta o nome da crianca
  // perdia o agendamento inteiro - a regra geral zerava tudo e a mandava para
  // a fila. Agora a equipe e avisada do arquivo e a pergunta segue esperando.
  const emFluxo = Boolean(estadoAtual) && estadoAtual !== 'menu' && estadoAtual !== 'atendente'
  if (opcoes.anexo && !noPedidoDeDocumento && emFluxo) {
    return {
      resposta:
        '📎 Recebi o que você enviou e já avisei a nossa equipe.\n\n' +
        'Para continuar de onde paramos, é só responder a pergunta acima 👆',
      atencao: 'anexo',
    }
  }

  if (opcoes.anexo && !noPedidoDeDocumento) {
    if (estadoAtual === 'atendente') return null
    await salvarEstado(admin, conversationId, {
      booking_state: 'atendente',
      booking_options: null,
      booking_unit_id: null,
      auto_replies_while_waiting: 0,
    })
    return {
      resposta:
        '📎 Recebi o que você enviou e já avisei a nossa equipe: alguém do consultório vai olhar e responder por aqui.\n\n' +
        'Se quiser, escreva junto o que é e o que você gostaria de saber. Isso ajuda quem for responder.\n\n' +
        avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' +
        VOLTA,
      atencao: 'anexo',
    }
  }

  // Equipe assumiu a conversa. O robo cala a boca - falar por cima de uma
  // pessoa que esta atendendo e pior do que nao responder.
  //
  // A excecao e urgencia. Quem ja esta na fila da equipe e escreve "e urgente"
  // precisa de duas coisas: a conversa subindo na lista da recepcao, e a
  // confirmacao de que o recado chegou. Ficar mudo aqui era o pior cenario
  // possivel - a mae avisando que a crianca esta mal, e a tela sem sinal
  // nenhum de que aquilo era diferente das outras conversas em espera.
  if (estadoAtual === 'atendente') {
    // Toque em "Marcar uma consulta" de um menu antigo, na fila da equipe
    // (24/09/2026). A atendente respondeu "selecione Agendar e marque direto";
    // a mae tocou - e o robo, calado porque havia gente na conversa, ignorou.
    // Ela escreveu "nao estou conseguindo marcar" e esperou 35 minutos. O
    // titulo exato do item so chega por toque (quem digita escreve outra
    // coisa), entao isto nao atropela conversa nenhuma: e pedido explicito.
    // O botao oferecido logo abaixo tem id proprio (MARCAR_AGORA), e nao "2"
    // (05/10/2026). Com id "2", o toque chegava como "2", que aqui e pedido de
    // marcar - e o robo oferecia o mesmo botao de novo. O Leandro tocou tres
    // vezes, ouviu tres vezes "toque em Marcar uma consulta" e desistiu.
    if (['marcar uma consulta', 'marcar_agora'].includes(normalizar(texto))) {
      registrar('opcao_escolhida', '2')
      return await iniciarAgendamento(
        admin, clinicId, conversationId, opcoes.pacientes, opcoes.consultas,
      )
    }

    // Conversa de sangramento ou urgencia, ainda sem ninguem da equipe: a
    // mensagem nova recebe o "nao espere", e nunca uma resposta pronta com
    // "sua conversa continua na fila". Ver lembreteDeUrgencia. Pergunta sempre
    // tem resposta ("vou pro PS ou espero?"); recado so quando o lembrete nao
    // acabou de sair.
    const motivo = opcoes.motivoDaAtencao
    // Ja indo para o pronto-socorro: resposta curta, sem novo alerta.
    if ((motivo === 'sangramento' || motivo === 'urgencia') && opcoes.podeIniciarMenu && (vaiAoProntoSocorro(texto) || indoAgora(texto))) {
      return {
        resposta:
          '💙 Isso. A nossa equipe já sabe e acompanha por aqui.' +
          (pediuAgendamento(texto) ? ' Depois do atendimento, quando quiser marcar a consulta, é só escrever por aqui.' : ''),
      }
    }
    // O lembrete nao vale para quem diz que nao e urgencia (rodada 2): "nao e
    // emergencia, so quero marcar o primeiro horario" recebeu o pronto-socorro
    // e mais uma notificacao falsa.
    const naoEUrgencia = /\b(nao|nem) (e|eh|era|foi) (uma |nenhuma )?(urgen|emergen)/.test(normalizar(texto))
    if (
      (motivo === 'sangramento' || motivo === 'urgencia') && opcoes.podeIniciarMenu &&
      !soAgradecimento(texto) && !despedida(texto) && !naoEUrgencia && texto.trim() !== '2'
    ) {
      const lembrete = lembreteDeUrgencia(motivo, texto)
      // "A consulta de sexta fica marcada ou nao?" (rodada 3 do painel) ouviu
      // o mesmo lembrete duas vezes, sem resposta. A consulta continua; o
      // lembrete vem junto.
      if (opcoes.consultas.length > 0 && /\bconsulta\b/.test(normalizar(texto)) && /\b(marcad\w*|fica|continua|mant\w*|vale|cancel\w*|desmarc\w*)\b/.test(normalizar(texto)) && parecePergunta(texto)) {
        const fuso = await fusoDaClinica(admin, clinicId)
        return {
          resposta:
            `Sim, a sua consulta de *${formatarData(opcoes.consultas[0].inicio, fuso)}* continua marcada. ` +
            '*Mas pelo que você contou, não espere por ela: procure atendimento hoje.*',
          atencao: motivo,
        }
      }
      // Marcar no lugar de ir (rodada 2): "ele ta respirando normal, precisa ir
      // agora msm? nao da pra marcar com o dr pra amanha?" ficou sem resposta.
      // A resposta e o lembrete, e a consulta fica para depois, com o botao.
      if (pediuAgendamento(texto)) {
        return {
          resposta: `${lembrete}\n\nSe ainda quiser marcar uma consulta para depois, toque em *Marcar uma consulta*.`,
          atencao: motivo,
          botoes: [{ id: 'MARCAR_AGORA', titulo: 'Marcar uma consulta' }],
        }
      }
      // O que a pessoa disse agora (o 192 para quem nao tem como ir) vale mesmo
      // com o lembrete de ha pouco (25/10/2026, rodada 5 do painel): "nao da pra
      // ir nao consigo anda" e "chama uma ambulancia pra mim" ficaram em
      // silencio, porque o lembrete com o 192 comeca igual ao de antes, e
      // jaMandada so compara o comeco.
      const complemento = complementoDaUrgencia(texto).trim()
      if (
        parecePergunta(texto) || pediuUrgencia(texto) || !(await jaMandada(admin, conversationId, lembrete)) ||
        (complemento && !(await jaMandada(admin, conversationId, complemento)))
      ) {
        return { resposta: lembrete, atencao: motivo }
      }
      // O 192 ja saiu e a pessoa insiste que nao consegue ir, ou pede que a
      // clinica chame a ambulancia (rodada 5): o silencio ali e o pior que ha.
      if (precisaDo192(texto)) {
        return {
          resposta:
            '🚑 *Ligue 192 (SAMU) agora*: eles vão até você. Por aqui não conseguimos chamar a ambulância. ' +
            'Se tiver alguém perto, peça para ligar. A nossa equipe já foi avisada.',
          atencao: motivo,
        }
      }
      // "Ajuda", logo depois do lembrete (rodada 3 do painel), ficava sem
      // resposta nenhuma. O pedido curto recebe o caminho mais curto.
      if (/\b(ajuda|ajude|socorro|por favor|pelo amor de deus|me ajud\w*)\b/.test(normalizar(texto))) {
        return {
          resposta: '🚨 Não espere a nossa resposta: procure o pronto-socorro agora. A nossa equipe já foi avisada e acompanha por aqui.',
          atencao: motivo,
        }
      }
      return null
    }

    if (pediuUrgencia(texto)) {
      // Na fila tambem: fora do horario, "o mais rapido possivel" seria segunda.
      if (!dentroDoExpediente(agora)) return { resposta: urgenciaForaDoExpediente(agora), atencao: 'urgencia' }
      return {
        resposta:
          '🚨 Avisei a nossa equipe de que é urgente. Alguém entra em contato o mais rápido possível.\n\n' +
          (geral()
            ? `*Se alguém está passando mal agora, não espere a nossa resposta. ${prontoSocorro()}*`
            : 'Se for uma emergência com risco de vida, procure o pronto-socorro mais próximo ou ligue 192.'),
        atencao: 'urgencia',
      }
    }

    // Pedido de gente, "alguem ai?" ou "nao respondeu", ja na fila (16/10/2026,
    // painel): o silencio parecia que ninguem tinha recebido. Uma vez: a
    // segunda insistencia ja tem a resposta logo acima.
    // "E vai demorar quanto tempo dessa vez???" (rodada 3 do painel) recebeu a
    // resposta pronta "Como e a consulta" (40 minutos): e a fila que demora.
    const perguntouDaDemora = /\b(vai demorar|demora muito|demorar muito|vao demorar|ainda vai demorar|quanto tempo (vai|pra|para|ainda)|vao responder|vai responder|quando (vao|vai|voces vao) (me )?(responder|atender))\b/.test(normalizar(texto))
    if (opcoes.podeIniciarMenu && (pediuAtendente(texto) || chamandoAlguem(texto) || naoFoiRespondida(texto) || (geral() && perguntouDaDemora))) {
      const naFila = `🙋 Sua conversa já está na fila da nossa equipe: alguém responde por aqui assim que possível.\n\n${avisoDeHorario(agora)}`
      if (await jaMandada(admin, conversationId, naFila)) return null
      return { resposta: reclamouDaDemora(texto) ? `Desculpe a demora! 🙏 ${naFila}` : naFila }
    }
    // Em ingles, ja na fila (rodada 2 do painel): "English??" e "Hello? Someone
    // speak English?" ficavam sem resposta nenhuma. Uma vez, em ingles.
    if (opcoes.podeIniciarMenu && escreveuEmIngles(texto)) {
      const emIngles = '🙋 Our team already has your message and will reply here, on weekdays during office hours (Brasília time).'
      return (await jaMandada(admin, conversationId, emIngles)) ? null : { resposta: emIngles }
    }

    // Pergunta de sempre, respondida na espera - ate tres vezes.
    //
    // A fila pode durar a noite inteira, e nesse tempo a pessoa escreve
    // "convenio?", "quanto custa?", "onde fica?". Calar diante de uma pergunta
    // que a clinica ja respondeu mil vezes nao protege ninguem.
    //
    // Tres e o limite porque insistir costuma querer dizer que o texto pronto
    // nao serviu: a quarta repeticao do mesmo paragrafo vira deboche. Passou
    // disso, o robo cala e a conversa e so da equipe.
    //
    // podeIniciarMenu entra aqui porque ele e quem sabe se alguem da equipe
    // escreveu ha pouco. Com atendimento humano em andamento, nem a resposta
    // pronta deve aparecer: seria o robo falando por cima da atendente.
    // Na fila, so responde o que casa forte: duas palavras do assunto, e nao
    // uma. Uma palavra solta pega frases que nao sao pergunta - "quero marcar
    // retorno para o Matheus" casava com "retorno" e recebia a lista de
    // documentos. Duas palavras separam a duvida de verdade do resto.
    //
    // A trava anterior era "pedido de agendamento nao recebe resposta pronta", e
    // ela calou a Simone: a mensagem dela pedia informacoes PARA agendar, e a
    // pergunta (AMIL, valor, formas de pagamento) ficou sem resposta. O peso do
    // casamento resolve os dois casos sem precisar adivinhar a intencao.
    const jaRespondidas = opcoes.respostasNaEspera ?? 0

    // "Ta, mas ate que horas?" na fila (rodada 2): a agenda responde, uma vez,
    // dentro do limite das respostas na espera. Ver respostaDaAgenda.
    if (opcoes.podeIniciarMenu && jaRespondidas < LIMITE_NA_ESPERA && !pediuParaMarcar(texto)) {
      const jaTemResumo = (await mensagensRecentesDoRobo(admin, conversationId)).some((m) => m.includes('Dias e horários com vaga'))
      const agenda = await respostaDaAgenda(admin, clinicId, texto, jaTemResumo)
      if (agenda && !(await jaMandada(admin, conversationId, agenda))) {
        await admin
          .from('whatsapp_conversations')
          .update({ auto_replies_while_waiting: jaRespondidas + 1 })
          .eq('id', conversationId)
        return { resposta: `${agenda}\n\nSua conversa continua na fila da nossa equipe.` }
      }
    }

    // Quer marcar, estando na fila (25/09/2026). Em 24/09 a atendente
    // respondeu "basta escolher a opcao 2"; a mae digitou "Pode agendar", "2",
    // e o robo, calado na fila, nao fez nada - 35 minutos ate ela escrever
    // "nao estou conseguindo marcar". Ate 26/10/2026 o robo oferecia um botao;
    // desde entao abre a agenda ele mesmo (ver o querMarcar abaixo).
    // Pergunta de verdade nao e pedido de marcar (06/10/2026): "Tenho gemeas
    // de 3 anos. Poderia agendar a consulta pro valor de 450 para as duas?"
    // recebeu "toque em Marcar uma consulta" - ela queria uma resposta da
    // equipe, que ja estava com a conversa. Frase longa com cara de pergunta
    // fica para a equipe.
    // Despedida na fila: resposta curta, e a conversa continua na fila.
    if (opcoes.podeIniciarMenu && despedida(texto)) {
      return (await jaMandada(admin, conversationId, RESPOSTA_A_DESPEDIDA)) ? null : { resposta: RESPOSTA_A_DESPEDIDA }
    }
    // "Vou esperar a equipe me confirmar" (rodada 2 do painel): ficava sem
    // resposta nenhuma, como se a mensagem nao tivesse chegado. Uma vez.
    const vaiEsperar =
      !parecePergunta(texto) &&
      /\b(vou|vamos) (esperar|aguardar)\b|\bfico (no )?(aguard\w*|esperando)\b|\b(aguardo|aguardando|esperando) (a |o |vcs|voces|retorno|resposta|contato)/.test(normalizar(texto))
    // "Ta bom obrigada fico esperando" (rodada 3) ficava sem resposta.
    if (geral() && opcoes.podeIniciarMenu && (vaiEsperar || soAgradecimento(texto))) {
      const combinado = '💙 Combinado! A nossa equipe responde por aqui assim que possível.'
      return (await jaMandada(admin, conversationId, combinado)) ? null : { resposta: combinado }
    }
    const perguntaLonga =
      parecePergunta(texto) && normalizar(texto).split(/\s+/).filter(Boolean).length >= 10
    // Com a equipe conversando, so o pedido curto (20/10/2026 no sistema do
    // Dr. Marcello, trazido em 26/10/2026). La, alguem do credenciamento de um
    // convenio conversava com a equipe sobre uma paciente e escreveu "Ja
    // coloquei a informacao que sera a ultima vez que iremos agendar pra":
    // recebeu "toque em Marcar uma consulta" no meio da conversa. Frase
    // comprida com gente conversando so vale se pede alguma coisa ("Preciso
    // agendar o retorno em 6 meses" continua pedido).
    const pedeAlgo =
      /\?|\b(preciso|precisava|precisamos|quero|queria|queremos|gostaria|gostariamos|pode|poderia|podemos|consigo|consegue|conseguimos|da pra|tem como|marca|marque|agende|agenda)\b/
    const conversaDaEquipe =
      !opcoes.podeIniciarMenu &&
      normalizar(texto).split(/\s+/).filter(Boolean).length > 6 &&
      !pedeAlgo.test(normalizar(texto))
    // Remarcar ou cancelar na fila (26/10/2026, vindo do sistema do Dr.
    // Marcello; o Edu: "se tiver tb com a equipe e perguntarem, a IA pode
    // entrar e conduzir"): vai direto para a consulta, com os botoes de
    // remarcar e cancelar, como no menu. Sem consulta neste numero, fica com a
    // equipe - ela pode estar no telefone de outra pessoa da familia.
    if (!perguntaLonga && !conversaDaEquipe && pediuMudarConsulta(texto) && !assuntoClinico(texto) && opcoes.consultas.length > 0) {
      registrar('opcao_escolhida', '4')
      const minha = await mostrarMinhaConsulta(admin, clinicId, conversationId, opcoes.consultas)
      if (minha) return minha
    }
    const querMarcar = !perguntaLonga && !conversaDaEquipe && (pediuAgendamento(texto) || texto.trim() === '2')
    // O "2", e o pedido de marcar, sem ninguem da equipe escrevendo (rodadas 2
    // e 3 do painel): o robo tinha escrito "se quiser marcar, digite 2", e a
    // resposta ao 2 era um botao, duas vezes; "entao marca uma consulta em
    // santos pela porto" ganhou o botao e, depois dele, as perguntas da
    // unidade e do convenio. Abre a agenda, como o toque no botao abriria, com
    // o que o pedido ja diz. Com gente da equipe conversando tambem, desde
    // 26/10/2026 (o bloco logo abaixo).
    if (geral() && querMarcar && opcoes.podeIniciarMenu) {
      const distante = await retornoDistante()
      if (distante) return await pedirRetornoDistante(admin, conversationId, distante.pedido, distante.horizonte, true)
      registrar('opcao_escolhida', '2')
      const pedido = await contextoDoPedido(admin, clinicId, conversationId, texto.trim() === '2' ? '' : texto)
      return await iniciarAgendamento(admin, clinicId, conversationId, opcoes.pacientes, opcoes.consultas, false, false, pedido)
    }
    // Desde 26/10/2026 o robo abre a agenda ele mesmo tambem com a equipe na
    // conversa, sem o botao no meio e sem o limite de respostas na espera
    // (vindo do sistema do Dr. Marcello: la, uma familia esperou 18 minutos
    // com "Oi quero marcar", e o Edu pediu que o pedido de agendamento seja
    // sempre atendido pelo robo, "mesmo que esteja com a solicitacao
    // humana"). As travas de cima continuam: pergunta longa e conversa da
    // equipe ficam com a equipe.
    if (querMarcar) {
      // Na fila, retorno para daqui a meses: a agenda nao chega la. Ver
      // retornoAlemDaAgenda.
      const distante = await retornoDistante()
      if (distante) {
        await admin
          .from('whatsapp_conversations')
          .update({ auto_replies_while_waiting: jaRespondidas + 1 })
          .eq('id', conversationId)
        return await pedirRetornoDistante(admin, conversationId, distante.pedido, distante.horizonte, true)
      }
      const lista = await carregarRespostas(admin, clinicId)
      // "Marca consulta pra minha filha, e valor da consulta": as duas coisas.
      const achadoJunto = acharResposta(texto, lista, 2)
      const junto = achadoJunto && !(await jaMandada(admin, conversationId, achadoJunto.resposta)) ? achadoJunto : null
      registrar('opcao_escolhida', '2')
      const pedido = await contextoDoPedido(admin, clinicId, conversationId, texto.trim() === '2' ? '' : texto)
      const agenda = await iniciarAgendamento(admin, clinicId, conversationId, opcoes.pacientes, opcoes.consultas, false, false, pedido)
      return junto && agenda ? { ...agenda, resposta: `${junto.resposta}\n\n${agenda.resposta}` } : agenda
    }

    if (opcoes.podeIniciarMenu && jaRespondidas < LIMITE_NA_ESPERA) {
      const lista = await carregarRespostas(admin, clinicId)
      // Casamento forte (duas palavras do assunto) responde sempre, mesmo que a
      // frase fale em agendar: e o caso da Simone, que pediu informacoes PARA
      // agendar e perguntou de AMIL, valor e formas de pagamento.
      //
      // Casamento fraco (uma palavra) so vale se a pessoa nao estiver pedindo
      // para marcar: e o caso da Regina, cujo "quero marcar retorno para o
      // Matheus" casava com "retorno" e recebia a lista de documentos. Mas
      // "convenio?" solto, que tambem casa com uma palavra e e pergunta de
      // verdade, continua respondido.
      //
      // E casamento fraco so em frase com cara de pergunta (25/09/2026):
      // "Aguardo retorno" casou com "retorno" e recebeu a lista de documentos
      // para levar a consulta. "Convenio?" e "Valores ?" continuam respondidos.
      const achada =
        acharResposta(texto, lista, 2) ??
        (pediuAgendamento(texto) || !parecePergunta(texto) ? null : acharResposta(texto, lista, 1))
      // Sem perguntar a unidade: a pergunta "para qual atendimento?" mudaria a
      // etapa da conversa e tiraria a pessoa da fila sem ela pedir. Vale o
      // texto curto da propria resposta, que ja cobre os tres lugares.
      // Ja respondida ha pouco: na fila, silencio (a equipe esta a caminho).
      if (achada && !(await jaMandada(admin, conversationId, achada.resposta))) {
        await admin
          .from('whatsapp_conversations')
          .update({ auto_replies_while_waiting: jaRespondidas + 1 })
          .eq('id', conversationId)
        return {
          resposta:
            `${achada.resposta}\n\n` +
            '🙋 Sua conversa continua na fila: alguém da nossa equipe responde por aqui.',
        }
      }
    }
    return null
  }

  // Nao existe mais silencio por causa da bandeira de atencao.
  //
  // A bandeira acumulava dois papeis: avisar a equipe e calar o robo. Sao
  // coisas diferentes. Quem cancelou a consulta sozinho acende a bandeira
  // porque a vaga interessa a recepcao - mas nao esta esperando ninguem falar
  // com ele, e ficava mudo ate alguem abrir a conversa na tela.
  //
  // Quem realmente pediu gente cai no estado 'atendente' logo acima, e quem
  // esta em conversa humana e barrado por equipeFalouRecentemente, calculado no
  // webhook. Esses dois bastam, e nao criam becos sem saida.

  // Pedir gente vale de qualquer etapa, e nao so da opcao 3 do menu. Nas
  // perguntas de nome da ficha, o nome da secretaria e resposta, e nao pedido.
  if (pediuAtendente(texto, estadoAtual !== 'dados_nome' && estadoAtual !== 'dados_responsavel')) {
    const chamada = await chamarEquipe(admin, conversationId)
    return reclamouDaDemora(texto) ? { ...chamada, resposta: `Desculpe a demora! 🙏 ${chamada?.resposta ?? ''}` } : chamada
  }

  // Urgencia tambem vale de qualquer etapa. Nasceu na telemedicina, mas uma
  // mae com a crianca passando mal nao vai procurar a etapa certa para dizer
  // isso - e o custo de tratar como urgente o que nao era e uma ligacao a mais.
  // Urgencia transfere de qualquer etapa - menos dentro do pedido de
  // documento, onde "urgente" quase sempre quer dizer pressa.
  //
  // "e urgente, ela precisa do omeprazol" e uma mae correndo atras de receita,
  // nao uma emergencia: mandar essa pessoa ao pronto-socorro e ainda jogar
  // fora o pedido dela erra duas vezes. Com sintoma junto - "e urgente, ela
  // esta vomitando sangue" - a transferencia vale, e o pedido perder-se ali e
  // o menor dos problemas.
  if (pediuUrgencia(texto) && (!noPedidoDeDocumento || assuntoClinico(texto))) {
    return await transferirUrgencia(admin, conversationId, agora)
  }

  // "Cancelar" muda de sentido dentro de "minha consulta": ali nao e desistir
  // do fluxo, e desmarcar a consulta. Sem esta excecao a palavra era engolida
  // aqui e a pessoa nunca chegava a poder cancelar de fato.
  const naEtapaDeCancelar =
    estadoAtual === 'minha_consulta' || estadoAtual === 'confirmar_cancelamento'

  // Desistir no meio da ficha (16/10/2026, painel): a consulta ja estava
  // marcada quando a ficha comecou. "cancelar" ouvia "parei por aqui" e o
  // horario continuava reservado, sem a pessoa saber; "nao quero marcar,
  // cancela isso" foi lido como o nome do paciente. Agora a pergunta e se ela
  // quer desmarcar, com SIM ou 0, como no cancelamento de sempre.
  if (
    opcoes.consultaEmCadastro &&
    perguntas().some((p) => p.estado === estadoAtual) &&
    (desistiu(texto) || desistiuDaConsultaNaFicha(texto))
  ) {
    const marcada = opcoes.consultas.find((c) => c.id === opcoes.consultaEmCadastro)
    if (marcada) {
      const troca = await pedirConfirmacaoCancelamento(admin, clinicId, conversationId, marcada, false)
      return { ...troca, resposta: `Sem problema. ${troca?.resposta ?? ''}` }
    }
  }

  if (desistiu(texto) && estadoAtual && !naEtapaDeCancelar) {
    return await mostrarMenu(
      admin,
      conversationId,
      saudacao,
      'Tudo bem, parei por aqui. Posso ajudar em mais alguma coisa?',
    )
  }


  /** Pedido de retorno (ou de marcar) para daqui a meses? Ver retornoAlemDaAgenda. */
  async function retornoDistante(): Promise<{ pedido: { dias: number; mes: string }; horizonte: number } | null> {
    if (!pediuAgendamento(texto) && !/\bretorno\b/.test(normalizar(texto))) return null
    const horizonte = await horizonteDaAgenda(admin, clinicId)
    // relogioEmFoco (22/10/2026, vindo do sistema do Dr. Marcello): sem ele o
    // mes saia do relogio real, e o teste de "daqui uns 40 dias" (fixo em
    // 07/10) passou a dizer dezembro a partir de 22/10/2026, travando a
    // publicacao. Em producao os dois relogios sao o mesmo.
    const pedido = retornoAlemDaAgenda(texto, horizonte, relogioEmFoco ?? new Date())
    return pedido ? { pedido, horizonte } : null
  }

  /**
   * O que vale sem etapa e com o menu na tela, antes de nota e 2a via: o CPF
   * mandado depois e o recado da farmacia (15/10/2026).
   */
  async function pedidoDireto(): Promise<Resultado | null> {
    const cpf = cpfMandadoDepois(texto)
    if (cpf) {
      const semCpf = opcoes.pacientes.filter((p) => !soDigitos(p.cpf ?? ''))
      const t = ` ${normalizar(texto).replace(/[^a-z\s]/g, ' ')} `
      // Irmaos sem CPF: so com o nome da crianca na mensagem. Chutar poria o
      // CPF de um no cadastro do outro.
      const alvo =
        semCpf.length === 1
          ? semCpf[0]
          : semCpf.find((p) => t.includes(` ${normalizar(p.name).split(/\s+/)[0]} `))
      if (alvo) {
        const { error } = await admin.from('patients').update({ cpf }).eq('id', alvo.id)
        // Falhou: segue o caminho de sempre, que passa a mensagem para a equipe.
        if (!error) {
          registrar('cpf_depois')
          const nome = alvo.name.trim().split(/\s+/)[0]
          return {
            resposta: `✅ Recebi o CPF de *${nome}*: já está no cadastro. Obrigado!\n\n` + VOLTA,
            concluida: true,
          }
        }
        console.warn('Nao consegui guardar o CPF mandado depois', error)
      }
    }
    if (opcoes.pacientes.length === 0 && falaDeFarmacia(texto)) {
      registrar('opcao_escolhida', '5')
      // Recado completo na primeira mensagem: registra direto. So "sou da
      // farmacia": pergunta o paciente e o que corrigir.
      const palavras = normalizar(texto).split(/\s+/).filter(Boolean).length
      const resultado =
        palavras >= 10
          ? await registrarRecadoDaFarmacia(admin, clinicId, conversationId)
          : await perguntarPedidoDaFarmacia(admin, conversationId)
      if (opcoes.jaViuOMenu) return resultado
      await salvarEstado(admin, conversationId, { menu_sent_at: new Date().toISOString() })
      return { ...resultado, resposta: `${saudacao}\n\n${resultado.resposta}` }
    }
    return null
  }

  /**
   * Outro medico, "alguem ai?" e "nao respondeu" (16/10/2026, painel de
   * pacientes simulados), sem etapa e com o menu na tela. Vem antes dos
   * atalhos e das respostas prontas: "preciso remarcar com o dr marcelo" nao e
   * remarcacao aqui, e "nao tem nada sobre estacionamento ai em cima" casaria
   * de novo com a mesma resposta.
   */
  async function conversaSolta(): Promise<Resultado | null> {
    const outro = outroMedico(texto)
    if (outro) {
      registrar('outro_medico')
      const ela = outro.startsWith('Dra.')
      const o = perfil().o
      return await mostrarMenu(
        admin,
        conversationId,
        saudacao,
        `🙂 Aqui é o consultório ${o.replace(/^o /, 'do ')}. ${ela ? 'A' : 'O'} ${outro} não atende aqui: ` +
          `para a consulta com ${ela ? 'ela' : 'ele'}, fale com o consultório ${ela ? 'dela' : 'dele'}.\n\n` +
          `Se quiser algo com ${o}, é só escolher:`,
      )
    }
    if (chamandoAlguem(texto)) {
      const aqui = presenca(agora)
      // De novo, logo depois: curto, e sem o menu inteiro outra vez.
      if (await jaMandada(admin, conversationId, aqui)) {
        return { resposta: 'Estou aqui, sim 🙂 É só escolher uma opção da lista acima, ou digitar *9* para falar com alguém da nossa equipe.' }
      }
      return await mostrarMenu(admin, conversationId, saudacao, opcoes.jaViuOMenu ? aqui : `${saudacao}\n\n${aqui}`)
    }
    // Mensagem em ingles (16/10/2026, rodada 2 do painel): "appointment" e
    // "English??" receberam o mesmo "Nao entendi" em portugues, duas vezes.
    if (escreveuEmIngles(texto)) {
      registrar('em_ingles')
      const chamada = await chamarEquipe(admin, conversationId)
      return {
        ...chamada,
        resposta:
          `Hello! 👋 This is the automatic assistant of ${perfil().O.replace(/^O /, '')}'s office. ` +
          'I can only reply in Portuguese, so I have asked our team to answer you here, on weekdays during office hours (Brasília time).\n\n' +
          '(Olá! Passei sua mensagem para a nossa equipe, que responde por aqui.)',
      }
    }
    // "Voces tem o telefone dele?", logo depois do aviso de que o outro medico
    // nao atende aqui (16/10/2026, rodada 2): recebia os telefones do Dr.
    // Fabio, como se fossem os do outro.
    if (/\b(telefone|numero|contato|whatsapp|endereco|email|instagram|site)\b/.test(normalizar(texto)) && /\b(dele|dela)\b/.test(normalizar(texto))) {
      const recentes = await mensagensRecentesDoRobo(admin, conversationId)
      if (recentes.some((m) => m.includes('não atende aqui'))) {
        return await mostrarMenu(
          admin,
          conversationId,
          saudacao,
          `Não temos o contato de outros consultórios por aqui, desculpe. Se precisar de algo com ${perfil().o}, é só escolher:`,
        )
      }
    }
    if (naoFoiRespondida(texto)) {
      registrar('duvida_para_equipe')
      const chamada = await chamarEquipe(admin, conversationId)
      return { ...chamada, resposta: `Desculpe! 🙏 ${chamada?.resposta ?? ''}` }
    }
    if (geral()) {
      const t = normalizar(texto)
      // "Ah, entao errei o numero, desculpa" (rodada 3 do painel) ouviu "Nao
      // consegui entender" e foi para a fila da equipe.
      if (/\b(errei o numero|numero errado|foi engano|mensagem errada|engano meu|mandei errado|desculp\w* (o|pelo) engano)\b/.test(t)) {
        return { resposta: `Sem problema! 🙂 Se precisar de algo com ${perfil().o}, é só escrever por aqui.`, concluida: true }
      }
      // Depois do aviso de outro consultorio, "tenho consulta dia 20 com ele" e
      // "entao eu nao tenho consulta marcada ai?" (rodada 3 do painel) ouviram
      // a propaganda do consultorio e "Nao consegui entender".
      if (/\bconsulta\b/.test(t) && /\b(tenho|marquei|marcada|minha|com ele|com ela|dele|dela)\b/.test(t)) {
        const recentes = await mensagensRecentesDoRobo(admin, conversationId)
        if (recentes.some((m) => m.includes('não atende aqui'))) {
          const fuso = await fusoDaClinica(admin, clinicId)
          return {
            resposta: opcoes.consultas.length
              ? `Neste número há esta consulta com ${perfil().o}:\n\n${descreverConsulta(opcoes.consultas[0], fuso)}\n\nA consulta com o outro médico é com o consultório dele.`
              : `Neste número não há consulta marcada com ${perfil().o}. A consulta com o outro médico é com o consultório dele: aqui só marcamos com ${perfil().o}.`,
          }
        }
      }
      // Documento com problema ("o pedido de exame esta sem o carimbo")
      // (rodada 3 do painel): recebeu a resposta pronta de exames. Quem confere
      // e gente.
      if (
        /\b(carimbo|assinatura|assinado|rasura|ilegivel|corrigir|correcao|faltando|falta o|falta a|sem o nome|sem a data)\b/.test(t) &&
        /\b(pedido|receita|exame|laudo|atestado|guia|relatorio|declaracao|documento)\b/.test(t)
      ) {
        registrar('duvida_para_equipe')
        const chamada = await chamarEquipe(admin, conversationId)
        return { ...chamada, resposta: `📄 Passei para a nossa equipe, que confere o documento e responde por aqui.\n\n${avisoDeHorario(agora)}` }
      }
    }
    // "Ate que horas o doutor atende?", "e as 8 da manha tem?" (rodada 2): a
    // agenda responde (ver respostaDaAgenda). Quem pede para marcar vai para a
    // agenda, com o resumo em cima (ver agendarDoPedido).
    if (!pediuParaMarcar(texto)) {
      // O resumo de novo, logo abaixo do primeiro, e a saudacao repetida
      // pareceriam que o robo nao leu nada (ver o jaTemResumo).
      const jaTemResumo = (await mensagensRecentesDoRobo(admin, conversationId)).some((m) => m.includes('Dias e horários com vaga'))
      const agenda = await respostaDaAgenda(admin, clinicId, texto, jaTemResumo)
      if (agenda) {
        registrar('pergunta_de_agenda')
        // Conta como menu visto, e o menu fica ativo (rodada 3 do painel): o
        // toque em "Marcar uma consulta" logo abaixo devolvia a saudacao e o menu.
        await voltarAoMenuAtivo(admin, conversationId)
        if (!opcoes.jaViuOMenu) await salvarEstado(admin, conversationId, { menu_sent_at: new Date().toISOString() })
        const cumprimento = opcoes.jaViuOMenu || (await jaMandada(admin, conversationId, saudacao)) ? '' : `${saudacao}\n\n`
        return {
          resposta: `${cumprimento}${agenda}\n\nPara marcar, digite *2*. ${VOLTA}`,
          // O 2 e o do menu: sem etapa, ele abre a agenda.
          botoes: [
            { id: '2', titulo: 'Marcar uma consulta' },
            { id: '9', titulo: 'Falar com a equipe' },
            { id: '0', titulo: 'Voltar ao menu' },
          ],
        }
      }
    }
    // O nome de uma unidade logo depois do resumo da agenda (rodada 2): a
    // pessoa escolheu onde quer marcar, e nao pediu o endereco.
    if (unidadeCitada(await opcoesDeAtendimento(admin, clinicId), texto) && normalizar(texto).split(/\s+/).length <= 4) {
      // O resumo pode ter saido uma mensagem antes ("os dias estao logo acima").
      const recentes = await mensagensRecentesDoRobo(admin, conversationId)
      if (recentes.slice(0, 2).some((m) => m.includes('Dias e horários com vaga'))) return await agendarDoPedido()
    }
    return null
  }

  /**
   * "Preciso remarcar minha consulta", com uma consulta so: direto para a
   * confirmacao, sem a tela de Remarcar e Cancelar (16/10/2026, painel). Com
   * duas consultas, ou intencao que nao da para ler, a tela de sempre.
   */
  async function consultaDoPedido(): Promise<Resultado> {
    const intencao = intencaoDaConsulta(texto)
    if (opcoes.consultas.length === 1 && intencao) {
      return await pedirConfirmacaoCancelamento(admin, clinicId, conversationId, opcoes.consultas[0], intencao === 'remarcar')
    }
    return await mostrarMinhaConsulta(admin, clinicId, conversationId, opcoes.consultas)
  }

  /**
   * Pedido de marcar escrito, com o menu ja visto: a agenda, com o que o pedido
   * ja diz aproveitado e a duvida que veio junto em cima (ver unidadeDoPedido e
   * respostaJunto).
   */
  /**
   * A duvida que veio junto da resposta da etapa (16/10/2026, rodada 3 do
   * painel): "Ta bom, entao vai particular mesmo. Quanto fica?" escolhia o
   * particular e ignorava a pergunta, duas vezes. A resposta pronta vai em cima.
   */
  async function comDuvidaJunto(resultado: Resultado): Promise<Resultado> {
    // So pergunta de verdade: o "como" de "Unimed Santos, como falei" nao e.
    const pergunta = texto.includes('?') || /\b(quanto|quanta|qto|qnto|qual|quais|onde|custa|aceita|aceitam)\b/.test(normalizar(texto))
    if (!resultado || !geral() || !pergunta || assuntoClinico(texto)) return resultado
    const achada = acharResposta(texto, await carregarRespostas(admin, clinicId))
    if (!achada || (await jaMandada(admin, conversationId, achada.resposta))) return resultado
    if (achada.chamarEquipe) registrar('chamar_equipe_junto')
    const duvida = `${semConviteDoDois(achada.resposta)}${achada.chamarEquipe ? '\n\n🙋 Sobre isso, a nossa equipe confirma por aqui.' : ''}`
    return { ...resultado, resposta: `${duvida}\n\n${resultado.resposta}` }
  }

  /**
   * Unidade, dia e hora na mesma frase (16/10/2026, rodada 3 do painel): marca
   * direto, quando a unidade nao tem convenio a perguntar e o horario esta
   * livre. Null quando falta alguma coisa: a agenda segue pelo caminho de
   * sempre.
   */
  async function marcarDoPedido(unidade: Unidade, frase: string): Promise<Resultado | null> {
    if (!geral() || unidade.id === TELE_ID || planosDaUnidade(unidade).length > 0) return null
    const pedida = horaEscrita(frase)
    if (!pedida || limiteDaHora(frase)) return null
    const fuso = await fusoDaClinica(admin, clinicId)
    const { horarios } = await horariosLivres(admin, clinicId, unidade.id)
    const dias = agruparPorDia(horarios, fuso).map((d) => d.chave)
    const data = dataEscrita(frase)
    const qual = data
      ? dias.findIndex((c) => Number(c.slice(8, 10)) === data.dia && Number(c.slice(5, 7)) === data.mes)
      : diaPeloNome(frase, dias, agora)
    if (qual < 0) return null
    const naHora = naHoraPedida(horarios.filter((h) => chaveDoDia(h.inicio, fuso) === dias[qual]), pedida, fuso)
    const certa = pedida.minuto === null ? naHora.filter((h) => formatarHora(h.inicio, fuso).endsWith(':00')) : naHora
    if (certa.length !== 1) return null
    await salvarEstado(admin, conversationId, { booking_insurance: '', booking_modality: 'presencial', booking_unit_id: unidade.id })
    return await marcar(
      admin, clinicId, conversationId, unidade.id, pacienteDaConsulta, opcoes.telefone, opcoes.nomeDoPerfil,
      certa[0], opcoes.consultaASubstituir, '',
    )
  }

  async function agendarDoPedido(): Promise<Resultado> {
    const junto = await respostaJunto(admin, clinicId, conversationId, texto)
    // "Quero marcar, ate que horas ele atende?": o resumo da agenda em cima.
    // So com pergunta (rodada 3): "marca pra mim o ultimo horario que tiver" e
    // pedido, e o resumo inteiro em cima dele era ruido.
    const resumo = perguntouDaAgenda(texto) && texto.includes('?') ? await resumoDaAgenda(admin, clinicId) : ''
    // "Alguem ta ai agora? Quero agendar" (rodada 2): quem esta, antes da agenda.
    const quemEsta = perguntouSeTemAlguem(texto) ? presenca(agora) : ''
    // Unidade e convenio ditos antes valem (ver contextoDoPedido).
    const pedido = await contextoDoPedido(admin, clinicId, conversationId, texto)
    const agenda = await iniciarAgendamento(admin, clinicId, conversationId, opcoes.pacientes, opcoes.consultas, false, false, pedido)
    if ((!junto && !resumo && !quemEsta) || !agenda) return agenda
    return {
      ...agenda,
      ...(junto?.chamarEquipe && !agenda.atencao ? { atencao: 'atendente' } : {}),
      resposta: [quemEsta, junto?.texto, resumo, agenda.resposta].filter(Boolean).join('\n\n'),
    }
  }

  // ---- Sem etapa em andamento ----
  if (!estadoAtual) {
    if (opcoes.podeIniciarMenu) {
      const solta = await conversaSolta()
      if (solta) return solta
    }

    // Retorno para daqui a meses (05/10/2026): a agenda nao chega la, entao a
    // equipe reserva. Antes do atalho de agendamento, que abriria uma agenda de
    // 15 dias para quem pediu 3 meses.
    if (opcoes.podeIniciarMenu || opcoes.posAcompanhamento) {
      const distante = await retornoDistante()
      if (distante) return await pedirRetornoDistante(admin, conversationId, distante.pedido, distante.horizonte, false)
    }

    // Atalho de agendamento so depois que a pessoa viu o menu.
    //
    // O botao do site manda "Vim pelo site e gostaria de agendar uma consulta"
    // ja escrito. Com o atalho valendo na primeira mensagem, a conversa comecava
    // em "Em qual unidade?", sem apresentacao e sem as outras opcoes - e quem so
    // queria saber o valor antes de marcar ficava sem saber que podia perguntar.
    //
    // Entao: primeira mensagem sempre recebe o menu, com a saudacao e as quatro
    // opcoes. Da segunda em diante o atalho vale, e "quero marcar retorno para o
    // Matheus" abre a agenda direto. A pessoa ja sabe o que existe ali.
    //
    // Sintoma junto do pedido tambem nao abre a agenda direto. "Meu filho tem
    // refluxo, queria marcar" e as duas coisas: o robo diz que nao orienta sobre
    // sintoma e mostra o menu, de onde ela marca pelo *2*. Pular essa frase
    // seria o robo fingir que nao leu a parte que mais importava.
    // "...e volto pra marcar" e despedida, nao pedido de agora (14/10/2026).
    // "Eu nao passei em consulta" (ver negouConsulta, 25/10/2026): desculpas e
    // a equipe, nunca a agenda. Antes do atalho de agendamento, que leria o
    // "consulta" como pedido de marcar.
    if (negouConsulta(texto)) return await consultaQueNaoHouve(admin, conversationId)
    if (opcoes.jaViuOMenu && pediuAgendamento(texto) && !assuntoClinico(texto) && !despedida(texto)) {
      return await agendarDoPedido()
    }
    // Depois do acompanhamento pos-consulta (03/10/2026).
    //
    // O modelo diz "Como voce esta? Responda esta mensagem caso precise falar
    // com nossa equipe" - entao o que a familia escreve em seguida e recado
    // para a equipe, nao inicio de conversa. Em 03/10 o robo tratou como
    // inicio: a mae do Rafael contou que fez dois dos tres exames e recebeu "nao
    // posso orientar sobre sintomas" com o menu, sem ninguem avisado; a Olivia
    // agradeceu e recebeu a apresentacao inteira do consultorio.
    //
    // Pedido de marcar e nota fiscal seguem o caminho deles, mais abaixo. Frase
    // curta que nao e agradecimento ("sim", "otimo") tambem: cai na regra de
    // sempre.
    if (opcoes.posAcompanhamento) {
      if (soAgradecimento(texto) || despedida(texto)) {
        registrar('acompanhamento_agradeceu')
        return { resposta: '💙 Nós que agradecemos! Qualquer coisa, é só escrever por aqui.', concluida: true }
      }
      const palavrasDoRecado = normalizar(texto)
        .replace(/[^a-z\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((p) => p.length > 1)
      // Pergunta que nao e clinica ("qual o valor da consulta?") segue para a
      // resposta pronta, mais abaixo: a janela agora e de 7 dias, e nela a
      // familia tambem pergunta coisas que o robo sabe responder.
      const perguntaComum = parecePergunta(texto) && !assuntoClinico(texto)
      const recado =
        palavrasDoRecado.length >= 3 &&
        !perguntaComum &&
        !soCumprimento(texto) &&
        !pediuNotaFiscal(texto) &&
        !(pediuAgendamento(texto) && !assuntoClinico(texto))
      // Urgencia nao chega aqui: "urgente" e tratado antes, em qualquer etapa.
      if (recado) {
        registrar('acompanhamento_recado')
        const chamada = await chamarEquipe(admin, conversationId)
        return {
          ...chamada,
          resposta:
            'Obrigado por nos contar! 💙 Sua mensagem já está com a nossa equipe, e ' +
            `${quemAtende(clinicId).o} fica sabendo. Se for preciso, alguém responde por aqui.\n\n` +
            // Relato de sintoma ganha a saida de urgencia (09/10/2026).
            (assuntoClinico(texto) ? `${geral() ? 'Se piorar' : 'Se a criança piorar'}, digite *URGÊNCIA*.\n\n` : '') +
            avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' + VOLTA,
        }
      }
    }

    // Sem etapa aberta, o menu e uma iniciativa nossa - e iniciativa tem hora.
    // Mandar menu depois de "Estou bem, obrigada", ou no meio de uma conversa
    // que a secretaria esta tocando, atrapalha em vez de ajudar.
    if (!opcoes.podeIniciarMenu) return null

    // So agradecimento, sem etapa aberta (03/10/2026): "Ok, obrigada" depois
    // de "Consulta confirmada" ou de um atendimento encerrado recebia a
    // apresentacao inteira do consultorio, como se a pessoa chegasse agora.
    if (soAgradecimento(texto)) {
      return { resposta: '😊 Por nada! Se precisar de algo, é só escrever *0* para ver as opções.', concluida: true }
    }
    if (despedida(texto)) return { resposta: RESPOSTA_A_DESPEDIDA, concluida: true }

    // CPF mandado depois e farmacia. Ver pedidoDireto.
    const direto = await pedidoDireto()
    if (direto) return direto

    // Nota fiscal: a mensagem ja diz o que a pessoa quer. Ver pediuNotaFiscal.
    if (pediuNotaFiscal(texto)) return await registrarPedidoDeNota(admin, conversationId)

    // "Perdi a receita, tem segunda via?": a opcao 5, direto. Ver pediuSegundaVia.
    if (pediuSegundaVia(texto)) {
      registrar('opcao_escolhida', '5')
      const documento = await iniciarDocumento(admin, conversationId, opcoes.pacientes, texto)
      if (opcoes.jaViuOMenu) return documento
      await salvarEstado(admin, conversationId, { menu_sent_at: new Date().toISOString() })
      return { ...documento, resposta: `${saudacao}\n\n${documento.resposta}` }
    }

    // Quem pediu para marcar na primeira mensagem vai direto para a agenda,
    // COM a apresentacao em cima (01/10/2026).
    //
    // Ate aqui recebia o menu inteiro. Nos 10 dias ate 01/10, 16 conversas
    // chegaram pelo botao do site ("Vim pelo site e gostaria de agendar uma
    // consulta"): metade tocou em "Marcar" - um passo a toa -, e tres tocaram
    // em "Minha consulta" achando que era "marcar minha consulta", leram "Nao
    // encontrei nenhuma consulta" e acabaram pedindo atendente. O cuidado de
    // 15/09 (quem so quer saber o valor precisa saber que pode perguntar)
    // continua: a saudacao vem antes, e a linha seguinte diz que o *0* mostra
    // todas as opcoes.
    //
    // Continua valendo o que veio da Regina: pedido de marcar nunca vira
    // resposta pronta, nem quando "retorno" casa com o texto de documentos.
    if (pediuAgendamento(texto) && !assuntoClinico(texto)) {
      registrar('opcao_escolhida', '2')
      // A duvida que veio junto, em cima da agenda (ver respostaJunto).
      const junto = await respostaJunto(admin, clinicId, conversationId, texto)
      // Unidade e convenio ditos antes valem (ver contextoDoPedido).
      const pedido = await contextoDoPedido(admin, clinicId, conversationId, texto)
      const agenda = await iniciarAgendamento(
        admin, clinicId, conversationId, opcoes.pacientes, opcoes.consultas, false, false, pedido,
      )
      // Sem resposta da agenda (nao deveria acontecer): o menu de sempre, e
      // nunca silencio na primeira mensagem de alguem.
      if (!agenda) return await mostrarMenu(admin, conversationId, saudacao)
      // Conta como menu visto: daqui em diante os atalhos valem, como para
      // quem passou pelo menu.
      await salvarEstado(admin, conversationId, { menu_sent_at: new Date().toISOString() })
      // A saudacao uma vez so (rodada 2 do painel): depois de uma pergunta da
      // agenda respondida, "queria marcar as 8h" recebia o "Ola, seja bem-vindo"
      // de novo.
      const cumprimento = (await jaMandada(admin, conversationId, saudacao)) ? '' : `${saudacao}\n\n`
      // "Boa noite, tem alguem online ai? Queria marcar" (rodada 2 do painel):
      // a pergunta de quem esta ai tem resposta antes da agenda.
      const quemEsta = perguntouSeTemAlguem(texto) ? `${presenca(agora)}\n\n` : ''
      return {
        ...agenda,
        ...(junto?.chamarEquipe && !agenda.atencao ? { atencao: 'atendente' } : {}),
        resposta:
          cumprimento +
          quemEsta +
          (junto
            ? `${junto.texto}\n\n`
            : quemEsta
              ? ''
              : 'Já separei a agenda para você 👇 Se antes quiser saber valores ou tirar uma dúvida, digite *0* para ver todas as opções.\n\n') +
          agenda.resposta,
      }
    }

    // Remarcar ou desmarcar por extenso vai direto para a consulta, com a
    // apresentacao em cima - o mesmo cuidado do atalho de agendamento. Sem
    // consulta marcada neste numero, segue o caminho de sempre (o menu): a
    // consulta pode estar no telefone do outro responsavel, e "nao encontrei
    // nada" sem mais nada seria um beco. Ver pediuMudarConsulta.
    if (pediuMudarConsulta(texto) && !assuntoClinico(texto) && opcoes.consultas.length > 0) {
      registrar('opcao_escolhida', '4')
      const minha = await consultaDoPedido()
      // Conta como menu visto, como no atalho de agendamento.
      await salvarEstado(admin, conversationId, { menu_sent_at: new Date().toISOString() })
      if (minha) return { ...minha, resposta: `${saudacao}\n\n${minha.resposta}` }
    }

    // Operado escrevendo: recado para a equipe, com a saudacao em cima. Ver
    // falouDePosOperatorio.
    if (perfil().sinaisDeAlarme && falouDePosOperatorio(texto)) {
      const recado = await recadoDoPosOperatorio(admin, conversationId)
      if (opcoes.jaViuOMenu) return recado
      await salvarEstado(admin, conversationId, { menu_sent_at: new Date().toISOString() })
      return { ...recado, resposta: `${saudacao}\n\n${recado?.resposta ?? ''}` }
    }

    // A pergunta vem antes do menu. Quem escreveu uma duvida que a clinica ja
    // respondeu mil vezes merece a resposta, e nao uma lista de opcoes.
    const pronta = await responderPergunta(admin, clinicId, conversationId, texto, opcoes.textos.informacoes)
    if (pronta) return pronta

    // Quem descreveu um sintoma ou perguntou de remedio nao pode receber "como
    // podemos ajudar hoje?" como se nao tivesse dito nada. O robo nao responde
    // - isso e consulta -, mas diz por que nao responde e mostra o caminho. Nao
    // transfere sozinho de proposito: muita gente escreve o sintoma junto com
    // "queria marcar", e ai o menu e que resolve.
    if (assuntoClinico(texto)) return await responderAssuntoClinico(admin, clinicId, conversationId, saudacao)

    return await mostrarMenu(admin, conversationId, saudacao)
  }

  // ---- Ficha do paciente, depois de marcar ----
  //
  // Vem antes do menu porque estas etapas aceitam texto livre: um nome como
  // "Ana" nao pode cair na leitura de numeros do menu.
  const perguntaAtual = perguntas().find((p) => p.estado === estadoAtual)
  if (perguntaAtual) {
    const consulta = opcoes.consultaEmCadastro
    // Precisa de um destino: a consulta, ou a ficha de quem ja e paciente.
    // Sem nenhum dos dois, encerra em vez de continuar perguntando para o
    // vazio. A ficha entrou aqui em 16/09/2026: a equipe passou a poder
    // disparar o questionario para quem tem cadastro e nenhuma consulta
    // marcada, e ate entao a primeira resposta caia neste return.
    if (!consulta && !pacienteDaConsulta) return await terminarDados(admin, conversationId)

    // Outro horario pedido no meio da ficha (16/10/2026, painel): "nao!! eu
    // queria 16h nao 14h" foi gravado como nome do paciente, e as reclamacoes
    // seguintes viraram data de nascimento e queixa. A consulta recem-marcada
    // vai para a remarcacao, e a ficha da nova consulta pergunta o que faltar.
    if (consulta && pediuOutroHorario(texto)) {
      const marcada = opcoes.consultas.find((c) => c.id === consulta)
      if (marcada) {
        // A mesma hora que acabou de ser marcada (rodada 2 do painel): "14h",
        // repetido por quem nao viu que ja estava feito, nao e troca.
        const pedida = horaEscrita(texto)
        const fuso = await fusoDaClinica(admin, clinicId)
        if (pedida && naHoraPedida([{ inicio: marcada.inicio, fim: marcada.inicio }], pedida, fuso).length > 0) {
          return { resposta: `✅ Sua consulta já está marcada para *${formatarData(marcada.inicio, fuso)}*.\n\n${perguntaAtual.texto}` }
        }
        // A consulta que acabou de ser marcada, nesta conversa (rodada 3 do
        // painel): sem o SIM da remarcacao. "A data ta errada, eu quero dia 23"
        // ouvia "Vamos remarcar esta consulta? Responda SIM" e depois tinha de
        // escolher dia e hora de novo. A antiga so cai quando a nova estiver
        // marcada, como em toda remarcacao.
        if (geral()) {
          // So a hora ("eu queria 16h, nao 14h"): o mesmo dia, na hora pedida,
          // marcada direto quando esta livre.
          const t = normalizar(texto)
          const citaOutroDia = dataEscrita(texto) !== null || /\bdia\s+\d{1,2}\b|\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|semana)\b/.test(t)
          // "Nao, sexta da semana q vem, dia 23", com a consulta ja no dia 23
          // (rodada 3 do painel): nao e troca, e a ficha continua.
          const diaPedido = dataEscrita(texto)?.dia ?? Number((t.match(/\bdia\s+(\d{1,2})\b/) ?? [])[1] ?? 0)
          if (!pedida && diaPedido && diaPedido === Number(chaveDoDia(marcada.inicio, fuso).slice(8, 10))) {
            return { resposta: `✅ Sua consulta já está marcada para *${formatarData(marcada.inicio, fuso)}*.\n\n${perguntaAtual.texto}` }
          }
          if (pedida && !citaOutroDia) {
            const { data: antiga } = await admin.from('appointments').select('unit_id,insurance').eq('id', marcada.id).maybeSingle()
            const daAntiga = antiga as { unit_id?: string | null; insurance?: string | null } | null
            if (daAntiga?.unit_id) {
              const { horarios } = await horariosLivres(admin, clinicId, daAntiga.unit_id)
              const doDia = horarios.filter((h) => chaveDoDia(h.inicio, fuso) === chaveDoDia(marcada.inicio, fuso))
              const naHora = naHoraPedida(doDia, pedida, fuso)
              const certa = pedida.minuto === null ? naHora.filter((h) => formatarHora(h.inicio, fuso).endsWith(':00')) : naHora
              if (certa.length === 1) {
                return await marcar(
                  admin, clinicId, conversationId, daAntiga.unit_id, pacienteDaConsulta, opcoes.telefone, opcoes.nomeDoPerfil,
                  certa[0], marcada.id, String(daAntiga.insurance ?? ''),
                )
              }
            }
          }
          await salvarEstado(admin, conversationId, { booking_replaces_id: marcada.id })
          // Sem dia na frase, a lista do mesmo dia.
          const pedidoComDia = citaOutroDia ? texto : `dia ${chaveDoDia(marcada.inicio, fuso).slice(8, 10)} ${texto}`
          const nova = await remarcarNaMesmaUnidade(admin, clinicId, conversationId, marcada.id, pedidoComDia)
          if (nova) return { ...nova, resposta: `Sem problema, vamos trocar. ${nova.resposta}` }
        }
        const troca = await pedirConfirmacaoCancelamento(admin, clinicId, conversationId, marcada, true)
        return { ...troca, resposta: `Sem problema, dá para trocar o horário. ${troca?.resposta ?? ''}` }
      }
    }

    // Pergunta, reclamacao ou pedido de gente no meio da ficha (16/10/2026,
    // rodada 3 do painel): "Antes, so uma duvida: qual e o valor da consulta?"
    // ouviu "Nao consegui ler o nome", e a correcao seguinte deixou o nome em
    // branco; "perguntei se a amil devolve tudo" foi gravado como nome do
    // paciente, e "vc nao responde nada. tem alguem ai?", como data de
    // nascimento. A duvida tem resposta, e a pergunta da ficha volta, sem gastar
    // a segunda chance. No motivo, so a pergunta que nao conta queixa: "o nariz
    // entupido tem cura?" e o motivo.
    if (geral()) {
      const t = normalizar(texto)
      const reclamou = /\b(perguntei|pergunto|to perguntando|estou perguntando|minha pergunta|nao era o nome|nao e o nome|nao responde|nao respondeu|nao responderam)\b/.test(t)
      const ehDuvida = parecePergunta(texto) || perguntouSeTemAlguem(texto) || naoFoiRespondida(texto) || reclamou
      const naoERespostaDaFicha =
        perguntaAtual.chave === 'motivo'
          ? parecePergunta(texto) && !QUEIXA_DO_OTORRINO.test(t)
          : perguntaAtual.ler(texto) === null || reclamou
      if (ehDuvida && naoERespostaDaFicha && !pulou(texto)) {
        const continuar = `Para continuar a ficha:\n\n${perguntaAtual.texto}`
        const achadas = respostasDaMensagem(texto, await carregarRespostas(admin, clinicId))
        if (achadas.length > 0) {
          const chamar = achadas.some((a) => a.chamarEquipe)
          const novas: typeof achadas = []
          for (const a of achadas) if (!(await jaMandada(admin, conversationId, a.resposta))) novas.push(a)
          // A mesma resposta de novo nao: quem pergunta outra vez vai para a
          // equipe, que de fato e avisada.
          if (chamar || novas.length === 0) registrar('chamar_equipe_junto')
          const texto1 = novas.length
            ? novas.map((a) => semConviteDoDois(a.resposta)).join('\n\n') + (chamar ? '\n\n🙋 Sobre isso, a nossa equipe confirma por aqui.' : '')
            : '🙋 Para não repetir a mesma resposta, passei a sua pergunta para a nossa equipe, que responde por aqui.'
          return { resposta: `${texto1}\n\n${continuar}` }
        }
        if (perguntouSeTemAlguem(texto)) return { resposta: `${presenca(agora)}\n\n${continuar}` }
        registrar('chamar_equipe_junto')
        return { resposta: `🙋 Passei a sua pergunta para a nossa equipe, que responde por aqui. ${continuar}` }
      }
    }

    const { tentativas, faltam, manual, sugestao } = filaDaFicha(opcoes.opcoesAtuais)
    // Perfil 'geral': passou a data de nascimento sem resposta que de para ler,
    // o responsavel sai da fila (ver filaSemResponsavelDeAdulto). Com a data
    // respondida, a decisao e la embaixo, pela data.
    const restantes =
      perguntaAtual.chave === 'nascimento' ? filaSemResponsavelDeAdulto(faltam.slice(1), null, agora) : faltam.slice(1)

    // "Voltar" nao e "pular", e tratar como se fosse apagava o campo.
    //
    // Quem digita VOLTAR na ficha quer corrigir o que respondeu antes - errou
    // a data de nascimento, trocou uma letra do nome. Cair no mesmo caminho do
    // PULAR fazia o robo dizer "Sem problema." e seguir adiante, perdendo o
    // campo atual sem a pessoa ter pedido nada disso.
    //
    // Voltar de verdade exigiria guardar o que ja foi respondido nesta fila, e
    // a ficha e curta: dizer a verdade e repetir a pergunta resolve, e quem
    // precisa corrigir fala com a equipe na consulta, como sempre pode.
    if (pediuVoltar(texto)) {
      return {
        resposta:
          'Aqui não dá para voltar uma pergunta - mas o que já foi respondido está guardado, ' +
          `e ${quemAtende(clinicId).o} confere tudo na consulta.\n\n` +
          perguntaAtual.texto,
      }
    }

    // Pular vale nos campos opcionais, sem justificativa e sem insistir. Nos
    // obrigatorios o robo pede de novo, uma vez - e depois segue, porque
    // insistir eternamente prenderia quem nao pode responder agora.
    // CPF ou e-mail validos na mesma frase vencem o "nao sei": "nao tenho o
    // meu, o do pai e ana@x.com" respondeu a pergunta.
    const temValorValido =
      (perguntaAtual.chave === 'cpf' || perguntaAtual.chave === 'email') && perguntaAtual.ler(texto) !== null
    if (pulou(texto) && !temValorValido) {
      if (perguntaAtual.obrigatoria && tentativas < 1) {
        await salvarEstado(admin, conversationId, {
          booking_options: { tentativas: tentativas + 1, faltam, manual, ...(sugestao ? { sugestao } : {}) },
        })
        return {
          resposta:
            `Esse dado ${quemAtende(clinicId).o} precisa ter no cadastro. Pode responder aqui, ` +
            'mesmo que não seja exato?\n\n' +
            perguntaAtual.texto,
        }
      }
      return restantes.length
        ? await perguntarDados(admin, conversationId, consulta, restantes, 'Sem problema.', manual)
        : await terminarDados(admin, conversationId, clinicId, consulta, manual)
    }

    // "Sim" ao nome oferecido (ver nomeDito). "Sim, mas e o Theo" nao e sim.
    const aceitouONome =
      perguntaAtual.chave === 'nome' && sugestao !== null &&
      /^(sim|s|ss|isso|isso mesmo|exato|correto|certo|pode ser|e sim|sou eu|e eu|eu mesm[oa]|sim sou eu|sim e eu|sim isso)[.! ]*$/.test(normalizar(texto).trim())
    const valor = aceitouONome ? sugestao : perguntaAtual.ler(texto)
    if (valor === null) {
      // Uma segunda chance, e so uma. Insistir num CPF que a pessoa nao tem
      // seria transformar um dado opcional em muro.
      if (tentativas >= 1) {
        return restantes.length
          ? await perguntarDados(
              admin, conversationId, consulta, restantes,
              `Tudo bem, deixamos esse campo em branco: ${quemAtende(clinicId).o} completa na consulta.`,
              manual,
            )
          : await terminarDados(admin, conversationId, clinicId, consulta, manual)
      }
      await salvarEstado(admin, conversationId, {
        booking_options: { tentativas: tentativas + 1, faltam, manual, ...(sugestao ? { sugestao } : {}) },
      })
      return {
        resposta:
          perguntaAtual.erro +
          // O erro do CPF e do e-mail ja fala em PULAR: duas vezes na mesma
          // mensagem era ruido (painel, 14/10/2026).
          (perguntaAtual.obrigatoria || /PULAR/.test(perguntaAtual.erro) ? '' : '\n\n_Ou digite PULAR para seguir sem esse dado._'),
        botoes: perguntaAtual.obrigatoria ? undefined : [{ id: 'PULAR', titulo: 'Pular' }],
      }
    }

    await guardarDado(admin, consulta, perguntaAtual, valor, pacienteDaConsulta)
    // Nome e data na mesma mensagem ("Lucas Ferreira Campos, nasceu
    // 03/05/2022"): a data ja vem guardada e a pergunta dela nao se repete. No
    // painel, a mae respondeu "ja falei kkk" (14/10/2026).
    let seguintes =
      perguntaAtual.chave === 'nascimento' ? filaSemResponsavelDeAdulto(faltam.slice(1), valor, agora) : restantes
    if (perguntaAtual.chave === 'nome' && seguintes.includes('nascimento')) {
      const nascimento = dataDeNascimentoIso(texto, agora, { adulto: geral() })
      const perguntaDaData = perguntas().find((p) => p.chave === 'nascimento')
      if (nascimento && perguntaDaData) {
        const [ano, mes, dia] = nascimento.split('-')
        await guardarDado(admin, consulta, perguntaDaData, `${dia}/${mes}/${ano}`, pacienteDaConsulta)
        seguintes = filaSemResponsavelDeAdulto(seguintes.filter((chave) => chave !== 'nascimento'), nascimento, agora)
      }
    }
    return seguintes.length
      ? await perguntarDados(admin, conversationId, consulta, seguintes, '', manual)
      : await terminarDados(admin, conversationId, clinicId, consulta, manual)
  }

  // ---- Menu ----
  if (estadoAtual === 'menu') {
    // Toque em "Completar cadastro" (ver tentarFichaPendente).
    if (['ficha', 'completar cadastro', 'completar'].includes(normalizar(texto))) {
      const retomada = await tentarFichaPendente(admin, clinicId, conversationId, texto, opcoes.consultas)
      if (retomada) return retomada
    }

    const escolhido = escolha(texto, 5)

    // A resposta da pergunta "o que as pessoas mais pedem?". Guardado como o
    // numero que a pessoa escolheu (1 a 5), nao como o texto dela - contagem,
    // nao prontuario.
    if (escolhido !== null) registrar('opcao_escolhida', String(escolhido + 1))

    if (escolhido === 0) {
      return await perguntarLocalDasInformacoes(admin, clinicId, conversationId, opcoes.textos.informacoes)
    }

    if (escolhido === 1) {
      return await iniciarAgendamento(
        admin, clinicId, conversationId, opcoes.pacientes, opcoes.consultas,
      )
    }

    if (escolhido === 2) {
      return await chamarEquipe(admin, conversationId)
    }

    if (escolhido === 3) {
      return await mostrarMinhaConsulta(admin, clinicId, conversationId, opcoes.consultas)
    }

    if (escolhido === 4) {
      return await iniciarDocumento(admin, conversationId, opcoes.pacientes)
    }

    // Outro medico, "alguem ai?" e "nao respondeu". Ver conversaSolta.
    if (opcoes.podeIniciarMenu) {
      const solta = await conversaSolta()
      if (solta) return solta
    }

    // Sintoma junto do pedido nao abre a agenda direto. "Meu filho tem refluxo,
    // queria marcar" e as duas coisas: o robo diz que nao orienta sobre sintoma
    // e mostra o menu, de onde a pessoa marca pelo *2*. Pular essa frase seria
    // o robo fingir que nao leu a parte que mais importava.
    // Retorno para daqui a meses, com o menu na tela (05/10/2026).
    if (opcoes.podeIniciarMenu) {
      const distante = await retornoDistante()
      if (distante) return await pedirRetornoDistante(admin, conversationId, distante.pedido, distante.horizonte, false)
    }

    // "Eu nao passei em consulta", com o menu na tela (ver negouConsulta).
    if (negouConsulta(texto)) return await consultaQueNaoHouve(admin, conversationId)

    if (pediuAgendamento(texto) && !assuntoClinico(texto) && !despedida(texto)) {
      return await agendarDoPedido()
    }

    // Com o menu na tela, "quero remarcar" e a opcao 4 escrita. Ver pediuMudarConsulta.
    if (pediuMudarConsulta(texto) && !assuntoClinico(texto) && opcoes.consultas.length > 0) {
      registrar('opcao_escolhida', '4')
      return await consultaDoPedido()
    }

    // Com alguem da equipe conversando, o robo para por aqui.
    //
    // Numero de menu ele ainda processa, porque a pessoa escolheu de propósito.
    // Mas texto solto, daqui para baixo, vira resposta pronta ou "nao entendi" -
    // e isso ele nao pode mandar por cima de uma conversa humana em andamento.
    // Aconteceu com a Cristina em 15/09/2026: a equipe explicou a mao, as 11:50,
    // que a Trasmontano e atendida; ela perguntou "Unimed nao?" as 12:23 e o
    // robo repetiu a resposta pronta de convenio por cima da atendente.
    //
    // A trava ja existia (12 horas desde a ultima mensagem de gente), mas so
    // valia para quem estava sem etapa nenhuma. No menu, ela nao valia.
    if (!opcoes.podeIniciarMenu) return null

    // Com o menu na tela, a pessoa pode escrever o pedido em vez de escolher.
    const direto = await pedidoDireto()
    if (direto) return direto
    if (pediuNotaFiscal(texto)) return await registrarPedidoDeNota(admin, conversationId)

    // "Perdi a receita, tem segunda via?": a opcao 5, direto. Ver pediuSegundaVia.
    if (pediuSegundaVia(texto)) {
      registrar('opcao_escolhida', '5')
      const documento = await iniciarDocumento(admin, conversationId, opcoes.pacientes, texto)
      if (opcoes.jaViuOMenu) return documento
      await salvarEstado(admin, conversationId, { menu_sent_at: new Date().toISOString() })
      return { ...documento, resposta: `${saudacao}\n\n${documento.resposta}` }
    }

    if (despedida(texto)) return { resposta: RESPOSTA_A_DESPEDIDA, concluida: true }

    // Operado escrevendo, com o menu na tela. Ver falouDePosOperatorio.
    if (perfil().sinaisDeAlarme && falouDePosOperatorio(texto)) return await recadoDoPosOperatorio(admin, conversationId)

    // Agradecimento antes da resposta pronta (rodada 3 do painel): "Certo.
    // Obrigado, fico aguardando o retorno." casou "retorno" e recebeu o texto
    // do retorno da consulta.
    if (geral() && soAgradecimento(texto)) {
      return { resposta: '😊 Por nada! Se precisar de algo, é só escrever *0* para ver as opções.' }
    }

    // Antes de dizer "nao entendi": a pessoa pode ter ignorado a lista e
    // escrito a duvida dela, que e o que se faz num WhatsApp de verdade.
    const pronta = await responderPergunta(admin, clinicId, conversationId, texto, opcoes.textos.informacoes)
    if (pronta) return pronta

    // Sintoma escrito COM o menu na tela recebia "Não entendi. Responda com o
    // número da opção" - a mãe corrigida sobre a forma de responder, e ninguém
    // avisado. A frase existia, mas só valia para quem escrevia antes de o
    // menu aparecer, o que na prática é só a primeira mensagem da vida dela.
    // Quem foi atendido ha poucos dias (ou respondeu o acompanhamento) e conta
    // como a crianca esta: recado para o medico, com o menu na tela tambem.
    // Ver consultouHaPouco no webhook.
    if (opcoes.posAcompanhamento && assuntoClinico(texto)) {
      registrar('acompanhamento_recado')
      const chamada = await chamarEquipe(admin, conversationId)
      return {
        ...chamada,
        resposta:
          'Obrigado por nos contar! 💙 Sua mensagem já está com a nossa equipe, e ' +
          `${quemAtende(clinicId).o} fica sabendo. Se for preciso, alguém responde por aqui.\n\n` +
          `${geral() ? 'Se piorar' : 'Se a criança piorar'}, digite *URGÊNCIA*.\n\n` +
          avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' + VOLTA,
      }
    }

    if (assuntoClinico(texto)) {
      // Nao e "nao entendi": o robo entendeu muito bem, e a resposta certa e
      // nao opinar. Contar isto como falha do menu esconderia o que interessa -
      // quanta gente chega com sintoma, que e outra pergunta e merece nome
      // proprio no painel.
      registrar('assunto_clinico')
      return await responderAssuntoClinico(admin, clinicId, conversationId, saudacao)
    }

    // Aqui sim. Este e o ponto onde mais gente se perde - o menu na tela e a
    // pessoa escrevendo outra coisa - e ele nao passa pela funcao naoEntendi,
    // entao precisa do proprio registro. Sem esta linha o painel contaria so
    // os "nao entendi" de dentro dos fluxos, que sao a minoria, e diria que o
    // menu esta claro quando nao esta.
    // Antes do "nao entendi": o cadastro da consulta ficou pela metade?
    const retomada = await tentarFichaPendente(admin, clinicId, conversationId, texto, opcoes.consultas)
    if (retomada) return retomada

    // "Ok, obrigada" nao e pedido: responder com o menu inteiro e "Nao
    // entendi" corrigia uma mae que so estava sendo educada.
    if (soCumprimento(texto)) return await mostrarMenu(admin, conversationId, saudacao)

    if (soAgradecimento(texto)) {
      return { resposta: '😊 Por nada! Se precisar de algo, é só escrever *0* para ver as opções.' }
    }

    // Frase de verdade que o robo nao entendeu vai para a equipe (25/09/2026).
    // Em 24/09, "Dr está ciente." (a mae explicando que o medico ja sabia do
    // convenio dela) e o nome da crianca escrito solto receberam "Nao
    // entendi. Responda com o numero" - e a familia teve de achar sozinha o
    // "falar com a equipe". Tres palavras ou mais ja e recado para gente, nao
    // erro de digitacao. Numero, letra solta e palavra curta continuam
    // recebendo o menu, que e o que resolve nesses casos.
    const palavras = normalizar(texto).replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter((p) => p.length > 1)
    if (palavras.length >= 3) {
      registrar('nao_entendi', 'equipe')
      const chamada = await chamarEquipe(admin, conversationId)
      if (geral()) {
        return {
          ...chamada,
          resposta:
            '🤔 Não consegui entender por aqui, então passei sua mensagem para a nossa equipe, que responde por aqui.\n\n' +
            `${PERGUNTA_URGENCIA_OU_DUVIDA}\n\n${avisoDeHorario(agora)}`,
          botoes: BOTOES_URGENCIA_OU_DUVIDA,
        }
      }
      return {
        ...chamada,
        resposta:
          'Não consegui entender por aqui, então passei sua mensagem para a nossa equipe: estou direcionando você para alguém que responde por aqui.' +
          // Uma frase so (rodada 2 do painel): "passei sua mensagem para a
          // equipe" e "estou direcionando voce" diziam a mesma coisa, uma em
          // cima da outra.
          (chamada?.resposta ? `\n\n${chamada.resposta.replace(/^Estou direcionando você para alguém da nossa equipe\.\s*/, '')}` : ''),
      }
    }

    registrar('nao_entendi')
    // O mesmo "Nao entendi" com o menu inteiro, logo abaixo do primeiro (rodada 3
    // do painel): "ei" e "consulta" receberam a mesma mensagem, palavra por
    // palavra. A segunda vez e curta; a terceira chama a equipe (ver
    // tratarConversa).
    if (geral() && (await jaMandada(admin, conversationId, 'Não entendi. Responda com o número da opção:'))) {
      return { resposta: 'Não entendi ainda 🙏 Para marcar uma consulta, digite *2*. Para falar com alguém da equipe, digite *3*.' }
    }
    return await mostrarMenu(
      admin,
      conversationId,
      saudacao,
      'Não entendi. Responda com o número da opção:',
    )
  }

  // ---- 2a via de receita e pedido de exame ----

  // Numero sem atendimento: paciente/responsavel ou farmacia?
  if (estadoAtual === 'documento_quem') {
    const escolhido = escolha(texto, 2)
    if (escolhido === 0) {
      // Pode ser o pai no celular do trabalho, e pode ser alguem que nunca
      // veio. Quem confere e gente: o robo nao tem como saber, e chutar aqui
      // seria abrir cadastro para quem souber um nome.
      return await chamarEquipe(admin, conversationId)
    }
    if (escolhido === 1) {
      return await perguntarPedidoDaFarmacia(admin, conversationId)
    }
    return {
      resposta: 'Não entendi. Responda *1* se você é o paciente ou responsável, ou *2* se está falando de uma farmácia ou laboratório.',
      botoes: [
        { id: '1', titulo: 'Paciente/responsável' },
        { id: '2', titulo: 'Farmácia/laboratório' },
      ],
    }
  }

  // O pedido da farmacia, que sai daqui direto para a equipe.
  //
  // Sem confirmar nada sobre o paciente e sem prometer resposta por este canal:
  // quem recebe o documento corrigido e a familia, pelo numero dela. Dizer isso
  // agora evita a farmacia esperando um PDF que nunca vai chegar aqui.
  if (estadoAtual === 'documento_farmacia') {
    if (!texto.trim() && !opcoes.anexo) {
      return {
        resposta: 'Pode escrever o nome do paciente e o que precisa ser corrigido.',
      }
    }
    return await registrarRecadoDaFarmacia(admin, clinicId, conversationId)
  }

  // Para qual filho.
  if (estadoAtual === 'documento_paciente') {
    const ids = Array.isArray((opcoes.opcoesAtuais as { pacientes?: unknown } | null)?.pacientes)
      ? ((opcoes.opcoesAtuais as { pacientes: string[] }).pacientes)
      : []
    const candidatos = ids
      .map((id) => opcoes.pacientes.find((p) => p.id === id))
      .filter((p): p is Paciente => Boolean(p))

    if (opcoes.anexo && !texto.trim()) {
      return {
        resposta: '📎 Recebi. Só me diga antes para qual paciente é o pedido.',
      }
    }

    // O nome escrito vale tanto quanto o numero.
    //
    // A pessoa acabou de LER os nomes na tela; responder "Pedro" e o reflexo,
    // e so o numero era aceito. Primeiro nome basta, e por prefixo, porque
    // ninguem digita "Pedro Souza" inteiro quando o filho se chama Pedro.
    const escrito = normalizar(texto)
    const porNome = escrito
      ? candidatos.find((p) => {
          const nome = normalizar(p.name)
          return nome === escrito || nome.startsWith(`${escrito} `) || escrito === nome.split(' ')[0]
        })
      : undefined

    const indice = escolha(texto, candidatos.length)
    const escolhido = porNome ?? (indice === null ? undefined : candidatos[indice])
    if (!escolhido) {
      return {
        resposta: await naoEntendi(
          admin,
          clinicId,
          texto,
          'Responda com o número do paciente da lista acima.',
        ),
      }
    }
    return await perguntarTipoDoDocumento(admin, conversationId, {
      ...pedidoEmAndamento(opcoes.opcoesAtuais),
      pacienteId: escolhido.id,
      paciente: escolhido.name,
    })
  }

  // Receita ou exame.
  if (estadoAtual === 'documento_tipo') {
    const pedido = pedidoEmAndamento(opcoes.opcoesAtuais)

    if (opcoes.anexo && !texto.trim()) {
      return {
        resposta:
          '📎 Recebi. Antes de guardar, me diga o que você precisa:\n\n' +
          '*1* 💊 2ª via de receita\n' +
          '*2* 🔬 Pedido de exame',
        botoes: [
          { id: '1', titulo: '2ª via de receita' },
          { id: '2', titulo: 'Pedido de exame' },
        ],
      }
    }

    // A palavra vem antes do numero, e nao o contrario.
    //
    // "2ª via de receita" e o rotulo do proprio botao, e escolha() raspa os
    // digitos da frase: o "2" do "2ª" virava a opcao 2, e quem pediu receita
    // recebia "qual exame?". Ler a palavra primeiro resolve sem mexer na
    // leitura de numeros do resto do robo.
    const escrito = normalizar(texto)
    const porPalavra = /receita|remedio|medicamento/.test(escrito)
      ? 'receita'
      : /exame|laborat|ultrassom|endoscopia|sangue/.test(escrito)
        ? 'exame'
        : null

    const escolhido = escolha(texto, 2)
    if (!porPalavra && escolhido === null) {
      return {
        resposta: await naoEntendi(
          admin,
          clinicId,
          texto,
          'Responda *1* para 2ª via de receita, ou *2* para pedido de exame.',
        ),
        botoes: [
          { id: '1', titulo: '2ª via de receita' },
          { id: '2', titulo: 'Pedido de exame' },
        ],
      }
    }
    // "Preciso dos dois": primeiro a receita, depois o exame (ver
    // pediuOsDoisDocumentos).
    if (pediuOsDoisDocumentos(texto)) {
      return await perguntarItem(admin, conversationId, { ...pedido, tipo: 'receita', depois: 'exame' })
    }
    const tipo = porPalavra ?? (escolhido === 0 ? 'receita' : 'exame')
    return await perguntarItem(admin, conversationId, { ...pedido, tipo })
  }

  // Qual medicamento ou exame. Texto livre - e de proposito: ninguem tem a
  // lista de remedios da clinica na cabeca, e uma lista tocavel aqui daria
  // trabalho para acertar o que a pessoa ja sabe dizer numa linha.
  if (estadoAtual === 'documento_item') {
    const pedido = pedidoEmAndamento(opcoes.opcoesAtuais)
    const item = texto.trim()
    if (!item) {
      // A foto da receita quando o robo pede o nome do remedio e o reflexo
      // mais natural que existe - e era o que apagava o pedido inteiro. Aqui
      // ela e recebida, o estado fica de pe, e o robo explica por que ainda
      // precisa do nome: ele nao le imagem, e quem vai ler e o medico.
      const pediu = pedido.tipo === 'exame' ? 'o nome do exame' : 'o nome do medicamento'
      return {
        resposta: opcoes.anexo
          ? `📎 Recebi. Me diga também ${pediu}, escrito - assim o pedido chega completo.`
          : `Pode escrever ${pediu}.`,
      }
    }

    // Controlado sai do automatico aqui, e nao no fim.
    //
    // Continuar perguntando a exigencia e devolver "em ate 1 dia util" seria
    // prometer o que a lei nao deixa cumprir: a receita de controlado sai em
    // receituario proprio, a farmacia retem a via original, e PDF nenhum
    // substitui o papel que ficou no balcao. A familia iria a farmacia com um
    // arquivo no celular para ouvir nao - e a culpa seria nossa, por ter
    // prometido.
    //
    // O pedido nao se perde: vira conversa com a equipe, com o que ela ja
    // escreveu registrado acima.
    if (pedido.tipo === 'receita' && medicamentoControlado(item)) {
      // Sem o nome do remedio: a contagem precisa saber que aconteceu, nao o
      // que a crianca toma.
      registrar('controlado_bloqueado')
      await salvarEstado(admin, conversationId, {
        booking_state: 'atendente',
        booking_options: null,
        auto_replies_while_waiting: 0,
      })
      return {
        resposta:
          `Anotei: *${item}*.\n\n` +
          'Esse tipo de receita sai em receituário especial e a farmácia fica com a via ' +
          'original, então a 2ª via não pode ser resolvida por aqui automaticamente.\n\n' +
          'Já avisei a equipe: alguém do consultório responde por aqui para combinar como ' +
          'retirar.\n\n' +
          // O exame que ainda faltava perguntar nao some: a equipe le aqui.
          (pedido.depois ? 'Escreva aqui também qual exame você precisa, que a equipe vê junto.\n\n' : '') +
          avisoDeHorario(relogioEmFoco ?? new Date()),
        atencao: 'documento',
      }
    }

    // Era o primeiro de dois: anota e pergunta o segundo.
    if (pedido.depois && pedido.tipo) {
      return await perguntarItem(admin, conversationId, {
        ...pedido,
        feitos: [...(pedido.feitos ?? []), { tipo: pedido.tipo, item }],
        tipo: pedido.depois,
        depois: undefined,
        item: undefined,
      })
    }

    return await perguntarExigencia(admin, conversationId, { ...pedido, item })
  }

  // O que a farmacia ou o laboratorio exigiu. Aceita foto: a imagem do
  // documento recusado costuma dizer mais que a explicacao repassada de
  // cabeca por quem esta no balcao.
  if (estadoAtual === 'documento_exigencia') {
    const pedido = pedidoEmAndamento(opcoes.opcoesAtuais)
    const resposta = texto.trim()
    if (!resposta && !opcoes.anexo) {
      return await perguntarExigencia(admin, conversationId, pedido)
    }
    // "Nao" aqui e resposta completa, nao recusa: quer dizer que nada foi
    // exigido, e o pedido segue do mesmo jeito.
    const nada = /^(n|nao|não|nada|nenhuma|negativo)$/i.test(normalizar(resposta))
    const exigencia = nada ? '' : resposta
    return await registrarPedido(
      admin,
      clinicId,
      conversationId,
      pedido,
      exigencia || (opcoes.anexo ? 'enviou foto do documento' : ''),
    )
  }

  // ---- Informacoes: de qual unidade? ----
  if (estadoAtual === 'informacoes_unidade') {
    // Pedido de nota fiscal com a lista de unidades na tela (14/10/2026): no
    // painel, "preciso da nota fiscal da consulta do mes passado" casou com a
    // resposta de idade ("mes") e o pedido nao foi anotado. Pedido de nota e
    // pedido de nota em qualquer etapa de informacao. Pergunta sobre nota ("voces
    // emitem no nome da empresa?") continua indo para a equipe, mais abaixo.
    if (pediuNotaFiscal(texto) && !parecePergunta(texto)) return await registrarPedidoDeNota(admin, conversationId)
    const ids = Array.isArray(opcoes.opcoesAtuais) ? (opcoes.opcoesAtuais as string[]) : []
    let indice = escolha(texto, ids.length)
    // A unidade pelo nome (09/10/2026). A Bianca tocou em "Livance · Santos"
    // numa lista que ja nao era a ultima mensagem: o toque chega como o texto
    // do titulo, "livance" casou com a resposta pronta de endereco, e ela
    // recebeu os dois enderecos em vez do valor que tinha pedido. Saiu sem
    // saber o preco. Nome de unidade e escolha de unidade.
    if (indice === null) {
      const pelaNome = await unidadePeloNome(admin, clinicId, texto)
      const posicao = pelaNome ? ids.indexOf(pelaNome.id) : -1
      if (posicao >= 0) indice = posicao
    }
    if (indice === null) {
      if (pediuVoltar(texto)) return await mostrarMenu(admin, conversationId, saudacao)
      // "Bom dia" no meio da escolha: cumprimento, e nao resposta errada. A
      // pergunta volta inteira, com a lista - tocar na lista nova evita o toque
      // na antiga, que foi o que deu errado acima.
      if (soCumprimento(texto)) {
        return await perguntarLocalDasInformacoes(admin, clinicId, conversationId, opcoes.textos.informacoes)
      }
      // Duvida escrita depois de tocar em "Duvidas sobre a consulta" (07/10/2026,
      // Andre). Ele tocou 1, escreveu a pergunta - "o Dr. Marcello costuma pedir
      // exames para investigar dor abdominal cronica?" - e ouviu "nao posso
      // orientar" e "responda com o numero da unidade". Quem escolheu DUVIDAS
      // e escreveu a duvida ja fez o que o robo pediu: o que o robo nao sabe
      // responder vai para a equipe, sem mais um passo. (Ele mesmo acabou
      // digitando 9 em seguida.)
      //
      // Resposta pronta continua primeiro: se a clinica ja cadastrou aquilo,
      // a familia recebe na hora. Frase curta ("oi", "sim") segue no "nao
      // entendi" de sempre.
      // "ENTAO QUERO MARCAR EM SAO PAULO PRO MEU NETO" (segunda rodada do
      // painel): a avo tinha visto o endereco e a idade atendida, pediu para
      // marcar e ouviu "Passei sua pergunta para a equipe" - duas vezes. Pedido
      // de marcar e pedido de marcar, tambem aqui. Pergunta ("da pra marcar
      // sabado?") e sintoma continuam no caminho de baixo.
      if (pediuAgendamento(texto) && !parecePergunta(texto) && !assuntoClinico(texto)) {
        return await iniciarAgendamento(admin, clinicId, conversationId, opcoes.pacientes, opcoes.consultas, false, false, texto)
      }
      const palavrasDaDuvida = normalizar(texto).replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter((p) => p.length > 1)
      if (palavrasDaDuvida.length >= 3) {
        const clinica = assuntoClinico(texto)
        const achadaAqui = clinica ? null : acharResposta(texto, await carregarRespostas(admin, clinicId))
        const pronta = achadaAqui && !(await jaMandada(admin, conversationId, achadaAqui.resposta)) ? achadaAqui : null
        if (pronta) return { resposta: `${pronta.resposta}\n\n${VOLTA}` }
        registrar(clinica ? 'assunto_clinico' : 'duvida_para_equipe')
        const chamada = await chamarEquipe(admin, conversationId)
        return {
          ...chamada,
          resposta:
            (clinica ? fraseClinica(clinicId) + '\n\n' : '') +
            'Passei sua pergunta para a nossa equipe, que responde por aqui.\n\n' +
            avisoDeHorario(relogioEmFoco ?? new Date()) + '\n\n' + VOLTA,
        }
      }
      // A lista volta junto do "nao entendi": sem ela, o unico botao na tela
      // era o da mensagem anterior - o mesmo toque antigo de cima.
      const lugares = (await opcoesDeAtendimento(admin, clinicId)).filter((u) => ids.includes(u.id))
      return {
        resposta: await naoEntendi(
          admin,
          clinicId,
          texto,
          'Responda com o número da unidade ou toque em *Escolher*.\n\n' + VOLTA,
        ),
        ...(lugares.length > 0
          ? { lista: { rotulo: 'Escolher', linhas: comVoltar(lugares.map((u, i) => ({ id: String(i + 1), titulo: u.name }))) } }
          : {}),
      }
    }
    return await responderInformacoes(admin, clinicId, conversationId, ids[indice], opcoes.textos.informacoes)
  }

  // ---- Minha consulta ----
  if (estadoAtual === 'minha_consulta') {
    const ids = Array.isArray(opcoes.opcoesAtuais) ? (opcoes.opcoesAtuais as string[]) : []
    const t = normalizar(texto)
    // A frase vale, e nao so a palavra (16/10/2026, painel): "quero trocar" e
    // "cancela" recebiam "Nao entendi. Digite CANCELAR". Ver intencaoDaConsulta.
    const intencao = intencaoDaConsulta(texto)
    const querRemarcar = t === 'remarcar' || t === 'trocar' || t === 'mudar' || intencao === 'remarcar'
    const querCancelar = t === 'cancelar' || t === 'desmarcar' || intencao === 'cancelar'

    // A consulta em foco, e nao "a unica que a pessoa tem".
    //
    // booking_options comeca com todas e passa a ter uma so depois que ela
    // escolhe pelo numero. Enquanto a condicao olhava para opcoes.consultas,
    // quem tinha duas consultas escolhia a segunda, digitava CANCELAR e ouvia
    // "nao entendi, digite CANCELAR" - e os tres botoes daquela tela levavam
    // de volta ao mesmo lugar. Laco fechado, e justamente para a mae com dois
    // filhos em acompanhamento, que e o caso comum aqui.
    const emFoco = ids.length === 1
      ? opcoes.consultas.find((c) => c.id === ids[0]) ?? null
      : null

    if (emFoco && (querCancelar || querRemarcar)) {
      return await pedirConfirmacaoCancelamento(
        admin, clinicId, conversationId, emFoco, querRemarcar,
      )
    }

    const indice = escolha(texto, ids.length)
    const alvo = indice === null ? null : opcoes.consultas.find((c) => c.id === ids[indice])
    if (alvo) {
      await salvarEstado(admin, conversationId, { booking_options: [alvo.id] })
      const timezone = await fusoDaClinica(admin, clinicId)
      return {
        resposta:
          `${descreverConsulta(alvo, timezone)}\n\n` +
          'Digite CANCELAR para desmarcar, REMARCAR para trocar a data, ou *0* para voltar.',
      botoes: [
        { id: 'REMARCAR', titulo: 'Remarcar' },
        { id: 'CANCELAR', titulo: 'Cancelar consulta' },
        { id: 'MENU', titulo: 'Voltar ao menu' },
      ],
      }
    }

    return {
      resposta: await naoEntendi(
        admin,
        clinicId,
        texto,
        'Digite CANCELAR para desmarcar, REMARCAR para trocar a data, ' +
          'ou *0* para voltar ao início.',
      ),
      botoes: [
        { id: 'REMARCAR', titulo: 'Remarcar' },
        { id: 'CANCELAR', titulo: 'Cancelar consulta' },
        { id: 'MENU', titulo: 'Voltar ao menu' },
      ],
    }
  }

  // ---- Confirmacao do cancelamento ----
  if (estadoAtual === 'confirmar_cancelamento') {
    const t = normalizar(texto)
    // O sim escrito como gente escreve.
    //
    // A comparacao exata exigia a palavra sozinha: "sim, pode cancelar por
    // favor" virava "sua consulta continua marcada", e no caminho da
    // remarcacao jogava no menu quem tinha acabado de confirmar. Ninguem
    // responde uma pergunta de confirmacao em uma palavra seca.
    //
    // O "nao" e testado ANTES: sem isso, "nao, pode cancelar nao" casaria com
    // "pode cancelar" e desmarcaria a consulta de quem estava recusando. Errar
    // aqui apaga uma vaga que ninguem pediu para apagar.
    const negou = /^(n|nao|nada|negativo|deixa|espera|melhor nao)\b/.test(t)

    // "Quero mudar o dia" na pergunta de cancelar (26/10/2026, sondagem das
    // etapas para o Jev): comecava com "quero", valia como sim, e a consulta
    // de quem so queria trocar a data era cancelada. Pedido de remarcar vai
    // para a remarcacao, que so cancela a antiga depois da nova marcada.
    if (!negou && !opcoes.consultaASubstituir && intencaoDaConsulta(texto) === 'remarcar') {
      const marcadas = Array.isArray(opcoes.opcoesAtuais) ? (opcoes.opcoesAtuais as string[]) : []
      const consulta = opcoes.consultas.find((c) => c.id === marcadas[0]) ?? opcoes.consultas[0]
      if (consulta) return await pedirConfirmacaoCancelamento(admin, clinicId, conversationId, consulta, true)
    }

    // "Quero", "ok" e "pode" so confirmam o cancelamento sozinhos ou falando
    // de cancelar (26/10/2026): "quero falar com alguem" e "pode me ligar?"
    // tambem comecam assim, e cancelar por engano apaga uma vaga que ninguem
    // pediu para apagar. Na remarcacao nada cai agora, e "pode ser na semana
    // que vem" continua sendo sim. "Sim" e companhia valem em qualquer frase.
    const curta = t.replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).length <= 3 && !/\?\s*$/.test(texto)
    const falaDeCancelar = /\b(cancel\w*|desmarc\w*)\b/.test(t)
    const confirmou =
      !negou &&
      (/^(sim|s|isso|claro|confirmo|confirmar)\b/.test(t) ||
        (/^(quero|ok|pode)\b/.test(t) && (Boolean(opcoes.consultaASubstituir) || curta || falaDeCancelar)) ||
        t.includes('pode cancelar') ||
        t.includes('pode desmarcar'))
    if (!confirmou) {
      return await mostrarMenu(
        admin, conversationId, saudacao,
        'Tudo bem, sua consulta continua marcada. Posso ajudar em mais alguma coisa?',
      )
    }

    const ids = Array.isArray(opcoes.opcoesAtuais) ? (opcoes.opcoesAtuais as string[]) : []
    const alvo = opcoes.consultas.find((c) => c.id === ids[0]) ?? opcoes.consultas[0]
    if (!alvo) {
      return await mostrarMenu(admin, conversationId, saudacao, 'Não encontrei mais essa consulta.')
    }

    // Remarcar nao cancela agora: primeiro escolhe a nova data, e a antiga cai
    // so quando a nova estiver garantida. Na mesma unidade e no mesmo convenio,
    // quando da (ver remarcarNaMesmaUnidade).
    if (opcoes.consultaASubstituir === alvo.id) {
      const mesma = await remarcarNaMesmaUnidade(admin, clinicId, conversationId, alvo.id, texto)
      if (mesma) return mesma
      return await iniciarAgendamento(
        admin, clinicId, conversationId, opcoes.pacientes, opcoes.consultas, true,
      )
    }

    const ok = await cancelarConsulta(admin, alvo.id)
    if (ok) registrar('cancelou')
    // Menu ativo, e nao estado zerado: a resposta abaixo oferece "digite 2".
    await voltarAoMenuAtivo(admin, conversationId)
    if (!ok) {
      return {
        resposta:
          'Não consegui cancelar agora. Já avisei a nossa equipe, que resolve isso por aqui.\n\n' + VOLTA,
        atencao: 'falha',
      }
    }
    return {
      // A vaga que abriu interessa a recepcao: por isso a conversa acende.
      resposta:
        'Consulta cancelada. Obrigado por avisar!\n\n' +
        'Se quiser marcar outra data, digite 2. ' + VOLTA,
      atencao: 'cancelou_sozinho',
    }
  }

  // ---- Ja tem consulta marcada ----
  if (estadoAtual === 'ja_tem_consulta') {
    const escolhido = escolha(texto, 2)
    if (escolhido === 0) {
      const alvo = opcoes.consultas[0]
      if (!alvo) return await mostrarMenu(admin, conversationId, saudacao)
      return await pedirConfirmacaoCancelamento(admin, clinicId, conversationId, alvo, true)
    }
    if (escolhido === 1) {
      return await iniciarAgendamento(
        admin, clinicId, conversationId, opcoes.pacientes, opcoes.consultas, true, true,
      )
    }
    // 24/09/2026: a mae saiu do cadastro, tocou em "Marcar uma consulta",
    // caiu aqui e escreveu o nome da crianca - que virava "Nao entendi".
    const retomada = await tentarFichaPendente(admin, clinicId, conversationId, texto, opcoes.consultas)
    if (retomada) return retomada
    return {
      resposta: await naoEntendi(
        admin,
        clinicId,
        texto,
        'Responda 1 para remarcar, 2 para marcar mais uma consulta, ' +
          'ou MENU para voltar ao início.',
      ),
    }
  }

  // ---- Insistencia no retorno ja usado ou vencido (26/10/2026) ----
  // "Mas e retorno", "o medico falou que era retorno" no meio do agendamento,
  // com o retorno ja usado ou vencido no prontuario: explica (ate duas vezes,
  // contando a do comeco) e depois passa para a equipe. Numero e escolha da
  // lista seguem o caminho de sempre.
  if (
    (estadoAtual === 'aguardando_unidade' || estadoAtual === 'aguardando_convenio' || estadoAtual === 'aguardando_dia' || estadoAtual === 'aguardando_horario') &&
    pediuRetorno(texto) &&
    !/^\s*\d+\s*$/.test(texto)
  ) {
    const { aberto, fechado } = await retornoDaConversa(admin, clinicId, conversationId)
    if (!aberto && fechado) {
      return await explicarOuPassarORetorno(admin, clinicId, conversationId, {
        resposta:
          `${fechado}\n\nSe ${quemAtende(clinicId).o} combinou outra coisa com você, digite *9* que a nossa equipe confere. ` +
          'Para seguir com a marcação, escolha uma opção da lista acima.',
        botoes: [
          { id: '9', titulo: 'Falar com a equipe' },
          { id: '0', titulo: 'Voltar ao menu' },
        ],
      })
    }
  }

  // ---- Paciente do retorno, de um telefone sem ele (26/10/2026) ----
  if (estadoAtual === 'aguardando_crianca_do_retorno') {
    const t = normalizar(texto)
    const deOutra = opcoes.pacienteEmAndamento === OUTRA_CRIANCA
    if (t === 'nova' || /\b(consulta nova|nova consulta|primeira (vez|consulta)|nao e retorno)\b/.test(t)) {
      await salvarEstado(admin, conversationId, { booking_patient_id: deOutra ? OUTRA_CRIANCA : null, booking_options: null })
      return await perguntarUnidade(admin, clinicId, conversationId)
    }
    let achado: Awaited<ReturnType<typeof acharPacienteDoRetorno>> = null
    try {
      achado = await acharPacienteDoRetorno(admin, clinicId, texto)
    } catch (erro) {
      console.warn('Nao consegui procurar o paciente do retorno', erro)
    }
    if (achado === 'sem_dados') {
      return {
        resposta:
          `Para achar o cadastro preciso do *nome completo* e da *data de nascimento* ${doPacienteDoRetorno()} (ex.: ${exemploDeCadastro()}), ou do *CPF*.\n\n` +
          'Se for uma consulta nova, toque em *Consulta nova*.',
        botoes: BOTOES_DO_CADASTRO_DO_RETORNO,
      }
    }
    if (!achado) {
      const jaTentou = Array.isArray(opcoes.opcoesAtuais) && (opcoes.opcoesAtuais as unknown[]).includes('tentou')
      if (!jaTentou) {
        await salvarEstado(admin, conversationId, { booking_options: ['tentou'] })
        return {
          resposta:
            'Não achei esse cadastro. Confira o nome completo e a data de nascimento, ou mande o CPF.\n\n' +
            'Se for uma consulta nova, toque em *Consulta nova*.',
          botoes: BOTOES_DO_CADASTRO_DO_RETORNO,
        }
      }
      // Segunda vez sem achar: ninguem fica preso. Segue a marcacao, e a
      // equipe confere depois pela ficha (o cadastro automatico junta quando o
      // nome e o nascimento batem).
      registrar('retorno_sem_cadastro')
      await salvarEstado(admin, conversationId, { booking_patient_id: deOutra ? OUTRA_CRIANCA : null, booking_options: null })
      const unidades = await perguntarUnidade(admin, clinicId, conversationId)
      if (!unidades) return unidades
      return {
        ...unidades,
        resposta: `Não encontrei o cadastro, então sigo com a marcação. A nossa equipe confere se é retorno.\n\n${unidades.resposta}`,
      }
    }
    await salvarEstado(admin, conversationId, { booking_patient_id: achado.id, booking_options: null })
    const primeiro = achado.name.trim().split(/\s+/)[0] ?? ''
    // Aberto, o titulo das unidades diz ate quando; usado ou vencido,
    // perguntarUnidade diz que e consulta (o paciente pediu retorno).
    const unidades = await perguntarUnidade(admin, clinicId, conversationId)
    if (!unidades) return unidades
    return { ...unidades, resposta: `✅ Achei o cadastro de *${primeiro}*.\n\n${unidades.resposta}` }
  }

  // ---- Escolha do paciente ----
  if (estadoAtual === 'aguardando_paciente') {
    if (pediuVoltar(texto)) return await mostrarMenu(admin, conversationId, saudacao)

    const ids = Array.isArray(opcoes.opcoesAtuais) ? (opcoes.opcoesAtuais as string[]) : []
    let indice = escolha(texto, ids.length)
    // Pelo nome ("Theo") ou "outro filho" (painel, 14/10/2026: "Theo" dava
    // "Nao entendi" aqui, embora a 2a via ja aceitasse o nome).
    if (indice === null) {
      const t = ` ${normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()} `
      const porNome = opcoes.pacientes.filter((p) => {
        const primeiro = normalizar(p.name).split(/\s+/)[0]
        return primeiro.length >= 2 && t.includes(` ${primeiro} `)
      })
      // "teo" para o Theo (16/10/2026, painel): o nome como se fala. Ver nomeFalado.
      const comoSeFala = porNome.length === 0 ? pacienteCitado(opcoes.pacientes, texto) : null
      if (porNome.length === 1) indice = ids.indexOf(porNome[0].id)
      else if (comoSeFala) indice = ids.indexOf(comoSeFala.id)
      else if (ids.includes(OUTRA_CRIANCA) && / (outr[oa]|irma[o]?|nov[oa]|ainda nao tem cadastro|sem cadastro) /.test(t)) {
        indice = ids.indexOf(OUTRA_CRIANCA)
      }
      if (indice !== null && indice < 0) indice = null
    }
    if (indice === null) {
      if (desistiuDoAgendamento(texto)) {
        return await sairDoAgendamento(admin, conversationId, clinicId, opcoes.consultaASubstituir ?? null, opcoes.consultas)
      }
      return {
        resposta: await naoEntendi(
          admin,
          clinicId,
          texto,
          'Responda com o número ou o nome do paciente da lista acima.\n\n' + VOLTA,
        ),
      }
    }

    // O pedido de antes da pergunta de quem (rodada 2 do painel): "preciso
    // marcar pro meu filho pela porto em santos" perguntava para quem e, depois,
    // a unidade e o convenio de novo. Ver contextoDoPedido.
    const seguirDoPedido = async () => {
      const pedido = await contextoDoPedido(admin, clinicId, conversationId, '')
      return pedido ? await unidadeDoPedido(admin, clinicId, conversationId, pedido) : await perguntarUnidade(admin, clinicId, conversationId)
    }
    if (ids[indice] === OUTRA_CRIANCA) {
      // Outra pessoa para o retorno: pode ser quem esta cadastrado em outro
      // celular da familia (26/10/2026).
      if ((await falouEmRetorno(admin, conversationId)) && (await clinicaMarcaORetorno(admin, clinicId))) {
        return await perguntarPacienteDoRetorno(admin, conversationId, true)
      }
      await salvarEstado(admin, conversationId, { booking_patient_id: OUTRA_CRIANCA })
      return await seguirDoPedido()
    }
    const escolhido = opcoes.pacientes.find((p) => p.id === ids[indice])
    if (!escolhido) {
      return await mostrarMenu(
        admin,
        conversationId,
        saudacao,
        'Esse paciente não está mais disponível. Vamos recomeçar:',
      )
    }

    await salvarEstado(admin, conversationId, { booking_patient_id: escolhido.id })
    return await seguirDoPedido()
  }

  // ---- Escolha da unidade ----
  if (estadoAtual === 'aguardando_unidade') {
    const ids = Array.isArray(opcoes.opcoesAtuais) ? (opcoes.opcoesAtuais as string[]) : []

    // "3" aqui e ambiguo: pode ser a terceira unidade ou "falar com a equipe".
    // A lista manda, porque foi ela que a pessoa acabou de ler.
    const indice = escolha(texto, ids.length)
    const unidades = await opcoesDeAtendimento(admin, clinicId)
    // Pelo nome, quando nao veio numero (ver unidadeCitada).
    const citada = indice === null ? unidadeCitada(unidades, texto) : null
    // "Santos pela porto", "em santos eu tenho o santa saude" (rodada 2 do
    // painel): o convenio dito junto com a unidade era perguntado de novo. Com
    // plano ou "particular" na frase, o mesmo caminho do pedido escrito (ver
    // unidadeDoPedido).
    if (indice === null && geral() && falouDePlano(texto, unidades)) {
      return await unidadeDoPedido(admin, clinicId, conversationId, texto)
    }
    if (indice === null && !citada) {
      if (pediuVoltar(texto)) {
        return opcoes.pacientes.length > 1
          ? await perguntarPaciente(admin, conversationId, opcoes.pacientes)
          : await mostrarMenu(admin, conversationId, saudacao)
      }
      if (desistiuDoAgendamento(texto)) {
        return await sairDoAgendamento(admin, conversationId, clinicId, opcoes.consultaASubstituir ?? null, opcoes.consultas)
      }
      // "Qual tem horario mais cedo?", "tanto faz". Ver unidadeMaisCedo.
      const cedo = await unidadeMaisCedo(admin, clinicId, conversationId, texto, agora)
      if (cedo) return cedo
      const naoEntendeu = await naoEntendi(admin, clinicId, texto, '')
      const deNovo = await perguntarUnidade(admin, clinicId, conversationId)
      // Resposta pronta (a pessoa perguntou outra coisa) vem com a lista
      // numerada de novo embaixo (16/10/2026, painel): sem ela, o "2" seguinte
      // valia pela lista de cima, e os enderecos que a pessoa acabara de ler
      // estavam em outra ordem - ela quis Higienopolis e caiu em Santos. O
      // "nao entendi" puro tambem volta com a lista (painel de 14/10/2026).
      if (!naoEntendeu.startsWith('Não entendi')) return { ...deNovo, resposta: `${naoEntendeu.trim()}\n\n${deNovo?.resposta ?? ''}` }
      return {
        ...deNovo,
        resposta: `Não entendi qual unidade. Responda com o número da unidade ou escreva o nome (por exemplo, ${tituloCurto(unidades[0]?.name ?? 'Santos')}).\n\n${deNovo.resposta}`,
      }
    }

    const escolhida = citada ?? unidades.find((u) => u.id === ids[indice as number])
    if (!escolhida) {
      return await mostrarMenu(
        admin,
        conversationId,
        saudacao,
        'Essa unidade não está mais disponível. Vamos recomeçar:',
      )
    }
    // "Entao Tatuape, quinta as 14h" e "higienopolis terca 8h" (rodada 3 do
    // painel): o robo pedia o dia e a hora de novo. Unidade sem convenio a
    // perguntar, dia e hora livres: marca direto.
    if (citada) {
      const direto = await marcarDoPedido(escolhida, texto)
      if (direto) return direto
    }
    return await perguntarConvenioOuDia(admin, clinicId, conversationId, escolhida)
  }

  // ---- Convenio: particular ou pelo plano? ----
  //
  // So aparece em unidade que aceita convenio. A resposta nao muda o preco nem
  // o horario: muda o que a recepcao precisa ter em maos quando a pessoa
  // chegar. Sem ela, a familia aparece com a carteirinha e a recepcao descobre
  // na hora se fatura pelo plano ou cobra particular.
  if (estadoAtual === 'aguardando_convenio') {
    const unidadeId = unidadeEmAndamento
    const unidades = await opcoesDeAtendimento(admin, clinicId)
    const escolhida = unidades.find((u) => u.id === unidadeId)
    if (!escolhida) {
      return await mostrarMenu(
        admin,
        conversationId,
        saudacao,
        'Perdi o fio da conversa, desculpe. Vamos recomeçar:',
      )
    }

    // Outra unidade na pergunta do convenio (16/10/2026, rodada 3 do painel):
    // "entao prefiro fazer particular no Tatuape mesmo" seguiu na agenda de
    // Santos, e "nao, eu quero no Tatuape, nao em Santos" recebeu os enderecos.
    // "Nao quero em Santos, e longe" volta para a lista de unidades.
    if (geral()) {
      const outra = (await trocaDeUnidade(admin, clinicId, texto)) ?? unidadeCitada(unidades, texto)
      if (outra && outra.id !== escolhida.id) return await perguntarConvenioOuDia(admin, clinicId, conversationId, outra)
      if (pediuOutraUnidade(texto) || negouAUnidade(texto, escolhida)) {
        const lista = await perguntarUnidade(admin, clinicId, conversationId)
        return { ...lista, resposta: `Tudo bem, em outra unidade. ${lista?.resposta ?? ''}` }
      }
    }
    // A desistencia vale aqui tambem, como na pergunta da unidade (25/10/2026,
    // rodada 5 do painel): "nao quero marcar agora nao, so queria saber msm.
    // obg" e "obrigada" receberam duas vezes "Responda com o numero do convenio".
    if (desistiuDoAgendamento(texto)) {
      return await sairDoAgendamento(admin, conversationId, clinicId, opcoes.consultaASubstituir ?? null, opcoes.consultas)
    }

    const plano = (escolhida.accepts_insurance ?? '').trim()

    // A unidade deixou de aceitar convenio enquanto a pessoa estava nesta
    // pergunta. Aconteceu em 23/09/2026: o Dr. Marcello encerrou o Trasmontano
    // com uma familia parada aqui. Sem esta saida, qualquer texto dela recebia
    // "Responda *1* para  ou *2* para particular" - com o nome do plano em
    // branco. Sem plano, a resposta so pode ser particular: segue para as datas.
    if (!plano) {
      await salvarEstado(admin, conversationId, { booking_insurance: '' })
      return await perguntarDia(admin, clinicId, conversationId, escolhida)
    }

    // Varios planos na unidade (15/10/2026, ver planosDaUnidade). Um plano so
    // segue pelo caminho de sempre, logo abaixo, letra por letra.
    const planos = planosDaUnidade(escolhida)
    if (planos.length > 1) {
      const qual = planoEscolhido(texto, planos)
      if (qual === null) {
        if (pediuVoltar(texto)) return await mostrarMenu(admin, conversationId, saudacao)
        const fora = planoNaoAceito(texto, planos)
        if (fora) {
          const lista = `${planos.slice(0, -1).join(', ')} e ${planos.at(-1)}`
          return perguntaDosPlanos(
            planos,
            `O plano *${fora}* não está entre os convênios atendidos em ${escolhida.name}. Aqui atendemos ${lista}, ` +
              'ou a consulta pode ser particular, com recibo para você pedir reembolso ao seu plano.',
          )
        }
        const naoEntendeu = await naoEntendi(admin, clinicId, texto, 'Responda com o número do convênio, ou do particular, da lista abaixo.')
        return perguntaDosPlanos(planos, naoEntendeu)
      }
      await salvarEstado(admin, conversationId, { booking_insurance: qual < planos.length ? planos[qual] : '' })
      return await comDuvidaJunto(await perguntarDia(admin, clinicId, conversationId, escolhida))
    }

    const indice = escolha(texto, 2)
    const escrito = texto.trim().toLowerCase()
    // Aceita o numero, o nome do plano digitado e a palavra "particular": quem
    // responde por escrito nao deve ser mandado de volta para a lista.
    const pelaPalavra =
      plano && escrito.includes(plano.toLowerCase()) ? 0
        : /particular|sem convenio|sem convênio|nao tenho|não tenho/.test(escrito) ? 1
          : null
    const resposta = indice ?? pelaPalavra

    if (resposta === null) {
      if (pediuVoltar(texto)) return await mostrarMenu(admin, conversationId, saudacao)
      return {
        resposta: await naoEntendi(
          admin,
          clinicId,
          texto,
          `Responda *1* para ${plano} ou *2* para particular.\n\n` + VOLTA,
        ),
      }
    }

    await salvarEstado(admin, conversationId, {
      booking_insurance: resposta === 0 ? plano : '',
    })
    return await comDuvidaJunto(await perguntarDia(admin, clinicId, conversationId, escolhida))
  }

  // ---- Escolha do dia ----
  if (estadoAtual === 'aguardando_dia') {
    if (pediuVoltar(texto) || pediuOutraUnidade(texto)) {
      return await perguntarUnidade(admin, clinicId, conversationId)
    }
    // Antes da data escrita (ver desistiuComCerteza).
    if (desistiuComCerteza(texto)) {
      return await sairDoAgendamento(admin, conversationId, clinicId, opcoes.consultaASubstituir ?? null, opcoes.consultas)
    }

    // Tocou o nome de uma unidade numa lista de cima, ou corrigiu ("nao,
    // higienopolis"): troca de unidade. Ver trocaDeUnidade.
    const outraUnidade = await trocaDeUnidade(admin, clinicId, texto)
    if (outraUnidade && outraUnidade.id !== unidadeEmAndamento) return await perguntarConvenioOuDia(admin, clinicId, conversationId, outraUnidade)

    const dias = Array.isArray(opcoes.opcoesAtuais) ? (opcoes.opcoesAtuais as string[]) : []

    // A unidade numa frase maior (16/10/2026, rodada 3 do painel): "nao, eu
    // quero no Tatuape, nao em Santos" e "tatuape", ja nas datas do Tatuape,
    // recebiam a lista de enderecos. Outra unidade troca; a mesma confirma. O
    // plano ("unimed santos") fica com a pergunta do convenio, mais abaixo.
    if (geral()) {
      const unidades = await opcoesDeAtendimento(admin, clinicId)
      const citada = unidadeCitada(unidades, texto)
      const semDia = dataEscrita(texto) === null && diaPeloNome(texto, dias, agora) < 0 && escolha(texto, dias.length) === null
      if (citada && semDia && !falouDePlano(texto, unidades)) {
        if (citada.id !== unidadeEmAndamento) return await perguntarConvenioOuDia(admin, clinicId, conversationId, citada)
        if (!parecePergunta(texto)) return { resposta: `✅ Isso, em *${citada.name}*. Responda com o número do dia da lista acima.` }
      }
    }

    // "Nao tem antes?", "hj nao da?" (16/10/2026, painel): pergunta, e nao
    // escolha. "So dia 20? Nao tem nada antes?" abria os horarios do dia 20.
    {
      const quando = perguntouMaisCedo(texto)
      const hoje = agora.toLocaleDateString('en-CA', { timeZone: await fusoDaClinica(admin, clinicId) })
      // "Qualquer dia, o mais cedo que tiver" escolhe o primeiro dia (ver
      // qualquerUm): e escolha, e nao pergunta.
      if (quando && !qualquerUm(texto) && !(quando === 'hoje' && dias.includes(hoje)) && unidadeEmAndamento && unidadeEmAndamento !== TELE_ID) {
        const info = await informarMaisCedo(admin, clinicId, unidadeEmAndamento, quando, agora)
        if (info) {
          return {
            resposta: `${info}\n\nResponda com o número de um dia da lista acima.`,
            botoes: [
              { id: 'VOLTAR', titulo: 'Outra unidade' },
              { id: '9', titulo: 'Falar com a equipe' },
              { id: '0', titulo: 'Voltar ao menu' },
            ],
          }
        }
      }
    }

    // "Dia 22 nao da" (16/10/2026, painel): recusa, e nao escolha. O que vale e
    // o que vem depois dela, como no passo do horario (ver recusaDeEscolha).
    const recusa = recusaDeEscolha(texto)
    const pedido = recusa ? recusa.depois : texto
    if (recusa && !dataEscrita(pedido) && diaPeloNome(pedido, dias, agora) < 0 && !periodoEscrito(pedido)) {
      if (encerrouComARecusa(texto)) {
        return await sairDoAgendamento(admin, conversationId, clinicId, opcoes.consultaASubstituir ?? null, opcoes.consultas)
      }
      return {
        resposta:
          'Tudo bem, não marquei nada. Escolha outro dia da lista acima, ou digite VOLTAR para ver outra unidade. ' +
          'Se nenhum dia servir, digite *9* para falar com a nossa equipe.',
        botoes: [
          { id: 'VOLTAR', titulo: 'Outra unidade' },
          { id: '9', titulo: 'Falar com a equipe' },
          { id: '0', titulo: 'Voltar ao menu' },
        ],
      }
    }

    // "31/08" e uma resposta natural. Aqui nao ha o risco do horario - uma data
    // nunca cai dentro da faixa de indices - mas entender custa pouco.
    const data = dataEscrita(pedido)
    const porData = data
      ? dias.findIndex((chave) => {
          const [, mes, dia] = chave.split('-').map(Number)
          return dia === data.dia && mes === data.mes
        })
      : -1

    let porNome = porData >= 0 ? -1 : diaPeloNome(pedido, dias, agora)
    // "Pode ser sexta as 8", de quem pediu a semana que vem no comeco da
    // conversa (16/10/2026, rodada 3 do painel): era marcada a sexta desta
    // semana, embora o proprio robo tivesse destacado as da semana que vem.
    // So o dia da semana: "sexta dia 16" escolhe o 16.
    if (porNome >= 0 && geral() && !/\bdia\s+\d{1,2}\b|\d{1,2}\s*\/\s*\d{1,2}/.test(normalizar(pedido))) {
      const pediuASemanaQueVem = (await mensagensDoPaciente(admin, conversationId, 1)).some((m) => /\b(semana (que|q) vem|proxima semana|semana seguinte)\b/.test(normalizar(m)))
      if (pediuASemanaQueVem) {
        const fuso = await fusoDaClinica(admin, clinicId)
        const hoje = new Date(`${agora.toLocaleDateString('en-CA', { timeZone: fuso })}T12:00:00Z`)
        const inicio = new Date(hoje)
        inicio.setUTCDate(hoje.getUTCDate() + ((8 - hoje.getUTCDay()) % 7 || 7))
        const fim = new Date(inicio)
        fim.setUTCDate(inicio.getUTCDate() + 6)
        const [de, ate] = [inicio, fim].map((d) => d.toISOString().slice(0, 10))
        const semana = new Date(`${dias[porNome]}T12:00:00Z`).getUTCDay()
        const daQueVem = dias.findIndex((chave) => chave >= de && chave <= ate && new Date(`${chave}T12:00:00Z`).getUTCDay() === semana)
        if (daQueVem >= 0) porNome = daQueVem
      }
    }
    let indice = porData >= 0 ? porData : porNome >= 0 ? porNome : escolha(pedido, dias.length)
    if (indice === null && dias.length > 0 && qualquerUm(pedido)) indice = 0
    // "23" numa lista de oito dias (16/10/2026, painel): nao e item, e o dia do
    // mes que esta na lista. Numero que e item continua sendo item.
    if (indice === null) {
      const n = normalizar(pedido).match(/^(?:dia\s+)?(\d{1,2})$/)
      if (n && Number(n[1]) > dias.length) {
        const doMes = dias.filter((chave) => Number(chave.slice(8, 10)) === Number(n[1]))
        if (doMes.length === 1) indice = dias.indexOf(doMes[0])
      }
    }
    // Data escrita depois do prazo do retorno (26/10/2026, vindo do sistema do
    // Dr. Marcello): a lista e curta de proposito, e a data escrita nao fura o
    // prazo. Explica, e na insistencia passa para a equipe.
    if (indice === null) {
      const depoisDoPrazo = await dataDepoisDoPrazo(admin, clinicId, conversationId, pedido, agora)
      if (depoisDoPrazo) return depoisDoPrazo
    }
    // Dia da semana sem vaga: "sexta" quando a unidade nao atende sexta. Dizer
    // isso e mais util que "nao entendi" - a pessoa foi entendida.
    const diaCitado = indice === null ? DIAS_DA_SEMANA.find((d) => new RegExp(`\\b${d}\\b`).test(semErroNosDias(normalizar(pedido)))) : undefined
    if (indice === null && diaCitado) {
      const nome = { domingo: 'no domingo', segunda: 'na segunda', terca: 'na terça', quarta: 'na quarta', quinta: 'na quinta', sexta: 'na sexta', sabado: 'no sábado' }[diaCitado]
      // Nenhuma unidade nesse dia (16/10/2026, painel): "nao tem sabado?"
      // ouvia "nesta unidade nao temos", e a paciente foi conferir as outras.
      const fuso = await fusoDaClinica(admin, clinicId)
      const semana = DIAS_DA_SEMANA.indexOf(diaCitado)
      // O dia da semana existe na lista, e o que nao bateu foi a data ("sexta
      // dia 22", com o 22 numa quinta): os dias desse nome, para escolher.
      const desseNome = dias.filter((chave) => new Date(`${chave}T12:00:00Z`).getUTCDay() === semana)
      if (desseNome.length > 0) {
        const plural = { domingo: 'Os domingos', segunda: 'As segundas', terca: 'As terças', quarta: 'As quartas', quinta: 'As quintas', sexta: 'As sextas', sabado: 'Os sábados' }[diaCitado]
        const datas = desseNome.map((chave) => `${chave.slice(8, 10)}/${chave.slice(5, 7)}`)
        return {
          resposta:
            `Não achei esse dia na lista. ${plural} com horário livre são: ` +
            `${datas.length > 1 ? `${datas.slice(0, -1).join(', ')} e ${datas.at(-1)}` : datas[0]}.\n\n` +
            'Responda com o número do dia da lista acima.',
        }
      }
      const emAlguma = (await primeirosHorarios(admin, clinicId)).some((c) =>
        c.horarios.some((h) => new Date(`${chaveDoDia(h.inicio, fuso)}T12:00:00Z`).getUTCDay() === semana),
      )
      // "Horario livre", e nao "atendimento": a agenda pode estar so cheia.
      return {
        resposta:
          (emAlguma
            ? `Nesta unidade não temos horário livre ${nome}. Escolha um dos dias da lista acima.\n`
            : `Nesta unidade, e nas outras também, não temos horário livre ${nome}. Escolha um dos dias da lista acima.\n`) +
          'Digite VOLTAR para ver outra unidade, *9* se precisar de outra data, ou 0 para o início.',
        botoes: [
          { id: 'VOLTAR', titulo: 'Outra unidade' },
          { id: '9', titulo: 'Falar com a equipe' },
          { id: '0', titulo: 'Voltar ao menu' },
        ],
      }
    }
    // "Nao, quero de manha as 8h" no Tatuape, que so atende a tarde (rodada 2
    // do painel), ouviu "Nao entendi". Hora ou turno sem o dia: os dias da
    // lista que tem, ou as unidades que tem. Ver diasComAHora.
    if (indice === null && unidadeEmAndamento && geral()) {
      const pedida = horaEscrita(pedido)
      const turno = pedida ? null : periodoEscrito(pedido)
      if (pedida || turno) {
        const resposta = await diasComAHora(admin, clinicId, unidadeEmAndamento, dias, pedida, turno)
        if (resposta) return resposta
      }
    }
    if (indice === null) {
      if (desistiuDoAgendamento(texto)) {
        return await sairDoAgendamento(admin, conversationId, clinicId, opcoes.consultaASubstituir ?? null, opcoes.consultas)
      }
      // "Mas e Unimed Santos, como eu falei", ja na lista de dias (rodada 2 do
      // painel): o convenio desta consulta, e nao a resposta pronta de
      // convenios em cima da lista.
      if (geral() && unidadeEmAndamento && !/^\s*\d+\s*$/.test(texto)) {
        const unidade = await unidadePorId(admin, unidadeEmAndamento)
        const planos = unidade ? planosDaUnidade(unidade) : []
        const daCidade = normalizar(unidade?.name ?? '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3)
        const qual = planos.length ? planoEscolhido(texto, planos, daCidade) : null
        if (qual !== null) {
          const nome = qual < planos.length ? planos[qual] : ''
          await salvarEstado(admin, conversationId, { booking_insurance: nome })
          return await comDuvidaJunto({ resposta: `✅ Anotado: ${nome ? `pela *${nome}*` : 'particular'}. Responda com o número do dia da lista acima.` })
        }
      }
      // Data alem da agenda ("e pro dia 25 de novembro?"): a equipe reserva.
      // No painel, a mae ouviu duas vezes "Nao entendi" (14/10/2026).
      const horizonte = await horizonteDaAgenda(admin, clinicId)
      const distante = retornoAlemDaAgenda(texto, horizonte, agora)
      if (distante) return await pedirRetornoDistante(admin, conversationId, distante, horizonte, false)
      return {
        resposta: await naoEntendi(
          admin,
          clinicId,
          texto,
          // A saida para data distante continua na tela: sem ela, quem queria
          // novembro so tinha a lista de outubro e o "Nao entendi".
          'Responda com o número do dia da lista acima.\n' +
            'Digite VOLTAR para escolher outra unidade, *9* se precisar de uma data mais distante, ou 0 para o início.',
        ),
        botoes: [
          { id: 'VOLTAR', titulo: 'Outra unidade' },
          { id: '9', titulo: 'Data mais distante' },
          { id: '0', titulo: 'Voltar ao menu' },
        ],
      }
    }
    if (!unidadeEmAndamento) {
      return await mostrarMenu(
        admin,
        conversationId,
        saudacao,
        'Perdi o fio da conversa, desculpe. Vamos recomeçar:',
      )
    }
    // Dia e hora na mesma mensagem (rodada 2 do painel): "sexta 16 as 8h" e
    // "pode ser esse de quinta 14h" abriam a lista do dia, e a pessoa tinha de
    // escrever a hora de novo. Hora livre nesse dia: marca direto.
    const horaJunto = horaEscrita(pedido)
    if (horaJunto) {
      const fuso = await fusoDaClinica(admin, clinicId)
      const { horarios } = await horariosLivres(admin, clinicId, unidadeEmAndamento)
      // "Seg dia 26 depois das 16h": a lista do dia, com o que cabe no limite.
      const limite = limiteDaHora(pedido)
      if (limite) {
        const doDia = horarios.filter((h) => chaveDoDia(h.inicio, fuso) === dias[indice])
        const lista = await perguntarHorario(admin, clinicId, conversationId, unidadeEmAndamento, dias[indice])
        return { ...lista, resposta: `${textoDoLimite(doDia, horaJunto, limite, fuso)}\n\n${lista?.resposta ?? ''}` }
      }
      const naHora = naHoraPedida(horarios.filter((h) => chaveDoDia(h.inicio, fuso) === dias[indice]), horaJunto, fuso)
      const cheia = horaJunto.minuto === null ? naHora.filter((h) => formatarHora(h.inicio, fuso).endsWith(':00')) : []
      // "15h" num dia que so tem 15:20 (rodada 3 do painel) era marcado 15:20
      // sem perguntar: a hora mais perto vai como pergunta.
      const unico = cheia.length === 1 ? cheia[0] : naHora.length === 1 && (!geral() || horaJunto.minuto !== null) ? naHora[0] : null
      if (unico) {
        return await marcar(
          admin, clinicId, conversationId, unidadeEmAndamento,
          pacienteDaConsulta, opcoes.telefone, opcoes.nomeDoPerfil, unico,
          opcoes.consultaASubstituir, opcoes.convenioEmAndamento ?? '',
        )
      }
      if (naHora.length === 0) {
        const lista = await perguntarHorario(admin, clinicId, conversationId, unidadeEmAndamento, dias[indice], periodoEscrito(pedido))
        return { ...lista, resposta: `Às ${horaFalada(horaJunto)} não há horário livre nesse dia. ${lista?.resposta ?? ''}` }
      }
      if (geral()) {
        const lista = await perguntarHorario(admin, clinicId, conversationId, unidadeEmAndamento, dias[indice], periodoEscrito(pedido))
        const perto = emLista(naHora.map((h) => formatarHora(h.inicio, fuso)))
        return { ...lista, resposta: `Às ${horaFalada(horaJunto)} em ponto não há horário nesse dia; o mais perto é ${perto}. Responda com o horário, ou com o número da lista.\n\n${lista?.resposta ?? ''}` }
      }
    }
    // "Segunda de manha" (16/10/2026, painel): o periodo vai junto, e o dia
    // que nao tem esse periodo diz isso. Ver perguntarHorario.
    return await perguntarHorario(
      admin,
      clinicId,
      conversationId,
      unidadeEmAndamento,
      dias[indice],
      periodoEscrito(pedido),
    )
  }

  // ---- Escolha do horario ----
  if (estadoAtual === 'aguardando_horario') {
    // Antes da hora escrita: "vou manter a das 8 mesmo" e desistencia, e lida
    // como hora trocaria a consulta (ver desistiuComCerteza).
    if (desistiuComCerteza(texto)) {
      return await sairDoAgendamento(admin, conversationId, clinicId, opcoes.consultaASubstituir ?? null, opcoes.consultas)
    }
    // Mesma troca de unidade do passo do dia (ver trocaDeUnidade).
    {
      if (pediuOutraUnidade(texto)) return await perguntarUnidade(admin, clinicId, conversationId)
      const outraUnidade = await trocaDeUnidade(admin, clinicId, texto)
      if (outraUnidade && outraUnidade.id !== unidadeEmAndamento) return await perguntarConvenioOuDia(admin, clinicId, conversationId, outraUnidade)
    }
    if (pediuVoltar(texto)) {
      if (!unidadeEmAndamento) {
        return await perguntarUnidade(admin, clinicId, conversationId)
      }
      const unidade = await unidadePorId(admin, unidadeEmAndamento)
      if (!unidade) return await perguntarUnidade(admin, clinicId, conversationId)
      return await perguntarDia(admin, clinicId, conversationId, unidade)
    }

    // "17:20 nao da pra mim, deixa" (16/10/2026, painel) saia marcado as 17:20.
    // O que vale e o que vem depois da recusa: sem nada depois, nada e marcado.
    // Ver recusaDeEscolha.
    const recusa = recusaDeEscolha(texto)
    const pedido = recusa ? recusa.depois : texto
    if (recusa && !horaEscrita(pedido) && !periodoEscrito(pedido) && !dataEscrita(pedido)) {
      if (encerrouComARecusa(texto)) {
        return await sairDoAgendamento(admin, conversationId, clinicId, opcoes.consultaASubstituir ?? null, opcoes.consultas)
      }
      return {
        resposta:
          'Tudo bem, não marquei esse horário. Escolha outro da lista acima, escreva o horário que fica melhor, ' +
          'ou digite VOLTAR para ver outros dias.',
      }
    }

    const timezoneDaClinica = await fusoDaClinica(admin, clinicId)
    // O dia inteiro, e nao so os horarios da lista (16/10/2026): "tem as 16h?"
    // num dia de doze horarios procurava so nos oito primeiros. O dia e o dos
    // horarios da lista, quando e um so (a lista de sugestoes do cancelamento
    // pode ter dias diferentes).
    const lista = Array.isArray(opcoes.opcoesAtuais) ? (opcoes.opcoesAtuais as Horario[]) : []
    const diasDaLista = [...new Set(lista.map((h) => chaveDoDia(h.inicio, timezoneDaClinica)))]
    const diaInteiro = diasDaLista.length === 1 ? diasDaLista[0] : null
    const todosDoDia = async (): Promise<Horario[]> => {
      if (!diaInteiro || !unidadeEmAndamento) return lista
      const { horarios } = await horariosLivres(admin, clinicId, unidadeEmAndamento)
      const doDia = horarios.filter((h) => chaveDoDia(h.inicio, timezoneDaClinica) === diaInteiro)
      return doDia.length > 0 ? doDia : lista
    }

    // Hora escrita vem antes do indice, e nao depois: num dia com dez ou mais
    // horarios, "10h" tambem e um indice valido - e apontaria para outra hora.
    const pedida = horaEscrita(pedido)
    if (pedida) {
      // "Depois das 16h" (ver limiteDaHora): os horarios do limite, e nao o das 16h.
      const limite = limiteDaHora(pedido)
      if (limite) return { resposta: textoDoLimite(await todosDoDia(), pedida, limite, timezoneDaClinica) }
      const timezone = timezoneDaClinica
      const naHora = (h: Horario) => {
        const [hh, mm] = formatarHora(h.inicio, timezone).split(':').map(Number)
        return hh === pedida.hora && (pedida.minuto === null || mm === pedida.minuto)
      }
      let daHora = lista.filter(naHora)
      if (daHora.length === 0) daHora = (await todosDoDia()).filter(naHora)

      // "8h", "14 horas": a hora cheia, quando existe (14/10/2026). Perguntar
      // "temos 14:00 e 14:40" a quem disse "14 horas" era um passo a toa - so
      // quem disse "10h" para um dia de 10:00 e 10:40 sem 10:00 ainda escolhe.
      const cheia = pedida.minuto === null ? daHora.filter((h) => formatarHora(h.inicio, timezone).endsWith(':00')) : []
      if (cheia.length === 1) daHora.splice(0, daHora.length, cheia[0])

      // "15h" num dia que so tem 15:20 (rodada 3 do painel): pergunta, em vez
      // de marcar 15:20 sem a pessoa saber.
      if (geral() && pedida.minuto === null && cheia.length === 0 && daHora.length === 1) {
        const perto = formatarHora(daHora[0].inicio, timezone)
        return { resposta: `Às ${horaFalada(pedida)} em ponto não há horário nesse dia; o mais perto é ${perto}. Responda ${perto} para marcar, ou escolha outro da lista acima.` }
      }
      if (daHora.length === 1) {
        if (!unidadeEmAndamento) {
          return await mostrarMenu(admin, conversationId, saudacao, 'Perdi o fio da conversa, desculpe. Vamos recomeçar:')
        }
        return await marcar(
          admin, clinicId, conversationId, unidadeEmAndamento,
          pacienteDaConsulta, opcoes.telefone, opcoes.nomeDoPerfil, daHora[0],
          opcoes.consultaASubstituir, opcoes.convenioEmAndamento ?? '',
        )
      }

      // Ambiguidade de "10h" e entre 10:00 e 10:40, e nao entre os quinze do
      // dia. Repetir a lista inteira aqui empurraria de volta o trabalho que a
      // pessoa ja tinha feito.
      if (daHora.length > 1) {
        const opcoesHora = daHora.map((h) => formatarHora(h.inicio, timezone))
        return {
          resposta:
            `Nesse horário temos ${opcoesHora.slice(0, -1).join(', ')} e ${opcoesHora.at(-1)}.\n\n` +
            'Responda com o horário exato, ou com o número da lista acima.',
        }
      }

      // Os que nao couberam na lista tambem aparecem, para serem escritos.
      const foraDaLista = (await todosDoDia())
        .filter((h) => !lista.some((l) => l.inicio === h.inicio))
        .map((h) => formatarHora(h.inicio, timezone))
      const linhas = lista
        .map((h, i) => `${i + 1} - ${formatarHora(h.inicio, timezone)}`)
        .join('\n')
      return {
        resposta:
          'Esse horário não está entre os livres deste dia.' +
          (linhas ? ` Os disponíveis são:\n\n${linhas}` : '') +
          (foraDaLista.length ? `\n\n${linhas ? 'Também há' : 'Os livres são'}: ${foraDaLista.join(', ')} (escreva o horário).` : '') +
          '\n\nResponda com o número ou o horário, ou digite VOLTAR para escolher outro dia.',
      }
    }

    // "Nao tem de manha?", "tem a tarde?" (16/10/2026, painel): o periodo do
    // mesmo dia, ou os dias que tem esse periodo. Ver perguntarHorario.
    const periodoPedido = periodoEscrito(pedido)
    if (periodoPedido && diaInteiro && unidadeEmAndamento && (parecePergunta(texto) || recusa || normalizar(texto).split(/\s+/).length <= 4)) {
      return await perguntarHorario(admin, clinicId, conversationId, unidadeEmAndamento, diaInteiro, periodoPedido)
    }

    // "Nao tem antes?", "hj nao da?" (16/10/2026, painel). Ver informarMaisCedo.
    {
      const quando = perguntouMaisCedo(texto)
      if (quando && unidadeEmAndamento && unidadeEmAndamento !== TELE_ID) {
        const info = await informarMaisCedo(admin, clinicId, unidadeEmAndamento, quando, agora)
        if (info) return { resposta: `${info}\n\nResponda com o número de um horário da lista acima, ou digite VOLTAR para ver os dias.` }
      }
    }

    // Mudou de ideia sobre o DIA, ja estando na lista de horarios.
    //
    // Caso real de 22/09/2026: a mae via os horarios de 09/10 e tocou em
    // "sexta, 02/10" na lista de datas da mensagem anterior. O certo e mostrar
    // os horarios de 02/10 - foi isso que ela pediu. Vem depois da hora escrita
    // de proposito: "09/10 as 10h" e pedido de HORARIO, e ja foi tratado acima.
    //
    // O dia e procurado entre os horarios livres, e nao montado da data: assim
    // nao ha ano para adivinhar, e um dia sem vaga responde que nao tem vaga.
    const outroDia = dataEscrita(pedido)
    if (outroDia && unidadeEmAndamento) {
      // Mesmo cuidado do passo do dia: outro dia, so dentro do prazo do
      // retorno (26/10/2026).
      const depoisDoPrazo = await dataDepoisDoPrazo(admin, clinicId, conversationId, pedido, agora)
      if (depoisDoPrazo) return depoisDoPrazo
      const timezone = await fusoDaClinica(admin, clinicId)
      const { horarios } = await horariosLivres(admin, clinicId, unidadeEmAndamento)
      const chave = horarios
        .map((h) => chaveDoDia(h.inicio, timezone))
        .find((c) => {
          const [, mes, dia] = c.split('-').map(Number)
          return dia === outroDia.dia && mes === outroDia.mes
        })
      if (chave) {
        return await perguntarHorario(admin, clinicId, conversationId, unidadeEmAndamento, chave)
      }
      const dd = String(outroDia.dia).padStart(2, '0')
      const mm = String(outroDia.mes).padStart(2, '0')
      return {
        resposta:
          `Não há horários livres em ${dd}/${mm}.\n\n` +
          'Responda com o número de um horário da lista acima, ou digite VOLTAR para ver os dias disponíveis.',
      }
    }

    // A troca de dia escrita como se fala (16/10/2026, painel): "nao, eu falei
    // dia 23", "quinta 22", "sexta". Ver diaPeloNome.
    {
      const t = normalizar(pedido)
      const citaDia = /\bdia\s+\d{1,2}\b/.test(t) || /\bamanha\b/.test(t) || DIAS_DA_SEMANA.some((d) => new RegExp(`\\b${d}\\b`).test(t))
      if (citaDia && unidadeEmAndamento) {
        const { horarios } = await horariosLivres(admin, clinicId, unidadeEmAndamento)
        const dias = agruparPorDia(horarios, timezoneDaClinica).map((d) => d.chave)
        const qual = diaPeloNome(pedido, dias, agora)
        if (qual >= 0 && dias[qual] !== diaInteiro) {
          // O dia pelo nome vem da agenda inteira: depois do prazo do retorno,
          // explica (26/10/2026).
          const retorno = await retornoEmAberto(admin, clinicId, conversationId)
          if (retorno && dias[qual] > retorno.ate) {
            return await explicarOuPassarORetorno(admin, clinicId, conversationId, foraDoPrazoDoRetorno(retorno))
          }
          return await perguntarHorario(admin, clinicId, conversationId, unidadeEmAndamento, dias[qual], periodoEscrito(pedido))
        }
      }
    }

    // "10" numa lista de seis horarios (16/10/2026, painel): nao e item da
    // lista, e a hora. Numero que e item continua sendo item.
    {
      const n = normalizar(pedido).match(/^(?:as\s+)?(\d{1,2})$/)
      if (n && Number(n[1]) > lista.length && Number(n[1]) <= 23 && unidadeEmAndamento) {
        const naHora = (await todosDoDia()).filter((h) => Number(formatarHora(h.inicio, timezoneDaClinica).slice(0, 2)) === Number(n[1]))
        const cheia = naHora.filter((h) => formatarHora(h.inicio, timezoneDaClinica).endsWith(':00'))
        const unico = cheia.length === 1 ? cheia[0] : naHora.length === 1 && !geral() ? naHora[0] : null
        if (geral() && !unico && naHora.length > 0) {
          const perto = emLista(naHora.map((h) => formatarHora(h.inicio, timezoneDaClinica)))
          return { resposta: `Às ${Number(n[1])}h em ponto não há horário nesse dia; o mais perto é ${perto}. Responda com o horário, ou escolha outro da lista acima.` }
        }
        if (unico) {
          return await marcar(
            admin, clinicId, conversationId, unidadeEmAndamento,
            pacienteDaConsulta, opcoes.telefone, opcoes.nomeDoPerfil, unico,
            opcoes.consultaASubstituir, opcoes.convenioEmAndamento ?? '',
          )
        }
      }
    }

    let indice = escolha(pedido, lista.length)
    if (indice === null && lista.length > 0 && qualquerUm(pedido)) indice = 0
    // "Pode ser o ultimo horario" (rodada 3 do painel) recebeu o resumo da
    // agenda inteira: e o ultimo da lista.
    if (
      indice === null && lista.length > 0 &&
      /^((pode ser|quero|prefiro|me ve|entao|ok|sim|beleza|blz|marca|pode marcar)\s+)*(o |a )?(ultimo|ultima)( horario| vaga| da lista| do dia| da tarde| mesmo| que tiver)*$/.test(normalizar(pedido).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim())
    ) {
      indice = lista.length - 1
    }
    if (indice === null) {
      if (desistiuDoAgendamento(texto)) {
        return await sairDoAgendamento(admin, conversationId, clinicId, opcoes.consultaASubstituir ?? null, opcoes.consultas)
      }
      return {
        resposta: await naoEntendi(
          admin,
          clinicId,
          texto,
          'Responda com o número do horário da lista acima.\n' +
            'Digite VOLTAR para escolher outro dia, ou 0 para o início.',
        ),
      }
    }
    if (!unidadeEmAndamento) {
      return await mostrarMenu(
        admin,
        conversationId,
        saudacao,
        'Perdi o fio da conversa, desculpe. Vamos recomeçar:',
      )
    }
    return await marcar(
      admin,
      clinicId,
      conversationId,
      unidadeEmAndamento,
      pacienteDaConsulta,
      opcoes.telefone,
      opcoes.nomeDoPerfil,
      lista[indice],
      opcoes.consultaASubstituir,
      opcoes.convenioEmAndamento ?? '',
    )
  }

  return null
}
