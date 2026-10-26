/**
 * O Jev escolhendo o caminho quando o robo nao entende (26/10/2026).
 *
 * Pedido do Edu: "quero que seja usado a inteligencia do jev para nao deixar
 * nunca o bot travado... quando o robo nao entender, o jev pode entrar e levar
 * p caminho pedido". O robo continua sendo regra de texto; o Jev so entra
 * quando a regra disse "Nao entendi", e responde duas perguntas fechadas numa
 * chamada so, com a conversa como contexto:
 *   assunto  o pedido principal (marcar, remarcar, valor, falar com a equipe...);
 *   opcao    qual opcao da lista que esta valendo a pessoa escolheu, ou nenhuma
 *            ("o primero", "a de santos", "novembro", "zona leste").
 *
 * Quem segue o caminho e o robo: o Jev nao responde nada ao paciente. A opcao
 * vira o numero dela, e o assunto vira uma frase que a regra entende com
 * certeza naquela etapa (rotaDoAssunto), conferida etapa por etapa no
 * simulador. Cancelar e remarcar passam sempre pela confirmacao do robo.
 *
 * Medicao em ../jev-caminho (fora do repositorio): 87 mensagens em que o robo
 * de hoje trava, das rodadas 1 a 5 do painel e de uma sondagem das etapas.
 *  - opcao: nenhuma escolha errada, em nenhuma confianca; 25 de 34 certas
 *    acima de 0,5, e o resto ficou em "nenhuma" (seguro);
 *  - assunto: 98% certo acima de 0,8; mudando de caminho, 21 de 22 (o outro,
 *    discutivel). Entre 0,5 e 0,8 errou 3 de 6: ali o robo pergunta antes.
 *
 * Regra assimetrica, como a segunda leitura: o Jev nunca piora o que existe.
 * Falha, tempo esgotado, nota baixa ou "outro" deixam o "Nao entendi" de
 * sempre. Liga e desliga junto com a segunda leitura (Preferencias).
 */
import type { MensagemDoHistorico, ModoDaSegundaLeitura } from './segunda-leitura.ts'

export const CAMINHO = {
  // Versao fixa: os limiares foram medidos nesta.
  modelo: 'jev-1.13.0',
  limiarOpcao: 0.5,
  limiarSugerirOpcao: 0.2,
  limiarAssunto: 0.8,
  // 0,55, e nao 0,5: na repassagem das rodadas, "eu quero e o Marcelo" (0,52)
  // virava "voce quer ver a sua consulta?".
  limiarSugerirAssunto: 0.55,
  // Uma chamada, depois do robo: so na mensagem que travou. Mediana medida
  // de 0,25 s numa pergunta; com duas, folga.
  tempoLimiteMs: 2500,
  maximoDaUltimaResposta: 400,
  endereco: 'https://api.typesafe.ai/v1/systemone',
}

// As perguntas, palavra por palavra como foram medidas (medir-caminho.mjs).
const CONTEXTO =
  'As `mensagens_anteriores` são da mesma pessoa, na mesma conversa, antes da `mensagem`. ' +
  'A `ultima_resposta_do_robo` é o que ela leu antes de escrever. Use as duas só para entender a `mensagem`.'
const PERGUNTA_ASSUNTO = 'Qual é o pedido principal da pessoa na `mensagem`?'
export const ASSUNTOS = {
  marcar: 'Marcar uma consulta nova, ou continuar o agendamento: unidade, convênio, dia, horário, nome e dados da ficha',
  remarcar: 'Trocar o dia ou o horário de uma consulta já marcada',
  cancelar: 'Desmarcar uma consulta já marcada, ou desistir de marcar',
  ver_consulta: 'Saber se tem consulta marcada e quando é, ou confirmar que vai',
  valor: 'Preço da consulta ou de cirurgia, pagamento, parcelamento, pix',
  convenio: 'Plano de saúde, convênio, carteirinha, reembolso, guia ou encaminhamento',
  endereco_horario: 'Endereço, estacionamento, dias e horários em que o consultório atende',
  documento: '2ª via de receita, pedido de exame, resultado, atestado ou outro documento',
  equipe: 'Quer falar com uma pessoa da equipe, ou pergunta se tem alguém atendendo',
  agradecimento: 'Só agradece, se despede, ou diz que vai aguardar',
  urgencia: 'Problema de saúde que precisa de atendimento agora',
  outro: 'Outra coisa: cumprimento, pergunta fora desta lista, mensagem sem sentido',
} as const
export type Assunto = keyof typeof ASSUNTOS

const PERGUNTA_OPCAO = 'A `mensagem` escolhe uma das opções da lista que o robô mostrou? Qual?'
const NENHUMA =
  'Nenhuma: a mensagem não escolhe uma opção desta lista. Pergunta outra coisa, muda de assunto, ' +
  'manda dado da ficha (nome, data, CPF, e-mail), pede algo que não está na lista, ou não dá para saber qual.'

export type OpcaoDaLista = { numero: string; rotulo: string }

/** O menu do robo (mostrarMenu em atendimento.ts), descrito como foi medido. */
export const MENU_DO_ROBO: OpcaoDaLista[] = [
  { numero: '1', rotulo: 'Dúvidas sobre a consulta: valores, contatos e orientações' },
  { numero: '2', rotulo: 'Marcar uma consulta ou retorno' },
  { numero: '3', rotulo: 'Falar com alguém da equipe' },
  { numero: '4', rotulo: 'Ver, remarcar ou cancelar a minha consulta' },
  { numero: '5', rotulo: '2ª via de receita ou pedido de exame' },
]

/** Etapas em que o robo mostra uma lista numerada e espera o numero. */
const ETAPAS_COM_LISTA = new Set(['aguardando_unidade', 'aguardando_convenio', 'aguardando_dia', 'aguardando_horario', 'aguardando_paciente'])
const ETAPAS_DO_AGENDAMENTO = new Set([...ETAPAS_COM_LISTA])

/** O "Nao entendi" do robo, em qualquer das tres formas, no comeco de uma linha. */
const NAO_ENTENDI = /(^|\n)(Não entendi|🤔 Não consegui entender|Desculpe, não estou conseguindo entender)/

/**
 * O robo travou nesta mensagem? Pelo texto, e nao pelo evento nao_entendi: a
 * funcao naoEntendi registra o evento e muitas vezes responde (resposta
 * pronta, agenda, "estou aqui"). Na repassagem das rodadas do painel com o Jev
 * (26/10/2026), "essas datas sao do Tatuape?" recebeu os enderecos e, logo
 * embaixo, o Jev perguntando "voce quer saber o endereco?".
 */
export function roboTravou(resultado: { resposta?: string } | null | undefined): boolean {
  return Boolean(resultado?.resposta && NAO_ENTENDI.test(resultado.resposta.trim()))
}

/**
 * Quando perguntar ao Jev. Nao na ficha (ela tem a propria segunda chance),
 * nem na fila da equipe, nem em conversa de urgencia: ali quem decide e gente.
 */
export function precisaDoCaminho(situacao: {
  estado: string | null
  foiToque: boolean
  anexo: boolean
  motivoAceso: string | null | undefined
}): boolean {
  if (situacao.foiToque || situacao.anexo) return false
  if (situacao.motivoAceso === 'urgencia' || situacao.motivoAceso === 'sangramento') return false
  const e = situacao.estado
  if (e && (e.startsWith('dados_') || e === 'atendente' || e === 'confirmar_cancelamento')) return false
  return true
}

/** "*3* sexta, 16/10 (manhã)" -> { numero: '3', rotulo: 'sexta, 16/10 (manhã)' } */
export function opcoesNumeradas(texto: string): OpcaoDaLista[] {
  const opcoes: OpcaoDaLista[] = []
  for (const linha of String(texto ?? '').split('\n')) {
    const m = /^\*(\d{1,2})\*\s+(.+)$/.exec(linha.trim())
    if (m) opcoes.push({ numero: m[1], rotulo: m[2].trim() })
  }
  return opcoes
}

/**
 * O contexto da pergunta, como foi medido: ate 4 mensagens anteriores da
 * pessoa, a ultima resposta que ela leu e a lista que esta valendo na etapa
 * (o menu fixo, ou a ultima lista numerada do robo). `historico` vem da mais
 * recente para a mais antiga, sem a mensagem de agora.
 */
export function contextoDoCaminho(
  historico: MensagemDoHistorico[],
  estado: string | null,
): { anteriores: string[]; ultimaDoRobo: string; lista: OpcaoDaLista[] } {
  const anteriores: string[] = []
  let ultimaDoRobo = ''
  let listaVista: OpcaoDaLista[] = []
  for (const m of historico) {
    const corpo = String(m.body ?? '').trim()
    if (!corpo) continue
    if (m.direction === 'inbound') {
      if (anteriores.length < 4) anteriores.unshift(corpo)
    } else {
      if (!ultimaDoRobo && anteriores.length === 0) ultimaDoRobo = corpo
      if (!listaVista.length && m.automatic !== false) listaVista = opcoesNumeradas(corpo)
    }
  }
  const lista = estado === 'menu' || estado === null ? MENU_DO_ROBO : ETAPAS_COM_LISTA.has(estado) ? listaVista : []
  return { anteriores, ultimaDoRobo, lista }
}

export function perguntasDoCaminho(lista: OpcaoDaLista[]) {
  const instrucoes = (pergunta: string) => ({ pergunta, contexto: CONTEXTO })
  const q: Record<string, unknown> = {
    assunto: { type: 'choice', instructions: instrucoes(PERGUNTA_ASSUNTO), criteria: ASSUNTOS },
  }
  if (lista.length) {
    q.opcao = {
      type: 'choice',
      instructions: instrucoes(PERGUNTA_OPCAO),
      criteria: { ...Object.fromEntries(lista.map((o) => [`opcao_${o.numero}`, o.rotulo])), nenhuma: NENHUMA },
    }
  }
  return q
}

export function estadoDoCaminho(entrada: { texto: string; anteriores: string[]; ultimaDoRobo: string }) {
  const estado: Record<string, unknown> = {}
  if (entrada.anteriores.length) estado.mensagens_anteriores = entrada.anteriores.slice(-4)
  if (entrada.ultimaDoRobo) estado.ultima_resposta_do_robo = entrada.ultimaDoRobo.slice(0, CAMINHO.maximoDaUltimaResposta)
  estado.mensagem = entrada.texto
  return estado
}

export type LeituraDoCaminho =
  | { ok: true; assunto: Assunto | null; confAssunto: number; opcao: string | null; confOpcao: number; modelo: string }
  | { ok: false; erro: string }

/** Nunca lanca: falhou, devolve { ok: false } e o "Nao entendi" de sempre segue. */
export async function lerCaminhoComJev(
  entrada: { texto: string; anteriores: string[]; ultimaDoRobo: string; lista: OpcaoDaLista[] },
  opcoes: { chave: string; fetch?: typeof fetch; modelo?: string; tempoLimiteMs?: number },
): Promise<LeituraDoCaminho> {
  if (!String(opcoes.chave ?? '').trim()) return { ok: false, erro: 'sem chave' }
  const buscar = opcoes.fetch ?? fetch
  const modelo = opcoes.modelo ?? CAMINHO.modelo
  const controle = new AbortController()
  const relogio = setTimeout(() => controle.abort(), opcoes.tempoLimiteMs ?? CAMINHO.tempoLimiteMs)
  try {
    const r = await buscar(CAMINHO.endereco, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opcoes.chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: estadoDoCaminho(entrada), model: modelo, questions: perguntasDoCaminho(entrada.lista) }),
      signal: controle.signal,
    })
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` }
    const corpo = await r.json()
    const a = corpo?.answers?.assunto
    const o = corpo?.answers?.opcao
    const conf = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 ? x : null)
    if (!a || typeof a.choice !== 'string' || conf(a.confidence) === null) return { ok: false, erro: 'resposta sem assunto' }
    const assunto = a.choice in ASSUNTOS ? (a.choice as Assunto) : null
    let opcao: string | null = null
    let confOpcao = 0
    if (entrada.lista.length && o && typeof o.choice === 'string' && conf(o.confidence) !== null) {
      opcao = o.choice === 'nenhuma' ? 'nenhuma' : o.choice.replace(/^opcao_/, '')
      confOpcao = o.confidence
    }
    return { ok: true, assunto, confAssunto: a.confidence, opcao, confOpcao, modelo: String(corpo?.model ?? modelo) }
  } catch (erro) {
    return { ok: false, erro: controle.signal.aborted ? 'tempo esgotado' : String((erro as Error)?.message ?? erro) }
  } finally {
    clearTimeout(relogio)
  }
}

/** Para onde o robo vai: a frase que ele entende, na etapa de agora ou a partir do menu. */
export type Rota = { texto: string; doMenu: boolean; rotulo: string; perguntavel: boolean }

/**
 * A frase que leva ao assunto em cada etapa (26/10/2026, conferida no
 * simulador etapa por etapa, ver canonicas.mjs em ../jev-caminho):
 *  - valor, convenio, endereco e equipe respondem em qualquer etapa sem
 *    desmanchar o agendamento: vao na etapa de agora;
 *  - remarcar, cancelar, ver a consulta, documento e marcar so funcionam a
 *    partir do menu: vao por ele. Cancelar e remarcar caem na pergunta de
 *    confirmacao do robo, e nada e desmarcado sem o SIM da pessoa;
 *  - no meio do agendamento, "cancelar" e desistir de marcar (CANCELAR, que o
 *    robo ja le), e "remarcar" na lista de horarios e voltar aos dias.
 * Null: o assunto nao leva a outro caminho ali (marcar no meio do agendamento,
 * urgencia, que e da segunda leitura, e "outro").
 */
export function rotaDoAssunto(assunto: Assunto | null, estado: string | null, temConsulta: boolean, texto = ''): Rota | null {
  const noAgendamento = Boolean(estado && ETAPAS_DO_AGENDAMENTO.has(estado))
  const aqui = (t: string, rotulo: string, perguntavel = true): Rota => ({ texto: t, doMenu: false, rotulo, perguntavel })
  const peloMenu = (t: string, rotulo: string, perguntavel = true): Rota => ({ texto: t, doMenu: true, rotulo, perguntavel })
  switch (assunto) {
    case 'valor':
      return aqui('quanto custa a consulta?', 'saber o valor da consulta')
    case 'convenio':
      return aqui('quais convênios vocês atendem?', 'saber dos convênios atendidos')
    case 'endereco_horario':
      // "Tem de manha em alguma unidade? 8h?" e pergunta de horario: o resumo
      // dos dias e horarios de cada unidade responde (repassagem de 26/10/2026).
      return /\b(hora|horas|horario|horarios|abre|abrem|fecha|fecham|funciona\w*|sabado|domingo|feriado|manha|tarde|noite|cedo)\b|\b\d{1,2}\s*h\b/.test(
        String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
      )
        ? aqui('qual o horário de atendimento?', 'saber os dias e horários de atendimento')
        : aqui('qual o endereço?', 'saber o endereço')
    case 'equipe':
      return aqui('quero falar com alguém da equipe', 'falar com alguém da equipe')
    case 'documento':
      return peloMenu('5', 'pedir a 2ª via de receita ou de pedido de exame')
    case 'ver_consulta':
      return peloMenu('4', 'ver a sua consulta')
    case 'marcar':
      return noAgendamento ? null : peloMenu('2', 'marcar uma consulta')
    case 'remarcar':
      if (noAgendamento) return estado === 'aguardando_horario' ? aqui('VOLTAR', 'escolher outro dia') : null
      return temConsulta ? peloMenu('REMARCAR', 'remarcar a sua consulta') : peloMenu('4', 'ver a sua consulta')
    case 'cancelar':
      if (noAgendamento) return aqui('CANCELAR', 'parar o agendamento')
      return temConsulta ? peloMenu('quero cancelar minha consulta', 'cancelar a sua consulta') : peloMenu('4', 'ver a sua consulta')
    case 'agradecimento':
      // Ninguem pergunta "voce quer agradecer?": so com confianca alta.
      return estado === null || estado === 'menu' || noAgendamento
        ? aqui('obrigado', 'encerrar', false)
        : peloMenu('obrigado', 'encerrar', false)
    default:
      return null
  }
}

/** O botao "Sim" da sugestao leva o que o Jev entendeu: o robo le o id. */
export const PREFIXO_DO_BOTAO = 'JEV:'

export type DecisaoDoCaminho =
  | { acao: 'seguir'; texto: string; doMenu: boolean; detalhe: string }
  | { acao: 'sugerir'; pergunta: string; botao: { id: string; titulo: string }; detalhe: string }
  | { acao: 'nada'; detalhe: string }

/**
 * O que fazer com a leitura. Funcao pura: o webhook e o simulador usam a mesma.
 * A opcao vem antes do assunto: no menu as duas dizem o mesmo, e nas listas a
 * opcao e a resposta da pergunta que o robo fez.
 */
export function decidirCaminho(
  leitura: LeituraDoCaminho | null,
  situacao: {
    modo: ModoDaSegundaLeitura
    estado: string | null
    lista: OpcaoDaLista[]
    /** Quantas opcoes a etapa guardou (booking_options), contra lista velha no historico. */
    quantasOpcoes: number | null
    temConsulta: boolean
    texto: string
    /**
     * O "Nao entendi" ja chamou a equipe (o de tres palavras ou mais, ou o
     * terceiro seguido). Seguir ainda vale; perguntar, nao: seriam tres
     * mensagens para quem ja vai ser atendido por gente.
     */
    chamouEquipe?: boolean
  },
): DecisaoDoCaminho {
  const nada = (detalhe: string): DecisaoDoCaminho => ({ acao: 'nada', detalhe: detalhe.slice(0, 120) })
  if (!leitura || situacao.modo === 'desligada') return nada('desligada')
  if (!leitura.ok) return nada(`falhou: ${leitura.erro}`)
  const opcao = situacao.lista.find((o) => o.numero === leitura.opcao)
  const opcaoValida =
    Boolean(opcao) &&
    (situacao.quantasOpcoes === null || Number(leitura.opcao) <= situacao.quantasOpcoes)
  const rota = rotaDoAssunto(leitura.assunto, situacao.estado, situacao.temConsulta, situacao.texto)
  const n = (x: number) => x.toFixed(2)
  const resumo = `assunto ${leitura.assunto ?? '?'} ${n(leitura.confAssunto)} opcao ${leitura.opcao ?? '-'} ${n(leitura.confOpcao)} ${leitura.modelo}`

  let decisao: DecisaoDoCaminho
  if (opcaoValida && leitura.confOpcao >= CAMINHO.limiarOpcao) {
    decisao = { acao: 'seguir', texto: opcao!.numero, doMenu: false, detalhe: `opcao ${opcao!.numero} ${n(leitura.confOpcao)} ${leitura.modelo}` }
  } else if (rota && leitura.confAssunto >= CAMINHO.limiarAssunto) {
    decisao = { acao: 'seguir', texto: rota.texto, doMenu: rota.doMenu, detalhe: `assunto ${leitura.assunto} ${n(leitura.confAssunto)} ${leitura.modelo}` }
  } else if (situacao.chamouEquipe) {
    return nada(`nada ${resumo}`)
  } else if (opcaoValida && leitura.confOpcao >= CAMINHO.limiarSugerirOpcao) {
    // So o nome da opcao: "Tatuapé · São Paulo", sem o "(18 horários livres)".
    const nome = opcao!.rotulo.replace(/\s*\([^)]*\)\s*$/, '').trim() || opcao!.rotulo
    decisao = {
      acao: 'sugerir',
      pergunta: `Você quis dizer *${nome}*? Se for, toque em Sim.`,
      botao: { id: `${PREFIXO_DO_BOTAO}opcao:${opcao!.numero}`, titulo: 'Sim' },
      detalhe: `sugeriu opcao ${opcao!.numero} ${n(leitura.confOpcao)} ${leitura.modelo}`,
    }
  } else if (rota?.perguntavel && leitura.confAssunto >= CAMINHO.limiarSugerirAssunto) {
    decisao = {
      acao: 'sugerir',
      pergunta: `Você quer ${rota.rotulo}? Se for, toque em Sim.`,
      botao: { id: `${PREFIXO_DO_BOTAO}assunto:${leitura.assunto}`, titulo: 'Sim' },
      detalhe: `sugeriu assunto ${leitura.assunto} ${n(leitura.confAssunto)} ${leitura.modelo}`,
    }
  } else {
    return nada(`nada ${resumo}`)
  }
  // Modo sombra: le e registra o que faria, sem mudar nada para o paciente.
  if (situacao.modo === 'sombra') return nada(`sombra ${decisao.detalhe}`)
  return decisao
}

/**
 * O toque no "Sim" da sugestao, antes do robo: vira a entrada que o Jev tinha
 * entendido. Null quando o id nao e do Jev. Assunto que ali ja nao leva a
 * caminho nenhum (a etapa mudou) volta ao menu.
 */
export function entradaDoBotao(
  id: string,
  estado: string | null,
  temConsulta: boolean,
): { texto: string; doMenu: boolean } | null {
  if (!id.startsWith(PREFIXO_DO_BOTAO)) return null
  const [tipo, valor] = id.slice(PREFIXO_DO_BOTAO.length).split(':')
  if (tipo === 'opcao' && /^\d{1,2}$/.test(valor ?? '')) return { texto: valor, doMenu: false }
  if (tipo === 'assunto' && valor && valor in ASSUNTOS) {
    const rota = rotaDoAssunto(valor as Assunto, estado, temConsulta)
    if (rota) return { texto: rota.texto, doMenu: rota.doMenu }
  }
  return { texto: '0', doMenu: false }
}

/**
 * Os campos da conversa que o "Nao entendi" pode ter mudado (o menu de novo,
 * ou a equipe chamada na terceira vez). Antes de o robo seguir o caminho do
 * Jev, a conversa volta a como estava, ou vai ao menu.
 */
export function estadoParaSeguir(
  antes: { booking_state?: unknown; booking_options?: unknown; booking_unit_id?: unknown; auto_replies_while_waiting?: unknown },
  doMenu: boolean,
): Record<string, unknown> {
  if (doMenu) return { booking_state: 'menu', booking_options: null, booking_unit_id: null }
  return {
    booking_state: antes.booking_state ?? null,
    booking_options: antes.booking_options ?? null,
    booking_unit_id: antes.booking_unit_id ?? null,
    auto_replies_while_waiting: Number(antes.auto_replies_while_waiting ?? 0),
  }
}

/** O detalhe do evento jev_caminho em frase, para o simulador e para a tela. */
export function descreverCaminho(detalhe: string): { texto: string; tom: 'ok' | 'alerta' | 'erro' } {
  const d = String(detalhe ?? '').trim()
  const pct = (x: string | undefined) => (x && /^\d(\.\d+)?$/.test(x) ? `${Math.round(Number(x) * 100)}%` : '?')
  const p = d.split(/\s+/)
  if (d.startsWith('falhou:')) return { texto: `Não consegui perguntar ao Jev (${d.slice(7).trim()}). Ficou o "Não entendi" de sempre.`, tom: 'erro' }
  if (p[0] === 'opcao') return { texto: `O robô não entendeu; o Jev escolheu a opção ${p[1]} (${pct(p[2])}).`, tom: 'ok' }
  if (p[0] === 'assunto') return { texto: `O robô não entendeu; o Jev levou para "${p[1]}" (${pct(p[2])}).`, tom: 'ok' }
  if (p[0] === 'sugeriu') return { texto: `O robô não entendeu; o Jev perguntou se era ${p[1] === 'opcao' ? `a opção ${p[2]}` : `"${p[2]}"`} (${pct(p[3])}).`, tom: 'ok' }
  if (p[0] === 'sombra') return { texto: `Só observando: o Jev faria "${p.slice(1, 3).join(' ')}".`, tom: 'ok' }
  if (p[0] === 'nada') return { texto: 'O robô não entendeu, e o Jev também não teve certeza: ficou o "Não entendi".', tom: 'alerta' }
  if (p[0] === 'desligada') return { texto: 'Desligada.', tom: 'ok' }
  return { texto: d || 'Sem detalhe.', tom: 'ok' }
}
