// Campos que se trocam sozinhos nos textos do robo (14/10/2026).
//
// O que precisa valer: o valor do cartao da unidade chega certo na mensagem,
// nenhum "{valor}" sai cru para a familia, e a tela recusa salvar o que o robo
// nao conseguiria preencher. Valores e enderecos abaixo sao os da clinica real
// em 14/10/2026 (SP R$ 600, Santos e telemedicina R$ 450).

import {
  preencherCampos,
  problemasDoTexto,
  lerValor,
  formatarValor,
  temCampo,
  valoresEscritos,
  trocarPorCampo,
  valorDaConsulta,
} from './campos-do-texto.build.mjs'

let passou = 0
const falhas = []
function confere(titulo, veio, esperado) {
  const ok = JSON.stringify(veio) === JSON.stringify(esperado)
  if (ok) passou++
  else falhas.push(`${titulo}\n    esperado ${JSON.stringify(esperado)}\n    veio     ${JSON.stringify(veio)}`)
}
function contem(titulo, texto, trecho) {
  if (texto.includes(trecho)) passou++
  else falhas.push(`${titulo}\n    faltou ${JSON.stringify(trecho)} em ${JSON.stringify(texto)}`)
}
function naoContem(titulo, texto, trecho) {
  if (!texto.includes(trecho)) passou++
  else falhas.push(`${titulo}\n    nao devia ter ${JSON.stringify(trecho)} em ${JSON.stringify(texto)}`)
}

const SP = { id: 'sp', nome: 'Livance Ibirapuera - São Paulo', endereco: 'Av. Ibirapuera, 2120 - 20º andar', valorCentavos: 60000 }
const SANTOS = { id: 'st', nome: 'Livance · Santos', endereco: 'Av. Ana Costa, 433', valorCentavos: 45000 }
const TELE = { id: 'tele', nome: 'Telemedicina (por vídeo)', endereco: '', valorCentavos: 45000, telemedicina: true }
const TODOS = [SP, SANTOS, TELE]

// ---------------------------------------------------------------
// Valor digitado na tela
// ---------------------------------------------------------------
for (const [digitado, esperado] of [
  ['600', 60000],
  ['600,00', 60000],
  ['R$ 600,00', 60000],
  ['r$600', 60000],
  ['600.00', 60000],
  ['1.200,50', 120050],
  ['1.200', 120000],
  ['450,5', 45050],
  // Na duvida, nada: preco cem vezes maior e pior do que o cartao recusar.
  ['6,000,00', null],
  ['600,000', null],
  ['1.20', 120],
  ['abc', null],
  ['', null],
  ['0', null],
  ['-600', null],
  ['200000', null], // R$ 200 mil: digitacao, nao consulta
]) confere(`lerValor(${JSON.stringify(digitado)})`, lerValor(digitado), esperado)

// O cartao: vazio, ilegivel e baixo demais nao passam.
confere('cartao: vazio', 'erro' in valorDaConsulta('  '), true)
confere('cartao: ilegivel', 'erro' in valorDaConsulta('seiscentos'), true)
confere('cartao: R$ 1,20 e engano', 'erro' in valorDaConsulta('1.20'), true)
confere('cartao: 600', valorDaConsulta('600'), { centavos: 60000 })

confere('formatarValor 600', formatarValor(60000), 'R$ 600,00')
confere('formatarValor 1200,50', formatarValor(120050), 'R$ 1.200,50')
confere('formatarValor 45,05', formatarValor(4505), 'R$ 45,05')

// ---------------------------------------------------------------
// Preencher: o caminho feliz
// ---------------------------------------------------------------
{
  const texto = '💙 *Consulta em {unidade}: {valor}.* Inclui retorno em até 30 dias.\n\n📍 {endereco}'
  const r = preencherCampos(texto, SP, TODOS)
  confere('texto da unidade preenchido', r.texto,
    '💙 *Consulta em Livance Ibirapuera - São Paulo: R$ 600,00.* Inclui retorno em até 30 dias.\n\n📍 Av. Ibirapuera, 2120 - 20º andar')
  confere('nada faltando', r.faltando, [])
}
{
  // Acento e espaco dentro da chave: a equipe escreve como fala.
  const r = preencherCampos('Fica na { Endereço }.', SANTOS, TODOS)
  confere('chave com acento e espaco', r.texto, 'Fica na Av. Ana Costa, 433.')
}
{
  const r = preencherCampos('Valores:\n{valores}\n\nQualquer dúvida, digite 9.', null, TODOS)
  confere('lista de valores na resposta pronta', r.texto,
    'Valores:\n• Livance Ibirapuera - São Paulo: R$ 600,00\n• Livance · Santos: R$ 450,00\n• Telemedicina (por vídeo): R$ 450,00\n\nQualquer dúvida, digite 9.')
}
{
  const r = preencherCampos('{enderecos}', null, TODOS)
  confere('lista de enderecos sem a telemedicina', r.texto,
    '• Livance Ibirapuera - São Paulo: Av. Ibirapuera, 2120 - 20º andar\n• Livance · Santos: Av. Ana Costa, 433')
}
{
  // {nome} e da saudacao e e trocado em outro lugar: aqui passa intacto.
  const r = preencherCampos('Olá, {nome}! A consulta custa {valor}.', SP, TODOS)
  confere('{nome} nao e nosso', r.texto, 'Olá, {nome}! A consulta custa R$ 600,00.')
  confere('temCampo so com {nome}', temCampo('Olá, {nome}!'), false)
}
{
  // Mudou no cartao, mudou na mensagem: e o motivo de tudo isto existir.
  const r = preencherCampos('{valor}', { ...SP, valorCentavos: 65000 }, TODOS)
  confere('valor novo vale na hora', r.texto, 'R$ 650,00')
}

// ---------------------------------------------------------------
// Preencher: o que nao pode sair cru
// ---------------------------------------------------------------
{
  const texto = 'Bem-vindo!\n*Consulta: {valor}.*\nTraga a carteirinha.'
  const r = preencherCampos(texto, { ...SANTOS, valorCentavos: null }, TODOS)
  confere('sem valor: a linha cai, o resto fica', r.texto, 'Bem-vindo!\nTraga a carteirinha.')
  confere('sem valor: avisa', r.faltando, ['valor de Livance · Santos'])
}
{
  const r = preencherCampos('A consulta custa {valor}.', null, TODOS)
  naoContem('texto geral com {valor}: nao sai cru', r.texto, '{valor}')
  confere('texto geral com {valor}: avisa', r.faltando, ['valor (texto sem unidade)'])
}
{
  const r = preencherCampos('Endereço: {endereco}', TELE, TODOS)
  confere('telemedicina nao tem endereco', r.texto, '')
  confere('telemedicina sem endereco avisa', r.faltando.length, 1)
}
{
  // Lista incompleta ainda serve, mas grita.
  const r = preencherCampos('{valores}', null, [SP, { ...SANTOS, valorCentavos: null }])
  confere('lista incompleta mostra quem tem', r.texto, '• Livance Ibirapuera - São Paulo: R$ 600,00')
  confere('lista incompleta avisa quem falta', r.faltando, ['valor de Livance · Santos'])
}
{
  const r = preencherCampos('Linha 1\n\n{valor}\n\nLinha 3', null, [])
  confere('linha que cai nao deixa buraco', r.texto, 'Linha 1\n\nLinha 3')
}
{
  const texto = 'Sem campo nenhum, R$ 600,00 escrito à mão.'
  confere('texto sem campo volta igual', preencherCampos(texto, null, []).texto, texto)
}

// ---------------------------------------------------------------
// O que a tela recusa salvar
// ---------------------------------------------------------------
confere('unidade com tudo preenchido', problemasDoTexto('{unidade}: {valor} - {endereco}', 'unidade', SP, TODOS), [])
confere('texto vazio pode', problemasDoTexto('', 'unidade', SP, TODOS), [])
confere('{valor} sem valor no cartao', problemasDoTexto('{valor}', 'unidade', { ...SP, valorCentavos: null }, TODOS),
  ['Preencha o valor para usar {valor}.'])
confere('{endereco} sem endereco', problemasDoTexto('{endereco}', 'unidade', { ...SP, endereco: ' ' }, TODOS),
  ['Preencha o endereço para usar {endereco}.'])
confere('campo inventado', problemasDoTexto('{preco}', 'unidade', SP, TODOS).length, 1)
contem('campo inventado explica os certos', problemasDoTexto('{preco}', 'unidade', SP, TODOS)[0] ?? '', '{valor}')
confere('{nome} fora da saudacao e recusado', problemasDoTexto('Olá {nome}', 'geral', null, TODOS).length, 1)
contem('resposta pronta com {valor}', problemasDoTexto('{valor}', 'geral', null, TODOS)[0] ?? '', 'Use {valores}')
contem('telemedicina com {endereco}', problemasDoTexto('{endereco}', 'telemedicina', TELE, TODOS)[0] ?? '', 'não tem endereço')
confere('resposta pronta com {valores} completo', problemasDoTexto('{valores}', 'geral', null, TODOS), [])
contem('{valores} com unidade sem valor',
  problemasDoTexto('{valores}', 'geral', null, [SP, { ...SANTOS, valorCentavos: null }])[0] ?? '', 'valor de Livance · Santos')

// ---------------------------------------------------------------
// Valor escrito a mao: o aviso e a troca
// ---------------------------------------------------------------
{
  const nbsp = String.fromCharCode(160)
  const texto = `*Consulta em São Paulo: R$ 600,00.* Relatório: R$${nbsp}50. Antes era R$ 550.`
  confere('acha os valores escritos', valoresEscritos(texto).map((v) => v.centavos), [60000, 5000, 55000])
  confere('troca so o igual ao cartao', trocarPorCampo(texto, 60000),
    `*Consulta em São Paulo: {valor}.* Relatório: R$${nbsp}50. Antes era R$ 550.`)
}

console.log(`Campos do texto: ${passou} verificações passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
