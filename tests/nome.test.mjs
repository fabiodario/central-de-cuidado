// Nome de perfil do WhatsApp usado no convite para retomar o atendimento.
// Em 23/09/2026 um convite saiu como "retomar o atendimento com tudo bem".
// Nomes abaixo sao inventados.

import { primeiroNomeUtil } from './nome.build.mjs'

let passou = 0
const falhas = []
const casos = [
  // [nome, doCadastro, esperado]
  ['tudo bem', false, null],
  ['Tudo bem, graças a Deus', false, null],
  ['Mãe do Pedro', false, null],
  ['🌸✨', false, null],
  ['.', false, null],
  ['', false, null],
  [null, false, null],
  ['Deus é fiel', false, null],
  ['Dra. Ana', false, null],
  ['J', false, null],
  ['Helena Souza', false, 'Helena'],
  ['HELENA', false, 'Helena'],
  ['joão pedro', false, 'João'],
  ['Anne-Marie', false, 'Anne-marie'],
  // Do cadastro passa como esta, mesmo que seja estranho: foi a clinica que escreveu.
  ['Beatriz Lima', true, 'Beatriz'],
]
for (const [nome, cadastro, esperado] of casos) {
  const veio = primeiroNomeUtil(nome, cadastro)
  if (veio === esperado) passou++
  else falhas.push(`${JSON.stringify(nome)} -> esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(veio)}`)
}

console.log(`Nome no convite: ${passou} verificações passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
