// Gera src/lib/cid-tabela.ts a partir da CID-10 do DATASUS (15/10/2026).
//
// A tabela anterior era a da gastropediatria do Dr. Marcello (capitulos K e
// R), e o script que a gerou nunca entrou no repositorio. Este le as paginas
// da CID-10 que o DATASUS publica (versao 2008, traducao do Centro Brasileiro
// de Classificacao de Doencas), uma por agrupamento, e fica com o que cabe num
// consultorio de otorrino: o ouvido inteiro, as vias aereas superiores, os
// sintomas e algumas categorias soltas de outros capitulos (apneia do sono,
// paralisia facial, nariz torto, corpo estranho...).
//
// Uso, de dentro de sistema-followup:  node scripts/cid/gerar_tabela.mjs
//
// As paginas vem em Latin-1, com a grafia de 2008 ("Apneia" com acento,
// "neuro-sensorial"). A descricao entra como esta na pagina: o nome amigavel
// dos codigos do dia a dia mora em NOMES, no src/lib/cid.ts.
import { writeFileSync } from 'node:fs'

const BASE = 'http://www2.datasus.gov.br/cid10/V2008/WebHelp/'

// Agrupamentos inteiros. Cada um e uma pagina do site.
const AGRUPAMENTOS = [
  // Capitulo VIII: doencas do ouvido e da apofise mastoide.
  'h60_h62', 'h65_h75', 'h80_h83', 'h90_h95',
  // Capitulo X, so as vias aereas superiores: nariz, seios, faringe, laringe.
  'j00_j06', 'j30_j39',
  // Capitulo XVIII inteiro: sintomas (epistaxe, tontura, olfato, voz...).
  'r00_r09', 'r10_r19', 'r20_r23', 'r25_r29', 'r30_r39', 'r40_r46', 'r47_r49',
  'r50_r69', 'r70_r79', 'r80_r82', 'r83_r89', 'r90_r94', 'r95_r99',
]

// Categorias soltas de outros capitulos, com a pagina onde cada uma mora.
const AVULSAS = {
  G47: 'g40_g47', // disturbios do sono (G47.3 apneia de sono)
  G51: 'g50_g59', // nervo facial (G51.0 paralisia de Bell)
  K11: 'k00_k14', // glandulas salivares
  M95: 'm95_m99', // M95.0 deformidade adquirida do nariz (rinoplastia)
  Q16: 'q10_q18', // malformacoes do ouvido que afetam a audicao
  Q17: 'q10_q18', // malformacoes da orelha (Q17.5 orelha em abano)
  Q30: 'q30_q34', // malformacoes do nariz
  Q31: 'q30_q34', // malformacoes da laringe (Q31.5 laringomalacia)
  S02: 's00_s09', // S02.2 fratura dos ossos nasais
  T16: 't15_t19', // corpo estranho no ouvido
  T17: 't15_t19', // corpo estranho nas vias aereas
}

function texto(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Codigo e descricao de cada paragrafo que comeca com um codigo ("H60.0
 * Abscesso do ouvido externo"). O asterisco das categorias de manifestacao
 * ("H62.0*") sai do codigo: ninguem digita o asterisco no prontuario.
 * Paragrafos de inclusao ("Rolha de cerume") e de exclusao nao comecam com
 * codigo e ficam de fora.
 *
 * "R83.-" e a categoria cujas subdivisoes sao as do comeco do agrupamento
 * (R83 a R89 dividem a mesma lista: .0 nivel enzimatico anormal...). Entra so
 * a categoria: quem digitar R84.5 recebe o nome de R84 pelo degrau da
 * categoria, no cid.ts.
 */
function codigosDaPagina(html) {
  const achados = []
  for (const pedaco of html.split(/<P\b/i).slice(1)) {
    const linha = texto(`<P${pedaco.split(/<\/P>/i)[0]}`)
    const m = linha.match(/^([A-Z]\d{2})(\.\d|\.-)?[*†+]?\s+(.+)$/u)
    if (m) achados.push([m[2] === '.-' || !m[2] ? m[1] : m[1] + m[2], m[3].trim()])
  }
  return achados
}

async function pagina(nome) {
  const resposta = await fetch(`${BASE}${nome}.htm`)
  if (!resposta.ok) throw new Error(`${nome}.htm: HTTP ${resposta.status}`)
  return new TextDecoder('latin1').decode(await resposta.arrayBuffer())
}

const tabela = new Map()
function guardar(codigo, descricao, origem) {
  const ja = tabela.get(codigo)
  // O mesmo codigo duas vezes com textos diferentes seria o parser lendo
  // errado. Melhor parar do que gravar um dos dois calado.
  if (ja !== undefined && ja !== descricao) {
    throw new Error(`${codigo} aparece duas vezes em ${origem}: "${ja}" e "${descricao}"`)
  }
  tabela.set(codigo, descricao)
}

for (const nome of AGRUPAMENTOS) {
  const achados = codigosDaPagina(await pagina(nome))
  if (!achados.length) throw new Error(`${nome}.htm veio sem nenhum codigo: o site mudou?`)
  for (const [codigo, descricao] of achados) guardar(codigo, descricao, nome)
}

const porPagina = new Map()
for (const [categoria, nome] of Object.entries(AVULSAS)) {
  if (!porPagina.has(nome)) porPagina.set(nome, codigosDaPagina(await pagina(nome)))
  const achados = porPagina.get(nome).filter(([codigo]) => codigo.slice(0, 3) === categoria)
  if (!achados.some(([codigo]) => codigo === categoria)) {
    throw new Error(`${categoria} nao apareceu em ${nome}.htm`)
  }
  for (const [codigo, descricao] of achados) guardar(codigo, descricao, nome)
}

const codigos = [...tabela.keys()].sort()
// Travessao e meia-risca viram hifen: regra do projeto para todo texto.
const aspas = (descricao) => `'${descricao.replace(/[\u2013\u2014]/g, '-').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const linhas = codigos.map((codigo) => `  '${codigo}': ${aspas(tabela.get(codigo))},`)
const kb = Math.round(linhas.join('\n').length / 1024)

const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
const arquivo = `/**
 * A tabela oficial do CID-10 para o que este consultorio usa.
 *
 * Gerada em ${hoje} por scripts/cid/gerar_tabela.mjs, das paginas da CID-10
 * do DATASUS (versao 2008): o capitulo VIII inteiro (ouvido, H60 a H95), as
 * vias aereas superiores (J00 a J06 e J30 a J39), o capitulo XVIII inteiro
 * (sintomas, R00 a R99) e categorias de outros capitulos que caem no otorrino:
 * ${Object.keys(AVULSAS).join(', ')}.
 *
 * Ate 15/10/2026 era a tabela da gastropediatria do Dr. Marcello (capitulos K
 * e R), sem o script que a gerou.
 *
 * Sao ${codigos.length} codigos e ${kb} KB. A tabela inteira passaria de 350 KB dentro
 * do sistema, para o medico usar uma fracao disso.
 *
 * A descricao e a da pagina, com a grafia de 2008 ("Apneia" com acento,
 * "neuro-sensorial"). Os codigos do dia a dia da clinica ficam em NOMES, no
 * cid.ts, com nome curto e de gente, e ganham deste arquivo. Esta tabela e a
 * rede embaixo.
 *
 * Nao edite a mao: e saida de script.
 */
export const TABELA: Record<string, string> = {
${linhas.join('\n')}
}
`

writeFileSync(new URL('../../src/lib/cid-tabela.ts', import.meta.url), arquivo)
console.log(`cid-tabela.ts: ${codigos.length} codigos, ${kb} KB`)
