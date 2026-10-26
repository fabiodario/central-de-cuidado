// O Jev escolhendo o caminho quando o robo nao entende (26/10/2026, pedido do
// Edu). Ver supabase/functions/_shared/caminho-pelo-jev.ts. O Jev aqui e de
// mentira: devolve a leitura que o caso manda. Para provar que um caso pega o
// defeito, ver DESLIGAR em tests/montar-para-teste.mjs.
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { conferirDesligar, lerComTrocas, montar } from './montar-para-teste.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SHARED = join(AQUI, '..', 'supabase', 'functions', '_shared')
const C = await montar(join(SHARED, 'caminho-pelo-jev.ts'), join(AQUI, 'caminho-pelo-jev.build.mjs'))
const { Simulacao } = await montar(join(AQUI, '..', 'src', 'simulador', 'sessao.ts'), join(AQUI, 'caminho-sessao.build.mjs'))
const { IDENTIDADES, FAMILIAS } = await montar(join(AQUI, '..', 'src', 'simulador', 'dados.ts'), join(AQUI, 'caminho-dados.build.mjs'))
const ler = (...partes) => lerComTrocas(join(AQUI, '..', ...partes))

let ok = 0
async function caso(nome, fn) {
  try {
    await fn()
    ok++
  } catch (erro) {
    console.error('FALHOU:', nome)
    throw erro
  }
}

// ---------------------------------------------------------------
// As pecas
// ---------------------------------------------------------------

await caso('so o "Nao entendi" chama o Jev; ficha, fila da equipe, urgencia, toque e foto ficam fora', () => {
  assert.equal(C.roboTravou({ resposta: 'Não entendi. Responda com o número do dia da lista acima.' }), true)
  assert.equal(C.roboTravou({ resposta: '🤔 Não consegui entender por aqui, então passei sua mensagem para a nossa equipe' }), true)
  assert.equal(C.roboTravou({ resposta: 'Desculpe, não estou conseguindo entender por aqui. 🙏 Já chamei alguém' }), true)
  // A funcao naoEntendi registra o evento e muitas vezes responde: resposta
  // pronta, agenda, "estou aqui" (repassagem das rodadas, 26/10/2026).
  assert.equal(C.roboTravou({ resposta: '📍 *Onde o Dr. Fábio atende*\n\n*Santos · Boqueirão*' }), false, 'o robo respondeu algo')
  assert.equal(C.roboTravou({ resposta: '⏰ *Horários de sexta, 16/10:*' }), false)
  assert.equal(C.roboTravou(null), false, 'robo calado nao e trava')
  const pode = (s) => C.precisaDoCaminho({ estado: 'menu', foiToque: false, anexo: false, motivoAceso: null, ...s })
  assert.equal(pode({}), true)
  assert.equal(pode({ estado: 'aguardando_dia' }), true)
  assert.equal(pode({ estado: 'dados_nome' }), false, 'a ficha tem a propria segunda chance')
  assert.equal(pode({ estado: 'atendente' }), false, 'na fila da equipe, quem responde e gente')
  assert.equal(pode({ estado: 'confirmar_cancelamento' }), false, 'cancelar e sempre a regra quem decide')
  assert.equal(pode({ motivoAceso: 'urgencia' }), false)
  assert.equal(pode({ motivoAceso: 'sangramento' }), false)
  assert.equal(pode({ foiToque: true }), false)
  assert.equal(pode({ anexo: true }), false)
})

await caso('o contexto: o menu fixo, ou a ultima lista numerada da etapa; ate 4 mensagens de antes', () => {
  const historico = [
    { direction: 'outbound', automatic: true, body: 'Não entendi. Responda com o número do dia da lista acima.' },
    { direction: 'inbound', body: 'teo' },
    { direction: 'outbound', automatic: true, body: '🗓️ Datas\n\n*1* sexta, 16/10 (manhã · 6 horários)\n*2* segunda, 19/10 (tarde · 6 horários)' },
    { direction: 'inbound', body: '1' },
    { direction: 'inbound', body: '2' },
    { direction: 'inbound', body: 'quero marcar' },
    { direction: 'inbound', body: 'Oi' },
  ]
  const dia = C.contextoDoCaminho(historico, 'aguardando_dia')
  assert.deepEqual(dia.lista.map((o) => o.numero), ['1', '2'], 'a lista vem da mensagem que a tinha, e nao do "nao entendi"')
  assert.equal(dia.lista[0].rotulo, 'sexta, 16/10 (manhã · 6 horários)')
  assert.deepEqual(dia.anteriores, ['quero marcar', '2', '1', 'teo'])
  assert.match(dia.ultimaDoRobo, /^Não entendi/)
  assert.deepEqual(C.contextoDoCaminho(historico, 'menu').lista, C.MENU_DO_ROBO, 'no menu, as cinco opcoes de sempre')
  assert.deepEqual(C.contextoDoCaminho(historico, 'minha_consulta').lista, [], 'sem lista numerada, so o assunto')
})

await caso('a rota de cada assunto: na etapa, ou pelo menu; cancelar e remarcar sempre com a confirmacao do robo', () => {
  const r = (assunto, estado, temConsulta = false, texto = '') => C.rotaDoAssunto(assunto, estado, temConsulta, texto)
  assert.deepEqual([r('valor', 'aguardando_dia').texto, r('valor', 'aguardando_dia').doMenu], ['quanto custa a consulta?', false], 'informacao responde sem desmanchar o agendamento')
  assert.equal(r('convenio', 'menu').texto, 'quais convênios vocês atendem?')
  assert.equal(r('endereco_horario', 'menu', false, 'onde fica').texto, 'qual o endereço?')
  assert.equal(r('endereco_horario', 'menu', false, 'que horas abre').texto, 'qual o horário de atendimento?')
  assert.equal(r('endereco_horario', 'aguardando_dia', false, '8h da MANHÃ. Tem de manhã em alguma unidade?').texto, 'qual o horário de atendimento?')
  assert.equal(r('equipe', 'aguardando_horario').texto, 'quero falar com alguém da equipe')
  assert.deepEqual([r('documento', 'menu').texto, r('documento', 'menu').doMenu], ['5', true])
  assert.deepEqual([r('ver_consulta', 'menu').texto, r('ver_consulta', 'menu').doMenu], ['4', true])
  assert.equal(r('marcar', 'aguardando_dia'), null, 'no meio do agendamento, "marcar" e responder a etapa')
  assert.deepEqual([r('marcar', 'minha_consulta').texto, r('marcar', 'minha_consulta').doMenu], ['2', true])
  assert.equal(r('remarcar', 'menu', true).texto, 'REMARCAR')
  assert.equal(r('remarcar', 'menu', false).texto, '4', 'sem consulta, "Minha consulta" diz que nao ha')
  assert.equal(r('remarcar', 'aguardando_horario').texto, 'VOLTAR', 'na lista de horarios, outro dia')
  assert.equal(r('remarcar', 'aguardando_unidade'), null)
  assert.equal(r('cancelar', 'aguardando_dia').texto, 'CANCELAR', 'no agendamento, desistir de marcar')
  assert.equal(r('cancelar', 'menu', true).texto, 'quero cancelar minha consulta', 'cai na pergunta de confirmacao')
  assert.equal(r('cancelar', 'menu', false).texto, '4')
  assert.equal(r('agradecimento', 'menu').perguntavel, false, 'ninguem pergunta "voce quer agradecer?"')
  assert.equal(r('urgencia', 'menu'), null, 'urgencia e da segunda leitura')
  assert.equal(r('outro', 'menu'), null)
})

const lista = [
  { numero: '1', rotulo: 'Higienópolis · São Paulo (36 horários livres · particular)' },
  { numero: '2', rotulo: 'Santos · Boqueirão (48 horários livres · convênio ou particular)' },
  { numero: '3', rotulo: 'Tatuapé · São Paulo (18 horários livres · particular)' },
]
const leitura = (l) => ({ ok: true, assunto: 'marcar', confAssunto: 0.9, opcao: 'nenhuma', confOpcao: 0.9, modelo: 'jev-1.13.0', ...l })
const decidir = (l, s = {}) =>
  C.decidirCaminho(leitura(l), { modo: 'ligada', estado: 'aguardando_unidade', lista, quantasOpcoes: 3, temConsulta: false, texto: 'x', ...s })

await caso('a decisao: opcao segura segue, meio segura pergunta, nenhuma e nota baixa ficam no "Nao entendi"', () => {
  assert.deepEqual(decidir({ opcao: '3', confOpcao: 0.9 }), { acao: 'seguir', texto: '3', doMenu: false, detalhe: 'opcao 3 0.90 jev-1.13.0' })
  assert.equal(decidir({ opcao: '3', confOpcao: 0.5 }).acao, 'seguir', '0,5 ja segue (medido: nenhuma opcao errada)')
  const sugestao = decidir({ opcao: '3', confOpcao: 0.43 })
  assert.equal(sugestao.acao, 'sugerir')
  assert.equal(sugestao.pergunta, 'Você quis dizer *Tatuapé · São Paulo*? Se for, toque em Sim.', 'so o nome, sem o parentese')
  assert.deepEqual(sugestao.botao, { id: 'JEV:opcao:3', titulo: 'Sim' })
  assert.equal(decidir({ opcao: '3', confOpcao: 0.1 }).acao, 'nada')
  assert.equal(decidir({ opcao: 'nenhuma', confOpcao: 0.99 }).acao, 'nada')
  assert.equal(decidir({ opcao: '7', confOpcao: 0.99 }).acao, 'nada', 'opcao que nao esta na lista')
  assert.equal(decidir({ opcao: '3', confOpcao: 0.99 }, { quantasOpcoes: 2 }).acao, 'nada', 'lista velha no historico: a etapa so guardou 2')
})

await caso('a decisao: assunto seguro muda de caminho, meio seguro pergunta, e a opcao vem antes', () => {
  assert.deepEqual(decidir({ assunto: 'valor', confAssunto: 0.85 }), {
    acao: 'seguir', texto: 'quanto custa a consulta?', doMenu: false, detalhe: 'assunto valor 0.85 jev-1.13.0',
  })
  assert.equal(decidir({ assunto: 'valor', confAssunto: 0.79 }).acao, 'sugerir')
  assert.equal(decidir({ assunto: 'valor', confAssunto: 0.79 }).botao.id, 'JEV:assunto:valor')
  assert.equal(decidir({ assunto: 'valor', confAssunto: 0.4 }).acao, 'nada')
  assert.equal(decidir({ assunto: 'valor', confAssunto: 0.52 }).acao, 'nada', 'abaixo de 0,55 nem pergunta')
  assert.equal(decidir({ assunto: 'valor', confAssunto: 0.6 }, { chamouEquipe: true }).acao, 'nada', 'com a equipe ja chamada, sem pergunta a mais')
  assert.equal(decidir({ opcao: '3', confOpcao: 0.43 }, { chamouEquipe: true }).acao, 'nada')
  assert.equal(decidir({ assunto: 'valor', confAssunto: 0.9 }, { chamouEquipe: true }).acao, 'seguir', 'seguir ainda vale')
  assert.equal(decidir({ assunto: 'agradecimento', confAssunto: 0.7 }, { estado: 'menu' }).acao, 'nada', 'agradecimento nao vira pergunta')
  assert.equal(decidir({ assunto: 'marcar', confAssunto: 0.99 }).acao, 'nada', 'marcar no meio do agendamento nao leva a lugar nenhum')
  assert.equal(decidir({ assunto: 'valor', confAssunto: 0.99, opcao: '2', confOpcao: 0.9 }).texto, '2', 'a opcao vem antes')
})

await caso('a decisao: sombra so registra; falha e desligado ficam no "Nao entendi"', () => {
  assert.deepEqual(decidir({ opcao: '3', confOpcao: 0.9 }, { modo: 'sombra' }), { acao: 'nada', detalhe: 'sombra opcao 3 0.90 jev-1.13.0' })
  assert.deepEqual(C.decidirCaminho({ ok: false, erro: 'tempo esgotado' }, { modo: 'ligada', estado: 'menu', lista: [], quantasOpcoes: null, temConsulta: false, texto: '' }), { acao: 'nada', detalhe: 'falhou: tempo esgotado' })
  assert.equal(C.decidirCaminho(null, { modo: 'ligada', estado: 'menu', lista: [], quantasOpcoes: null, temConsulta: false, texto: '' }).detalhe, 'desligada')
  assert.equal(decidir({ opcao: '3', confOpcao: 0.9 }, { modo: 'desligada' }).acao, 'nada')
})

await caso('o "Sim" da sugestao vira o que o Jev tinha entendido', () => {
  assert.deepEqual(C.entradaDoBotao('JEV:opcao:3', 'aguardando_unidade', false), { texto: '3', doMenu: false })
  assert.deepEqual(C.entradaDoBotao('JEV:assunto:remarcar', 'menu', true), { texto: 'REMARCAR', doMenu: true })
  assert.deepEqual(C.entradaDoBotao('JEV:assunto:valor', 'aguardando_dia', false), { texto: 'quanto custa a consulta?', doMenu: false })
  assert.deepEqual(C.entradaDoBotao('JEV:assunto:marcar', 'aguardando_dia', false), { texto: '0', doMenu: false }, 'a etapa mudou: o menu')
  assert.equal(C.entradaDoBotao('REMARCAR', 'menu', true), null, 'botao do robo nao e do Jev')
})

await caso('a pergunta ao Jev: as duas perguntas numa chamada, com a lista; sem chave, erro e tempo esgotado nao lancam', async () => {
  let pedido = null
  const responde = (corpo, status = 200) => async (_url, init) => {
    pedido = JSON.parse(init.body)
    return new Response(JSON.stringify(corpo), { status })
  }
  const entrada = { texto: 'zona leste', anteriores: ['quero marcar'], ultimaDoRobo: 'Em qual unidade?', lista }
  const r = await C.lerCaminhoComJev(entrada, {
    chave: 'teste',
    fetch: responde({ model: 'jev-1.13.0', answers: { assunto: { choice: 'marcar', confidence: 0.9 }, opcao: { choice: 'opcao_3', confidence: 0.43 } } }),
  })
  assert.deepEqual(r, { ok: true, assunto: 'marcar', confAssunto: 0.9, opcao: '3', confOpcao: 0.43, modelo: 'jev-1.13.0' })
  assert.equal(pedido.model, 'jev-1.13.0')
  assert.deepEqual(Object.keys(pedido.questions), ['assunto', 'opcao'])
  assert.equal(pedido.questions.opcao.criteria.opcao_3, lista[2].rotulo)
  assert.ok(pedido.questions.opcao.criteria.nenhuma, 'sempre com a saida "nenhuma"')
  assert.deepEqual(pedido.state, { mensagens_anteriores: ['quero marcar'], ultima_resposta_do_robo: 'Em qual unidade?', mensagem: 'zona leste' })
  await C.lerCaminhoComJev({ ...entrada, lista: [] }, { chave: 'teste', fetch: responde({ answers: { assunto: { choice: 'valor', confidence: 0.9 } } }) })
  assert.deepEqual(Object.keys(pedido.questions), ['assunto'], 'sem lista, so o assunto')
  assert.deepEqual(await C.lerCaminhoComJev(entrada, { chave: '' }), { ok: false, erro: 'sem chave' })
  assert.deepEqual(await C.lerCaminhoComJev(entrada, { chave: 'teste', fetch: responde({}, 500) }), { ok: false, erro: 'HTTP 500' })
  const parado = (_url, init) => new Promise((_, rejeitar) => init.signal.addEventListener('abort', () => rejeitar(new Error('abortado'))))
  assert.deepEqual(await C.lerCaminhoComJev(entrada, { chave: 'teste', fetch: parado, tempoLimiteMs: 20 }), { ok: false, erro: 'tempo esgotado' })
})

// ---------------------------------------------------------------
// No simulador, com o motor de producao
// ---------------------------------------------------------------

const QUARTA_10H = Date.parse('2026-10-14T13:00:00Z')
/** Simulacao com um Jev de mentira: `jev(entrada)` devolve a leitura; conta as chamadas. */
function comJev(familia, jev, modo = 'ligada') {
  let agora = QUARTA_10H
  const s = new Simulacao(IDENTIDADES.fabio, FAMILIAS[familia], { relogio: () => new Date((agora += 30000)) })
  s.chamadasDoJev = []
  s.leitorDoCaminho = async (entrada) => {
    s.chamadasDoJev.push(entrada)
    return { modo, leitura: await jev(entrada) }
  }
  return s
}
async function conversar(s, passos) {
  let r = null
  for (const p of passos) r = await s.enviarDaFamilia(typeof p === 'string' ? { texto: p } : p)
  return { ...r, texto: r.respostas.map((m) => m.texto).join('\n'), jev: r.registros.filter((g) => g.titulo.startsWith('Jev:')).map((g) => g.titulo) }
}
const sempre = (l) => async () => leitura(l)

await caso('simulador: robo que entende nao chama o Jev, nem o "nao entendi" que responde algo', async () => {
  const s = comJev('nova', sempre({}))
  await conversar(s, ['Oi', 'quero marcar uma consulta', '2', '1', '1'])
  assert.equal(s.chamadasDoJev.length, 0)
  const t = comJev('nova', sempre({ assunto: 'endereco_horario', confAssunto: 0.6 }))
  const r = await conversar(t, ['Oi', 'quero marcar uma consulta', '2', '1', 'essas datas são do Tatuapé? lá em cima tá escrito Santos'])
  assert.match(r.texto, /Onde o Dr\. Fábio atende/, 'a regra respondeu com os enderecos')
  assert.equal(t.chamadasDoJev.length, 0, 'e o Jev nao pergunta "voce quer saber o endereco?" embaixo')
})

await caso('simulador: "o primero" na lista de dias vai para os horarios do primeiro dia', async () => {
  const s = comJev('nova', sempre({ opcao: '1', confOpcao: 0.98 }))
  const r = await conversar(s, ['Oi', 'quero marcar uma consulta', '2', '1', 'o primero'])
  assert.match(r.texto, /Horários de sexta, 16\/10/)
  assert.doesNotMatch(r.texto, /Não entendi/)
  assert.equal(s.etapa, 'aguardando_horario')
  assert.deepEqual(s.chamadasDoJev[0].lista.map((o) => o.numero), ['1', '2', '3', '4', '5', '6', '7', '8'], 'o Jev viu a lista de dias')
  assert.match(r.jev.join(), /escolheu a opção 1/)
})

await caso('simulador: "obg, era isso" no menu agradece e nao chama a equipe', async () => {
  const s = comJev('nova', sempre({ assunto: 'agradecimento', confAssunto: 0.99 }))
  const r = await conversar(s, ['Oi', 'obg, era isso'])
  assert.match(r.texto, /Por nada/)
  assert.equal(s.motivo, null, 'sem etiqueta para a equipe')
  assert.notEqual(s.etapa, 'atendente', 'o "nao entendi" tinha posto a conversa na fila: voltou')
})

await caso('simulador: no meio do agendamento, "na vdd quero cancelar" para o agendamento', async () => {
  const s = comJev('nova', sempre({ assunto: 'cancelar', confAssunto: 0.99 }))
  const r = await conversar(s, ['Oi', 'quero marcar uma consulta', 'na vdd quero cancelar minha consulta'])
  assert.match(r.texto, /parei por aqui/)
})

await caso('simulador: em Minha consulta, "da pra passar pra semana q vem?" vai para a remarcacao, sem cancelar', async () => {
  const s = comJev('com_consulta', sempre({ assunto: 'remarcar', confAssunto: 0.99 }))
  const r = await conversar(s, ['Oi', '4', 'da pra passar pra semana q vem?'])
  assert.match(r.texto, /Vamos remarcar esta consulta/)
  assert.equal(s.consultas().some((c) => c.status === 'cancelled'), false)
})

await caso('simulador: cancelar pelo Jev cai na pergunta de confirmacao', async () => {
  const s = comJev('com_consulta', sempre({ assunto: 'cancelar', confAssunto: 0.99 }))
  const r = await conversar(s, ['Oi', 'aquela parada de quarta, esquece ela'])
  assert.equal(s.chamadasDoJev.length, 1)
  assert.match(r.texto, /Confirma o cancelamento/)
  assert.equal(s.consultas().some((c) => c.status === 'cancelled'), false, 'nada cancelado sem o SIM')
})

await caso('simulador: meio seguro, o robo pergunta com o botao Sim; o Sim segue o caminho', async () => {
  const s = comJev('nova', sempre({ opcao: '3', confOpcao: 0.43 }))
  let r = await conversar(s, ['Oi', 'quero marcar uma consulta', 'zona leste'])
  assert.match(r.texto, /Não entendi qual unidade/, 'o "nao entendi" continua')
  const sugestao = r.respostas.at(-1)
  assert.equal(sugestao.texto, 'Você quis dizer *Tatuapé · São Paulo*? Se for, toque em Sim.')
  assert.deepEqual(sugestao.toques.opcoes, [{ id: 'JEV:opcao:3', titulo: 'Sim' }])
  r = await conversar(s, [{ texto: 'Sim', idDoToque: 'JEV:opcao:3' }])
  assert.match(r.texto, /Datas disponíveis em Tatuapé/)
  assert.equal(s.chamadasDoJev.length, 1, 'o toque no Sim nao pergunta de novo')
})

await caso('simulador: o Sim de um assunto pelo menu vai pelo menu', async () => {
  const s = comJev('com_consulta', sempre({ assunto: 'remarcar', confAssunto: 0.6 }))
  // Curta de proposito: no menu, frase de tres palavras ou mais ja chama a
  // equipe, e ai nao ha pergunta a mais (chamouEquipe).
  let r = await conversar(s, ['Oi', 'ajeita ai'])
  assert.match(r.texto, /^Não entendi/m)
  assert.equal(r.respostas.at(-1).texto, 'Você quer remarcar a sua consulta? Se for, toque em Sim.')
  r = await conversar(s, [{ texto: 'Sim', idDoToque: 'JEV:assunto:remarcar' }])
  assert.match(r.texto, /Vamos remarcar esta consulta/)
})

await caso('simulador: Jev sem certeza, com falha ou em sombra deixa o "Nao entendi" de sempre', async () => {
  for (const [jev, modo, frase] of [
    [sempre({ assunto: 'outro', confAssunto: 0.9 }), 'ligada', /também não teve certeza/],
    [async () => ({ ok: false, erro: 'tempo esgotado' }), 'ligada', /Não consegui perguntar ao Jev \(tempo esgotado\)/],
    [async () => { throw new Error('rede fora') }, 'ligada', /Não consegui perguntar ao Jev/],
    [sempre({ opcao: '1', confOpcao: 0.99 }), 'sombra', /Só observando/],
  ]) {
    const s = comJev('nova', jev, modo)
    const r = await conversar(s, ['Oi', 'quero marcar uma consulta', '2', '1', 'teo'])
    assert.match(r.texto, /Não entendi\. Responda com o número do dia/)
    assert.equal(s.etapa, 'aguardando_dia')
    assert.match(r.jev.join(), frase)
  }
})

await caso('simulador: "nao entendi" que ja chamou a equipe nao ganha pergunta a mais', async () => {
  const s = comJev('com_consulta', sempre({ assunto: 'remarcar', confAssunto: 0.6 }))
  const r = await conversar(s, ['Oi', 'aquela parada de quarta la, da um jeito ai'])
  assert.match(r.texto, /passei sua mensagem para a nossa equipe/)
  assert.equal(r.respostas.some((m) => /Se for, toque em Sim/.test(m.texto)), false)
})

await caso('simulador: conversa de urgencia e ficha nao passam pelo Jev', async () => {
  const s = comJev('nova', sempre({ opcao: '1', confOpcao: 0.99 }))
  await conversar(s, ['Oi', 'quero marcar uma consulta', '2', '1', '1', '1', 'qualquer coisa estranha aqui'])
  assert.equal(s.chamadasDoJev.length, 0, 'na ficha, nao')
})

// ---------------------------------------------------------------
// O webhook faz o mesmo que o simulador
// ---------------------------------------------------------------

await caso('webhook: o caminho vem depois da segunda leitura, volta a conversa antes de rodar o robo de novo, e registra jev_caminho', () => {
  const w = ler('supabase', 'functions', 'meta-webhook', 'index.ts')
  const segunda = w.indexOf('decidirSegundaLeitura(await leituraJev')
  const trava = w.indexOf('roboTravou(resultado)')
  const volta = w.indexOf('.update(estadoParaSeguir(conversaAnterior ?? {}, caminhoJev.doMenu))')
  const deNovo = w.indexOf('const seguido = await tratarConversa({')
  assert.ok(segunda > 0 && trava > segunda, 'depois da segunda leitura')
  assert.match(w.slice(trava - 400, trava), /!decisaoJev\?\.atencao && !decisaoJev\?\.botoes/, 'urgencia vista pela segunda leitura manda')
  assert.ok(volta > trava && deNovo > volta, 'a conversa volta ao estado de antes, e so entao o robo roda de novo')
  assert.match(w, /if \(respondeu && caminhoJev\?\.acao === 'sugerir'\) \{\s*await responder\(caminhoJev\.pergunta, null, \{ botoes: \[caminhoJev\.botao\] \}\)/)
  assert.match(w, /if \(caminhoJev\) eventos\.push\(\{ evento: 'jev_caminho', detalhe: caminhoJev\.detalhe \}\)/)
  assert.match(w, /const eventos = eventosDoRobo/, 'os eventos sao os da resposta que saiu')
  assert.match(w, /texto: botaoDoJev\?\.texto \?\? escolhido/, 'o Sim da sugestao vira o que o Jev entendeu')
  assert.match(w, /chamouEquipe: Boolean\(resultado\.atencao\)/, 'com a equipe ja chamada, sem pergunta a mais')
})

conferirDesligar()
console.log(`caminho pelo jev: ${ok} casos ok`)
