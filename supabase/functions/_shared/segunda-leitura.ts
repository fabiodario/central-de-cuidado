/**
 * Segunda leitura das mensagens pelo Jev, da TypeSafe AI (17/10/2026, prototipo).
 *
 * O robo e regra de texto. O painel de pacientes simulados de 16/10/2026 achou,
 * a cada rodada, urgencia escrita de um jeito que a regra nao lia: na rodada 3,
 * "to operado do septo, ta saindo coagulo e to cuspindo vermelho" e "chiadinho
 * no peito e bem cansado" (bebe de 8 meses). Cada uma virou teste, mas a
 * proxima vem com outras palavras: num conjunto novo de 80 urgencias escritas
 * em 17/10/2026, a regra leu 53, e as outras 27 receberam propaganda,
 * "atende criancas e adultos" ou o menu, sem os botoes de urgencia.
 *
 * O Jev nao escreve texto: responde uma pergunta fechada ("a pessoa descreve
 * um problema de saude que precisa de atendimento agora?") com a probabilidade
 * do sim. Medicao em ../jev-medicao (fora do repositorio): com as duas leituras
 * abaixo e os limiares daqui, pegou todas as urgencias do painel e do conjunto
 * novo, e acendeu 1 de 766 mensagens comuns (no limiar dos botoes).
 *
 * Regra assimetrica: o Jev so acrescenta cuidado.
 *  - Nao roda quando a regra ja acendeu a urgencia, nem quando a conversa ja
 *    esta em urgencia: nunca tira o que a regra pegou.
 *  - Nao muda a resposta do robo, nao marca consulta, nao escreve nada: pode
 *    mandar a pergunta com os dois botoes que o robo ja usa quando nao entende
 *    (Urgencia e Duvida), e acender a conversa como urgencia, o que manda a
 *    notificacao ao celular do Dr. Fabio e da Dayane.
 *  - Qualquer falha (chave desligada, sem chave, tempo esgotado, erro da API)
 *    deixa o robo exatamente como hoje.
 *
 * DESLIGADA por padrao. O segredo JEV_SEGUNDA_LEITURA das Edge Functions liga:
 *   sombra  le e registra a nota em whatsapp_bot_events, sem mudar nada;
 *   ligada  le, registra e age.
 * Com paciente de verdade, so depois de: contrato de tratamento de dados com
 * retencao zero (a TypeSafe so oferece a cliente empresarial), texto na
 * politica de privacidade e o OK do Dr. Fabio, porque e dado de saude indo
 * para servidor nos Estados Unidos (LGPD). Isso vale tambem para o modo sombra.
 */

export type ModoDaSegundaLeitura = 'desligada' | 'sombra' | 'ligada'

/** O modo vem do segredo; sem a chave da TypeSafe, desligada. */
export function modoDaSegundaLeitura(valor: string | null | undefined, chave: string | null | undefined): ModoDaSegundaLeitura {
  if (!String(chave ?? '').trim()) return 'desligada'
  const v = String(valor ?? '').trim().toLowerCase()
  return v === 'ligada' || v === 'sombra' ? v : 'desligada'
}

/**
 * Os numeros que a medicao de 17/10/2026 escolheu. Mudar qualquer um pede
 * medir de novo (node medir.mjs e analisar.mjs, em ../jev-medicao).
 */
export const SEGUNDA_LEITURA = {
  // Versao fixa: o apelido jev-latest muda sozinho quando sai versao nova, e
  // os limiares foram medidos nesta.
  modelo: 'jev-1.13.0',
  // Botoes: a urgencia mais fraca do painel ficou em 0,35 e a do conjunto
  // novo em 0,28; nenhuma mensagem comum passou de 0,25 (uma de 766 chegou a
  // 0,20). O alarme falso aqui custa pouco: a pessoa ve a pergunta e segue.
  limiarBotoes: 0.2,
  // Urgencia para a equipe (notificacao no celular): nenhuma mensagem comum
  // nem queixa de consulta chegou a 0,5 em nenhum conjunto medido. A zona
  // cinza chega (pus no ouvido com dor forte, 0,81 na rodada 4 do painel).
  limiarUrgencia: 0.5,
  // As duas chamadas vao juntas. Mediana medida: 0,25 s; a mais lenta, 0,36 s.
  tempoLimiteMs: 1500,
  // So o comeco da ultima resposta do robo: a documentacao do Jev pede estado
  // curto, e o que importa ("procure o pronto-socorro") vem no comeco.
  maximoDaUltimaResposta: 400,
  endereco: 'https://api.typesafe.ai/v1/systemone',
}

/** Os mesmos botoes do "nao entendi" do motor (BOTOES_URGENCIA_OU_DUVIDA em atendimento.ts). */
export const BOTOES_URGENCIA_OU_DUVIDA = [
  { id: 'URGENCIA', titulo: '🚨 Urgência' },
  { id: 'E_DUVIDA', titulo: '💬 Dúvida' },
]
export const PERGUNTA_URGENCIA_OU_DUVIDA = 'É uma *urgência* ou uma *dúvida*? Toque abaixo.'

// A pergunta, palavra por palavra como foi medida (urg_pt_crit em
// ../jev-medicao/perguntas.mjs). Outra redacao e outra medicao.
const PERGUNTA = 'A pessoa descreve, na `mensagem`, um problema de saúde que precisa de atendimento agora?'
const CONTEXTO =
  'As `mensagens_anteriores` são da mesma pessoa, na mesma conversa, antes da `mensagem`. ' +
  'A `ultima_resposta_do_robo` é o que ela leu antes de escrever. Use as duas só para entender a `mensagem`.'
const CRITERIO = {
  true:
    'Problema de saúde que pede pronto-socorro ou atendimento hoje, ou pedido de socorro ou de pronto-socorro. ' +
    'Exemplos: sangramento, falta de ar, objeto preso no nariz, no ouvido ou na garganta, perda súbita da audição, ' +
    'tontura forte com vômito, não conseguir engolir, rosto paralisado, bebê cansado ou molinho, febre alta depois de cirurgia.',
  false:
    'Assunto que pode esperar a consulta, ou que não é de saúde: marcar, remarcar ou cancelar consulta, convênio, preço, ' +
    'endereço, horário, dados da ficha, ou queixa de sempre (ronco, rinite, sinusite de repetição, zumbido antigo, ' +
    'nariz entupido há semanas).',
}

export function perguntaDaLeitura(comContexto: boolean) {
  return {
    urgencia: {
      type: 'noul',
      instructions: comContexto ? { pergunta: PERGUNTA, contexto: CONTEXTO } : PERGUNTA,
      criteria: CRITERIO,
    },
  }
}

/** Mensagem escrita, com letra, numa conversa que ainda nao e de urgencia. Toque em botao o robo ja sabe o que e. */
export function precisaDeLeitura(texto: string, foiToque: boolean, motivoDaAtencao: string | null | undefined): boolean {
  if (foiToque || !/\p{L}/u.test(texto ?? '')) return false
  return motivoDaAtencao !== 'urgencia' && motivoDaAtencao !== 'sangramento'
}

export type MensagemDoHistorico = { direction: string; body: string | null; automatic?: boolean | null }

/**
 * O contexto como foi medido: as 3 mensagens anteriores da pessoa e a ultima
 * resposta que ela leu. `historico` vem da mais recente para a mais antiga,
 * sem a mensagem de agora.
 */
export function contextoDaLeitura(historico: MensagemDoHistorico[]): { anteriores: string[]; ultimaDoRobo: string } {
  const anteriores: string[] = []
  let ultimaDoRobo = ''
  for (const m of historico) {
    const corpo = String(m.body ?? '').trim()
    if (!corpo) continue
    if (m.direction === 'inbound') {
      if (anteriores.length < 3) anteriores.unshift(corpo)
    } else if (!ultimaDoRobo && anteriores.length === 0) {
      ultimaDoRobo = m.automatic === false ? `(a equipe escreveu) ${corpo}` : corpo
    }
  }
  return { anteriores, ultimaDoRobo }
}

export function estadosDaLeitura(texto: string, anteriores: string[], ultimaDoRobo: string) {
  const comContexto: Record<string, unknown> = {}
  if (anteriores.length) comContexto.mensagens_anteriores = anteriores
  if (ultimaDoRobo) {
    const max = SEGUNDA_LEITURA.maximoDaUltimaResposta
    comContexto.ultima_resposta_do_robo = ultimaDoRobo.length > max ? `${ultimaDoRobo.slice(0, max)}...` : ultimaDoRobo
  }
  comContexto.mensagem = texto
  return { sozinha: { mensagem: texto }, comContexto }
}

export type Leitura =
  | { ok: true; nota: number; sozinha: number | null; comContexto: number | null; modelo: string }
  | { ok: false; erro: string }

/**
 * Duas perguntas ao Jev, juntas: a mensagem sozinha e a mensagem com a
 * conversa. Vale a maior nota. Sozinha, "minha mulher ta no trabalho nao
 * tenho como i" e nada; com a conversa (tontura forte e vomito), e urgencia.
 * Com a conversa, "so sexta?? nao tem nada hj? nao consigo engolir" parecia
 * so pressa para marcar (0,19); sozinha, e urgencia (0,83).
 *
 * Nunca lanca erro: falhou, devolve { ok: false } e o robo segue como hoje.
 */
export async function lerComJev(
  entrada: { texto: string; anteriores: string[]; ultimaDoRobo: string },
  opcoes: { chave: string; fetch?: typeof fetch; modelo?: string; tempoLimiteMs?: number },
): Promise<Leitura> {
  const buscar = opcoes.fetch ?? fetch
  const modelo = opcoes.modelo ?? SEGUNDA_LEITURA.modelo
  const controle = new AbortController()
  const relogio = setTimeout(() => controle.abort(), opcoes.tempoLimiteMs ?? SEGUNDA_LEITURA.tempoLimiteMs)
  const estados = estadosDaLeitura(entrada.texto, entrada.anteriores, entrada.ultimaDoRobo)
  async function perguntar(state: unknown, comContexto: boolean): Promise<{ nota: number; modelo: string }> {
    const r = await buscar(SEGUNDA_LEITURA.endereco, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opcoes.chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, model: modelo, questions: perguntaDaLeitura(comContexto) }),
      signal: controle.signal,
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const corpo = await r.json()
    const nota = corpo?.answers?.urgencia?.noul
    if (typeof nota !== 'number' || !Number.isFinite(nota) || nota < 0 || nota > 1) throw new Error('resposta sem nota')
    return { nota, modelo: String(corpo?.model ?? modelo) }
  }
  try {
    const [sozinha, comContexto] = await Promise.allSettled([
      perguntar(estados.sozinha, false),
      perguntar(estados.comContexto, true),
    ])
    const lidas = [sozinha, comContexto].filter((r): r is PromiseFulfilledResult<{ nota: number; modelo: string }> => r.status === 'fulfilled')
    if (lidas.length === 0) {
      const motivo = sozinha.status === 'rejected' ? sozinha.reason : null
      return { ok: false, erro: controle.signal.aborted ? 'tempo esgotado' : String((motivo as Error)?.message ?? motivo ?? 'erro') }
    }
    return {
      ok: true,
      nota: Math.max(...lidas.map((l) => l.value.nota)),
      sozinha: sozinha.status === 'fulfilled' ? sozinha.value.nota : null,
      comContexto: comContexto.status === 'fulfilled' ? comContexto.value.nota : null,
      modelo: lidas[0].value.modelo,
    }
  } catch (erro) {
    return { ok: false, erro: String((erro as Error)?.message ?? erro) }
  } finally {
    clearTimeout(relogio)
  }
}

export type Decisao = {
  /** Mandar, depois da resposta do robo, a pergunta com os botoes Urgencia e Duvida. */
  botoes: boolean
  /** Acender a conversa como urgencia (notificacao no celular da equipe). */
  atencao: 'urgencia' | null
  /** Para whatsapp_bot_events: so a acao e a nota, nunca o que a pessoa escreveu. */
  detalhe: string
}

/**
 * O que fazer com a leitura. Funcao pura: o webhook e o simulador usam a mesma.
 *
 * `motivoDoRobo` e o motivo de atencao que a regra devolveu nesta mensagem;
 * `roboRespondeu` e falso quando o robo calou (a equipe esta conversando);
 * `jaTemBotaoDeUrgencia` e verdadeiro quando a resposta do robo ja traz o
 * botao de urgencia (o "nao entendi" do motor), para nao perguntar duas vezes.
 */
export function decidirSegundaLeitura(
  leitura: Leitura | null,
  situacao: { modo: ModoDaSegundaLeitura; motivoDoRobo: string | null | undefined; roboRespondeu: boolean; jaTemBotaoDeUrgencia: boolean },
): Decisao {
  const nada = (detalhe: string): Decisao => ({ botoes: false, atencao: null, detalhe })
  if (!leitura || situacao.modo === 'desligada') return nada('desligada')
  if (!leitura.ok) return nada(`falhou: ${leitura.erro}`.slice(0, 120))
  const nota = leitura.nota.toFixed(2)
  if (situacao.modo === 'sombra') return nada(`sombra ${nota} ${leitura.modelo}`)
  // A regra ja acendeu: ela manda, e a leitura so fica registrada para comparar.
  if (situacao.motivoDoRobo === 'urgencia' || situacao.motivoDoRobo === 'sangramento') return nada(`regra ${nota} ${leitura.modelo}`)
  const podeMandarBotoes = situacao.roboRespondeu && !situacao.jaTemBotaoDeUrgencia
  if (leitura.nota >= SEGUNDA_LEITURA.limiarUrgencia) {
    return { botoes: podeMandarBotoes, atencao: 'urgencia', detalhe: `urgencia ${nota} ${leitura.modelo}` }
  }
  if (leitura.nota >= SEGUNDA_LEITURA.limiarBotoes && podeMandarBotoes) {
    return { botoes: true, atencao: null, detalhe: `botoes ${nota} ${leitura.modelo}` }
  }
  return nada(`nada ${nota} ${leitura.modelo}`)
}

/** A resposta do robo ja traz o botao de urgencia? (botoes do "nao entendi", ou a linha de urgencia de uma lista) */
export function temBotaoDeUrgencia(resultado: { botoes?: { id: string }[]; lista?: { linhas: { id: string }[] } } | null | undefined): boolean {
  return Boolean(
    resultado?.botoes?.some((b) => b.id === 'URGENCIA') || resultado?.lista?.linhas?.some((l) => l.id === 'URGENCIA'),
  )
}
