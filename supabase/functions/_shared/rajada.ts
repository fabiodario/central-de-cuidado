/**
 * Mensagens em rajada: a segunda espera a resposta da primeira (01/10/2026).
 *
 * O caso, 30/09/2026: uma mae mandou "preciso da nota fiscal" e, dois
 * segundos depois, "Seria possivel enviar?". A Meta entrega cada mensagem num
 * webhook separado, e os dois rodaram AO MESMO TEMPO. O primeiro registrou o
 * pedido de nota e pediu nome e data; o segundo leu a conversa antes disso,
 * achou que era a primeira mensagem e mandou o menu inteiro por cima - o que
 * apagou a etapa da nota. Ela mandou o nome e a data, como pedido, e ouviu
 * "Nao consegui entender por aqui"; depois recebeu "Estou direcionando voce"
 * duas vezes.
 *
 * A regra: se a ultima mensagem da conversa e da familia, chegou ha pouco,
 * ainda nao teve resposta E e um pedido de nota fiscal, quem chegou agora
 * espera essa resposta sair (ate um limite) e so entao le a conversa.
 *
 * Ate 14/10/2026 era so nota fiscal (decisao de 01/10: o atraso ficava
 * restrito ao caso que tinha acontecido). Entre 13 e 14/10 as outras rajadas
 * deram problema tres vezes: "boa tarde!" + "Tudo bem?" recebeu dois menus
 * (Vicente), a frase do site + "?" recebeu a agenda e o menu (Viviane), e duas
 * linhas soltas receberam "Nao entendi" e "passei para a equipe" (Isabelle).
 * O webhook agora espera em qualquer rajada (motivo = sempre), e o segundo
 * pedaco que e so cumprimento ou pontuacao nem recebe resposta: ver
 * complementoDaRajada e rajadaJaRespondida, abaixo.
 *
 * Regra pura, sem banco, para o teste cobrir (tests/rajada.test.mjs).
 */

export type UltimaMensagem = {
  direction: 'inbound' | 'outbound'
  /** Quando foi gravada (created_at). */
  criadaEm: string
  /** O que a familia escreveu. */
  corpo?: string | null
}

/** Mensagem da familia mais velha que isto nao conta como rajada. */
export const JANELA_DA_RAJADA_MS = 10_000
/** Quanto a segunda mensagem aceita esperar pela resposta da primeira. */
export const ESPERA_MAXIMA_MS = 6_000

export function precisaEsperar(
  ultima: UltimaMensagem | null,
  agora: number,
  /** Que mensagem anterior justifica esperar (hoje: pedido de nota fiscal). */
  motivo: (corpo: string) => boolean,
): boolean {
  if (!ultima) return false
  // Ja respondemos (robo ou equipe): a conversa esta em dia.
  if (ultima.direction !== 'inbound') return false
  const idade = agora - new Date(ultima.criadaEm).getTime()
  // Futuro (relogio torto) ou antiga: nao e rajada. Uma mensagem de horas
  // atras sem resposta e conversa parada, e esperar por ela seria atrasar a
  // familia a toa.
  if (idade < 0 || idade >= JANELA_DA_RAJADA_MS) return false
  return motivo(String(ultima.corpo ?? ''))
}

/** Qualquer mensagem anterior justifica esperar (14/10/2026). */
export const qualquerMensagem = () => true

const CUMPRIMENTO = new Set([
  'oi', 'oie', 'ola', 'opa', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'como', 'vai', 'e',
  'ai', 'td', 'tb', 'tbm', 'tambem', 'pessoal', 'doutor', 'dr', 'ok', 'certo',
])

/**
 * O segundo pedaco de uma rajada que nao pede nada: "?", "Tudo bem?",
 * "boa tarde!", um emoji. Responder a ele e mandar o menu (ou o "Nao
 * entendi") de novo, logo abaixo da resposta que acabou de sair.
 */
export function complementoDaRajada(texto: string): boolean {
  // Numero e escolha ("2", "1"), nunca enfeite.
  if (/\d/.test(texto)) return false
  const t = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
  if (!t) return true
  return t.split(/\s+/).every((palavra) => CUMPRIMENTO.has(palavra))
}

export type MensagemRecente = {
  direction: 'inbound' | 'outbound'
  automatic?: boolean | null
  criadaEm: string
}

/**
 * A mensagem anterior da familia, de segundos atras, ja recebeu resposta do
 * robo? `recentes` vem da mais nova para a mais antiga e NAO inclui a mensagem
 * que acabou de chegar (o webhook le antes de grava-la).
 */
export function rajadaJaRespondida(recentes: MensagemRecente[], agora: number): boolean {
  const resposta = recentes.findIndex((m) => m.direction === 'outbound')
  if (resposta !== 0 || !recentes[0].automatic) return false
  const pergunta = recentes.slice(1).find((m) => m.direction === 'inbound')
  if (!pergunta) return false
  const idade = agora - new Date(pergunta.criadaEm).getTime()
  return idade >= 0 && idade < JANELA_DA_RAJADA_MS
}

/**
 * A mensagem anterior desta pessoa ainda esta sendo atendida? (24/10/2026)
 *
 * O caso, no sistema do Dr. Marcello: "Ah infelizmente so consigo passar pelo convenio" e,
 * tres segundos depois, "Mas obrigada". Cada webhook leva 5 a 6 segundos entre
 * chegar e GRAVAR a mensagem (le paciente, agenda, conversa), e a espera da
 * rajada acima so enxerga mensagem gravada. A segunda chegou quando a primeira
 * ainda nao estava no banco, nao esperou nada, e as duas foram a IA ao mesmo
 * tempo: saiu a mesma explicacao do reembolso duas vezes, com 1 s de
 * diferenca, e "Mas obrigada" (fechamento) nem devia ter resposta.
 *
 * O registro de eventos do webhook (whatsapp_webhook_events) e gravado logo na
 * chegada e ganha concluded_at quando a resposta ja saiu. Entao: se ha um
 * evento de mensagem desta mesma pessoa registrado ANTES do meu (id menor) e
 * ainda sem conclusao, espero ele terminar, e so depois leio a conversa - que
 * ja tem a mensagem anterior E a resposta dela.
 *
 * Evento de uma execucao que morreu fica sem conclusao para sempre: por isso
 * a espera tem limite (ESPERA_PELA_ANTERIOR_MS) e o webhook so olha eventos
 * recentes (JANELA_DA_FILA_MS).
 */
export type EventoDeMensagem = { id: number; chave: string; concluidoEm: string | null }

/** Quanto a mensagem espera a anterior terminar. O atendimento com IA leva ate ~12 s do registro a conclusao. */
export const ESPERA_PELA_ANTERIOR_MS = 20_000
/** So conta como fila evento registrado neste intervalo. */
export const JANELA_DA_FILA_MS = 60_000

export function anteriorEmCurso(eventos: EventoDeMensagem[], minhaChave: string): boolean {
  const minha = eventos.find((e) => e.chave === minhaChave)
  // Sem o meu registro na lista (consulta atrasada, chave diferente), nao ha
  // como saber quem veio antes: segue como antes.
  if (!minha) return false
  return eventos.some((e) => e.chave !== minhaChave && e.id < minha.id && !e.concluidoEm)
}
