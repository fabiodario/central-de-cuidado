// Parametros e texto dos modelos aprovados na Meta (03/10/2026).
//
// O acompanhamento v2 fala com os pais e usa so o primeiro nome da crianca. O
// antigo continua com o nome completo: enquanto a clinica apontar para ele, nada
// pode mudar no que sai.
import { parametrosDoAcompanhamento, textoDoModelo } from './modelos.build.mjs'

let passou = 0
const falhas = []
function conferir(titulo, condicao, detalhe = '') {
  if (condicao) passou++
  else falhas.push(`${titulo}${detalhe ? ` | ${detalhe}` : ''}`)
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

let p = parametrosDoAcompanhamento('acompanhamento_pos_consulta', 'Rafael Moreira Lima Teixeira', '18/09/2026')
conferir('Modelo antigo continua com o nome completo', igual(p, ['Rafael Moreira Lima Teixeira', '18/09/2026']), JSON.stringify(p))

p = parametrosDoAcompanhamento('acompanhamento_pos_consulta_v2', 'Rafael Moreira Lima Teixeira', '18/09/2026')
conferir('v2 usa so o primeiro nome', igual(p, ['Rafael', '18/09/2026']), JSON.stringify(p))

p = parametrosDoAcompanhamento('acompanhamento_pos_consulta_v2', 'AGATHA BETTINI DA SILVA', '01/10/2026')
conferir('v2: nome em maiusculas vira "Agatha"', p[0] === 'Agatha', p[0])

p = parametrosDoAcompanhamento('acompanhamento_pos_consulta_v2', '   ', '01/10/2026')
conferir('v2: sem nome, nunca parametro vazio', p[0] === 'a criança', p[0])

p = parametrosDoAcompanhamento('modelo_que_nao_existe', 'Ana Lima', '01/10/2026')
conferir('Modelo desconhecido: nome completo, como sempre foi', igual(p, ['Ana Lima', '01/10/2026']), JSON.stringify(p))

const texto = textoDoModelo('acompanhamento_pos_consulta_v2', ['Rafael', '18/09/2026']) ?? ''
conferir('Texto do v2 pergunta pela crianca', texto.includes('saber como Rafael está depois da consulta do dia 18/09/2026'), texto.slice(0, 120))
conferir('Texto do v2 nao pergunta "como voce esta"', !/como você está/i.test(texto))
conferir('Botao "Estamos bem" no registro', texto.includes('Estamos bem'))

console.log(`VERIFICAÇÕES QUE PASSARAM: ${passou}`)
console.log(`FALHAS: ${falhas.length}`)
if (falhas.length) {
  console.log('')
  for (const f of falhas) console.log(`✗ ${f}`)
  process.exit(1)
}
