// Lista "Resposta pronta..." da conversa (23/10/2026, vindo do sistema do Dr.
// Marcello): desligada aparece para a equipe, marcada "(so equipe)"; o robo
// continua usando so as ligadas. Dados inventados: o repositorio e publico.
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'respostas-da-equipe.build.mjs')
buildSync({ entryPoints: [join(AQUI, '..', 'src/lib/respostas-da-equipe.ts')], format: 'esm', outfile: saida, logLevel: 'warning' })
const { ehRespostaProntaSemMudanca, respostasDaEquipe } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

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

// Resposta pronta sem mudanca nao segura o robo (26/10/2026, vindo do sistema
// do Dr. Marcello: la, uma familia respondeu "Oi quero marcar" a apresentacao
// do medico e o robo ficou calado).
const QUEBRA = String.fromCharCode(10)
const sobre = ['Oi! Passando para te contar...', '', 'Se quiser, te mostro os horários. É só me responder aqui 💙'].join(QUEBRA)
confere('pronta enviada como esta: automatica', ehRespostaProntaSemMudanca(sobre, [sobre]))
confere('quebras de linha e espacos nao contam como mudanca', ehRespostaProntaSemMudanca(sobre.replace(QUEBRA + QUEBRA, QUEBRA + '  '), [sobre]))
confere('equipe mudou o texto: segura o robo', !ehRespostaProntaSemMudanca(sobre + ' Abraço, Dayane', [sobre]))
confere('equipe escreveu algo antes da pronta: segura o robo', !ehRespostaProntaSemMudanca(['Bom dia, Maria!', '', sobre].join(QUEBRA), [sobre]))
confere('texto digitado sem pronta: segura o robo', !ehRespostaProntaSemMudanca('Oi, tudo bem?', []))
confere('duas prontas colocadas: vale qualquer uma enviada sozinha', ehRespostaProntaSemMudanca('Valor: R$ 450', [sobre, 'Valor: R$ 450']))
confere('campo vazio nao e pronta', !ehRespostaProntaSemMudanca('   ', ['   ']))

console.log(`respostas da equipe: ${ok} verificacoes ok`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
