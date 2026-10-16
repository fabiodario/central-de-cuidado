// As telas internas no perfil do otorrino (15/10/2026).
//
// O sistema veio da gastropediatria do Dr. Marcello, e as telas ainda falavam
// dela: CID de refluxo e constipacao no painel, curva de crescimento para
// adulto, faixas etarias que acabavam em "14+" e "a familia recebe" em toda
// parte. Este teste cobre a troca e barra a volta: tela portada do sistema de
// origem com "a familia" fora do ramo da pediatria falha aqui.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { NOMES, nomeDoCid } from './cid.build.mjs'
import { TABELA } from './cid-tabela.build.mjs'
import { anosCompletos, mostraCurvaDeCrescimento } from './curvas.build.mjs'
import { contarPorFaixa, faixasEtarias } from './faixas-etarias.build.mjs'
import { avisoDoBloqueio } from './bloqueio-de-dia.build.mjs'
import { CLINICA_DR_FABIO } from './quem-atende.build.mjs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}

// ---------------------------------------------------------------- CID
// Cada codigo do dicionario curto existe na tabela oficial do DATASUS: um
// codigo digitado errado no cid.ts viraria um diagnostico que nao existe.
const foraDaTabela = Object.keys(NOMES).filter((codigo) => !TABELA[codigo])
confere('todo codigo do dicionario existe na tabela oficial', foraDaTabela.length === 0, foraDaTabela.join(', '))
confere('o dicionario cobre a rotina do otorrino', Object.keys(NOMES).length >= 60, Object.keys(NOMES).length)

for (const [codigo, nome] of [
  ['J34.2', 'Desvio do septo nasal'],
  ['J32.9', 'Sinusite crônica'],
  ['J01.9', 'Sinusite aguda'],
  ['J30.4', 'Rinite alérgica'],
  ['J35.3', 'Hipertrofia das amígdalas e das adenoides'],
  ['H66.9', 'Otite média'],
  ['H91.9', 'Perda auditiva'],
  ['H93.1', 'Zumbido'],
  ['R04.0', 'Epistaxe (sangramento nasal)'],
  ['G47.3', 'Apneia do sono'],
  ['J38.2', 'Nódulo de prega vocal'],
  ['M95.0', 'Deformidade adquirida do nariz'],
]) {
  confere(`${codigo} e ${nome}`, nomeDoCid(codigo) === nome, nomeDoCid(codigo))
}
confere('virgula do teclado numerico e minuscula', nomeDoCid(' j34,2 ') === 'Desvio do septo nasal', nomeDoCid(' j34,2 '))
confere('codigo com digito a mais cai na categoria', nomeDoCid('J32.01') === 'Sinusite crônica', nomeDoCid('J32.01'))
confere('subdivisao fora do dicionario sai da tabela oficial', nomeDoCid('H90.6') === TABELA['H90.6'], nomeDoCid('H90.6'))
confere('codigo desconhecido continua codigo', nomeDoCid('Z99.9') === 'Z99.9')

// A lista de gastro saiu: refluxo, diarreia e constipacao nao tem mais nome.
for (const codigo of ['K21.9', 'A09', 'K52.9', 'K59.0']) {
  confere(`${codigo} (gastro) nao tem mais nome`, nomeDoCid(codigo) === codigo, nomeDoCid(codigo))
}
const nomesDeGastro = Object.values(NOMES).filter((nome) => /refluxo|gastr|intestin|colite|diarreia|constipa/i.test(nome))
confere('nenhum nome do dicionario e de gastro', nomesDeGastro.length === 0, nomesDeGastro.join(', '))

// A tabela de rede e a do otorrino: ouvido, vias aereas superiores, sintomas.
const capitulos = new Set(Object.keys(TABELA).map((codigo) => codigo[0]))
confere('tabela tem ouvido, vias aereas e sintomas', ['H', 'J', 'R'].every((c) => capitulos.has(c)), [...capitulos].join(''))
confere('tabela tem o ouvido inteiro (H60 a H95)', Boolean(TABELA.H60 && TABELA.H95 && TABELA['H90.3']))
confere('tabela nao tem mais o aparelho digestivo', !TABELA.K21 && !TABELA.K59 && !TABELA.K52)
const comTravessao = Object.entries(TABELA).filter(([, descricao]) => /[\u2013\u2014]/.test(descricao))
confere('nenhuma descricao com travessao ou meia-risca', comTravessao.length === 0, JSON.stringify(comTravessao))

// ---------------------------------------------------------------- curvas
const HOJE = '2026-10-15'
confere('anos completos no dia do aniversario', anosCompletos('2008-10-15', HOJE) === 18)
confere('anos completos na vespera', anosCompletos('2008-10-16', HOJE) === 17)
confere('nascimento depois de hoje nao tem idade', anosCompletos('2027-01-01', HOJE) === null)
confere('data ilegivel nao tem idade', anosCompletos('marco de 2019', HOJE) === null)

confere('otorrino, adulto: sem curva', mostraCurvaDeCrescimento('geral', '1981-05-20', HOJE) === false)
confere('otorrino, crianca de 6 anos: com curva', mostraCurvaDeCrescimento('geral', '2020-03-02', HOJE) === true)
confere('otorrino, bebe: com curva', mostraCurvaDeCrescimento('geral', '2026-04-01', HOJE) === true)
confere('otorrino, vespera dos 18: com curva', mostraCurvaDeCrescimento('geral', '2008-10-16', HOJE) === true)
confere('otorrino, no dia dos 18: sem curva', mostraCurvaDeCrescimento('geral', '2008-10-15', HOJE) === false)
confere('otorrino, sem nascimento: sem curva', mostraCurvaDeCrescimento('geral', '', HOJE) === false)
confere('otorrino, nascimento nulo: sem curva', mostraCurvaDeCrescimento('geral', null, HOJE) === false)
confere('pediatria: curva sempre, como antes', mostraCurvaDeCrescimento('pediatria', '1981-05-20', HOJE) === true)
confere('pediatria sem nascimento: a aba fica e pede a data', mostraCurvaDeCrescimento('pediatria', '', HOJE) === true)

// ---------------------------------------------------------------- faixas etarias
const rotulos = (publico) => faixasEtarias(publico).map((f) => f.rotulo).join(' | ')
confere(
  'pediatria segue com as faixas de origem',
  rotulos('pediatria') === '0 a 2 anos | 3 a 5 anos | 6 a 9 anos | 10 a 13 anos | 14+ anos',
  rotulos('pediatria'),
)
confere('otorrino tem faixas de adulto', /18 a 39 anos/.test(rotulos('geral')) && /60\+ anos/.test(rotulos('geral')), rotulos('geral'))
const contagem = Object.fromEntries(
  contarPorFaixa([0, 5, 6, 17, 18, 39, 40, 59, 60, 92, null, null], faixasEtarias('geral')).map((f) => [f.rotulo, f.valor]),
)
confere(
  'cada idade cai na sua faixa, nos limites inclusive',
  contagem['0 a 5 anos'] === 2 &&
    contagem['6 a 12 anos'] === 1 &&
    contagem['13 a 17 anos'] === 1 &&
    contagem['18 a 39 anos'] === 2 &&
    contagem['40 a 59 anos'] === 2 &&
    contagem['60+ anos'] === 2,
  JSON.stringify(contagem),
)
const total = Object.values(contagem).reduce((a, b) => a + b, 0)
confere('nascimento em branco nao vira bebe (fica fora do grafico)', total === 10, total)

// ---------------------------------------------------------------- perfil da clinica
// O build carrega marca.ts, que le a ultima clinica do localStorage. No node
// nao ha window: sem clinica conhecida, o padrao e o Dr. Fabio.
const { publicoDaClinica } = await import('./publico.build.mjs')
confere('Dr. Fabio: fala com o paciente', publicoDaClinica(CLINICA_DR_FABIO) === 'geral')
confere('sem clinica: o Dr. Fabio, deste sistema', publicoDaClinica(null) === 'geral' && publicoDaClinica() === 'geral')
confere('clinica desconhecida: o Dr. Fabio', publicoDaClinica('outra-clinica') === 'geral')
confere('perfil de origem (c1): pediatria', publicoDaClinica('c1') === 'pediatria')
globalThis.window = { localStorage: { getItem: () => 'c1', setItem() {} } }
confere('sem clinica na tela, vale a ultima vista no navegador', publicoDaClinica() === 'pediatria')
delete globalThis.window

// ---------------------------------------------------------------- bloquear dia
const consultas = [{ startsAt: '2026-10-12T13:00:00Z', status: 'scheduled', patientName: 'Paciente A', contactName: '' }]
const doOtorrino = avisoDoBloqueio(consultas, 'geral')
confere('bloquear dia no otorrino fala do paciente', /o paciente NÃO é avisado/.test(doOtorrino.detalhe), doOtorrino.detalhe)
confere('bloquear dia no otorrino nao fala de familia', !/famíli/i.test(doOtorrino.detalhe), doOtorrino.detalhe)
const duas = avisoDoBloqueio([...consultas, { ...consultas[0], patientName: 'Paciente B' }], 'geral')
confere('com duas consultas, os pacientes', /os pacientes NÃO são avisados/.test(duas.detalhe), duas.detalhe)
confere('na pediatria o texto de origem', /as famílias NÃO são avisadas/.test(avisoDoBloqueio(consultas, 'pediatria').detalhe))

// ---------------------------------------------------------------- textos das telas
// Todo texto das telas que fala de familia ou crianca precisa estar no ramo
// da pediatria de um "geral ? ... : ..." (ou publico === 'geral'). Le o
// codigo com o compilador do TypeScript, entao comentario nao conta e texto
// quebrado em varias linhas conta.
const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const PALAVRAS = /\bfam[ií]lias?\b|\bcrian[çc]as?\b|\bseu filho\b|gastro|pedi[áa]tric/i
// O que fala de crianca e de proposito, com o motivo.
const PERMITIDOS = [
  // Previa do modelo pediatrico da Meta (v2), que so aparece com
  // acompanhamentoV2 - e o Dr. Fabio esta no modelo antigo (ver marca.ts).
  { arquivo: 'src/sections/Settings.tsx', texto: /\[primeiro nome da criança\]/ },
  // Nome oficial da caderneta do Ministerio, na referencia da curva, que no
  // otorrino so aparece para menor de idade.
  { arquivo: 'src/sections/prontuario/CurvaDeCrescimento.tsx', texto: /Caderneta da\s+Criança/ },
]

function arquivosDasTelas(pasta) {
  const lista = []
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) {
      if (nome !== 'ui') lista.push(...arquivosDasTelas(caminho))
    } else if (/\.tsx?$/.test(nome) && nome !== 'cid-tabela.ts') lista.push(caminho)
  }
  return lista
}

/** 'true' quando o ramo do perfil geral e o whenTrue; 'false', o whenFalse; null se a condicao nao e de perfil. */
function ramoDoGeral(condicao) {
  let negado = false
  let c = condicao
  while (ts.isParenthesizedExpression(c)) c = c.expression
  if (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken) {
    negado = true
    c = c.operand
  }
  let geralNoTrue = null
  if (ts.isIdentifier(c) && c.text === 'geral') geralNoTrue = true
  if (ts.isBinaryExpression(c)) {
    const literal = [c.left, c.right].find((lado) => ts.isStringLiteral(lado))?.text
    const igual = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(c.operatorToken.kind)
    const diferente = [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(c.operatorToken.kind)
    if ((literal === 'geral' || literal === 'pediatria') && (igual || diferente)) {
      geralNoTrue = (literal === 'geral') === igual
    }
  }
  if (geralNoTrue === null) return null
  return negado ? !geralNoTrue : geralNoTrue
}

const dentro = (no, ramo) => ramo.pos <= no.pos && no.end <= ramo.end

function soNaPediatria(no) {
  for (let pai = no.parent; pai; pai = pai.parent) {
    if (!ts.isConditionalExpression(pai)) continue
    const geralNoTrue = ramoDoGeral(pai.condition)
    if (geralNoTrue === null) continue
    return dentro(no, geralNoTrue ? pai.whenFalse : pai.whenTrue)
  }
  return false
}

const soltos = []
const pastas = ['src/sections', 'src/components', 'src/pages', 'src/lib'].map((p) => join(RAIZ, p))
for (const arquivo of pastas.flatMap(arquivosDasTelas)) {
  const rel = relative(RAIZ, arquivo).replace(/\\/g, '/')
  const fonte = ts.createSourceFile(arquivo, readFileSync(arquivo, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visitar = (no) => {
    const ehTexto =
      ts.isStringLiteral(no) ||
      ts.isNoSubstitutionTemplateLiteral(no) ||
      ts.isTemplateHead(no) ||
      ts.isTemplateMiddle(no) ||
      ts.isTemplateTail(no) ||
      ts.isJsxText(no)
    if (ehTexto && PALAVRAS.test(no.text)) {
      const permitido = PERMITIDOS.some((p) => p.arquivo === rel && p.texto.test(no.text))
      if (!permitido && !soNaPediatria(no)) {
        const { line } = fonte.getLineAndCharacterOfPosition(no.getStart(fonte))
        soltos.push(`${rel}:${line + 1} ${JSON.stringify(no.text.trim().slice(0, 70))}`)
      }
    }
    ts.forEachChild(no, visitar)
  }
  visitar(fonte)
}
confere(
  'nenhum texto de familia ou crianca fora do ramo da pediatria',
  soltos.length === 0,
  `\n  ${soltos.join('\n  ')}\n  (use "geral ? 'o paciente' : 'a família'", ver src/lib/publico.ts)`,
)

console.log(`Telas do otorrino: ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
