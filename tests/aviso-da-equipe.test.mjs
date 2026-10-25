// Quando a mensagem da familia vira notificacao no celular da equipe.
// Regra em supabase/functions/_shared/aviso-da-equipe.ts.
import assert from 'node:assert/strict'
import { montarAviso } from './aviso-da-equipe.build.mjs'

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

const base = {
  conversationId: 'c1',
  atencaoAntes: false,
  motivoAntes: null,
  motivoAgora: null,
  texto: 'Quero falar com alguém',
  pacientes: [{ name: 'Joana Lima' }],
  nomeDoPerfil: 'Mãe da Joana',
  telefone: '5513991165576',
}

caso('conversa que o robo resolveu sozinho nao avisa ninguem', () => {
  assert.equal(montarAviso(base), null)
})

caso('pediu para falar com a equipe: avisa com o nome do paciente', () => {
  const a = montarAviso({ ...base, motivoAgora: 'atendente' })
  assert.equal(a.titulo, 'Joana Lima quer falar com a equipe')
  assert.equal(a.corpo, 'Quero falar com alguém')
  assert.equal(a.etiqueta, 'conversa-c1')
  assert.equal(a.urgente, false)
})

caso('urgencia avisa marcada como urgente', () => {
  const a = montarAviso({ ...base, motivoAgora: 'urgencia', texto: 'Meu filho está vomitando sangue' })
  assert.match(a.titulo, /^🚨 Urgência: Joana Lima$/)
  assert.equal(a.urgente, true)
})

// Pedido do Dr. Fabio (15/10/2026): sangramento toca o celular dele e o da
// Dayane, urgente, e reavisa a cada mensagem nova enquanto ninguem assume.
caso('sangramento avisa marcado como urgente, e reavisa a cada mensagem', () => {
  const a = montarAviso({ ...base, motivoAgora: 'sangramento', texto: 'Meu nariz não para de sangrar' })
  assert.equal(a.titulo, '🩸 Sangramento: Joana Lima')
  assert.equal(a.corpo, 'Meu nariz não para de sangrar')
  assert.equal(a.urgente, true)
  const de_novo = montarAviso({ ...base, atencaoAntes: true, motivoAntes: 'sangramento', motivoAgora: 'sangramento', texto: 'Continua sangrando' })
  assert.equal(de_novo.titulo, '🩸 Joana Lima')
  assert.equal(de_novo.urgente, true)
})

caso('2a via e farmacia avisam', () => {
  assert.match(montarAviso({ ...base, motivoAgora: 'documento' }).titulo, /2ª via/)
  assert.match(montarAviso({ ...base, motivoAgora: 'farmacia' }).titulo, /Farmácia/)
})

caso('motivos fora da escolha da clinica nao avisam', () => {
  for (const m of ['anexo', 'ajuda', 'falha', 'cancelou_sozinho']) {
    assert.equal(montarAviso({ ...base, motivoAgora: m }), null, m)
  }
})

caso('ja na fila e escreveu de novo: avisa como mensagem, titulo so com o nome', () => {
  const a = montarAviso({ ...base, atencaoAntes: true, motivoAntes: 'atendente', motivoAgora: 'atendente', texto: 'Alguém?' })
  assert.equal(a.titulo, 'Joana Lima')
  assert.equal(a.corpo, 'Alguém?')
})

caso('na fila por urgencia e escreveu de novo: a sirene continua no titulo', () => {
  const a = montarAviso({ ...base, atencaoAntes: true, motivoAntes: 'urgencia', motivoAgora: 'urgencia' })
  assert.equal(a.titulo, '🚨 Joana Lima')
  assert.equal(a.urgente, true)
})

caso('mudou de motivo (atendente -> urgencia) conta como pedido novo', () => {
  const a = montarAviso({ ...base, atencaoAntes: true, motivoAntes: 'atendente', motivoAgora: 'urgencia' })
  assert.match(a.titulo, /Urgência/)
})

caso('irmaos no mesmo telefone: usa o nome do perfil, nao um dos filhos', () => {
  const a = montarAviso({ ...base, motivoAgora: 'atendente', pacientes: [{ name: 'Ana' }, { name: 'Bia' }] })
  assert.equal(a.titulo, 'Mãe da Joana quer falar com a equipe')
})

caso('sem cadastro e sem nome de perfil: telefone formatado', () => {
  const a = montarAviso({ ...base, motivoAgora: 'atendente', pacientes: [], nomeDoPerfil: '' })
  assert.equal(a.titulo, '(13) 99116-5576 quer falar com a equipe')
})

caso('anexo sem legenda vira texto legivel, e texto longo e cortado', () => {
  assert.equal(montarAviso({ ...base, motivoAgora: 'atendente', texto: '[audio]' }).corpo, '🎤 Áudio')
  const longo = montarAviso({ ...base, motivoAgora: 'atendente', texto: 'a'.repeat(500) }).corpo
  assert.equal(longo.length, 138)
  assert.ok(longo.endsWith('…'))
})

// Vindo do sistema do Dr. Marcello (16/10/2026): ligacao pelo WhatsApp chega
// como "[unsupported]" e so a equipe consegue responder.
caso('tentou falar (mensagem que o WhatsApp nao mostra) avisa a equipe', () => {
  const aviso = montarAviso({ ...base, motivoAgora: 'nao_suportada', texto: 'Tentou falar (talvez uma ligação pelo WhatsApp)' })
  assert.ok(aviso, 'nao_suportada deveria avisar')
  assert.match(aviso.titulo, /tentou falar com a clínica/)
})

console.log(`aviso-da-equipe: ${ok} verificacoes ok`)
