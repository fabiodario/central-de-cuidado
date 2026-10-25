// Icone do aparelho no lugar da bolinha verde (21/10/2026).
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

// Vindo do sistema do Dr. Marcello (25/10/2026). Monta o modulo na hora, como os testes novos daqui.
const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'aparelho.build.mjs')
buildSync({ entryPoints: [join(AQUI, '..', 'src/lib/aparelho.ts')], bundle: true, format: 'esm', outfile: saida, logLevel: 'warning' })
const { aparelhoDaTela, aparelhosDe, descreverAparelhos } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const confere = (nome, cond, detalhe = '') => (cond ? ok++ : falhas.push(`${nome} ${detalhe}`))

const CHROME_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
confere('computador com mouse', aparelhoDaTela({ toquePrincipal: false, userAgent: CHROME_PC }) === 'computador')
confere('celular pela tela de toque', aparelhoDaTela({ toquePrincipal: true, userAgent: CHROME_PC }) === 'celular')
confere('celular pelo navegador', aparelhoDaTela({ toquePrincipal: false, userAgent: IPHONE }) === 'celular')

confere('uma aba no computador', JSON.stringify(aparelhosDe([{ aparelho: 'computador' }])) === '["computador"]')
confere('duas abas no celular contam uma vez', JSON.stringify(aparelhosDe([{ aparelho: 'celular' }, { aparelho: 'celular' }])) === '["celular"]')
confere('computador e celular: os dois, computador primeiro', JSON.stringify(aparelhosDe([{ aparelho: 'celular' }, { aparelho: 'computador' }])) === '["computador","celular"]')
confere('aba de versao antiga (sem aparelho): nenhum icone', aparelhosDe([{}]).length === 0)

confere('descricao dos dois', descreverAparelhos(['computador', 'celular']) === 'no computador e no celular')
confere('descricao do celular', descreverAparelhos(['celular']) === 'no celular')
confere('sem aparelho: online', descreverAparelhos([]) === 'online')

console.log(`aparelho: ${ok} verificacoes ok`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
