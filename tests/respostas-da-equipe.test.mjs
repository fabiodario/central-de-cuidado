// Lista "Resposta pronta..." da conversa (23/10/2026, vindo do sistema do Dr.
// Marcello): desligada aparece para a equipe, marcada "(so equipe)"; o robo
// continua usando so as ligadas. Dados inventados: o repositorio e publico.
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'respostas-da-equipe.build.mjs')
buildSync({ entryPoints: [join(AQUI, '..', 'src/lib/respostas-da-equipe.ts')], format: 'esm', outfile: saida, logLevel: 'warning' })
const { respostasDaEquipe } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const confere = (nome, cond, detalhe = '') => (cond ? ok++ : falhas.push(`${nome} ${detalhe}`))

const lista = [
  { id: 'a', assunto: 'Valor e pagamento', resposta: 'A consulta custa {valores}.', ativa: true },
  { id: 'b', assunto: 'Sobre o Dr. Fábio', resposta: 'Oi! Passando para te contar...', ativa: false },
  { id: 'c', assunto: 'Rascunho vazio', resposta: '   ', ativa: false },
]
const opcoes = respostasDaEquipe(lista)

// O texto so para a equipe so podia ficar desligado (ligado, o robo o mandaria
// sozinho), e desligado ele nao aparecia na conversa.
confere('desligada aparece para a equipe', opcoes.some((o) => o.id === 'b'))
confere('desligada vem marcada (so equipe)', opcoes.find((o) => o.id === 'b')?.rotulo === 'Sobre o Dr. Fábio (só equipe)')
confere('ligada continua com o nome de sempre', opcoes.find((o) => o.id === 'a')?.rotulo === 'Valor e pagamento')
confere('sem texto nao aparece', !opcoes.some((o) => o.id === 'c'))
confere('mantem a ordem da equipe', opcoes.map((o) => o.id).join() === 'a,b')
confere('nao perde os campos da resposta', opcoes[0].resposta === 'A consulta custa {valores}.')

console.log(`respostas da equipe: ${ok} verificacoes ok`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
