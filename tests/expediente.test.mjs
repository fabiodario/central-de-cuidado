// Frase do horario de atendimento (24/09/2026). Antes era fixa e, as 23h de
// sabado, prometia "proximo dia util" sem dizer quando.

import { avisoDeHorario, dentroDoExpediente, quandoAEquipeVolta, feriadosDoAno } from './expediente.build.mjs'

let passou = 0
const falhas = []
function igual(titulo, veio, esperado) {
  if (veio === esperado) passou++
  else falhas.push(`${titulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(veio)}`)
}

// Horarios em Brasilia (-03:00). 24/09/2026 e uma quinta-feira.
igual('quinta 10h dentro', dentroDoExpediente(new Date('2026-09-24T10:00:00-03:00')), true)
igual('quinta 18h fora', dentroDoExpediente(new Date('2026-09-24T18:00:00-03:00')), false)
igual('quinta 7h59 fora', dentroDoExpediente(new Date('2026-09-24T07:59:00-03:00')), false)
igual('sabado 10h fora', dentroDoExpediente(new Date('2026-09-26T10:00:00-03:00')), false)

igual('madrugada de quinta volta hoje', quandoAEquipeVolta(new Date('2026-09-24T02:00:00-03:00')), 'hoje, a partir das 8h')
igual('quinta a noite volta amanha', quandoAEquipeVolta(new Date('2026-09-24T21:00:00-03:00')), 'amanhã, a partir das 8h')
igual('sexta a noite volta segunda', quandoAEquipeVolta(new Date('2026-09-25T21:00:00-03:00')), 'na segunda-feira, a partir das 8h')
igual('sabado volta segunda', quandoAEquipeVolta(new Date('2026-09-26T10:00:00-03:00')), 'na segunda-feira, a partir das 8h')
igual('domingo a noite volta amanha', quandoAEquipeVolta(new Date('2026-09-27T22:00:00-03:00')), 'amanhã, a partir das 8h')

// Nao depende do fuso da maquina: 23h de sexta em Brasilia e 02h de sabado em UTC.
igual('fuso: sexta 23h de Brasilia', quandoAEquipeVolta(new Date('2026-09-26T02:00:00Z')), 'na segunda-feira, a partir das 8h')

igual('frase no horario', avisoDeHorario(new Date('2026-09-24T10:00:00-03:00')), 'Atendemos de segunda a sexta, das 8h às 18h.')
igual(
  'frase fora do horario',
  avisoDeHorario(new Date('2026-09-26T10:00:00-03:00')),
  'Agora estamos fora do horário de atendimento (segunda a sexta, das 8h às 18h). Alguém da equipe responde na segunda-feira, a partir das 8h.',
)

// Feriados (25/09/2026). 12/10/2026 e uma segunda-feira.
igual('feriado 10h nao e expediente', dentroDoExpediente(new Date('2026-10-12T10:00:00-03:00')), false)
igual(
  'frase do feriado',
  avisoDeHorario(new Date('2026-10-12T10:00:00-03:00')),
  'Hoje é feriado (Nossa Senhora Aparecida) e a equipe não está atendendo. Alguém responde amanhã, a partir das 8h.',
)
igual('sexta 11/10 a noite pula o feriado de segunda', quandoAEquipeVolta(new Date('2026-10-09T21:00:00-03:00')), 'na terça-feira, a partir das 8h')
// Pascoa de 2027: 28/03. Batem com a lista que a migration de feriados gravou.
const f27 = feriadosDoAno(2027)
igual('carnaval 2027', f27.get('2027-02-08'), 'Carnaval')
igual('cinzas 2027', f27.get('2027-02-10'), 'Quarta-feira de Cinzas')
igual('sexta-feira santa 2027', f27.get('2027-03-26'), 'Sexta-feira Santa')
igual('corpus christi 2027', f27.get('2027-05-27'), 'Corpus Christi')
// Sexta antes do Carnaval de 2027: volta so na quinta 11/02.
igual('carnaval pula para quinta', quandoAEquipeVolta(new Date('2027-02-05T21:00:00-03:00')), 'na quinta-feira, a partir das 8h')

console.log(`Expediente: ${passou} verificações passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
