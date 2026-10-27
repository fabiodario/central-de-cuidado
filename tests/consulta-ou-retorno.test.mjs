// O que o prontuario grava ao salvar (26/10/2026, vindo do sistema do
// Dr. Marcello): a escolha do medico ou a sugestao que a tela mostrava, e o
// tipo clinico acompanhando. Antes o tipo abria fixo em "Retorno". Dados
// inventados: o repositorio e publico.
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'consulta-ou-retorno.build.mjs')
buildSync({
  entryPoints: [join(AQUI, '..', 'src/lib/consulta-ou-retorno.ts')],
  bundle: true,
  format: 'esm',
  outfile: saida,
  alias: { '@': join(AQUI, '..', 'src') },
  logLevel: 'warning',
})
const { comoVisita, visitaParaGravar } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const igual = (nome, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? ok++ : falhas.push(`${nome}\n  veio:     ${JSON.stringify(a)}\n  esperado: ${JSON.stringify(b)}`))

const consulta = (data, visita = '', retornoAte = '') => ({ data, visita, retornoAte })

igual('vazio vira nulo para a regra', comoVisita(consulta('2026-09-16')), { data: '2026-09-16', visita: null, retornoAte: null })

// Sem escolha: a sugestao, com o prazo padrao.
igual('primeira visita: consulta com 30 dias', visitaParaGravar(consulta('2026-10-02'), []), { visita: 'consulta', retornoAte: '2026-11-01', tipo: 'initial' })
igual('dentro do prazo: retorno', visitaParaGravar(consulta('2026-10-02'), [consulta('2026-09-16')]), { visita: 'retorno', retornoAte: '', tipo: 'return' })
// O caso que trouxe a regra, visto do prontuario: o terceiro atendimento e consulta.
igual('depois do retorno: consulta', visitaParaGravar(consulta('2026-11-25'), [consulta('2026-09-16'), consulta('2026-10-02')]).visita, 'consulta')

// A escolha do medico passa por cima.
igual('consulta escolhida dentro do prazo', visitaParaGravar(consulta('2026-10-02', 'consulta'), [consulta('2026-09-16')]), { visita: 'consulta', retornoAte: '2026-11-01', tipo: 'initial' })
igual('retorno escolhido sem consulta antes', visitaParaGravar(consulta('2026-10-02', 'retorno'), []), { visita: 'retorno', retornoAte: '', tipo: 'return' })
igual('prazo do exame fica', visitaParaGravar(consulta('2026-10-02', 'consulta', '2026-11-30'), []).retornoAte, '2026-11-30')
igual('sem retorno fica', visitaParaGravar(consulta('2026-10-02', 'consulta', '2026-10-02'), []).retornoAte, '2026-10-02')
// Retorno nao guarda prazo: o prazo e da consulta.
igual('retorno apaga prazo esquecido', visitaParaGravar(consulta('2026-10-02', 'retorno', '2026-11-30'), []).retornoAte, '')

console.log(`consulta ou retorno: ${ok} verificacoes ok`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
