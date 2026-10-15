// Categorias dos documentos da Memed no prontuario (23/09/2026).
// Os valores de tipo e receituario sao os que a Memed de fato manda.

import { categoriaDaReceita } from './categoria-da-receita.build.mjs'

let passou = 0
const falhas = []
const casos = [
  ['exame', [{ tipo: 'exame', receituario: 'Simples' }], 'exame'],
  ['varios exames', [{ tipo: 'exame', receituario: 'Simples' }, { tipo: 'exame', receituario: 'Simples' }], 'exame'],
  ['alopatico simples', [{ tipo: 'alopático', receituario: 'Simples' }], 'medicacao'],
  ['dermocosmetico', [{ tipo: 'dermocosmético', receituario: 'Simples' }], 'medicacao'],
  ['white-label', [{ tipo: 'white-label', receituario: 'Simples' }], 'medicacao'],
  ['manipulado simples', [{ tipo: 'manipulado', receituario: 'Simples' }], 'medicacao'],
  ['atestado', [{ tipo: 'custom', receituario: null }], 'documento'],
  ['antibiotico', [{ tipo: 'alopático', receituario: 'Antibióticos-2 vias' }], 'especial'],
  ['manipulado C1', [{ tipo: 'manipulado', receituario: 'Especial-2 vias (C1)' }], 'especial'],
  ['notificacao B', [{ tipo: 'alopático', receituario: 'Notif. receita B (B1)' }], 'especial'],
  ['misto com especial', [{ tipo: 'alopático', receituario: 'Simples' }, { tipo: 'alopático', receituario: 'Notif. receita B (B1)' }], 'especial'],
  ['misto exame e remedio', [{ tipo: 'exame', receituario: 'Simples' }, { tipo: 'alopático', receituario: 'Simples' }], 'medicacao'],
  ['receita antiga sem tipo', [{}], 'medicacao'],
  ['sem itens', [], 'medicacao'],
]
for (const [titulo, itens, esperado] of casos) {
  const veio = categoriaDaReceita(itens)
  if (veio === esperado) passou++
  else falhas.push(`${titulo}: esperado ${esperado}, veio ${veio}`)
}

console.log(`Categoria da receita: ${passou} verificações passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
