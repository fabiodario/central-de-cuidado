/**
 * Como ler a resposta de quem recebeu um lembrete de consulta.
 *
 * Isto morava dentro do meta-webhook, misturado com banco e rede, e por isso
 * nunca teve teste. O preco apareceu em 31/08/2026: o Nelson confirmou a
 * consulta, a confirmacao nao chegou na plataforma, e descobrir o porque virou
 * investigacao manual em cima de dados de producao. A regra estava errada num
 * `if` que ninguem conseguia exercitar sem mandar mensagem de verdade.
 *
 * Aqui nao ha banco nem rede: entra contexto, sai decisao. O webhook continua
 * dono de buscar os dados e gravar o resultado.
 */

import { avisoDeHorario } from './expediente.ts'

/** Quanto tempo depois de um envio nosso um numero ainda responde a ele. */
const JANELA_RESPOSTA_MS = 48 * 3600 * 1000
/** Enquanto alguem da equipe estiver conversando, o robo nao interrompe. */
const JANELA_CONVERSA_HUMANA_MS = 12 * 3600 * 1000

export type Resposta = {
  confirma: boolean
  remarca: boolean
  cancela: boolean
  /** Qualquer uma das tres acima. Atalho para o que o webhook faz depois. */
  respondeuLembrete: boolean
  optedOut: boolean
  /**
   * O pedido e para nao receber NADA (15/10/2026): "tirem meu numero", "parem
   * de mandar". Sem isso, o optedOut e so do acompanhamento - o botao "Nao quero
   * receber" e o SAIR, que respondem ao acompanhamento e ouvem "nao enviaremos
   * mais mensagens de acompanhamento". Lembrete de consulta continua saindo.
   */
  paraTudo: boolean
  isWell: boolean
  pediuAjuda: boolean
  /** O que a equipe precisa ver na plataforma, se for o caso. */
  motivoAtencao: 'remarcacao' | 'cancelamento' | 'ajuda' | null
}

export function normalizarResposta(valor: string) {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/**
 * A ultima coisa que NOS mandamos foi um lembrete ou um acompanhamento?
 *
 * So dentro dessa janela "1", "2" e "3" significam confirmar, remarcar e
 * cancelar. Fora dela sao opcoes do menu - e essa ambiguidade e justamente o
 * motivo de a pergunta existir.
 */
export function respondendoEnvioNosso(
  ultimoEnvio: { created_at?: string | null; followup_id?: string | null; appointment_id?: string | null } | null,
  agora = Date.now(),
  /**
   * A consulta da mensagem ainda esta marcada? Falso so quando se sabe que
   * nao (cancelada); desconhecido vale como marcada, o comportamento antigo.
   *
   * Existe por causa do aviso de cancelamento (13/10/2026). Ele e gravado
   * ligado a consulta, e diz "para escolher uma nova data, digite *2*". A
   * Giovana digitou 2 e o robo leu como "remarcar" em resposta a um
   * lembrete - de uma consulta que ele mesmo tinha acabado de avisar que foi
   * cancelada: "essa consulta nao aparece mais como marcada". Consulta
   * cancelada nao se confirma, remarca nem cancela; o numero volta a ser do
   * menu, que e o que o aviso promete.
   */
  consultaAindaMarcada: boolean | null = null,
) {
  if (!ultimoEnvio?.created_at) return false
  if (!ultimoEnvio.followup_id && !ultimoEnvio.appointment_id) return false
  if (ultimoEnvio.appointment_id && !ultimoEnvio.followup_id && consultaAindaMarcada === false) return false
  return agora - new Date(ultimoEnvio.created_at).getTime() < JANELA_RESPOSTA_MS
}

/**
 * A conversa ainda e a do acompanhamento pos-consulta?
 *
 * Diferente de respondendoEnvioNosso, que olha so a ULTIMA mensagem nossa: la,
 * o "Que bom saber!" do robo ja apaga o contexto. Foi o que aconteceu em
 * 03/10/2026 - a familia do Rafael tocou em "Estou bem" e, um minuto depois,
 * escreveu que tinha feito dois dos tres exames e esperava o convenio liberar o
 * terceiro. Para o robo aquilo ja era conversa nova: respondeu "sobre sintomas
 * e remedios eu nao posso orientar" com o menu, e o recado para o medico nao
 * acendeu para ninguem. A Olivia agradeceu ("Obrigada🙏🏻🌹") e recebeu a
 * apresentacao inteira do consultorio.
 *
 * Aqui vale o ACOMPANHAMENTO mais recente (followup_id), dentro de 7 dias.
 * Eram 48h ate 06/10/2026: o pai do Samuel respondeu "Estou bem" tres dias
 * depois do envio e, em seguida, descreveu como estavam as fezes do filho - e
 * recebeu "sobre sintomas eu nao posso orientar", sem ninguem avisado.
 */
export function depoisDoAcompanhamento(
  ultimoAcompanhamento: { created_at?: string | null } | null,
  agora = Date.now(),
) {
  if (!ultimoAcompanhamento?.created_at) return false
  const idade = agora - new Date(ultimoAcompanhamento.created_at).getTime()
  return idade >= 0 && idade < JANELA_DO_ACOMPANHAMENTO_MS
}

/** Familia responde acompanhamento com dias de atraso; o contexto dura uma semana. */
const JANELA_DO_ACOMPANHAMENTO_MS = 7 * 24 * 3600 * 1000

/**
 * Houve lembrete de consulta para esta conversa nas ultimas 48h, mesmo que
 * NAO seja a ultima mensagem nossa (06/10/2026)?
 *
 * O Leandro recebeu o lembrete as 9:20; a equipe escreveu as 16:08; ele
 * respondeu "Confirmado" - e nada aconteceu, porque o lembrete ja nao era a
 * ultima mensagem. A equipe confirmou a mao. Ver interpretarResposta: so a
 * PALAVRA de confirmar usa isto. Numero ("1") e cancelamento continuam
 * exigindo que o lembrete seja a ultima mensagem - "1" pode ser opcao de
 * menu, e cancelar por engano apaga a vaga da familia.
 */
export function lembreteRecente(
  ultimoLembrete: { created_at?: string | null } | null,
  agora = Date.now(),
) {
  if (!ultimoLembrete?.created_at) return false
  const idade = agora - new Date(ultimoLembrete.created_at).getTime()
  return idade >= 0 && idade < JANELA_RESPOSTA_MS
}

/**
 * Alguem da equipe escreveu para esta pessoa ha pouco?
 *
 * A pergunta precisa ser sobre gente. Ate 30/08/2026 ela era so "saiu alguma
 * mensagem daqui?", e o robo se calava por causa da propria voz: respondeu
 * 11:36, a pessoa escreveu "Oi" as 14:28 e nao recebeu nada.
 */
export function equipeFalouRecentemente(
  ultimaHumana: { created_at?: string | null } | null,
  agora = Date.now(),
  /**
   * Quando alguem da equipe apertou "Destravar" (01/10/2026). Destravar e a
   * equipe devolvendo a conversa ao robo: o que ela escreveu ANTES disso deixa
   * de contar. Sem isto o botao limpava a etapa mas o robo seguia calado por
   * ate 12h - o Edu destravou as 23:02, escreveu "Oi" e a conversa acendeu
   * como "Quer falar com a equipe", porque a equipe tinha falado as 16:50.
   */
  roboLiberadoEm: string | null = null,
) {
  if (!ultimaHumana?.created_at) return false
  const falou = new Date(ultimaHumana.created_at).getTime()
  if (roboLiberadoEm && new Date(roboLiberadoEm).getTime() >= falou) return false
  return agora - falou < JANELA_CONVERSA_HUMANA_MS
}

/**
 * A equipe segura o robo nesta mensagem? (26/10/2026, vindo do sistema do
 * Dr. Marcello no mesmo dia)
 *
 * A regra das 12h (equipeFalouRecentemente) existe para o robo nao atropelar a
 * secretaria no meio de uma conversa. La ela fez o contrario: a equipe
 * escreveu "no menu tem as opcoes de data e horario, tente primeiro", a
 * familia tocou numa unidade da lista do robo e o robo ficou calado -
 * "equipe conversando". O Edu: "toque em opcao do robo vence a regra das 12h".
 *
 * Toque numa lista ou botao do proprio robo (tipo interactive) e o paciente
 * pedindo o robo. Texto digitado continua com a regra: "pode confirmar amanha
 * 09h20" depois da secretaria e conversa com ela. Botao de modelo aprovado
 * (tipo button: lembrete, acompanhamento) tambem fica com a regra.
 *
 * Pedido de marcar, remarcar ou cancelar tambem vence (mesmo dia): la, uma
 * familia respondeu "Oi quero marcar" a uma mensagem da equipe e esperou 18
 * minutos ate alguem mandar os horarios a mao. O Edu: "sempre que for um
 * pedido, mesmo que esteja com a solicitacao humana, o robo interpretar e ele
 * mesmo mandar". Quem decide se e pedido e pediuAgendamento e
 * pediuMudarConsulta (atendimento.ts).
 */
export function equipeSeguraORobo(
  equipeFalou: boolean,
  tipoDaMensagem: string | null | undefined,
  pedidoDeAgendamento = false,
): boolean {
  return equipeFalou && tipoDaMensagem !== 'interactive' && !pedidoDeAgendamento
}

/**
 * O que a pessoa quis dizer.
 *
 * `escolhido` e o id do botao quando ela tocou, ou o proprio texto quando ela
 * digitou - os dois entram pelo mesmo caminho de proposito.
 */
export function interpretarResposta(
  escolhido: string,
  dentroDaJanela: boolean,
  /** Lembrete nas ultimas 48h, mesmo que nao seja a ultima mensagem. Ver lembreteRecente. */
  comLembreteRecente = false,
  /**
   * A ultima mensagem nossa foi o LEMBRETE (modelo ligado a uma consulta, sem
   * acompanhamento). Separado de dentroDaJanela, que tambem vale depois do
   * acompanhamento: "sim" ali e "estou bem", nao confirmacao de consulta.
   */
  ultimaFoiLembrete = false,
): Resposta {
  const r = normalizarResposta(escolhido)

  // Palavra CONTIDA na resposta, e nao a resposta inteira.
  //
  // Ate 14/09/2026 a comparacao era exata: valia "confirmar", nao valia
  // "confirmar presenca". Isso amarrava o sistema ao rotulo do botao aprovado na
  // Meta - e o rotulo mora la, nao aqui. Um botao escrito "Confirmar presenca"
  // devolvia exatamente esse texto, nao batia com nada, e a consulta nao era
  // confirmada. Sem erro na tela, sem registro: o paciente tocava em confirmar e
  // para a clinica era como se ele nao tivesse respondido.
  //
  // Com "contem", o mesmo codigo entende o botao curto, o botao longo e a pessoa
  // que digitou "quero confirmar minha consulta". Trocar o texto do botao na
  // Meta deixa de ser uma mudanca que quebra o sistema em silencio.
  const tem = (...palavras: string[]) => palavras.some((p) => r.includes(p))

  // A palavra aparece SEM um "nao" mandando nela.
  //
  // "Nao posso confirmar", "nao quero cancelar": a negacao inverte o sentido, e
  // e melhor cair no atendimento humano do que confirmar uma consulta que a
  // pessoa acabou de dizer que nao vai comparecer.
  //
  // Ate 22/09/2026 bastava um "nao" em QUALQUER lugar da mensagem para anular
  // tudo. Uma mae escreveu "vou precisar reagendar a consulta, pois nao
  // consegui leva-la para fazer os exames" - o "nao"
  // era da explicacao, nao do pedido. O robo descartou o reagendamento, ficou
  // calado, e o pedido se perdeu.
  //
  // Agora o "nao" so vale se estiver na mesma oracao (sem virgula ou ponto no
  // meio) e ate tres palavras antes. Cobre "nao posso confirmar" e "nao vou
  // conseguir remarcar", e deixa passar "nao, quero confirmar" e o "nao" que
  // vem depois do pedido.
  const semNegacao = (...palavras: string[]) =>
    palavras.some((palavra) => {
      let desde = 0
      for (;;) {
        const pos = r.indexOf(palavra, desde)
        if (pos < 0) return false
        const oracao = r.slice(0, pos).split(/[,.;!?\n]/).pop() ?? ''
        const antes = oracao.trim().split(/\s+/).filter(Boolean).slice(-3)
        if (!antes.includes('nao')) return true
        desde = pos + palavra.length
      }
    })

  // "Nao sei se vou conseguir confirmar" tem o "nao" longe demais da palavra
  // para a regra acima pegar, e mesmo assim nao e confirmacao. Duvida declarada
  // nunca confirma nem cancela sozinha - cancelar apaga a vaga da familia.
  // Remarcar pode: ele nao muda nada na agenda, so chama a equipe.
  const duvida = /(^|\s)nao sei(\s|$)/.test(r)

  // "Confirma" e o "sim" (20/10/2026 no sistema do Dr. Marcello, trazido em
  // 25/10/2026). La, um paciente respondeu o lembrete digitando "Confirma": a
  // lista so tinha confirmar/confirmo/confirmado, a mensagem foi para outro
  // caminho, e na agenda a consulta seguiu "lembrete enviado, sem resposta".
  // "confirma" contido cobre confirma, confirmada, confirmamos; "confirmei"
  // vem a parte.
  //
  // O lembrete pergunta "Podemos confirmar sua presenca?", e "sim", "ok", "vou
  // sim", "estarei la" respondem isso. So com o lembrete como ultima mensagem
  // nossa (fora dela "ok" e so um ok), sem "nao" na frase, e nunca por cima de
  // um pedido de remarcar ou cancelar na mesma mensagem.
  const so = r.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const afirma =
    dentroDaJanela &&
    ultimaFoiLembrete &&
    !/\bnao\b/.test(so) &&
    (/^(sim|ok|okay|certo|combinado|positivo|claro|com certeza|perfeito|beleza)\b/.test(so) ||
      /^(sim )?(vou|vamos|estarei|estaremos|irei|iremos)( sim)?( la| ai| presente| presentes)?( sim)?( obrigad[oa])?$/.test(so))
  // O numero so vale dentro da janela para nao roubar as opcoes do menu.
  const confirmaAntes =
    !duvida &&
    ((dentroDaJanela && r === '1') ||
      ((dentroDaJanela || comLembreteRecente) && semNegacao('confirma', 'confirmo', 'confirmei')) ||
      afirma)
  // "Escolher outra data" e o texto do botao da confirmacao (15/10/2026, no
  // Dr. Marcello): nao era reconhecido, e o toque caia no cadastro pela metade
  // como nome.
  const remarca =
    dentroDaJanela &&
    (r === '2' ||
      semNegacao('remarcar', 'reagendar', 'trocar a data', 'outro horario', 'outra data', 'mudar a data', 'trocar o dia', 'mudar o dia'))
  const cancela =
    dentroDaJanela && !duvida && (r === '3' || semNegacao('cancelar', 'cancelo', 'desmarcar'))
  // "Sim, mas preciso remarcar": o pedido manda, o "sim" so respondia a pergunta.
  const confirma = confirmaAntes && !remarca && !cancela

  const pediuAjuda = tem('preciso de ajuda', 'preciso falar')

  // Dois pedidos de sair (15/10/2026). O do acompanhamento - o botao "Nao
  // quero receber" e o SAIR que o proprio modelo ensina - para so o
  // acompanhamento: foi o que a resposta sempre prometeu, e a mae do Vicente,
  // que tocou o botao, continua precisando do lembrete da consulta que marcar.
  // O resto e para nao receber nada.
  // "sair" continua exato: contido, ele apareceria em "vou sair de viagem" e
  // descadastraria quem so estava avisando que viaja.
  const soAcompanhamento = r === 'sair' || tem('nao quero receber', 'nao quero mais receber')
  const paraTudo =
    // "Nao quero receber nada" e para tudo; o botao sozinho, so acompanhamento.
    (soAcompanhamento && /\b(nada|nenhuma)\b/.test(r)) ||
    tem('descadastr', 'nao me mandem mais', 'nao mandem mais') ||
    /\b(tir(a|e|em|ar)|remov(a|e|am|er)|exclu(a|i|am|ir)) (o )?(meu )?(numero|telefone|contato)\b/.test(r) ||
    /\b(me )?(tir(a|e|em)|remov(a|am)|exclu(a|am)) (da|dessa|desta) lista\b/.test(r) ||
    /\bpar(e|em|ar) de (me )?(mandar|enviar|ligar)\b/.test(r)

  return {
    confirma,
    remarca,
    cancela,
    respondeuLembrete: confirma || remarca || cancela,
    // "sair" continua exato: contido, ele apareceria em "vou sair de viagem" e
    // descadastraria quem so estava avisando que viaja.
    // "Tirem meu numero da lista" (14/10/2026): no painel, um senhor que
    // recebeu mensagem por engano pediu tres vezes e nao foi descadastrado.
    optedOut: soAcompanhamento || paraTudo,
    paraTudo,
    // Nada de "tudo bem" aqui: "bom dia, tudo bem?" e cumprimento, nao resposta
    // ao acompanhamento, e trata-lo como resposta faria o robo se calar.
    isWell: tem('estou bem', 'estamos bem', 'ele esta bem', 'ela esta bem'),
    pediuAjuda,
    // Remarcar e cancelar exigem alguem da equipe: no primeiro caso ninguem
    // escolheu o novo horario ainda; no segundo a agenda abriu um buraco que a
    // recepcao pode querer preencher.
    motivoAtencao: remarca ? 'remarcacao' : cancela ? 'cancelamento' : pediuAjuda ? 'ajuda' : null,
  }
}

/** O que gravar na consulta. Cancelar muda o status; os outros so anotam. */
export function mudancaDaConsulta(resposta: Resposta, quando: string) {
  if (resposta.confirma) return { confirmed_at: quando, reschedule_requested_at: null }
  if (resposta.cancela) return { status: 'cancelled', cancelled_at: quando, confirmed_at: null }
  return { reschedule_requested_at: quando, confirmed_at: null }
}

/**
 * O que responder de volta.
 *
 * Ate 31/08/2026 o sistema anotava a resposta e nao dizia nada: quem confirmava
 * ficava sem saber se tinha dado certo.
 */
export function avisoDaResposta(
  resposta: Resposta,
  /**
   * Unidade com endereco (unidadeNoLembrete), repetida em quem confirmou
   * (09/10/2026): a confirmacao e a mensagem que a familia guarda para o dia.
   */
  onde = '',
) {
  const aviso = resposta.confirma
    ? 'Consulta confirmada, obrigado! Até lá.' + (onde ? `\n\n📍 ${onde}` : '')
    : resposta.cancela
      ? // Com botao desde 22/09/2026. "Digite 2" sozinho nem funcionava: sem
        // etapa aberta, o 2 caia no menu, e a pessoa precisava mandar 2 de
        // novo. Agora o webhook deixa o menu ativo e oferece o botao - quem
        // cancelou pode ter so trocado de ideia sobre o dia.
        'Consulta cancelada. Quer já escolher uma nova data? Toque no botão abaixo ou digite 2.'
      : 'Certo! Já avisei a nossa equipe para remarcar com você. Alguém retorna por aqui.'
  return `${aviso}\n\nDigite 0 se precisar de mais alguma coisa.`
}

/**
 * O que responder a quem apertou um botão do acompanhamento.
 *
 * Até 08/09/2026 os três botões eram anotados e nada voltava: "Estou bem"
 * fechava o acompanhamento em silêncio, "Preciso de ajuda" acendia a bandeira
 * para a equipe sem dizer isso à família, e "Não quero receber" desligava os
 * envios sem confirmar. Quem aperta um botão espera ouvir algo.
 *
 * Devolve null quando a resposta não foi a um acompanhamento: aí quem fala é
 * o menu, como sempre.
 */
export function respostaAoAcompanhamento(resposta: Resposta): string | null {
  if (resposta.isWell) {
    return 'Que bom saber! 💙 Se surgir qualquer dúvida, é só escrever por aqui.'
  }
  if (resposta.pediuAjuda) {
    return (
      'Já avisei a nossa equipe. Pode escrever sua dúvida por aqui: quem assumir o ' +
      'atendimento vai ler tudo antes de responder.\n\n' +
      avisoDeHorario()
    )
  }
  if (resposta.optedOut && resposta.paraTudo) {
    return (
      'Pronto: não vamos mais enviar mensagens para este número, nem lembrete de consulta. ' +
      'Se precisar da clínica, é só escrever por aqui que respondemos.'
    )
  }
  if (resposta.optedOut) {
    return (
      'Tudo bem, não enviaremos mais mensagens de acompanhamento. ' +
      'Se precisar da clínica, é só escrever por aqui que respondemos.'
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// Quando o lembrete sai
// ---------------------------------------------------------------------------

/** Perto demais da consulta o lembrete perde a serventia e vira susto. */
export const ANTECEDENCIA_MINIMA_HORAS = 2

/**
 * Deslocamento do fuso naquele instante, em ms. Negativo a oeste de Greenwich
 * (Sao Paulo: -3h).
 *
 * Calculado com Intl, e nao com o truque de `new Date(x.toLocaleString(...))`:
 * aquele depende do fuso da MAQUINA onde roda, e este codigo roda em dois
 * lugares com fusos diferentes - o Edge (UTC) e o teste no computador da
 * clinica (Sao Paulo). O truque acertava num e errava no outro em exatas tres
 * horas, que e o suficiente para o lembrete sair no dia errado.
 */
function deslocamentoDoFusoMs(instante: Date, timezone: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante)
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value)
  const relogioLocalComoUtc = Date.UTC(
    valor('year'), valor('month') - 1, valor('day'),
    valor('hour'), valor('minute'), valor('second'),
  )
  return relogioLocalComoUtc - instante.getTime()
}

/** Meia-noite (inicio) do dia local que vem `dias` depois de hoje, como instante. */
export function fimDoDiaLocal(agora: Date, dias: number, timezone: string): Date {
  const [ano, mes, dia] = agora
    .toLocaleDateString('en-CA', { timeZone: timezone })
    .split('-')
    .map(Number)
  // Meia-noite do dia seguinte ao alvo, ainda como se fosse UTC...
  const semFuso = new Date(Date.UTC(ano, mes - 1, dia + dias + 1))
  // ...corrigida para o fuso da clinica.
  return new Date(semFuso.getTime() - deslocamentoDoFusoMs(semFuso, timezone))
}

/**
 * Consultas que entram na conta de lembretes agora.
 *
 * A janela vai de daqui a duas horas ate o FIM DO DIA de `dias` a frente, no
 * fuso da clinica. Com dias = 1, e o fim de amanha.
 *
 * Por que o fim do dia, e nao "24 horas a frente" (que era a regra ate
 * 21/09/2026): com 24 horas, a consulta das 17:20 de amanha so entrava na
 * janela as 17:20 de hoje - e a familia era avisada no fim da tarde, sem tempo
 * de se programar. Com o fim do dia, a passada da manha ja pega o dia inteiro
 * de amanha, e todo mundo e avisado cedo.
 *
 * A passada continua sendo de hora em hora, e isto e deliberado: em 31/08/2026
 * o lembrete rodava uma vez por dia, e quem marcava depois da passada para o
 * dia seguinte ficava sem aviso. A passada da manha avisa a maioria; as
 * seguintes pegam quem marcou depois, e quem marcou hoje para daqui a pouco.
 */
export function janelaDeLembrete(agora: Date, dias: number, timezone: string) {
  return {
    inicio: new Date(agora.getTime() + ANTECEDENCIA_MINIMA_HORAS * 3600 * 1000),
    fim: fimDoDiaLocal(agora, dias, timezone),
  }
}

// ---------------------------------------------------------------------------
// Toque em botao ou lista
// ---------------------------------------------------------------------------

/**
 * O que a pessoa escolheu ao tocar num botao ou item de lista do robo.
 *
 * Os ids das opcoes sao o numero da opcao ("1", "2", "4"), para que tocar e
 * digitar entrem pelo mesmo caminho. So que o WhatsApp deixa tocar em listas de
 * mensagens ANTIGAS, e ai o numero responde a pergunta errada.
 *
 * Caso real de 22/09/2026: a mae estava escolhendo o horario do dia 09/10, mudou
 * de ideia e tocou em "sexta, 02/10" na lista de DATAS da mensagem anterior.
 * Esse item era o 4. O robo leu "4" como resposta a pergunta atual, de
 * HORARIOS, e marcou 09/10 as 10:40 - um horario que ela nunca escolheu.
 *
 * A Meta diz em qual mensagem estava o botao tocado (context.id). Se nao e a
 * nossa ultima mensagem, o numero nao vale: usa-se o texto do item ("sexta,
 * 02/10"), que diz o que a pessoa quis sem depender da pergunta. No pior caso o
 * robo responde "nao entendi" - nunca marca o que ninguem escolheu.
 *
 * Sem os dois ids para comparar (envio que falhou, evento sem contexto), fica
 * como sempre foi.
 */
export function oQueFoiEscolhido(toque: {
  /** Id do botao ou item tocado. Vazio quando a pessoa digitou. */
  id: string
  /** Texto visivel do botao ou item, ou o que a pessoa digitou. */
  titulo: string
  /** Id da mensagem onde estava o botao (context.id da Meta). */
  respondeA?: string | null
  /** Id da nossa mensagem mais recente nesta conversa. */
  ultimoEnvio?: string | null
}): string {
  if (!toque.id) return toque.titulo
  const antigo = Boolean(
    toque.respondeA && toque.ultimoEnvio && toque.respondeA !== toque.ultimoEnvio,
  )
  return antigo && toque.titulo ? toque.titulo : toque.id
}

/**
 * O lugar como vai no lembrete da vespera ("na unidade {{4}}").
 *
 * Com o endereco junto desde 09/10/2026. Duas familias com consulta marcada
 * antes da mudanca foram ao endereco antigo de Santos (Praiamar) - o lembrete
 * dizia so "Livance · Santos", e o endereco que elas tinham era o da
 * confirmacao de setembro. Uma delas so percebeu na recepcao do predio errado,
 * e a consulta acabou nao sendo cobrada. O modelo aprovado nao muda sem nova
 * aprovacao da Meta; o parametro muda: "na unidade Livance · Santos (Av. Anna
 * Costa, 228, 20º andar, Gonzaga, Santos - SP)".
 *
 * CEP sai (ninguem procura o predio pelo CEP, e alonga a frase). Quebra de
 * linha e espaco repetido saem porque a Meta recusa parametro com eles.
 */
export function unidadeNoLembrete(
  modalidade: string | null | undefined,
  nome: string | null | undefined,
  endereco: string | null | undefined,
): string {
  // Na telemedicina a frase fecha com "virtual (consulta por video)" - ver o
  // comentario no appointment-reminders.
  if (modalidade === 'telemedicina') return 'virtual (consulta por vídeo)'
  const lugar = (nome ?? '').trim() || 'a clínica'
  const limpo = (endereco ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s*[-·,]?\s*CEP:?\s*[\d.-]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[,·-]\s*$/, '')
    .trim()
  return limpo ? `${lugar} (${limpo})` : lugar
}

/**
 * "Estamos bem" no acompanhamento encerra a conversa (14/10/2026).
 *
 * O acompanhamento ja era marcado como concluido, mas a conversa ficava
 * aberta, com cara de pendente. No feriado de 12/10 a equipe abriu tres
 * dessas e mandou "Que bom, a disposicao" - fora das 24h, pelo modelo pago
 * da Meta - para familias que o robo ja tinha respondido. Encerrar e o mesmo
 * que o Concluir da tela, e nao e definitivo: a proxima mensagem da familia
 * reabre. Com algum pedido em aberto (bandeira de atencao), fica como esta.
 */
export function acompanhamentoEncerraConversa(resposta: Pick<Resposta, 'isWell'>, temPendencia: boolean): boolean {
  return resposta.isWell && !temPendencia
}

/**
 * Pedido de sair e a mensagem seguinte (15/10/2026).
 *
 * Toda mensagem nova devolvia a conversa para "aberta", ate o "ok, obrigado"
 * de quem acabou de pedir para sair - e para quem nao e paciente o pedido so
 * existia aqui, entao se desfazia com um agradecimento.
 *
 * Agora so a confirmacao ("ok", "obrigado") mantem a conversa fora, com o robo
 * calado. Mensagem de verdade - a mae que volta meses depois para marcar
 * retorno - reabre a conversa e o robo atende normalmente: foi o que a
 * resposta ao "Nao quero receber" prometeu ("se precisar da clinica, e so
 * escrever por aqui"). O que para de vez sao os envios automaticos do
 * paciente, guardados no cadastro (whatsapp_opt_out_at), que isto nao toca.
 */
export function depoisDoPedidoDeSair(
  statusAntes: string | null | undefined,
  pediuParaSair: boolean,
  texto: string,
): 'open' | 'opted_out' {
  if (pediuParaSair) return 'opted_out'
  if (statusAntes !== 'opted_out') return 'open'
  const r = normalizarResposta(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const soConfirmou =
    !r || /^(ok|okay|obrigad[oa]s?|muito obrigad[oa]|valeu|grat[oa]|beleza|blz|certo|ta bom|ta|tudo bem|otimo|perfeito)( obrigad[oa]s?)?$/.test(r)
  return soConfirmou ? 'opted_out' : 'open'
}
