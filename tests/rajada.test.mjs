// Mensagens em rajada (supabase/functions/_shared/rajada.ts). Caso real de
// 30/09/2026: duas mensagens com 2 segundos de diferenca, processadas juntas.
import assert from 'node:assert/strict'
import { precisaEsperar, JANELA_DA_RAJADA_MS, complementoDaRajada, rajadaJaRespondida, qualquerMensagem, anteriorEmCurso } from './rajada.build.mjs'

let ok = 0
function caso(nome, fn) {
  try {
    fn()
    ok++
  } catch (erro) {
    console.error('FALHOU:', nome)
    throw erro
  }
}

const agora = Date.parse('2026-09-30T13:59:19Z')
// O mesmo criterio do robo, simplificado: menciona nota fiscal ou recibo.
const ehNota = (corpo) => /nota fiscal|\bnf\b|recibo/i.test(corpo)
const NOTA = 'Olá bom dia Tudo bem? Meu filho passou em consulta com o dr Marcelo dia 25/09 e preciso da nota fiscal'
const ha = (ms) => new Date(agora - ms).toISOString()

caso('pedido de nota 2s antes, ainda sem resposta: espera (caso de 30/09)', () => {
  assert.equal(precisaEsperar({ direction: 'inbound', criadaEm: ha(2000), corpo: NOTA }, agora, ehNota), true)
})

caso('conversa nova (nada antes): nao espera', () => {
  assert.equal(precisaEsperar(null, agora, ehNota), false)
})

caso('a ultima e nossa: a conversa esta em dia, nao espera', () => {
  assert.equal(precisaEsperar({ direction: 'outbound', criadaEm: ha(1000), corpo: NOTA }, agora, ehNota), false)
})

caso('mensagem da familia de horas atras sem resposta nao e rajada', () => {
  assert.equal(precisaEsperar({ direction: 'inbound', criadaEm: ha(3 * 3600 * 1000), corpo: NOTA }, agora, ehNota), false)
})

caso('no limite da janela deixa de esperar', () => {
  assert.equal(precisaEsperar({ direction: 'inbound', criadaEm: ha(JANELA_DA_RAJADA_MS - 1), corpo: NOTA }, agora, ehNota), true)
  assert.equal(precisaEsperar({ direction: 'inbound', criadaEm: ha(JANELA_DA_RAJADA_MS), corpo: NOTA }, agora, ehNota), false)
})

caso('relogio torto (mensagem "do futuro") nao trava ninguem', () => {
  assert.equal(precisaEsperar({ direction: 'inbound', criadaEm: ha(-5000), corpo: NOTA }, agora, ehNota), false)
})

caso('rajada que nao e de nota fiscal nao espera (decisao de 01/10)', () => {
  assert.equal(precisaEsperar({ direction: 'inbound', criadaEm: ha(2000), corpo: 'Oi' }, agora, ehNota), false)
  assert.equal(precisaEsperar({ direction: 'inbound', criadaEm: ha(2000), corpo: 'quero marcar' }, agora, ehNota), false)
})

// 14/10/2026: o webhook espera em qualquer rajada, nao so de nota fiscal.
caso('com qualquerMensagem, "Oi" de 2s atras sem resposta faz esperar', () => {
  assert.equal(precisaEsperar({ direction: 'inbound', criadaEm: ha(2000), corpo: 'boa tarde!' }, agora, qualquerMensagem), true)
})

// Vicente ("boa tarde!" + "Tudo bem?") e Viviane (frase do site + "?").
caso('cumprimento e pontuacao sao complemento da rajada', () => {
  for (const t of ['Tudo bem?', '?', 'boa tarde!', 'Oi, tudo bem?', '🙏', 'ok', 'Tudo bem tbm']) {
    assert.equal(complementoDaRajada(t), true, t)
  }
})
caso('pedido de verdade nao e complemento', () => {
  for (const t of ['quero marcar', 'quanto custa?', 'Enquanto&', '2', 'convenio?', 'Por enquanto nao']) {
    assert.equal(complementoDaRajada(t), false, t)
  }
})

const msg = (direction, msAtras, automatic = false) => ({ direction, automatic, criadaEm: ha(msAtras) })
caso('a mensagem de 3s atras ja teve resposta do robo: rajada respondida', () => {
  assert.equal(rajadaJaRespondida([msg('outbound', 1000, true), msg('inbound', 3000)], agora), true)
})
caso('resposta foi da equipe, nao do robo: nao conta', () => {
  assert.equal(rajadaJaRespondida([msg('outbound', 1000, false), msg('inbound', 3000)], agora), false)
})
caso('mensagem anterior de minutos atras: nao e rajada', () => {
  assert.equal(rajadaJaRespondida([msg('outbound', 60000, true), msg('inbound', 62000)], agora), false)
})
caso('a ultima e da familia, sem resposta ainda: nao conta como respondida', () => {
  assert.equal(rajadaJaRespondida([msg('inbound', 1000), msg('outbound', 5000, true)], agora), false)
})
caso('conversa vazia', () => {
  assert.equal(rajadaJaRespondida([], agora), false)
})

// A fila (24/10/2026, caso do sistema do Dr. Marcello): eventos 8073 e 8074 registrados as
// 08:25:05 e 08:25:08; a primeira mensagem so foi gravada as 08:25:11.
const ev = (id, concluido = null) => ({ id, chave: `message:wamid.${id}`, concluidoEm: concluido })
caso('fila: a anterior ainda em curso, a minha espera', () => {
  assert.equal(anteriorEmCurso([ev(8073), ev(8074)], 'message:wamid.8074'), true)
})
caso('fila: a anterior concluiu, segue', () => {
  assert.equal(anteriorEmCurso([ev(8073, '2026-10-24T11:25:17Z'), ev(8074)], 'message:wamid.8074'), false)
})
caso('fila: a primeira nao espera a que chegou depois', () => {
  assert.equal(anteriorEmCurso([ev(8073), ev(8074)], 'message:wamid.8073'), false)
})
caso('fila: sem o meu registro na lista, nao espera', () => {
  assert.equal(anteriorEmCurso([ev(8073)], 'message:wamid.8074'), false)
})
caso('fila: tres seguidas, a terceira espera a segunda', () => {
  assert.equal(anteriorEmCurso([ev(1, 'x'), ev(2), ev(3)], 'message:wamid.3'), true)
})

console.log(`rajada: ${ok} verificacoes ok`)
