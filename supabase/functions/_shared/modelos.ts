/**
 * O texto dos modelos aprovados na Meta.
 *
 * Fora da janela de 24 horas o WhatsApp só aceita modelo aprovado, e a Meta
 * guarda o texto do lado dela: nós mandamos o nome do modelo e os parâmetros,
 * e ela monta a mensagem. O sistema, então, nunca via o que a família leu -
 * guardava um resumo ("Acompanhamento de 30 dias enviado para Fulano"), e a
 * equipe abria a conversa na plataforma sem saber o que tinha sido dito.
 *
 * Aqui ficam as mesmas frases, para o registro da conversa mostrar a mensagem
 * como ela chega no celular. Se um modelo for alterado na Meta, este arquivo
 * precisa acompanhar: por isso os textos estão juntos, curtos e comentados, e
 * não espalhados pelas funções.
 */

/** Modelos conhecidos, pelo nome cadastrado na Meta. */
const MODELOS: Record<string, {
  corpo: string
  rodape?: string
  botoes?: string[]
  /** O {{1}} e so o primeiro nome da crianca, e nao o nome completo. */
  primeiroNome?: boolean
}> = {
  // Versao 2 do acompanhamento (enviada a Meta em 03/10/2026). A primeira
  // chamava a crianca pelo nome completo e perguntava "Como voce esta?", como se
  // ela fosse ler - "Ola, Rafael Moreira Lima Teixeira... Como voce esta?". Esta
  // fala com os pais e pergunta pela crianca, pelo primeiro nome.
  //
  // O botao e "Estamos bem" de proposito: interpretarResposta (lembrete.ts) ja
  // le "estamos bem" como resposta positiva, sem mexer em regra nenhuma.
  //
  // Passa a valer quando clinic_settings.whatsapp_template_name apontar para
  // ela - o que so pode acontecer DEPOIS de a Meta aprovar.
  acompanhamento_pos_consulta_v2: {
    corpo:
      'Olá! Aqui é do consultório do Dr. Marcello Ruiz. Estamos passando para saber como {{1}} ' +
      'está depois da consulta do dia {{2}}. Se precisar falar com a nossa equipe, é só responder ' +
      'esta mensagem.',
    rodape: 'Para não receber novos acompanhamentos, responda SAIR.',
    botoes: ['Estamos bem', 'Preciso de ajuda', 'Não quero receber'],
    primeiroNome: true,
  },
  acompanhamento_pos_consulta: {
    corpo:
      'Olá, {{1}}. A Clínica Dr. Marcello Ruiz está entrando em contato para acompanhar ' +
      'sua consulta realizada em {{2}}. Como você está? Responda esta mensagem caso ' +
      'precise falar com nossa equipe.',
    rodape: 'Para não receber novos acompanhamentos, responda SAIR.',
    botoes: ['Estou bem', 'Preciso de ajuda', 'Não quero receber'],
  },
  lembrete_consulta: {
    corpo:
      'Olá, {{1}}. Lembrete da sua consulta em {{2}} às {{3}}, na unidade {{4}}. ' +
      'Podemos confirmar sua presença?',
    botoes: ['Confirmar presença', 'Preciso remarcar'],
  },
  // A resposta da equipe fora da janela de 24 horas. O {{2}} é o texto que a
  // pessoa digitou na tela - por isso o registro precisa deste modelo aqui:
  // sem ele, a conversa guardaria "modelo enviado" e ninguém saberia o que a
  // família leu, que é justamente o conteúdo que importa.
  // Aviso unico da mudanca de Santos para a Livance (26/09/2026). Aprovado como
  // Utilidade so depois de falar da consulta da familia e perder o link do
  // Instagram - na primeira versao a Meta quis classificar como Marketing.
  //
  // DESATUALIZADO desde 28/09/2026 e NAO ENVIADO: o Dr. Marcello avisou que na
  // Livance e so o 20o andar e que o pagamento e pelo link que a Livance manda
  // ao agendar, nao no totem. O texto aprovado na Meta ainda diz "20o e 21o
  // andares" e "pagamento no totem". Precisa de modelo novo aprovado antes de
  // disparar; quando sair, este texto troca junto (e o nome, se mudar).
  mudanca_santos_livance: {
    corpo:
      'Olá, {{1}}. Aqui é do consultório do Dr. Marcello Ruiz.\n\n' +
      'Sua consulta de {{2}} às {{3}} em Santos será no novo endereço:\n' +
      '📍 Livance, Av. Anna Costa, 228, 20º e 21º andares, Gonzaga, Santos\n\n' +
      'Como funciona a chegada:\n' +
      '1. Faça o check-in em um dos totens digitais, digitando o nome do paciente.\n' +
      '2. Ainda no totem, faça o pagamento da consulta: Pix, débito ou crédito (à vista).\n' +
      '3. O Dr. Marcello recebe o aviso e chama vocês na sala de espera assim que terminar a consulta anterior.\n\n' +
      'Se precisar remarcar, é só responder esta mensagem.',
  },
  // Modelos da clinica de teste (27/09/2026): os mesmos tres de cima que
  // citavam o Dr. Marcello, com o nome do Consultorio Central de Cuidado. Vivem
  // so na conta de teste da Meta; a clinica de teste aponta para eles em
  // clinic_settings.
  demo_acompanhamento: {
    corpo:
      'Olá, {{1}}. O Consultório Central de Cuidado está entrando em contato para acompanhar ' +
      'sua consulta realizada em {{2}}. Como você está? Responda esta mensagem caso ' +
      'precise falar com nossa equipe.',
    rodape: 'Para não receber novos acompanhamentos, responda SAIR.',
    botoes: ['Estou bem', 'Preciso de ajuda', 'Não quero receber'],
  },
  demo_resposta_da_clinica: {
    corpo:
      'Olá, {{1}}. Aqui é o Consultório Central de Cuidado.\n\n{{2}}\n\n' +
      'Se precisar, é só responder por aqui.',
  },
  // Com o nome do Dr. Fabio desde 17/10/2026: ate aqui era o texto herdado do
  // Dr. Marcello. E o texto que o Edu cadastra na Meta da clinica, o mesmo da
  // dica da tela de Respostas (consultorioNaResposta em src/lib/marca.ts).
  resposta_da_clinica: {
    corpo:
      'Olá, {{1}}. Aqui é o consultório do Dr. Fábio Dario.\n\n{{2}}\n\n' +
      'Se precisar, é só responder por aqui.',
  },
  // O alerta de urgencia no WhatsApp do medico (17/10/2026, ver
  // alerta-de-urgencia.ts), categoria Utilidade, portugues (BR), validade de 12
  // horas. Parametros: o motivo ("urgência" ou "sangramento"), quem, a hora e o
  // trecho da mensagem. "O robo ja respondeu", e nao "ja orientou o
  // pronto-socorro": a urgencia lida pelo Jev nao muda a resposta do robo.
  // Estes textos sao os que o Edu cadastra na Meta (LEIA-ME): mudou la, muda aqui.
  alerta_urgencia: {
    corpo:
      '🚨 Alerta de {{1}} na Central de Cuidado.\n\n{{2}} escreveu às {{3}}:\n"{{4}}"\n\n' +
      'O robô já respondeu ao paciente. Veja a conversa na Central de Cuidado para avaliar e responder.',
  },
  alerta_urgencia_botoes: {
    corpo:
      '🚨 Alerta de {{1}} na Central de Cuidado.\n\n{{2}} escreveu às {{3}}:\n"{{4}}"\n\n' +
      'O robô já respondeu ao paciente. Toque num botão ou responda a esta mensagem com a orientação, que eu repasso ao paciente.',
    botoes: ['É urgente', 'Pode aguardar', 'Eu respondo'],
  },
  // O "Mandar para o celular" da Central (25/10/2026, vindo do sistema do Dr.
  // Marcello, ver alerta-de-urgencia.ts), categoria Utilidade, portugues (BR),
  // validade de 12 horas. Parametros: quem, a hora, o assunto e o trecho da
  // ultima mensagem do paciente. Enquanto nao e aprovado, o mesmo texto vai
  // como mensagem comum, que so chega a quem escreveu para o numero da clinica
  // nas ultimas 24 horas.
  pedido_equipe: {
    corpo:
      '📋 Pedido para a equipe na Central de Cuidado.\n\n{{1}} escreveu às {{2}}.\nAssunto: {{3}}\n"{{4}}"\n\n' +
      'Para responder ao paciente, responda a esta mensagem com o texto, que eu repasso. Ou toque em Eu respondo.',
    botoes: ['Eu respondo'],
  },
}

/**
 * Os parametros do acompanhamento, na ordem do modelo: quem e quando.
 *
 * O modelo antigo leva o nome completo; o v2, so o primeiro nome. Nome de
 * cadastro todo em maiusculas ("AGATHA BETTINI") vira "Agatha" - no meio de uma
 * frase, em maiusculas, parece grito.
 */
export function parametrosDoAcompanhamento(nomeDoModelo: string, nomeDoPaciente: string, data: string): string[] {
  const completo = String(nomeDoPaciente ?? '').trim()
  if (!MODELOS[nomeDoModelo]?.primeiroNome) return [completo, data]
  const primeiro = completo.split(/\s+/)[0] ?? ''
  const nome =
    primeiro && primeiro === primeiro.toUpperCase()
      ? primeiro.charAt(0) + primeiro.slice(1).toLowerCase()
      : primeiro
  // Sem nome nenhum, "como a crianca esta" ainda e uma frase inteira; vazio
  // deixaria "saber como  esta" - e a Meta recusa parametro vazio.
  return [nome || 'a criança', data]
}

/**
 * A mensagem como a família recebe, com os parâmetros no lugar.
 *
 * Modelo desconhecido devolve null, e quem chamou usa o resumo de antes: um
 * modelo novo na Meta não pode impedir o envio nem apagar o registro.
 */
export function textoDoModelo(nome: string, parametros: string[]): string | null {
  const modelo = MODELOS[nome]
  if (!modelo) return null

  const corpo = modelo.corpo.replace(/\{\{(\d+)\}\}/g, (_, indice) => parametros[Number(indice) - 1] ?? '')

  return [
    corpo,
    modelo.rodape,
    // Os botões entram no texto porque são parte do que a pessoa vê, e porque
    // explicam as respostas curtas que voltam depois ("Estou bem") para quem
    // ler a conversa semanas mais tarde.
    modelo.botoes?.length ? `[${modelo.botoes.join(' · ')}]` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
}
