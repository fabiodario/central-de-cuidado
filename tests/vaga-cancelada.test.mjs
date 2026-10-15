// A marca de "vagou por cancelamento" nos horarios livres da Agenda.
//
// Nomes inventados: este repositorio e publico.
//
// Esta tela nao tem banco falso como o robo, entao o que se testa aqui e a
// unica regra com chance real de errar: casar o horario livre com a consulta
// cancelada. Os dois vem de lugares diferentes do Postgres e podem escrever o
// mesmo instante de formas diferentes.
//
// Como rodar:  node tests/vaga-cancelada.test.mjs

let passou = 0
const falhas = []
const conferir = (titulo, condicao, detalhe = '') => {
  if (condicao) passou++
  else falhas.push(`${titulo}${detalhe ? ` | ${detalhe}` : ''}`)
}

// A mesma regra da tela: mapa por INSTANTE, nunca por texto.
function montarMapa(vagas) {
  const mapa = new Map()
  for (const vaga of vagas) {
    const instante = new Date(vaga.quando).getTime()
    if (!Number.isNaN(instante)) mapa.set(instante, vaga)
  }
  return mapa
}
const vagou = (mapa, slot) => mapa.get(new Date(slot).getTime())

// ---------------------------------------------------------------------------

{
  // O caso que motivou o teste: o mesmo momento escrito de tres formas.
  const mapa = montarMapa([{ quando: '2026-09-23T19:40:00+00:00', paciente: 'Beatriz' }])

  conferir(
    'Mesmo instante com "Z" em vez de "+00:00" casa',
    vagou(mapa, '2026-09-23T19:40:00Z')?.paciente === 'Beatriz',
  )
  conferir(
    'Mesmo instante com milissegundos casa',
    vagou(mapa, '2026-09-23T19:40:00.000Z')?.paciente === 'Beatriz',
  )
  conferir(
    'Mesmo instante escrito no fuso de Sao Paulo casa',
    vagou(mapa, '2026-09-23T16:40:00-03:00')?.paciente === 'Beatriz',
  )
  conferir(
    'Comparar TEXTO perderia a marca (e por isso a tela nao faz isso)',
    '2026-09-23T19:40:00+00:00' !== '2026-09-23T19:40:00Z',
  )
}

{
  // Nao pode marcar horario que ninguem cancelou.
  const mapa = montarMapa([{ quando: '2026-09-23T19:40:00Z', paciente: 'Beatriz' }])
  conferir('Horario vizinho de 40min depois nao e marcado', !vagou(mapa, '2026-09-23T20:20:00Z'))
  conferir('Horario vizinho de 40min antes nao e marcado', !vagou(mapa, '2026-09-23T19:00:00Z'))
  conferir('Mesmo horario em outro dia nao e marcado', !vagou(mapa, '2026-09-24T19:40:00Z'))
}

{
  // Duas pessoas cancelaram o mesmo dia: cada horario com o seu nome.
  const mapa = montarMapa([
    { quando: '2026-09-23T17:00:00Z', paciente: 'Otávio' },
    { quando: '2026-09-23T19:40:00Z', paciente: 'Beatriz' },
  ])
  conferir('Cada vaga leva o nome certo (1)', vagou(mapa, '2026-09-23T17:00:00Z')?.paciente === 'Otávio')
  conferir('Cada vaga leva o nome certo (2)', vagou(mapa, '2026-09-23T19:40:00Z')?.paciente === 'Beatriz')
}

{
  // Data invalida vinda do banco nao pode virar uma marca fantasma em cima de
  // qualquer horario: NaN como chave casaria com qualquer outro NaN.
  const mapa = montarMapa([{ quando: 'sem data', paciente: 'Ninguem' }])
  conferir('Data invalida nao entra no mapa', mapa.size === 0)
  conferir('...e nao marca um horario qualquer', !vagou(mapa, '2026-09-23T19:40:00Z'))
}

console.log(`VERIFICAÇÕES QUE PASSARAM: ${passou}`)
console.log(`FALHAS: ${falhas.length}`)
if (falhas.length) {
  console.log('')
  for (const f of falhas) console.log(`✗ ${f}`)
  process.exit(1)
}
