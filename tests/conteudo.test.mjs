// Botoes em toda resposta que oferece opcao (supabase/functions/_shared/conteudo.ts).
import assert from 'node:assert/strict'
import { montarMensagens, toquesDoFecho } from './conteudo.build.mjs'

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

const VOLTA = 'Digite *0* a qualquer momento para voltar ao início.'
const SAIDAS = 'Digite *9* para falar com a nossa equipe, ou *0* para voltar ao início.'
const ids = (m) => m.interactive?.action?.buttons?.map((b) => b.reply.id) ?? m.interactive?.action?.sections?.[0]?.rows?.map((r) => r.id) ?? []

caso('"Consulta marcada" com o fecho de voltar ganha o botao', () => {
  const [m] = montarMensagens(`✅ *Consulta marcada!*\n\n🗓️ segunda, 05/10 às 14:00\n\n${VOLTA}`)
  assert.equal(m.type, 'interactive')
  assert.deepEqual(ids(m), ['0'])
})

caso('aviso de falha com as duas saidas ganha os dois botoes', () => {
  const [m] = montarMensagens(`Tive um problema para consultar a agenda agora.\n\n${SAIDAS}`)
  assert.deepEqual(ids(m), ['9', '0'])
})

caso('"Por nada! ... *0* para ver as opções" ganha "Ver as opções"', () => {
  const [m] = montarMensagens('😊 Por nada! Se precisar de algo, é só escrever *0* para ver as opções.')
  assert.deepEqual(ids(m), ['0'])
  assert.equal(toquesDoFecho('Digite *1* para ver outra unidade ou *0* para ver todas as opções.').botoes[0].id, '0')
})

caso('mensagem sem opcao nenhuma continua texto puro', () => {
  const [m] = montarMensagens('Anotei. Obrigado!')
  assert.equal(m.type, 'text')
})

caso('botoes pedidos pelo robo vencem os do fecho', () => {
  const [m] = montarMensagens(`Confirma?\n\n${VOLTA}`, { botoes: [{ id: '1', titulo: 'Sim' }, { id: '2', titulo: 'Não' }] })
  assert.deepEqual(ids(m), ['1', '2'])
})

// O caso de 01/10: informacoes de Santos, texto longo, lista pedida e perdida.
const LONGO =
  '💙 *Consulta em Santos: R$ 450,00.* ' + 'x'.repeat(900) + '\n\n📋 Leve um documento.\n\n' +
  'Digite *1* para ver outra unidade ou *0* para ver todas as opções.'
const LISTA = { lista: { rotulo: 'Ver opções', linhas: [{ id: '2', titulo: 'Marcar uma consulta' }, { id: '1', titulo: 'Outra unidade' }, { id: '0', titulo: 'Voltar ao menu' }] } }

caso('texto longo vira duas mensagens: conteudo, e o fecho COM a lista', () => {
  const msgs = montarMensagens(LONGO, LISTA)
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].type, 'text')
  assert.ok(msgs[0].text.body.includes('Consulta em Santos'))
  assert.equal(msgs[1].type, 'interactive')
  assert.ok(msgs[1].interactive.body.text.includes('ver outra unidade'))
  assert.deepEqual(ids(msgs[1]), ['2', '1', '0'])
  assert.ok(msgs[1].interactive.body.text.length <= 1024)
})

caso('nada se perde na divisao: as duas partes somam o texto original', () => {
  const msgs = montarMensagens(LONGO, LISTA)
  assert.equal(`${msgs[0].text.body}\n\n${msgs[1].interactive.body.text}`, LONGO)
})

console.log(`conteudo: ${ok} verificacoes ok`)
