// Consulta e retorno (26/10/2026, vindo do sistema do Dr. Marcello): um
// retorno por consulta, no prazo que o medico define. Dados inventados: o
// repositorio e publico.
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'prazo-do-retorno.build.mjs')
buildSync({ entryPoints: [join(AQUI, '..', 'supabase/functions/_shared/prazo-do-retorno.ts')], bundle: true, format: 'esm', outfile: saida, logLevel: 'warning' })
const { classificarVisitas, DIAS_DO_RETORNO, retornoPadrao, situacaoDoRetorno, sugestaoDeVisita, visitasDoBanco } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const confere = (nome, cond, detalhe = '') => (cond ? ok++ : falhas.push(`${nome} ${detalhe}`))
const igual = (nome, a, b) => confere(nome, JSON.stringify(a) === JSON.stringify(b), `\n  veio:     ${JSON.stringify(a)}\n  esperado: ${JSON.stringify(b)}`)

confere('prazo padrao de 30 dias', DIAS_DO_RETORNO === 30 && retornoPadrao('2026-09-16') === '2026-10-16')

// --- O caso que trouxe a regra: consulta 16/09, retorno 02/10, nada marcado ---
const caso = [{ data: '2026-09-16' }, { data: '2026-10-02' }]
igual('sequencia: consulta e depois retorno', classificarVisitas(caso).map((v) => v.tipo), ['consulta', 'retorno'])
igual('a consulta abre ate 16/10', classificarVisitas(caso)[0].ate, '2026-10-16')
igual('em 26/10 o retorno ja foi usado', situacaoDoRetorno(caso, '2026-10-26'), { tipo: 'usado', consulta: '2026-09-16', usadoEm: '2026-10-02', confirmado: false })
// O tipo antigo do prontuario (todos "Retorno") nao conta: so a coluna nova.
confere('sem marcacao, tudo e sugerido', classificarVisitas(caso).every((v) => v.sugerido))

// --- Retorno nao abre outro retorno ---
const tres = [{ data: '2026-09-01' }, { data: '2026-09-20' }, { data: '2026-10-05' }]
igual('terceira visita depois do retorno e consulta', classificarVisitas(tres).map((v) => v.tipo), ['consulta', 'retorno', 'consulta'])
igual('a terceira abre retorno novo', situacaoDoRetorno(tres, '2026-10-10'), { tipo: 'aberto', consulta: '2026-10-05', ate: '2026-11-04', confirmado: false })
// Ainda dentro dos 30 dias da primeira: o retorno ja foi usado, entao e consulta.
const noMesmoPrazo = [{ data: '2026-09-01' }, { data: '2026-09-10' }, { data: '2026-09-20' }]
igual('retorno de retorno no mesmo prazo: consulta', classificarVisitas(noMesmoPrazo).map((v) => v.tipo), ['consulta', 'retorno', 'consulta'])
// Visita depois do prazo de uma consulta sem retorno: consulta, nao retorno.
igual('visita depois do prazo e consulta', classificarVisitas([{ data: '2026-08-01' }, { data: '2026-10-02' }]).map((v) => v.tipo), ['consulta', 'consulta'])

// --- Aberto, vencido, no limite ---
const uma = [{ data: '2026-10-02' }]
igual('aberto no dia seguinte', situacaoDoRetorno(uma, '2026-10-03'), { tipo: 'aberto', consulta: '2026-10-02', ate: '2026-11-01', confirmado: false })
igual('aberto no proprio dia da consulta', situacaoDoRetorno(uma, '2026-10-02')?.tipo, 'aberto')
igual('ultimo dia ainda vale', situacaoDoRetorno(uma, '2026-11-01')?.tipo, 'aberto')
igual('um dia depois venceu', situacaoDoRetorno(uma, '2026-11-02'), { tipo: 'vencido', consulta: '2026-10-02', ate: '2026-11-01', confirmado: false })
confere('nunca veio', situacaoDoRetorno([], '2026-10-26') === null)
// Consulta marcada para depois de hoje ainda nao aconteceu.
confere('consulta futura nao conta', situacaoDoRetorno([{ data: '2026-11-10' }], '2026-10-26') === null)

// --- O prazo do medico ---
const exame = [{ data: '2026-10-02', visita: 'consulta', retornoAte: '2026-11-30' }]
igual('retorno depois do exame: vale ate 30/11', situacaoDoRetorno(exame, '2026-11-20'), { tipo: 'aberto', consulta: '2026-10-02', ate: '2026-11-30', confirmado: true })
confere('marcado pelo medico nao e sugestao', classificarVisitas(exame)[0].sugerido === false)
// Visita em 20/11 cai no prazo esticado: e o retorno.
igual('visita no prazo esticado e retorno', classificarVisitas([...exame, { data: '2026-11-20' }]).map((v) => v.tipo), ['consulta', 'retorno'])
const curto = [{ data: '2026-10-02', visita: 'consulta', retornoAte: '2026-10-15' }]
igual('prazo encurtado vence antes dos 30', situacaoDoRetorno(curto, '2026-10-20')?.tipo, 'vencido')
const sem = [{ data: '2026-10-02', visita: 'consulta', retornoAte: '2026-10-02' }]
igual('sem retorno', situacaoDoRetorno(sem, '2026-10-10'), { tipo: 'sem', consulta: '2026-10-02', confirmado: true })
igual('depois de sem retorno, a proxima e consulta', classificarVisitas([...sem, { data: '2026-10-10' }]).map((v) => v.tipo), ['consulta', 'consulta'])

// --- A marcacao do medico passa por cima da sequencia ---
// Paciente antigo (antes da plataforma): o medico marca a primeira como retorno.
const antigo = [{ data: '2026-09-16', visita: 'retorno' }, { data: '2026-10-02' }]
igual('retorno marcado na primeira, a seguinte e consulta', classificarVisitas(antigo).map((v) => v.tipo), ['retorno', 'consulta'])
// Visita dentro do prazo que o medico cobrou como consulta.
const cobrou = [{ data: '2026-09-16' }, { data: '2026-10-02', visita: 'consulta' }]
igual('consulta marcada dentro do prazo abre prazo novo', situacaoDoRetorno(cobrou, '2026-10-26'), { tipo: 'aberto', consulta: '2026-10-02', ate: '2026-11-01', confirmado: true })

// Confirmado so com as visitas que decidem marcadas no prontuario: o robo so
// fala com o paciente sobre o confirmado.
const metade = [{ data: '2026-09-16', visita: 'consulta' }, { data: '2026-10-02' }]
igual('retorno deduzido: usado, mas a confirmar', situacaoDoRetorno(metade, '2026-10-26')?.confirmado, false)
const marcadas = [{ data: '2026-09-16', visita: 'consulta' }, { data: '2026-10-02', visita: 'retorno' }]
igual('consulta e retorno marcados: usado confirmado', situacaoDoRetorno(marcadas, '2026-10-26'), { tipo: 'usado', consulta: '2026-09-16', usadoEm: '2026-10-02', confirmado: true })

// --- Duas fichas no mesmo dia sao uma visita ---
const dobrada = [{ data: '2026-10-02' }, { data: '2026-10-02', visita: 'consulta', retornoAte: '2026-11-20' }, { data: '2026-10-20' }]
igual('mesmo dia: uma visita, vale a marcacao', classificarVisitas(dobrada).map((v) => [v.data, v.tipo, v.ate]), [['2026-10-02', 'consulta', '2026-11-20'], ['2026-10-20', 'retorno', null]])
confere('data invalida e ignorada', classificarVisitas([{ data: 'ontem' }, { data: null }]).length === 0)

// --- A sugestao do prontuario ---
igual('primeira visita: consulta', sugestaoDeVisita([], '2026-10-02'), { tipo: 'consulta', consulta: null, ate: null })
igual('dentro do prazo: retorno da consulta', sugestaoDeVisita([{ data: '2026-09-16' }], '2026-10-02'), { tipo: 'retorno', consulta: '2026-09-16', ate: '2026-10-16' })
igual('retorno ja usado: consulta', sugestaoDeVisita(caso, '2026-11-25').tipo, 'consulta')
igual('fora do prazo: consulta', sugestaoDeVisita([{ data: '2026-08-01' }], '2026-10-02').tipo, 'consulta')
// A propria ficha (mesmo dia) e as de depois nao contam.
igual('ignora o proprio dia e o futuro', sugestaoDeVisita([{ data: '2026-10-02' }, { data: '2026-10-20' }], '2026-10-02').tipo, 'consulta')
// Editando o retorno de 02/10 depois de ja existir a visita de 25/11.
igual('editando a antiga, o futuro nao muda a sugestao', sugestaoDeVisita([{ data: '2026-09-16' }, { data: '2026-11-25' }], '2026-10-02').tipo, 'retorno')

// --- Do banco: prontuario e agenda que passou ---
// A consulta das 21h em Sao Paulo ja e o dia seguinte em UTC: vale o dia daqui.
const doBanco = visitasDoBanco(
  [{ consultation_date: '2026-09-16', visita: 'consulta', retorno_ate: '2026-10-20' }, { consultation_date: '2026-09-30', visita: 'coisa estranha' }],
  [{ starts_at: '2026-10-11T00:30:00Z' }],
)
igual('do banco: ficha, marca invalida vira nula, agenda no dia de Sao Paulo', doBanco, [
  { data: '2026-09-16', visita: 'consulta', retornoAte: '2026-10-20' },
  { data: '2026-09-30', visita: null, retornoAte: null },
  { data: '2026-10-10' },
])

console.log(`prazo do retorno: ${ok} verificacoes ok`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
