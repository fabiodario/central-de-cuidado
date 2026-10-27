// O convenio na agenda (26/10/2026, vindo do sistema do Dr. Marcello): o do
// agendamento, o do cadastro, ou particular. Ver src/lib/convenio-do-horario.ts.
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'convenio-do-horario.build.mjs')
buildSync({ entryPoints: [join(AQUI, '..', 'src/lib/convenio-do-horario.ts')], format: 'esm', outfile: saida, logLevel: 'warning' })
const { convenioDoHorario } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const igual = (nome, a, b) => (a === b ? ok++ : falhas.push(`${nome}: veio ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`))

igual('o do agendamento vem primeiro', convenioDoHorario('Unimed Santos', 'Porto Saúde'), 'Unimed Santos')
igual('sem o do agendamento, o do cadastro', convenioDoHorario('', 'Porto Saúde'), 'Porto Saúde')
igual('"Particular" no agendamento nao esconde o cadastro', convenioDoHorario('Particular', 'Santa Saúde'), 'Santa Saúde')
igual('nada: particular', convenioDoHorario(null, ''), 'Particular')
igual('"particular" no cadastro: particular', convenioDoHorario(undefined, 'particular'), 'Particular')
igual('caixa alta vira um nome so no filtro', convenioDoHorario('PORTO SAÚDE', ''), 'Porto Saúde')
igual('caixa baixa tambem', convenioDoHorario('unimed santos', ''), 'Unimed Santos')
igual('grafia certa fica como esta', convenioDoHorario('SulAmérica', ''), 'SulAmérica')
igual('espacos a mais saem', convenioDoHorario('  Porto   Saúde ', ''), 'Porto Saúde')

console.log(`convenio do horario: ${ok} verificacoes ok`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
