// Receitas Memed levadas para o campo "Prescricao" do atendimento.
//
// Caso real de 23/09/2026: duas receitas na mesma consulta (um laxante as 16:26
// e uma radiografia as 16:27) e o prontuario assinado saiu so com a segunda.
// Dados abaixo sao inventados.

import { acrescentarReceitas, dataDaReceita } from './receita-no-texto.build.mjs'

let passou = 0
const falhas = []
function confere(titulo, condicao, detalhe = '') {
  if (condicao) passou++
  else falhas.push(`${titulo}${detalhe ? ` | ${detalhe}` : ''}`)
}

const LAXANTE = {
  emitidaEm: '2026-09-23T19:26:00Z',
  itens: [{ nome: 'Macrogol 4000, solução oral', posologia: 'Tomar 10 mL de 12 em 12 horas' }],
}
const EXAME = {
  emitidaEm: '2026-09-23T19:27:00Z',
  itens: [{ nome: 'Radiografia de abdome', posologia: 'Simples e sem preparo' }],
}

// 1. As duas entram, mesmo com a lista em ordem decrescente (como vem do banco).
{
  const t = acrescentarReceitas('', [EXAME, LAXANTE]) ?? ''
  confere('Duas receitas: laxante presente', t.includes('Macrogol 4000'), t)
  confere('Duas receitas: exame presente', t.includes('Radiografia de abdome'), t)
  confere('Duas receitas: a mais antiga vem primeiro', t.indexOf('Macrogol') < t.indexOf('Radiografia'), t)
}

// 2. A segunda emissao parte do texto que ja tem a primeira: nao duplica.
{
  const primeiro = acrescentarReceitas('Manter dieta.', [LAXANTE]) ?? ''
  const segundo = acrescentarReceitas(primeiro, [EXAME, LAXANTE]) ?? ''
  confere('Segunda emissao mantem a primeira', segundo.includes('Macrogol 4000'), segundo)
  confere('Segunda emissao acrescenta o exame', segundo.includes('Radiografia de abdome'), segundo)
  confere('Nao duplica o laxante', segundo.split('Macrogol 4000').length === 2, segundo)
  confere('Preserva o que o medico escreveu', segundo.startsWith('Manter dieta.'), segundo)
}

// 3. Nada novo: devolve null, para a tela nao gravar a toa.
{
  const pronto = acrescentarReceitas('', [LAXANTE, EXAME]) ?? ''
  confere('Sem novidade devolve null', acrescentarReceitas(pronto, [LAXANTE, EXAME]) === null)
}

// 4. Campo escrito no editor (HTML): acrescenta em HTML e reconhece o que ja esta.
{
  const html = '<p>Orientado sobre hidratação.</p>'
  const t = acrescentarReceitas(html, [LAXANTE, EXAME]) ?? ''
  confere('HTML: continua HTML', t.startsWith(html) && t.includes('<strong>Receita · Memed · 23/09/2026</strong>'), t)
  confere('HTML: as duas receitas', t.includes('Macrogol 4000') && t.includes('Radiografia de abdome'), t)
  confere('HTML: segunda passada nao duplica', acrescentarReceitas(t, [LAXANTE, EXAME]) === null)
}

// 5. Item sem nome nao vira linha em branco.
{
  const t = acrescentarReceitas('', [{ emitidaEm: '2026-09-23T10:00:00Z', itens: [{ nome: '  ', posologia: '' }] }])
  confere('Item sem nome e ignorado', t === null, String(t))
}

// 6. Data no fuso da clinica: 21h30 de 23/09 em Santos e 00h30 de 24/09 em UTC.
confere('Receita da noite fica no dia certo', dataDaReceita('2026-09-24T00:30:00Z') === '23/09/2026', dataDaReceita('2026-09-24T00:30:00Z'))
confere('Receita da manha', dataDaReceita('2026-09-23T12:00:00+00:00') === '23/09/2026', dataDaReceita('2026-09-23T12:00:00+00:00'))
{
  const t = acrescentarReceitas('', [{ emitidaEm: '2026-09-24T00:30:00Z', itens: [{ nome: 'Atestado', posologia: '', tipo: 'custom' }] }]) ?? ''
  confere('Titulo usa o dia local', t.includes('Atestado ou documento · Memed · 23/09/2026'), t)
}

// 7. Titulo pela categoria: pedido de exame nao sai como "Receita".
{
  const t = acrescentarReceitas('', [
    { emitidaEm: '2026-09-23T12:00:00Z', itens: [{ nome: 'Hemograma completo', posologia: '', tipo: 'exame', receituario: 'Simples' }] },
    { emitidaEm: '2026-09-23T12:01:00Z', itens: [{ nome: 'Remedio controlado', posologia: '', tipo: 'alopático', receituario: 'Notif. receita B (B1)' }] },
  ]) ?? ''
  confere('Exame sai como pedido de exames', t.includes('Pedido de exames · Memed · 23/09/2026'), t)
  confere('Controlado sai como receita especial', t.includes('Receita especial · Memed · 23/09/2026'), t)
}

console.log(`Receita no texto: ${passou} verificações passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
