// Segunda leitura pelo Jev (17/10/2026, prototipo): a regra assimetrica.
//
// O Jev so acrescenta cuidado: nunca mexe numa urgencia que a regra pegou,
// nunca muda a resposta, e qualquer falha deixa o robo como hoje. Nada aqui
// fala com a TypeSafe: a API e um fetch falso. A medicao com o Jev de verdade
// fica fora do repositorio, em ../jev-medicao.
//
// No "npm run test:bot" desde 17/10/2026, quando o modo passou a ser ligado e
// desligado em Preferencias. Sozinho: node tests/segunda-leitura.test.mjs
// SEGUNDA_LEITURA_TS aponta para outra copia do modulo (para provar que o
// teste pega o defeito com a protecao desligada).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const fonte = process.env.SEGUNDA_LEITURA_TS ?? join(AQUI, '..', 'supabase', 'functions', '_shared', 'segunda-leitura.ts')
const saida = join(AQUI, 'segunda-leitura.build.mjs')
buildSync({ entryPoints: [fonte], format: 'esm', outfile: saida, logLevel: 'warning' })
const SL = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)
const { Simulacao } = await import(pathToFileURL(join(AQUI, 'simulador.build', 'sessao.mjs')).href)
const { IDENTIDADES, FAMILIAS } = await import(pathToFileURL(join(AQUI, 'simulador.build', 'dados.mjs')).href)

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

/** fetch falso: devolve a nota pedida para cada estado (com ou sem contexto). */
function apiFalsa({ sozinha = 0.1, comContexto = 0.1, status = 200, corpo, demora = 0, chamadas = [] } = {}) {
  return async (url, init) => {
    const pedido = JSON.parse(init.body)
    chamadas.push({ url, init, pedido })
    if (demora) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, demora)
        init.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(Object.assign(new Error('abortado'), { name: 'AbortError' }))
        })
      })
    }
    const nota = 'mensagens_anteriores' in pedido.state || 'ultima_resposta_do_robo' in pedido.state ? comContexto : sozinha
    return new Response(JSON.stringify(corpo ?? { model: pedido.model, answers: { urgencia: { type: 'noul', noul: nota } } }), { status })
  }
}
const ENTRADA = { texto: 'minha mulher ta no trabalho nao tenho como i', anteriores: ['bom dia to com tontura muito forte'], ultimaDoRobo: 'procure o pronto-socorro agora' }
const LIGADA = { modo: 'ligada', motivoDoRobo: null, roboRespondeu: true, jaTemBotaoDeUrgencia: false }
const leu = (nota) => ({ ok: true, nota, sozinha: nota, comContexto: nota, modelo: 'jev-1.13.0' })

// ---------------------------------------------------------------
// Chave e modo
// ---------------------------------------------------------------

await caso('o modo vem da opcao de Preferencias: desligada por padrao e com valor estranho', () => {
  assert.equal(SL.modoDaSegundaLeitura(undefined), 'desligada')
  assert.equal(SL.modoDaSegundaLeitura(null), 'desligada')
  assert.equal(SL.modoDaSegundaLeitura(''), 'desligada')
  assert.equal(SL.modoDaSegundaLeitura('sim'), 'desligada')
  assert.equal(SL.modoDaSegundaLeitura('desligada'), 'desligada')
  assert.equal(SL.modoDaSegundaLeitura(' Ligada '), 'ligada')
  assert.equal(SL.modoDaSegundaLeitura('sombra'), 'sombra')
})

// Ligada em Preferencias sem a chave nos segredos (17/10/2026): antes virava
// desligada calada; agora cada leitura falha como "sem chave", fica
// registrada e a tela mostra.
await caso('ligada sem a chave: falha como "sem chave", sem chamar a TypeSafe, e o registro diz', async () => {
  const chamadas = []
  for (const chave of ['', '   ', undefined]) {
    const r = await SL.lerComJev(ENTRADA, { chave, fetch: apiFalsa({ chamadas }) })
    assert.deepEqual(r, { ok: false, erro: 'sem chave' })
  }
  assert.equal(chamadas.length, 0, 'sem chave, nada sai para a TypeSafe')
  const d = SL.decidirSegundaLeitura({ ok: false, erro: 'sem chave' }, LIGADA)
  assert.deepEqual(d, { botoes: false, atencao: null, detalhe: 'falhou: sem chave' })
  assert.equal(SL.descreverLeituraDoJev(d.detalhe).tom, 'erro')
  assert.match(SL.descreverLeituraDoJev(d.detalhe).texto, /TYPESAFE_API_KEY/)
})

await caso('so mensagem escrita, com letra, em conversa que ainda nao e urgencia', () => {
  assert.equal(SL.precisaDeLeitura('to sem conseguir respira direito', false, null), true)
  assert.equal(SL.precisaDeLeitura('🚨 Urgência', true, null), false, 'toque em botao o robo ja sabe o que e')
  assert.equal(SL.precisaDeLeitura('2', false, null), false)
  assert.equal(SL.precisaDeLeitura('ta bom to indo', false, 'urgencia'), false)
  assert.equal(SL.precisaDeLeitura('ta bom to indo', false, 'sangramento'), false)
  assert.equal(SL.precisaDeLeitura('ta bom', false, 'atendente'), true)
})

// ---------------------------------------------------------------
// O estado mandado ao Jev, igual ao que foi medido
// ---------------------------------------------------------------

await caso('contexto: as 3 mensagens anteriores da pessoa e a resposta que ela leu antes de escrever', () => {
  const historico = [
    { direction: 'outbound', body: 'Entendi que é urgência...', automatic: true },
    { direction: 'inbound', body: 'tudo girando' },
    { direction: 'outbound', body: 'Olá!', automatic: true },
    { direction: 'inbound', body: 'oi' },
    { direction: 'inbound', body: 'bom dia' },
    { direction: 'inbound', body: 'antiga demais' },
  ]
  assert.deepEqual(SL.contextoDaLeitura(historico), { anteriores: ['bom dia', 'oi', 'tudo girando'], ultimaDoRobo: 'Entendi que é urgência...' })
  // Duas mensagens seguidas da pessoa: a resposta do robo e a da anterior a elas, que nao veio.
  assert.equal(SL.contextoDaLeitura([{ direction: 'inbound', body: 'a' }, { direction: 'outbound', body: 'b' }]).ultimaDoRobo, '')
  assert.equal(SL.contextoDaLeitura([{ direction: 'outbound', body: 'Oi, aqui é a Dayane', automatic: false }]).ultimaDoRobo, '(a equipe escreveu) Oi, aqui é a Dayane')
})

await caso('estado: so os campos que existem, e a resposta do robo cortada em 400 letras', () => {
  const e = SL.estadosDaLeitura('oi', [], '')
  assert.deepEqual(e.sozinha, { mensagem: 'oi' })
  assert.deepEqual(e.comContexto, { mensagem: 'oi' })
  const longa = SL.estadosDaLeitura('oi', ['a'], 'x'.repeat(900)).comContexto
  assert.equal(longa.ultima_resposta_do_robo.length, 403)
  assert.deepEqual(Object.keys(longa), ['mensagens_anteriores', 'ultima_resposta_do_robo', 'mensagem'])
})

// ---------------------------------------------------------------
// A chamada: duas leituras, a maior nota, e nunca um erro para fora
// ---------------------------------------------------------------

await caso('duas chamadas, na versao fixa do modelo, com a chave no cabecalho; vale a maior nota', async () => {
  const chamadas = []
  const r = await SL.lerComJev(ENTRADA, { chave: 'chave-de-teste', fetch: apiFalsa({ sozinha: 0.04, comContexto: 0.65, chamadas }) })
  assert.deepEqual(r, { ok: true, nota: 0.65, sozinha: 0.04, comContexto: 0.65, modelo: 'jev-1.13.0' })
  assert.equal(chamadas.length, 2)
  for (const c of chamadas) {
    assert.equal(c.url, 'https://api.typesafe.ai/v1/systemone')
    assert.equal(c.init.headers.Authorization, 'Bearer chave-de-teste')
    assert.equal(c.pedido.model, 'jev-1.13.0', 'o apelido jev-latest muda sozinho')
    assert.equal(c.pedido.questions.urgencia.type, 'noul')
  }
})

// "so sexta?? nao tem nada hj? nao consigo engolir", no meio da agenda: com a
// conversa, o Jev leu pressa para marcar (0,19); sozinha, urgencia (0,83).
await caso('a mensagem sozinha tambem vale: a maior nota vence, de qualquer lado', async () => {
  const r = await SL.lerComJev(ENTRADA, { chave: 'c', fetch: apiFalsa({ sozinha: 0.83, comContexto: 0.19 }) })
  assert.equal(r.nota, 0.83)
  assert.equal(SL.decidirSegundaLeitura(r, LIGADA).atencao, 'urgencia')
})

await caso('uma das duas falhou: vale a outra', async () => {
  let n = 0
  const metade = async (url, init) => (n++ === 0 ? new Response('erro', { status: 500 }) : apiFalsa({ sozinha: 0.7, comContexto: 0.7 })(url, init))
  const r = await SL.lerComJev(ENTRADA, { chave: 'c', fetch: metade })
  assert.equal(r.ok, true)
  assert.equal(r.nota, 0.7)
})

await caso('qualquer falha vira { ok: false }, sem erro para fora: HTTP, resposta sem nota, rede, tempo esgotado', async () => {
  assert.equal((await SL.lerComJev(ENTRADA, { chave: 'c', fetch: apiFalsa({ status: 401 }) })).ok, false)
  assert.equal((await SL.lerComJev(ENTRADA, { chave: 'c', fetch: apiFalsa({ corpo: { answers: {} } }) })).ok, false)
  assert.equal((await SL.lerComJev(ENTRADA, { chave: 'c', fetch: apiFalsa({ corpo: { answers: { urgencia: { noul: 7 } } } }) })).ok, false)
  assert.equal((await SL.lerComJev(ENTRADA, { chave: 'c', fetch: () => { throw new Error('sem rede') } })).ok, false)
  const inicio = Date.now()
  const lenta = await SL.lerComJev(ENTRADA, { chave: 'c', fetch: apiFalsa({ demora: 5000 }), tempoLimiteMs: 100 })
  assert.deepEqual(lenta, { ok: false, erro: 'tempo esgotado' })
  assert.ok(Date.now() - inicio < 1500, 'o tempo limite corta a espera')
})

// ---------------------------------------------------------------
// A decisao: so acrescenta
// ---------------------------------------------------------------

await caso('desligada, sombra ou falha: nada muda para o paciente', () => {
  for (const [leitura, modo] of [[null, 'ligada'], [leu(0.99), 'desligada'], [leu(0.99), 'sombra'], [{ ok: false, erro: 'tempo esgotado' }, 'ligada']]) {
    const d = SL.decidirSegundaLeitura(leitura, { ...LIGADA, modo })
    assert.equal(d.botoes, false, modo)
    assert.equal(d.atencao, null, modo)
  }
  assert.equal(SL.decidirSegundaLeitura(leu(0.91), { ...LIGADA, modo: 'sombra' }).detalhe, 'sombra 0.91 jev-1.13.0')
})

await caso('a regra ja acendeu urgencia ou sangramento: o Jev nao mexe, nem com nota alta', () => {
  for (const motivo of ['urgencia', 'sangramento']) {
    for (const nota of [0.01, 0.3, 0.99]) {
      const d = SL.decidirSegundaLeitura(leu(nota), { ...LIGADA, motivoDoRobo: motivo })
      assert.deepEqual([d.botoes, d.atencao], [false, null], `${motivo} ${nota}`)
      assert.match(d.detalhe, /^regra /)
    }
  }
})

await caso('os dois limiares: abaixo de 0,2 nada; de 0,2 os botoes; de 0,5 tambem a urgencia para a equipe', () => {
  assert.deepEqual(SL.decidirSegundaLeitura(leu(0.19), LIGADA), { botoes: false, atencao: null, detalhe: 'nada 0.19 jev-1.13.0' })
  assert.deepEqual(SL.decidirSegundaLeitura(leu(0.2), LIGADA), { botoes: true, atencao: null, detalhe: 'botoes 0.20 jev-1.13.0' })
  assert.deepEqual(SL.decidirSegundaLeitura(leu(0.49), LIGADA), { botoes: true, atencao: null, detalhe: 'botoes 0.49 jev-1.13.0' })
  assert.deepEqual(SL.decidirSegundaLeitura(leu(0.5), LIGADA), { botoes: true, atencao: 'urgencia', detalhe: 'urgencia 0.50 jev-1.13.0' })
  // Outro motivo da regra (pedido de gente, anexo) pode subir para urgencia.
  assert.equal(SL.decidirSegundaLeitura(leu(0.8), { ...LIGADA, motivoDoRobo: 'atendente' }).atencao, 'urgencia')
})

await caso('resposta que ja traz o botao de urgencia nao ganha outro; robo calado nao manda botao, mas acende', () => {
  assert.equal(SL.decidirSegundaLeitura(leu(0.3), { ...LIGADA, jaTemBotaoDeUrgencia: true }).botoes, false)
  assert.deepEqual(
    [SL.decidirSegundaLeitura(leu(0.9), { ...LIGADA, jaTemBotaoDeUrgencia: true }).botoes, SL.decidirSegundaLeitura(leu(0.9), { ...LIGADA, jaTemBotaoDeUrgencia: true }).atencao],
    [false, 'urgencia'],
  )
  const calado = SL.decidirSegundaLeitura(leu(0.9), { ...LIGADA, roboRespondeu: false })
  assert.deepEqual([calado.botoes, calado.atencao], [false, 'urgencia'])
  assert.equal(SL.decidirSegundaLeitura(leu(0.3), { ...LIGADA, roboRespondeu: false }).botoes, false)
})

await caso('a decisao so tem duas saidas: botoes e urgencia (nunca outro motivo, nunca apagar)', () => {
  for (let nota = 0; nota <= 1; nota += 0.05) {
    for (const motivoDoRobo of [null, 'atendente', 'anexo', 'urgencia', 'sangramento']) {
      for (const roboRespondeu of [true, false]) {
        const d = SL.decidirSegundaLeitura(leu(nota), { modo: 'ligada', motivoDoRobo, roboRespondeu, jaTemBotaoDeUrgencia: false })
        assert.ok(d.atencao === null || d.atencao === 'urgencia')
        assert.deepEqual(Object.keys(d).sort(), ['atencao', 'botoes', 'detalhe'])
        assert.ok(!d.detalhe.includes('tonto'), 'nunca o texto do paciente')
      }
    }
  }
})

await caso('o botao de urgencia na resposta: botoes do "nao entendi" ou a linha de uma lista', () => {
  assert.equal(SL.temBotaoDeUrgencia({ botoes: [{ id: 'URGENCIA' }, { id: 'E_DUVIDA' }] }), true)
  assert.equal(SL.temBotaoDeUrgencia({ lista: { linhas: [{ id: '1' }, { id: 'URGENCIA' }] } }), true)
  assert.equal(SL.temBotaoDeUrgencia({ lista: { linhas: [{ id: '1' }] } }), false)
  assert.equal(SL.temBotaoDeUrgencia(null), false)
})

// ---------------------------------------------------------------
// Os botoes sao os do motor, e o motor sabe o que fazer com eles
// ---------------------------------------------------------------

await caso('os botoes e a pergunta sao os mesmos do "nao entendi" do motor', async () => {
  let agora = Date.parse('2026-10-14T13:00:00Z')
  const s = new Simulacao(IDENTIDADES.fabio, FAMILIAS.nova, { relogio: () => new Date((agora += 30000)) })
  await s.enviarDaFamilia({ texto: 'Oi' })
  const r = await s.enviarDaFamilia({ texto: 'o menino ta esquisito desde cedo, todo largadao no sofa' })
  const comBotoes = r.respostas.find((m) => m.toques?.opcoes?.some((o) => o.id === 'URGENCIA'))
  assert.ok(comBotoes, 'o "nao entendi" do motor tem os botoes')
  assert.deepEqual(comBotoes.toques.opcoes.map((o) => ({ id: o.id, titulo: o.titulo })), SL.BOTOES_URGENCIA_OU_DUVIDA)
  assert.ok(comBotoes.texto.includes(SL.PERGUNTA_URGENCIA_OU_DUVIDA))
})

await caso('o toque em Urgencia leva ao pronto-socorro com alerta, e o de Duvida a equipe, em qualquer etapa da marcacao', async () => {
  const CAMINHOS = [['Oi'], ['Oi', '2', '2'], ['Oi', '2', '2', '4'], ['Oi', '2', '2', '4', '1'], ['Oi', '2', '2', '4', '1', '1', 'Carla Mendes Rocha', '12/03/1988']]
  for (const passos of CAMINHOS) {
    for (const botao of SL.BOTOES_URGENCIA_OU_DUVIDA) {
      let agora = Date.parse('2026-10-14T13:00:00Z')
      const s = new Simulacao(IDENTIDADES.fabio, FAMILIAS.nova, { relogio: () => new Date((agora += 30000)) })
      for (const p of passos) await s.enviarDaFamilia({ texto: p })
      const r = await s.enviarDaFamilia({ texto: botao.titulo, idDoToque: botao.id })
      const texto = r.respostas.map((m) => m.texto).join('\n')
      if (botao.id === 'URGENCIA') {
        assert.equal(r.alertas.length, 1, passos.join(','))
        assert.equal(s.motivo, 'urgencia')
        assert.match(texto, /procure atendimento/)
      } else {
        assert.equal(r.alertas.length, 0, passos.join(','))
        assert.equal(s.motivo, 'atendente')
      }
    }
  }
})

// ---------------------------------------------------------------
// Ligar e desligar em Preferencias (17/10/2026)
// ---------------------------------------------------------------

await caso('Preferencias: cada leitura registrada vira frase, com a nota em virgula; falha e possivel urgencia se destacam', () => {
  const ver = (d) => SL.descreverLeituraDoJev(d)
  assert.deepEqual(ver('sombra 0.42 jev-1.13.0'), { texto: 'Só observando: nota 0,42.', tom: 'ok' })
  assert.deepEqual(ver('nada 0.05 jev-1.13.0'), { texto: 'Nada a fazer: nota 0,05.', tom: 'ok' })
  assert.equal(ver('regra 0.90 jev-1.13.0').tom, 'ok')
  assert.equal(ver('botoes 0.31 jev-1.13.0').tom, 'alerta')
  assert.match(ver('botoes 0.31 jev-1.13.0').texto, /0,31.*Urgência e Dúvida/)
  assert.equal(ver('urgencia 0.86 jev-1.13.0').tom, 'alerta')
  assert.match(ver('urgencia 0.86 jev-1.13.0').texto, /0,86.*equipe foi avisada/)
  assert.equal(ver('falhou: tempo esgotado').tom, 'erro')
  assert.equal(ver('falhou: HTTP 401').tom, 'erro')
  assert.match(ver('falhou: HTTP 401').texto, /HTTP 401/)
  // O que a decisao escreve, a tela entende: nenhuma leitura vira "?".
  for (const nota of [0.05, 0.25, 0.6]) {
    for (const modo of ['sombra', 'ligada']) {
      const d = SL.decidirSegundaLeitura(leu(nota), { ...LIGADA, modo })
      assert.doesNotMatch(ver(d.detalhe).texto, /\?|Sem detalhe/, d.detalhe)
    }
  }
})

// Sem CR: o git no Windows grava CRLF, e os trechos procurados aqui sao com \n.
const ler = (...partes) => readFileSync(join(AQUI, '..', ...partes), 'utf8').replace(/\r\n/g, '\n')

await caso('o webhook le o modo da clinica em consulta separada, e nao mais do segredo', () => {
  const webhook = ler('supabase', 'functions', 'meta-webhook', 'index.ts')
  assert.doesNotMatch(webhook, /JEV_SEGUNDA_LEITURA/, 'o modo nao vem mais do segredo')
  assert.match(webhook, /modoDaSegundaLeitura\(opcaoDoJev\)/)
  // Coluna nova em consulta propria: o Postgres recusa a query inteira quando
  // uma coluna nao existe, e a consulta principal das preferencias levaria o
  // robo inteiro junto.
  assert.match(webhook, /\.select\('jev_segunda_leitura'\)/)
  const principal = webhook.match(/\.from\('clinic_settings'\)\s*\.select\(\s*'clinic_id,[^']*'/)
  assert.ok(principal, 'a consulta principal das preferencias')
  assert.doesNotMatch(principal[0], /jev_segunda_leitura/)
})

await caso('o banco: so tres modos, desligada por padrao, e a tela pode gravar (grant da coluna)', () => {
  const sql = ler('supabase', 'migrations', '20261017120000_segunda_leitura_do_jev.sql')
  assert.match(sql, /add column if not exists jev_segunda_leitura text not null default 'desligada'/)
  assert.match(sql, /check \(jev_segunda_leitura in \('desligada', 'sombra', 'ligada'\)\)/)
  assert.match(sql, /grant update \(jev_segunda_leitura\) on table public\.clinic_settings to authenticated/)
})

await caso('Preferencias: a secao do Jev esta na tela, so o responsavel muda, e salvar confere a linha gravada', () => {
  assert.match(ler('src', 'sections', 'Settings.tsx'), /<SegundaLeituraDoJev \/>/)
  const repo = ler('src', 'lib', 'repository.ts')
  const salvar = repo.slice(repo.indexOf('export async function saveModoDoJev'), repo.indexOf('export interface UltimaLeituraDoJev'))
  assert.match(salvar, /\.select\('jev_segunda_leitura'\)/, 'pede a linha gravada de volta')
  assert.match(salvar, /throw new Error/, 'quem nao e responsavel ve o erro, e nao "salvo"')
  const tela = ler('src', 'sections', 'SegundaLeituraDoJev.tsx')
  assert.match(tela, /membership\.role === 'owner'/, 'so o responsavel muda')
  assert.match(tela, /perguntar\(/, 'sair do desligado pede confirmacao')
})

// ---------------------------------------------------------------
// O Jev no simulador do sistema (17/10/2026): um leitor falso no lugar da
// funcao jev-ler, e a mesma decisao do webhook.
// ---------------------------------------------------------------

function simulacao() {
  let agora = Date.parse('2026-10-14T13:00:00Z')
  return new Simulacao(IDENTIDADES.fabio, FAMILIAS.nova, { relogio: () => new Date((agora += 30000)) })
}
function leitorFalso(resposta, chamadas = []) {
  return async (entrada) => {
    chamadas.push(entrada)
    if (resposta instanceof Error) throw resposta
    return typeof resposta === 'function' ? resposta(entrada) : resposta
  }
}
const textos = (r) => r.respostas.map((m) => m.texto)
const registrosDoJev = (r) => r.registros.filter((g) => g.titulo.startsWith('Jev:')).map((g) => g.titulo)

await caso('simulador com o Jev ligado: nota alta vira alerta, bandeira de urgencia e a pergunta com os botoes', async () => {
  const chamadas = []
  const s = simulacao()
  s.leitorDoJev = leitorFalso({ modo: 'ligada', leitura: leu(0.86) }, chamadas)
  const r = await s.enviarDaFamilia({ texto: 'Oi, tudo bem?' })
  assert.equal(chamadas.length, 1)
  assert.deepEqual(chamadas[0], { texto: 'Oi, tudo bem?', anteriores: [], ultimaDoRobo: '' })
  assert.equal(s.motivo, 'urgencia')
  assert.equal(r.alertas.length, 1)
  assert.match(r.alertas[0].titulo, /Urgência/)
  const ultima = r.respostas.at(-1)
  assert.equal(ultima.texto, SL.PERGUNTA_URGENCIA_OU_DUVIDA)
  assert.deepEqual(ultima.toques.opcoes.map((o) => o.id), ['URGENCIA', 'E_DUVIDA'])
  assert.deepEqual(registrosDoJev(r), ['Jev: Urgência (nota 0,86): a equipe foi avisada.'])
  assert.equal(s.ultimoModoDoJev, 'ligada')
  // A resposta da regra continua a mesma de sem o Jev, so com a pergunta depois.
  const semJev = await simulacao().enviarDaFamilia({ texto: 'Oi, tudo bem?' })
  assert.deepEqual(textos(r).slice(0, -1), textos(semJev))
})

await caso('simulador: so observando, desligado ou com falha, nada muda para o paciente; o registro diz o que houve', async () => {
  const semJev = await simulacao().enviarDaFamilia({ texto: 'Oi, tudo bem?' })
  const casos = [
    [{ modo: 'sombra', leitura: leu(0.9) }, ['Jev: Só observando: nota 0,90.']],
    [{ modo: 'desligada', leitura: null }, []],
    [new Error('sem rede'), ['Jev: não consegui perguntar (sem rede). O robô seguiu como sempre.']],
    [{ modo: 'ligada', leitura: { ok: false, erro: 'sem chave' } }, ['Jev: Falhou: falta a chave da TypeSafe nos segredos do Supabase (TYPESAFE_API_KEY).']],
  ]
  for (const [resposta, esperado] of casos) {
    const s = simulacao()
    s.leitorDoJev = leitorFalso(resposta)
    const r = await s.enviarDaFamilia({ texto: 'Oi, tudo bem?' })
    assert.deepEqual(textos(r), textos(semJev), JSON.stringify(esperado))
    assert.equal(r.alertas.length, 0)
    assert.equal(s.motivo, null)
    assert.deepEqual(registrosDoJev(r), esperado)
  }
})

await caso('simulador: o Jev le com as mensagens de antes, sem a de agora; toque em botao e anexo nao vao para ele', async () => {
  const chamadas = []
  const s = simulacao()
  s.leitorDoJev = leitorFalso({ modo: 'ligada', leitura: leu(0.05) }, chamadas)
  const primeira = await s.enviarDaFamilia({ texto: 'Oi' })
  await s.enviarDaFamilia({ texto: 'estou com tontura' })
  assert.equal(chamadas.length, 2)
  assert.deepEqual(chamadas[1].anteriores, ['Oi'])
  assert.ok(chamadas[1].ultimaDoRobo.length > 0, 'a ultima resposta do robo vai junto')
  assert.ok(primeira.respostas.map((m) => m.texto).join('\n').startsWith(chamadas[1].ultimaDoRobo.slice(0, 40)))
  await s.enviarDaFamilia({ texto: 'Marcar uma consulta', idDoToque: '2' })
  await s.enviarDaFamilia({ texto: '', anexo: true })
  assert.equal(chamadas.length, 2, 'toque e foto nao vao para o Jev')
})

await caso('simulador: com a equipe conversando e o robo calado, a urgencia do Jev acende e toca o celular, sem mandar nada', async () => {
  const s = simulacao()
  s.leitorDoJev = leitorFalso({ modo: 'ligada', leitura: leu(0.86) })
  s.responderComoEquipe('Olá, aqui é a Dayane. Em que posso ajudar?')
  const r = await s.enviarDaFamilia({ texto: 'obrigada, era so isso mesmo' })
  assert.deepEqual(textos(r), [], 'o robo fica calado com a equipe na conversa')
  assert.equal(s.motivo, 'urgencia')
  assert.equal(r.alertas.length, 1)
})

await caso('simulador sem leitor (o arquivo da reuniao): nenhum registro do Jev', async () => {
  const r = await simulacao().enviarDaFamilia({ texto: 'Oi, tudo bem?' })
  assert.deepEqual(registrosDoJev(r), [])
})

await caso('o que chega do navegador e conferido: vazio ou enorme nao vai; contexto cortado em 3', () => {
  assert.equal(SL.entradaDoSimulador(null), null)
  assert.equal(SL.entradaDoSimulador({ texto: '   ' }), null)
  assert.equal(SL.entradaDoSimulador({ texto: 'x'.repeat(2001) }), null)
  assert.deepEqual(SL.entradaDoSimulador({ texto: ' oi ', anteriores: ['a', 7, '', 'b', 'c', 'd'], ultimaDoRobo: 5 }), {
    texto: 'oi',
    anteriores: ['b', 'c', 'd'],
    ultimaDoRobo: '',
  })
})

await caso('a funcao jev-ler: so com sessao e acesso ativo, le o modo, e desligado nem chama a TypeSafe', () => {
  const funcao = ler('supabase', 'functions', 'jev-ler', 'index.ts')
  assert.match(funcao, /if \(!authorization\.startsWith\('Bearer '\)\) return json\(\{ error: 'Sessão obrigatória\.' \}, 401\)/)
  assert.match(funcao, /\.eq\('user_id', quem\.user\.id\)\s*\.eq\('status', 'active'\)/)
  assert.match(funcao, /\.select\('jev_segunda_leitura'\)/)
  const desligado = funcao.indexOf("if (modo === 'desligada') return json({ modo, leitura: null })")
  assert.ok(desligado > 0 && desligado < funcao.indexOf('lerComJev(entrada'), 'desligado volta antes de chamar a TypeSafe')
  assert.match(funcao, /Deno\.env\.get\('TYPESAFE_API_KEY'\)/)
  assert.doesNotMatch(funcao, /return json\([^)]*chave/, 'a chave nunca volta para o navegador')
  assert.match(ler('supabase', 'config.toml'), /\[functions\.jev-ler\][^[]*verify_jwt = true/)
  assert.match(ler('.github', 'workflows', 'deploy-pages.yml'), /supabase functions deploy jev-ler --project-ref/)
  // O simulador pergunta por ela, e so com a clinica do sistema.
  assert.match(ler('src', 'simulador', 'jev.ts'), /supabase\.functions\.invoke\('jev-ler'/)
  // Desde 26/10/2026 o caminho pelo Jev vem junto (ver caminho-pelo-jev.ts).
  assert.match(
    ler('src', 'simulador', 'SimuladorBot.tsx'),
    /if \(base\.jev !== undefined\) \{\s*nova\.leitorDoJev = perguntarAoJev\s*nova\.leitorDoCaminho = perguntarOCaminhoAoJev\s*\}/,
  )
})

console.log(`segunda-leitura: ${ok} casos ok`)
