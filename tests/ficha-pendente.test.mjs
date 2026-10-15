// Reserva sem cadastro: lembrete em 6h, cancelamento em 23h
// (supabase/functions/_shared/ficha-pendente.ts). Exemplos combinados com o
// Edu em 01/10/2026. Horarios de Sao Paulo (UTC-3).
import assert from 'node:assert/strict'
import { decidir, horarios } from './ficha-pendente.build.mjs'

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

const FUSO = 'America/Sao_Paulo'
// "01/10 10:00" em Sao Paulo -> ms
const sp = (dia, hora, min = 0) => Date.UTC(2026, 9, dia, hora + 3, min)
const iso = (ms) => new Date(ms).toISOString()
const local = (ms) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))

const LONGE = iso(sp(20, 10)) // consulta bem depois de tudo

function situacao(base, extra = {}) {
  return { agora: base, ultimaDaFamilia: iso(base), lembreteEm: null, inicioDaConsulta: LONGE, fuso: FUSO, ...extra }
}

caso('marcou 10h: lembrete 16h, cancela 9h do dia seguinte', () => {
  const h = horarios(situacao(sp(1, 10)))
  assert.equal(local(h.lembrar), '01, 16:00')
  assert.equal(local(h.cancelar), '02, 09:00')
})

caso('marcou 15h: lembrete vai para 8h do dia seguinte (21h seria tarde), cancela 14h', () => {
  const h = horarios(situacao(sp(1, 15)))
  assert.equal(local(h.lembrar), '02, 08:00')
  assert.equal(local(h.cancelar), '02, 14:00')
})

caso('marcou 23h: lembrete 8h, cancelamento adiantado para 20h45 (22h seria noite)', () => {
  const h = horarios(situacao(sp(1, 23)))
  assert.equal(local(h.lembrar), '02, 08:00')
  assert.equal(local(h.cancelar), '02, 20:45')
  assert.ok(h.cancelar < h.fechaJanela, 'cancelamento dentro da janela gratis')
})

caso('marcou 2h da madrugada: lembrete 8h, cancela 20h45 do mesmo dia', () => {
  const h = horarios(situacao(sp(1, 2)))
  assert.equal(local(h.lembrar), '01, 08:00')
  assert.equal(local(h.cancelar), '01, 20:45')
})

caso('o cancelamento sempre cai dentro das 24h da ultima mensagem da familia', () => {
  for (let hora = 0; hora < 24; hora++) {
    const h = horarios(situacao(sp(1, hora)))
    assert.ok(h.cancelar <= h.fechaJanela - 30 * 60 * 1000, `marcou ${hora}h`)
    assert.ok(h.lembrar <= h.cancelar - 2 * 3600 * 1000, `marcou ${hora}h: tempo para responder`)
  }
})

caso('antes da hora do lembrete: espera', () => {
  assert.equal(decidir(situacao(sp(1, 10), { agora: sp(1, 15) })), 'esperar')
})

caso('na hora do lembrete: lembra', () => {
  assert.equal(decidir(situacao(sp(1, 10), { agora: sp(1, 16) })), 'lembrar')
})

caso('lembrete ja saiu, prazo nao venceu: espera', () => {
  assert.equal(decidir(situacao(sp(1, 10), { agora: sp(2, 8), lembreteEm: iso(sp(1, 16)) })), 'esperar')
})

caso('prazo venceu com lembrete enviado: cancela', () => {
  assert.equal(decidir(situacao(sp(1, 10), { agora: sp(2, 9), lembreteEm: iso(sp(1, 16)) })), 'cancelar')
})

caso('familia respondeu qualquer coisa: o relogio recomeca da nova mensagem', () => {
  // lembrete saiu 16h do dia 1; ela escreveu "ok, ja vejo" as 18h
  assert.equal(
    decidir({ ...situacao(sp(1, 18)), agora: sp(2, 9), lembreteEm: iso(sp(1, 16)) }),
    'esperar',
  )
})

caso('consulta antes do prazo de cancelar: chama a equipe, nao cancela', () => {
  // marcou 18h do dia 1 para 9h do dia 2
  assert.equal(
    decidir(situacao(sp(1, 18), { agora: sp(2, 17), lembreteEm: iso(sp(2, 8)), inicioDaConsulta: iso(sp(2, 9)) })),
    'chamar_equipe',
  )
})

caso('lembrete nunca saiu e o prazo passou (sistema fora do ar): chama a equipe', () => {
  assert.equal(decidir(situacao(sp(1, 10), { agora: sp(2, 9, 10) })), 'chamar_equipe')
})

caso('janela fechada: nada de texto, chama a equipe', () => {
  assert.equal(decidir(situacao(sp(1, 10), { agora: sp(2, 10, 5), lembreteEm: iso(sp(1, 16)) })), 'chamar_equipe')
  assert.equal(decidir(situacao(sp(1, 10), { agora: sp(2, 10, 5) })), 'chamar_equipe')
})

console.log(`ficha-pendente: ${ok} verificacoes ok`)
