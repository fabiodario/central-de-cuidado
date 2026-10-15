// Alergias do prontuario -> principios ativos da Memed. Nomes e textos
// inventados; ids da Memed sao os do exemplo publico da documentacao deles.
import {
  termosDeAlergia,
  escolherIngredientes,
  primeiraPalavra,
  lerIngredientes,
} from './alergias.build.mjs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// --- o que o medico escreve ---
const casos = [
  ['Alergia a amoxicilina e dipirona', ['amoxicilina', 'dipirona'], false],
  ['Alérgico à Dipirona', ['dipirona'], false],
  ['<p>Amoxicilina</p><p>Ibuprofeno</p>', ['amoxicilina', 'ibuprofeno'], false],
  ['Alergias: cefalexina; APLV', ['cefalexina', 'aplv'], false],
  ['Nega', [], true],
  ['Nega alergias', [], true],
  ['Nenhuma conhecida', [], true],
  ['NDA', [], true],
  ['N.D.A.', [], true],
  ['Não', [], true],
  ['', [], false],
  ['<p><br></p>', [], false],
  ['Nega alergia medicamentosa. APLV', ['aplv'], false],
  ['dipirona (urticária em 2024)', ['dipirona'], false],
  ['Amoxicilina, amoxicilina', ['amoxicilina'], false],
  ['alergia medicamentosa a sulfametoxazol', ['sulfametoxazol'], false],
]
for (const [texto, termos, sem] of casos) {
  const r = termosDeAlergia(texto)
  confere(`termos de "${texto}"`, igual(r.termos, termos), JSON.stringify(r))
  confere(`semAlergia de "${texto}"`, r.semAlergia === sem, JSON.stringify(r))
}
confere('no maximo 10 termos', termosDeAlergia('aaa1,aaa2,aaa3,aaa4,aaa5,aaa6,aaa7,aaa8,aaa9,aaa10,aaa11,aaa12').termos.length === 10)

// --- o que vem da Memed ---
const busca = [
  { id: 622, nome: 'dipirona' },
  { id: 900, nome: 'dipirona sódica' },
  { id: 174, nome: 'amoxicilina' },
  { id: 175, nome: 'amoxicilina + clavulanato de potássio' },
  { id: 50, nome: 'benzilpenicilina benzatina' },
]
confere('nome igual ganha sozinho', igual(escolherIngredientes('Dipirona', busca).map((c) => c.id), [622]))
confere('sem igual, vale quem comeca pelo termo', igual(escolherIngredientes('dipirona', busca.slice(1)).map((c) => c.id), [900]))
confere('"contem" nao vale (penicilina x benzilpenicilina)', escolherIngredientes('penicilina', busca).length === 0)
confere('termo que nao existe nao casa', escolherIngredientes('aplv', busca).length === 0)
confere('acento nao atrapalha', igual(escolherIngredientes('dipirona sodica', busca).map((c) => c.id), [900]))
confere('id invalido e descartado', escolherIngredientes('x', [{ id: NaN, nome: 'x' }]).length === 0)

confere('composto usa a primeira palavra', primeiraPalavra('amoxicilina com clavulanato') === 'amoxicilina')
confere('palavra curta nao vira busca', primeiraPalavra('acido acetilsalicilico') === null)
confere('termo simples nao tem segunda tentativa', primeiraPalavra('dipirona') === null)

// --- formato da resposta ---
confere(
  'le id em texto e "name"',
  igual(lerIngredientes({ data: [{ id: '622', attributes: { name: 'dipirona' } }] }), [{ id: 622, nome: 'dipirona' }]),
)
confere(
  'le "nome" tambem',
  igual(lerIngredientes({ data: [{ id: 174, attributes: { nome: 'amoxicilina' } }] }), [{ id: 174, nome: 'amoxicilina' }]),
)
confere('resposta estranha vira lista vazia', igual(lerIngredientes({ erro: 'x' }), []) && igual(lerIngredientes(null), []))

console.log(`Alergias: ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
